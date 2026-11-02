import { describe, expect, it } from "vitest";
import { hostnameOf, originOf, sanitizedUrlToString, sanitizeUrl } from "./sanitize-url.js";

function must(raw: string) {
  const r = sanitizeUrl(raw);
  if (!r) throw new Error(`expected sanitizeUrl to succeed for ${raw}`);
  return r;
}

describe("sanitizeUrl basics", () => {
  it("returns null for unparseable input", () => {
    expect(sanitizeUrl("")).toBeNull();
    expect(sanitizeUrl("not a url")).toBeNull();
    expect(sanitizeUrl("http://")).toBeNull();
    expect(sanitizeUrl("//example.com/x")).toBeNull();
  });

  it("returns null for hostless URLs (data:, file:, about:)", () => {
    expect(sanitizeUrl("data:text/plain;base64,c2VjcmV0")).toBeNull();
    expect(sanitizeUrl("file:///etc/passwd")).toBeNull();
    expect(sanitizeUrl("about:blank")).toBeNull();
    expect(sanitizeUrl("javascript:alert(1)")).toBeNull();
  });

  it("handles a plain ad request", () => {
    expect(must("https://noas.mtrtb.com/getAd?idfa&ipv4")).toEqual({
      scheme: "https",
      hostname: "noas.mtrtb.com",
      pathPattern: "/getAd",
      queryParamNames: ["idfa", "ipv4"],
      redacted: false,
    });
  });

  it("lower-cases hostnames and strips trailing dots", () => {
    expect(must("https://NoAs.MTRTB.com./getAd").hostname).toBe("noas.mtrtb.com");
  });

  it("converts IDN hosts to punycode", () => {
    expect(must("https://bücher.example/x").hostname).toBe("xn--bcher-kva.example");
  });

  it("keeps IPv6 literals in bracket form", () => {
    expect(must("http://[::1]:8080/x").hostname).toBe("[::1]");
  });
});

describe("schemes and ports", () => {
  it("maps http/https/ws/wss", () => {
    expect(must("http://a.example/").scheme).toBe("http");
    expect(must("https://a.example/").scheme).toBe("https");
    expect(must("ws://a.example/").scheme).toBe("ws");
    expect(must("wss://a.example/").scheme).toBe("wss");
  });

  it("maps everything else to other", () => {
    expect(must("ftp://a.example/x").scheme).toBe("other");
    expect(must("moz-extension://abc/x").scheme).toBe("other");
  });

  it("omits default ports and keeps non-default", () => {
    expect(must("https://a.example:443/").port).toBeUndefined();
    expect(must("http://a.example:80/").port).toBeUndefined();
    expect(must("wss://a.example:443/").port).toBeUndefined();
    expect(must("ws://a.example:80/").port).toBeUndefined();
    expect(must("https://a.example:8443/").port).toBe(8443);
    expect(must("http://a.example:443/").port).toBe(443);
    expect("port" in must("https://a.example/")).toBe(false);
  });
});

describe("secrets are dropped", () => {
  it("drops userinfo", () => {
    const r = must("https://user:pass@a.example/getAd");
    expect(r.redacted).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/user|pass|@/);
    expect(must("https://tokenonly@a.example/").redacted).toBe(true);
  });

  it("drops fragments", () => {
    const r = must("https://a.example/getAd#access_token=SECRETSECRET123");
    expect(r.redacted).toBe(true);
    expect(JSON.stringify(r)).not.toContain("SECRET");
    expect(JSON.stringify(r)).not.toContain("access_token");
  });

  it("an empty fragment marker is not a redaction", () => {
    expect(must("https://a.example/getAd#").redacted).toBe(false);
  });

  it("keeps param names, not values", () => {
    const r = must("https://a.example/p?cookie=abc~~~def&idfa=X");
    expect(r.queryParamNames).toEqual(["cookie", "idfa"]);
    expect(r.redacted).toBe(true);
    expect(JSON.stringify(r)).not.toContain("abc~~~def");
  });

  it("includes names even when values are empty, without marking redacted", () => {
    const r = must("https://a.example/p?idfa=&ipv4&x=");
    expect(r.queryParamNames).toEqual(["idfa", "ipv4", "x"]);
    expect(r.redacted).toBe(false);
  });

  it("lower-cases, de-duplicates, sorts and skips empty names", () => {
    const r = must("https://a.example/p?B=1&a=2&b=3&&=zz&A");
    expect(r.queryParamNames).toEqual(["a", "b"]);
  });

  it("decodes percent-encoded names but never values", () => {
    const r = must("https://a.example/p?user%5Fid=SECRETVALUE1234&e%2Dmail=1");
    expect(r.queryParamNames).toEqual(["e-mail", "user_id"]);
  });

  it("tolerates malformed percent-encoding in names", () => {
    const r = must("https://a.example/p?%E0%A4%A=1");
    expect(r.queryParamNames.length).toBe(1);
  });

  it("masks long token-like names and marks redacted", () => {
    const r = must(`https://a.example/p?${"n".repeat(100)}`);
    expect(r.queryParamNames).toEqual(["{token}"]);
    expect(r.redacted).toBe(true);
  });
  it("truncates long non-token names to 40 chars and marks redacted", () => {
    const name = "utm.source_campaign_medium_content_term_extra";
    const r = must(`https://a.example/p?${name}=1`);
    expect(r.queryParamNames).toEqual([name.slice(0, 40)]);
    expect(r.redacted).toBe(true);
  });

  it("caps names at 50 and marks redacted", () => {
    const q = Array.from({ length: 80 }, (_, i) => `p${String(i).padStart(3, "0")}`).join("&");
    const r = must(`https://a.example/p?${q}`);
    expect(r.queryParamNames).toHaveLength(50);
    expect(r.redacted).toBe(true);
  });

  it("does not parse ';' as a parameter separator and never leaks values with it", () => {
    const r = must("https://a.example/p?a=1;secretvalue1234=2");
    expect(JSON.stringify(r)).not.toContain("secretvalue1234");
  });
});

