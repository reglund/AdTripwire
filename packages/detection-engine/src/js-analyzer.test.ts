import { describe, expect, it } from "vitest";
import { JS_MARKER_DESCRIPTIONS, analyzeJavaScript } from "./js-analyzer.js";

const POSITIVE: Record<string, string> = {
  "js.new_function": 'var f = new Function("return (" + code + ")");',
  "js.eval": "var r = eval(payload);",
  "js.websocket": 'var s = new WebSocket("wss://x.test/ws");',
  "js.webrtc": "var pc = new RTCPeerConnection(cfg); pc.createDataChannel('c');",
  "js.webtransport": 'var t = new WebTransport("https://x.test/wt");',
  "js.postmessage_wildcard": "window.parent.postMessage({ type: 'x' }, '*');",
  "js.iframe_create": "var f = document.createElement('iframe');",
  "js.iframe_1x1": 'f.style.cssText = "width:1px;height:1px;border:none";',
  "js.script_inject":
    'var s = document.createElement("script"); s.src = u; document.head.appendChild(s);',
  "js.cookie_read": "var c = document.cookie.split(';');",
  "js.cookie_tilde_join": "parts.join('~~~')",
  "js.image_beacon": "var i = new Image(); i.src = url;",
  "js.high_entropy_hints": "navigator.userAgentData.getHighEntropyValues(['model'])",
  "js.webgl_renderer": "gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)",
  "js.battery": "navigator.getBattery().then(b => b.level)",
  "js.performance_memory": "var m = performance.memory.usedJSHeapSize;",
  "js.webdriver_probe": "if (navigator.webdriver) return;",
  "js.error_stack_trap": "Object.defineProperty(err, 'stack', { get: function () { trap(); } });",
  "js.doh_cloudflare": 'fetch("https://cloudflare-dns.com/dns-query?name=" + h + "&type=A")',
  "js.raw_ip_fetch": 'fetch("https://" + ip + "/json", { mode: "no-cors" })',
  "js.adfection_sdk_auth": "window.SDK_AUTH = { remainingRequests: 3 };",
  "js.adfection_sdk_ready": "{ type: 'analytics_sdk_ready' }",
  "js.adfection_script_tok": 'u = base + "sdk.js?script_tok=" + t;',
  "js.adfection_getad_script_id": 's.id = "getAdScript";',
  "js.crypto_subtle": "crypto.subtle.importKey(a, b, c)",
  "js.ecdh": '{ name: "ECDH", namedCurve: "P-256" }',
  "js.aes_cbc": '{ name: "AES-CBC", iv: iv }',
  "js.rsa_oaep": '{ name: "RSA-OAEP" }',
  "js.obfuscation_bang_bracket": "var a = !![]; var b = !0x0;",
  "js.timer_polling": "setInterval(function () { poll(); }, 1000);",
};

const BENIGN = `
  function renderBanner(container, width, height) {
    var element = document.getElementById(container);
    element.style.width = width + "px";
    element.textContent = "Advertisement";
    window.addEventListener("resize", function () { layout(element); });
    setTimeout(function () { layout(element); }, 100);
    window.parent.postMessage({ type: "resize" }, "https://publisher.synthetic-benign.test");
  }
`;

