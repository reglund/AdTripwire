#!/usr/bin/env node
/**
 * Local synthetic fixture server for manual verification in Firefox. Serves pages and
 * scripts under reserved .test hostnames that are mapped to 127.0.0.1 via the Firefox
 * pref network.dns.localDomains (see docs/testing.md). Nothing here contacts the internet.
 *
 *   node scripts/fixture-server.mjs [port=8787]
 *
 * Scenarios (open in Firefox with a DEV build of the extension):
 *   http://publisher.synthetic-site.test:PORT/benign        ordinary third-party ad, no detections expected
 *   http://publisher.synthetic-site.test:PORT/exposure      NOAS getAd script returning 0 bytes (informational)
 *   http://publisher.synthetic-site.test:PORT/selected      NOAS getAd returning JS that injects a 1x1 iframe to C2 host (chain)
 *   http://publisher.synthetic-site.test:PORT/ioc           plain image beacon to a synthetic malicious host
 */
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 8787);
const H = {
  publisher: `publisher.synthetic-site.test:${port}`,
  ads: `ads.synthetic-benign.test:${port}`,
  noas: `noas.synthetic-adfection.test:${port}`,
  c2: `c2.synthetic-adfection.test:${port}`,
  validator: `validator.synthetic-adfection.test:${port}`,
  staging: `staging.synthetic-dsp.test:${port}`,
};

// Scenario pages reload themselves every 30 s so that a sensor registered after the first
// load (e.g. the opt-in page sensor, registered once the extension finishes initialising)
// observes a later load. Creative and helper pages do not refresh.
const page = (
  title,
  body,
  refresh = false,
) => `<!doctype html><meta charset="utf-8"><title>${title}</title>
${refresh ? '<meta http-equiv="refresh" content="30">' : ""}
<h1>${title}</h1><p>Synthetic AdTripwire fixture. No real infrastructure is contacted.</p>${body}`;

const adFrame = (inner) =>
  `<iframe title="ad" width="300" height="250" src="http://${H.ads}/creative?${inner}"></iframe>`;

const routes = {
  // Headless Chrome accepts a single start URL: this page embeds every scenario as an iframe.
  "/all": () =>
    page(
      "All scenarios",
      ["/benign", "/exposure", "/selected", "/ioc"]
        .map(
          (p) =>
            `<h2>${p}</h2><iframe title="scenario ${p}" width="600" height="320" src="http://${H.publisher}${p}"></iframe>`,
        )
        .join(""),
      true,
    ),
  "/benign": () => page("Benign ad", adFrame("mode=benign"), true),
  // Diagnostic: a web page that fetches the mock runtime on loopback and logs the outcome.
  "/fetchtest": () =>
    page(
      "Loopback fetch test",
      `<script>fetch("http://127.0.0.1:${port}/api/tags").then(r=>r.json()).then(j=>console.log("[FetchTest] ok "+JSON.stringify(j))).catch(e=>console.log("[FetchTest] fail "+e.name+" "+e.message));</script>`,
    ),
  "/exposure": () => page("NOAS exposure (empty response)", adFrame("mode=exposure"), true),
  "/selected": () => page("NOAS selected (JS returned)", adFrame("mode=selected"), true),
  "/ioc": () =>
    page(
      "Known IOC beacon",
      `<img src="http://${H.c2}/pixel.gif?x=1" width="1" height="1" alt="">`,
      true,
    ),
  "/creative": (q) => {
    const mode = q.get("mode") ?? "benign";
    if (mode === "benign")
      return page("Creative", `<script src="http://${H.ads}/ad.js?w=300&h=250&slot=top"></script>`);
    const idfa = "00000000-0000-0000-0000-000000000000";
    return page(
      "Creative",
      `<div id="ad-wrapper"><script src="http://${H.noas}/getAd?idfa=${idfa}&ipv4=192.0.2.1&dom=publisher.synthetic-site.test&devicemodel=test&os=test&mode=${esc(mode)}"></script></div>`,
    );
  },
  "/ad.js": () => ({
    type: "application/javascript",
    body: `document.body.insertAdjacentHTML("beforeend","<p>benign ad script loaded</p>");`,
  }),
  "/getAd": (q) => {
    if (q.get("mode") === "selected") {
      return {
        type: "application/javascript",
        body: `(function(){var f=document.createElement("iframe");f.style.cssText="width:1px;height:1px;border:none";f.src="http://${H.staging}/iframe?impid=synthetic";document.body.appendChild(f);
var s=document.createElement("script");s.id="getAdScript";s.src="http://${H.validator}/check.js?q=c3ludGhldGlj";document.body.appendChild(s);})();`,
      };
    }
    return { type: "application/javascript", body: "" };
  },
  "/iframe": () =>
    page("staging frame", `<img src="http://${H.c2}/pixel.gif?t=1" width="1" height="1" alt="">`),
  "/check.js": () => ({
    type: "application/javascript",
    body: "/* synthetic validator response */",
  }),
  "/pixel.gif": () => ({
    type: "image/gif",
    body: Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"),
  }),
};

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Mock of an Ollama-compatible runtime for the --assist self-test. The canned answer
// deliberately contains a compromise claim and an unknown hostname so the browser-level test
// can assert that the guardrails remove and mask them. CORS mirrors Ollama's defaults for
// extension origins.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  // Chromium Private Network Access: a page may need this on the preflight to reach loopback.
  "access-control-allow-private-network": "true",
};
const MOCK_ANSWER =
  "What was observed\nA script request reached noas.synthetic-adfection.test from an ad frame. Your device is infected. Traffic also went to evil.attacker.example.\n\nSensible next steps\nExport a hand-off package.";