describe("pathPattern", () => {
  it("replaces hex tokens with {id}", () => {
    const r = must("https://a.example/u/5f4dcc3b5aa765d61d8327deb882cf99/track");
    expect(r.pathPattern).toBe("/u/{id}/track");
    expect(r.redacted).toBe(true);
  });

  it("replaces UUIDs with {id}", () => {
    expect(must("https://a.example/d/123e4567-e89b-12d3-a456-426614174000/x").pathPattern).toBe(
      "/d/{id}/x",
    );
  });

  it("replaces long base64url-ish tokens with {id}", () => {
    expect(must("https://a.example/t/Abc_def-GhiJklMnoPqrStu/x").pathPattern).toBe("/t/{id}/x");
  });

  it("replaces digit-heavy segments with {id}", () => {
    expect(must("https://a.example/o/1234567890/x").pathPattern).toBe("/o/{id}/x");
    expect(must("https://a.example/o/ab123456/x").pathPattern).toBe("/o/{id}/x");
  });

  it("keeps short numeric segments like api versions", () => {
    expect(must("https://a.example/v1/v2.0/x").pathPattern).toBe("/v1/v2.0/x");
    expect(must("https://a.example/12345/x").pathPattern).toBe("/12345/x");
  });

  it("replaces key=value path params with {id}", () => {
    expect(must("https://a.example/x;jsessionid=ABC/y").pathPattern).toBe("/{id}/y");
    expect(must("https://a.example/a=b/y").pathPattern).toBe("/{id}/y");
  });

  it("replaces percent-encoded segments with {seg}", () => {
    const r = must("https://a.example/a%20b/x");
    expect(r.pathPattern).toBe("/{seg}/x");
    expect(r.redacted).toBe(true);
    expect(must("https://a.example/%E2%9C%93").pathPattern).toBe("/{seg}");
  });

  it("replaces non-ascii and unusual-character segments with {seg}", () => {
    expect(must("https://a.example/café/x").pathPattern).toBe("/{seg}/x");
    expect(must("https://a.example/a,b/x").pathPattern).toBe("/{seg}/x");
  });

  it("replaces segments longer than 32 chars", () => {
    const seg = "word-".repeat(8) + "w"; // 41 chars, has hyphens, not hex
    expect(must(`https://a.example/${seg}/x`).pathPattern).toMatch(/^\/\{(seg|id)\}\/x$/);
    const dotted33 = "ab.".repeat(11); // dotted multi-part tokens of this length are ids
    const dotted32 = "ab.".repeat(10) + "ab";
    expect(must(`https://a.example/${dotted33}`).pathPattern).toMatch(/^\/\{(seg|id)\}$/);
    expect(must(`https://a.example/${dotted32}`).pathPattern).toBe(`/${dotted32}`);
    expect(must(`https://a.example/${"a".repeat(33)}`).pathPattern).toBe("/{id}");
  });

  it("preserves known-safe paths", () => {
    expect(must("https://a.example/getAd").pathPattern).toBe("/getAd");
    expect(must("https://a.example/cplatform/getAd").pathPattern).toBe("/cplatform/getAd");
    const r = must("https://a.example/static/js/bundle.js");
    expect(r.pathPattern).toBe("/static/js/bundle.js");
    expect(r.redacted).toBe(false);
    expect(must("https://a.example/sdk.js").pathPattern).toBe("/sdk.js");
  });

  it("preserves a trailing slash and collapses double slashes", () => {
    expect(must("https://a.example/a/b/").pathPattern).toBe("/a/b/");
    expect(must("https://a.example/a//b///c").pathPattern).toBe("/a/b/c");
    expect(must("https://a.example/").pathPattern).toBe("/");
    expect(must("https://a.example").pathPattern).toBe("/");
    expect(must("https://a.example//").pathPattern).toBe("/");
  });

  it("truncates 300-char paths to at most 200 chars with an ellipsis and marks redacted", () => {
    const path = "/ab".repeat(100); // 300 chars
    const r = must(`https://a.example${path}`);
    expect(r.pathPattern.length).toBeLessThanOrEqual(200);
    expect(r.pathPattern.endsWith("…")).toBe(true);
    expect(r.redacted).toBe(true);
  });

  it("does not leak dot-segment traversal", () => {
    expect(must("https://a.example/a/../b/./c").pathPattern).toBe("/b/c");
  });
});

