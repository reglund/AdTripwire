import { describe, expect, it } from "vitest";
import {
  JS_COLOCATION_MAX_CHARS,
  JS_MARKER_DESCRIPTIONS,
  analyzeJavaScript,
  buildCodeView,
} from "./js-analyzer.js";

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
    expect(Object.keys(r).sort()).toEqual(["markers", "proximity", "stats"]);
    for (const m of r.markers) expect(m).toMatch(/^js\.[a-z0-9_]+$/);
    for (const v of Object.values(r.proximity)) expect(typeof v).toBe("number");
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
      // Phase 2 regexes and scanners
      "fetch(" + " ".repeat(262_000) + "x",
      "document[" + " ".repeat(262_000) + "x",
      "getExtension(" + " ".repeat(262_000) + "x",
      "__defineGetter__(" + " ".repeat(262_000) + "x",
      "width=1" + " ".repeat(262_000) + "x",
      "width=1;".repeat(30_000),
      "setInterval(f," + "(".repeat(100_000),
      "setInterval(".repeat(20_000),
      "/".repeat(262_000),
      "/[".repeat(130_000),
      "`${".repeat(80_000),
      "'webdriver'".repeat(20_000),
      "/*" + "x".repeat(2_000) + ".min.js" + " ".repeat(200_000),
    ];
    for (const input of cases) {
      const t0 = performance.now();
      analyzeJavaScript(input);
      const ms = performance.now() - t0;
      expect(ms, `input starting ${input.slice(0, 12)} took ${ms.toFixed(0)} ms`).toBeLessThan(300);
    }
  });
});