function mockRuntime(req, res, url) {
  if (url.pathname.startsWith("/api/")) console.log(`mock runtime: ${req.method} ${url.pathname}`);
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS).end();
    return true;
  }
  if (url.pathname === "/api/tags" && req.method === "GET") {
    res
      .writeHead(200, { ...CORS, "content-type": "application/json" })
      .end(JSON.stringify({ models: [{ name: "mock-model" }] }));
    return true;
  }
  if (url.pathname === "/api/chat" && req.method === "POST") {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      let model = "?";
      try {
        model = JSON.parse(body).model;
      } catch {
        /* ignore */
      }
      console.log(`mock runtime: chat request for model ${model}, ${body.length} bytes`);
      res.writeHead(200, { ...CORS, "content-type": "application/json" }).end(
        JSON.stringify({
          model,
          message: { role: "assistant", content: MOCK_ANSWER },
          done: true,
        }),
      );
    });
    return true;
  }
  return false;
}

createServer((req, res) => {
  if (process.env.FIXTURE_LOG) console.log(`fixture: ${req.method} ${req.headers.host}${req.url}`);
  let url;
  try {
    url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  } catch {
    res.writeHead(400).end("bad request");
    return;
  }
  if (mockRuntime(req, res, url)) return;
  const handler = routes[url.pathname];
  if (!handler) {
    res.writeHead(404).end("not found");
    return;
  }
  const out = handler(url.searchParams);
  if (typeof out === "string") {
    res
      .writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" })
      .end(out);
  } else {
    res
      .writeHead(200, {
        "content-type": out.type,
        "content-length": Buffer.byteLength(out.body),
        "cache-control": "no-store",
      })
      .end(out.body);
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`fixture server on http://127.0.0.1:${port}`);
  console.log(
    `Start Firefox with: web-ext run -s apps/extension-firefox/dist --pref network.dns.localDomains=${Object.values(
      H,
    )
      .map((h) => h.split(":")[0])
      .join(",")}`,
  );
  console.log(`Then open http://${H.publisher}/benign | /exposure | /selected | /ioc`);
});