describe("display helpers", () => {
  it("sanitizedUrlToString shows names only", () => {
    expect(sanitizedUrlToString(must("https://noas.mtrtb.com/getAd?ipv4=1.2.3.4&idfa=ABC"))).toBe(
      "https://noas.mtrtb.com/getAd?idfa&ipv4",
    );
    expect(sanitizedUrlToString(must("https://a.example:8443/x"))).toBe("https://a.example:8443/x");
    expect(sanitizedUrlToString(must("ftp://a.example/x"))).toBe("other://a.example/x");
  });

  it("originOf", () => {
    expect(originOf("https://user:pw@A.Example:443/x?y=1#z")).toBe("https://a.example");
    expect(originOf("http://a.example:8080/x")).toBe("http://a.example:8080");
    expect(originOf("garbage")).toBeNull();
    expect(originOf("data:text/plain,hi")).toBeNull();
  });

  it("hostnameOf", () => {
    expect(hostnameOf("https://User@A.Example./x")).toBe("a.example");
    expect(hostnameOf("nope")).toBeNull();
    expect(hostnameOf("about:blank")).toBeNull();
  });
});

describe("property: query values never appear in output", () => {
  function mulberry32(seed: number) {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rand = mulberry32(0xad7217);
  const ALNUM = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const randStr = (min: number, extra: number, alphabet = ALNUM) => {
    const n = min + Math.floor(rand() * (extra + 1));
    let s = "";
    for (let i = 0; i < n; i++) s += alphabet[Math.floor(rand() * alphabet.length)];
    return s;
  };
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;

  it("500 random URLs", () => {
    const names = ["idfa", "cookie", "ipv4", "uid", "q", "x", "token", "sid", "a_b", "Zed"];
    for (let i = 0; i < 500; i++) {
      const values: string[] = [];
      const params: string[] = [];
      const count = 1 + Math.floor(rand() * 6);
      for (let j = 0; j < count; j++) {
        const v = randStr(12, 20);
        values.push(v);
        params.push(`${pick(names)}${j}=${v}`);
      }
      const segs = Array.from({ length: Math.floor(rand() * 4) }, () =>
        pick(["getAd", "x", "track", randStr(3, 10)]),
      );
      const userinfo = rand() < 0.4 ? `${randStr(12, 6)}:${randStr(12, 6)}@` : "";
      const pw = userinfo ? userinfo.split(":")[1]!.slice(0, -1) : "";
      const user = userinfo ? userinfo.split(":")[0]! : "";
      const frag = rand() < 0.4 ? `#${randStr(12, 10)}` : "";
      const raw = `${pick(["http", "https", "ws", "wss"])}://${userinfo}host${i % 7}.example.com/${segs.join("/")}?${params.join("&")}${frag}`;
      const out = sanitizeUrl(raw);
      expect(out).not.toBeNull();
      const json = JSON.stringify(out);
      for (const v of values) expect(json).not.toContain(v);
      if (user) expect(json).not.toContain(user);
      if (pw) expect(json).not.toContain(pw);
      if (frag) expect(json).not.toContain(frag.slice(1));
      expect(out!.redacted).toBe(true);
    }
  });
});

describe("token-like parameter names", () => {
  it("masks a bare token used as a parameter name", () => {
    const u = sanitizeUrl("https://x.synthetic.test/p?5f4dcc3b5aa765d61d8327deb882cf99&idfa=1")!;
    expect(u.queryParamNames).toEqual(["idfa", "{token}"]);
    expect(JSON.stringify(u)).not.toContain("5f4dcc3b");
    expect(u.redacted).toBe(true);
  });
  it("keeps ordinary short names", () => {
    const u = sanitizeUrl("https://x.synthetic.test/p?w=300&h=250&slot=top")!;
    expect(u.queryParamNames).toEqual(["h", "slot", "w"]);
  });
});

describe("sanitizer hardening (review L1)", () => {
  it("masks contact-like and JWT-like parameter names", () => {
    const u = sanitizeUrl(
      "https://x.synthetic.test/p?user@example.com&eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c&ok=1",
    )!;
    expect(u.queryParamNames).toEqual(["ok", "{token}"]);
    expect(JSON.stringify(u)).not.toMatch(/example\.com|eyJ/);
  });
  it("replaces long mixed letter+digit path slugs but keeps file-like names", () => {
    const u = sanitizeUrl("https://x.synthetic.test/u/user2024report/static/jquery-3.7.1.min.js")!;
    expect(u.pathPattern).toBe("/u/{id}/static/jquery-3.7.1.min.js");
  });
});