describe("analyzeJavaScript", () => {
  for (const [marker, code] of Object.entries(POSITIVE)) {
    it(`detects ${marker}`, () => {
      expect(analyzeJavaScript(code).markers).toContain(marker);
    });
  }

  it("raw IP literal and template forms", () => {
    expect(analyzeJavaScript('fetch("https://203.0.113.5/json")').markers).toContain(
      "js.raw_ip_fetch",
    );
    expect(analyzeJavaScript("fetch(`https://${ip}/json`)").markers).toContain("js.raw_ip_fetch");
    expect(
      analyzeJavaScript('fetch("https://example.synthetic-benign.test/json")').markers,
    ).not.toContain("js.raw_ip_fetch");
  });

  it("iframe_1x1 via property assignment near iframe", () => {
    const code = "var f = document.createElement('iframe'); f.width = 1; f.height = 1;";
    expect(analyzeJavaScript(code).markers).toEqual(
      expect.arrayContaining(["js.iframe_create", "js.iframe_1x1"]),
    );
  });

  it("benign ad rendering code yields no markers", () => {
    expect(analyzeJavaScript(BENIGN).markers).toEqual([]);
  });

  it("negatives for near-miss forms", () => {
    expect(analyzeJavaScript("obj.evaluate(x); model.eval(y);").markers).not.toContain("js.eval");
    expect(analyzeJavaScript("postMessage(msg, origin)").markers).not.toContain(
      "js.postmessage_wildcard",
    );
    expect(analyzeJavaScript("setInterval(tick, 60000)").markers).not.toContain("js.timer_polling");
    expect(analyzeJavaScript("var x = 'width:10px;height:10px'").markers).not.toContain(
      "js.iframe_1x1",
    );
    expect(analyzeJavaScript("document.createElement('script')").markers).not.toContain(
      "js.script_inject",
    );
  });

  it("every marker has a description and all emitted markers are documented", () => {
    const all = Object.values(POSITIVE).join("\n");
    for (const m of analyzeJavaScript(all).markers) expect(JS_MARKER_DESCRIPTIONS[m]).toBeTruthy();
    for (const m of Object.keys(POSITIVE)) expect(JS_MARKER_DESCRIPTIONS[m]).toMatch(/\.$/);
    expect(JS_MARKER_DESCRIPTIONS["js.obfuscation_hex_escapes"]).toBeTruthy();
    expect(JS_MARKER_DESCRIPTIONS["js.obfuscation_short_identifiers"]).toBeTruthy();
  });

  describe("obfuscation statistics", () => {
    it("hex escapes", () => {
      const r = analyzeJavaScript('var s = "' + "\\x61\\x62\\x63".repeat(50) + '";');
      expect(r.stats.escapeRatio).toBeGreaterThan(0.05);
      expect(r.markers).toContain("js.obfuscation_hex_escapes");
      expect(analyzeJavaScript(BENIGN).stats.escapeRatio).toBe(0);
    });

    it("short identifiers over >= 200 identifiers", () => {
      const code = Array.from({ length: 120 }, (_, i) => `a${i % 10}=b(c);`).join("");
      const r = analyzeJavaScript(code);
      expect(r.stats.avgIdentifierLength).toBeLessThan(2.5);
      expect(r.markers).toContain("js.obfuscation_short_identifiers");
      // fewer than 200 identifiers: no marker
      expect(analyzeJavaScript("a=b(c);d=e(f);").markers).not.toContain(
        "js.obfuscation_short_identifiers",
      );
      expect(analyzeJavaScript(BENIGN.repeat(10)).markers).not.toContain(
        "js.obfuscation_short_identifiers",
      );
    });

    it("string literal count", () => {
      expect(analyzeJavaScript(`var a = "x", b = 'y\\'z', c = \`t\`;`).stats.stringLiterals).toBe(
        3,
      );
    });
  });

  it("caps analysis at maxChars", () => {
    const code = " ".repeat(1000) + "eval(x)";
    expect(analyzeJavaScript(code, { maxChars: 500 }).markers).not.toContain("js.eval");
    expect(analyzeJavaScript(code, { maxChars: 500 }).stats.length).toBe(500);
    expect(analyzeJavaScript(code).markers).toContain("js.eval");
    const big = "x".repeat(300000);
    expect(analyzeJavaScript(big).stats.length).toBe(262144);
  });

  it("never returns input text", () => {
    const sentinel = "SENTINEL_9f8e7d_secret_cookie_value";
    const code = `document.cookie = "${sentinel}"; new Function("${sentinel}"); fetch("https://" + ${sentinel} + "/json");`;
    const r = analyzeJavaScript(code);
    expect(JSON.stringify(r)).not.toContain(sentinel);
    expect(Object.keys(r).sort()).toEqual(["markers", "stats"]);
    for (const m of r.markers) expect(m).toMatch(/^js\.[a-z0-9_]+$/);
  });

  it("stays fast on adversarial input", () => {
    const adversarial =
      "postMessage(".repeat(5000) +
      "defineProperty('stack'".repeat(5000) +
      "setInterval(".repeat(5000) +
      "width:1px ".repeat(5000);
    const start = performance.now();
    analyzeJavaScript(adversarial);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

describe("ReDoS resistance (review H1)", () => {
  it("analyses pathological whitespace-heavy inputs within a time budget", async () => {
    const { analyzeJavaScript } = await import("./js-analyzer.js");
    const cases = [
      "width:1px" + " ".repeat(262_000) + "X",
      "postMessage(" + " ".repeat(262_000) + "x",
      "setInterval(" + " ".repeat(262_000) + "x",
      "createElement(" + "'".repeat(100_000) + "iframe",
      '"'.repeat(262_000),
      "\\x41".repeat(60_000),
      "a ".repeat(131_000),
    ];
    for (const input of cases) {
      const t0 = performance.now();
      analyzeJavaScript(input);
      const ms = performance.now() - t0;
      expect(ms, `input starting ${input.slice(0, 12)} took ${ms.toFixed(0)} ms`).toBeLessThan(300);
    }
  });
});