describe("context-aware analysis (Phase 2)", () => {
  it("code view blanks comments and literal contents while keeping offsets", () => {
    const src = `a(1); // eval(x)\nvar s = "new Function(";/* WebSocket */ var t = \`x\${eval(y)}z\`; var r = /eval(/;`;
    const code = buildCodeView(src);
    expect(code.length).toBe(src.length);
    expect(code).not.toContain("// eval");
    expect(code).not.toContain("new Function");
    expect(code).not.toContain("WebSocket");
    expect(code).toContain('"'); // delimiters kept
    expect(code).toContain("eval(y)"); // template substitution is code
    expect(code.indexOf("var t")).toBe(src.indexOf("var t"));
    expect(code.slice(code.indexOf("var r"))).not.toContain("eval");
  });

  it("markers inside comments and strings no longer fire; real code still does", () => {
    expect(analyzeJavaScript("// eval(x)\nvar a = 1;").markers).not.toContain("js.eval");
    expect(analyzeJavaScript("/* eval(x) */ var a = 1;").markers).not.toContain("js.eval");
    expect(analyzeJavaScript('var msg = "new Function(x)";').markers).not.toContain(
      "js.new_function",
    );
    expect(analyzeJavaScript("var doc = 'new WebSocket(u)';").markers).not.toContain(
      "js.websocket",
    );
    expect(analyzeJavaScript("// setInterval(f, 10)").markers).not.toContain("js.timer_polling");
    expect(analyzeJavaScript('log("document.cookie")').markers).not.toContain("js.cookie_read");
    expect(analyzeJavaScript("// document.createElement('iframe')").markers).not.toContain(
      "js.iframe_create",
    );
    expect(analyzeJavaScript("// navigator.webdriver").markers).not.toContain("js.webdriver_probe");
    expect(analyzeJavaScript("eval(x)").markers).toContain("js.eval");
    expect(analyzeJavaScript('var f = new Function("a", "return a");').markers).toContain(
      "js.new_function",
    );
    expect(analyzeJavaScript('if ("webdriver" in navigator) {}').markers).toContain(
      "js.webdriver_probe",
    );
    expect(analyzeJavaScript('var c = document["cookie"];').markers).toContain("js.cookie_read");
    expect(analyzeJavaScript("var t = `a${eval(x)}b`;").markers).toContain("js.eval");
  });

  it("string-content markers still read literal text", () => {
    const r = analyzeJavaScript(
      "parent.postMessage({type:'analytics_sdk_ready'}, '*'); var u = 'sdk.js?script_tok=' + t; x.join('~~~');",
    );
    expect(r.markers).toEqual(
      expect.arrayContaining([
        "js.adfection_sdk_ready",
        "js.adfection_script_tok",
        "js.cookie_tilde_join",
        "js.postmessage_wildcard",
      ]),
    );
    expect(analyzeJavaScript("// postMessage(m, '*')").markers).not.toContain(
      "js.postmessage_wildcard",
    );
  });

  it("records the first offset of each marker", () => {
    const src = "var a = 1;\neval(x);\neval(y);\nnew WebSocket(u);";
    const r = analyzeJavaScript(src);
    expect(r.proximity["js.websocket"]).toBe(src.indexOf("WebSocket"));
    expect(Math.abs(r.proximity["js.eval"]! - src.indexOf("eval(x)"))).toBeLessThanOrEqual(1);
  });

  it("co-location: dynamic code + transport + crypto only combine within the threshold", () => {
    const near = "var k = crypto.subtle; var s = new WebSocket(u); var f = new Function(p);";
    expect(analyzeJavaScript(near).markers).toContain("js.colocated_dynamic_transport");
    const far =
      "var k = crypto.subtle;" +
      " ".repeat(JS_COLOCATION_MAX_CHARS + 100) +
      "var s = new WebSocket(u); var f = new Function(p);";
    const r = analyzeJavaScript(far);
    expect(r.markers).toEqual(
      expect.arrayContaining(["js.crypto_subtle", "js.websocket", "js.new_function"]),
    );
    expect(r.markers).not.toContain("js.colocated_dynamic_transport");
  });

  it("co-location: cookie read and beacon", () => {
    const near = "var c = document.cookie; var i = new Image(); i.src = u + c;";
    expect(analyzeJavaScript(near).markers).toContain("js.colocated_cookie_exfil");
    const far = "var c = document.cookie;" + ";".repeat(5000) + "var i = new Image(); i.src = u;";
    expect(analyzeJavaScript(far).markers).not.toContain("js.colocated_cookie_exfil");
  });

  it("minified-bundle baseline suppresses short identifiers unless other obfuscation is present", () => {
    const body = Array.from({ length: 120 }, (_, i) => `a${i % 10}=b(c);`).join("");
    expect(analyzeJavaScript(body).markers).toContain("js.obfuscation_short_identifiers");
    for (const banner of ["/*! lib v1 | MIT */\n", "/* lib.min.js */\n"]) {
      expect(analyzeJavaScript(banner + body).markers).not.toContain(
        "js.obfuscation_short_identifiers",
      );
    }
    expect(analyzeJavaScript(body + "\n//# sourceMappingURL=app.js.map").markers).not.toContain(
      "js.obfuscation_short_identifiers",
    );
    expect(analyzeJavaScript("/*! lib */\n" + body + "var z=!![];").markers).toEqual(
      expect.arrayContaining(["js.obfuscation_short_identifiers", "js.obfuscation_bang_bracket"]),
    );
  });

  it("timer_polling reads the interval of the setInterval call itself", () => {
    expect(analyzeJavaScript("setInterval(function(){ g(a, 5); }, 60000)").markers).not.toContain(
      "js.timer_polling",
    );
    expect(analyzeJavaScript("setInterval(tick, 60000); h(x, 100)").markers).not.toContain(
      "js.timer_polling",
    );
    expect(analyzeJavaScript("setInterval(function(){ g(a, 50000); }, 500)").markers).toContain(
      "js.timer_polling",
    );
    expect(analyzeJavaScript('setInterval(f, 1000, "a,b)")').markers).toContain("js.timer_polling");
    expect(analyzeJavaScript("setInterval(f, delay)").markers).not.toContain("js.timer_polling");
  });

  it("iframe_1x1 property form requires 'iframe' within 600 chars", () => {
    const near = "var f = document.createElement('iframe'); f.width = 1; f.height = 1;";
    expect(analyzeJavaScript(near).markers).toContain("js.iframe_1x1");
    const far = "img.width = 1; img.height = 1;" + " ".repeat(700) + "var t = 'iframe';";
    expect(analyzeJavaScript(far).markers).not.toContain("js.iframe_1x1");
  });
});
