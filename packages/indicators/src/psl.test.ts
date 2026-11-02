import { describe, expect, it } from "vitest";
import { PSL_VERSION, publicSuffix, registrableDomain } from "./psl.js";

describe("registrableDomain", () => {
  it("handles normal rules", () => {
    expect(registrableDomain("example.co.uk")).toBe("example.co.uk");
    expect(registrableDomain("a.b.example.co.uk")).toBe("example.co.uk");
    expect(registrableDomain("noas.mtrtb.com")).toBe("mtrtb.com");
    expect(registrableDomain("MTRTB.com.")).toBe("mtrtb.com");
  });

  it("skips the PRIVATE section: cloudfront.net and github.io are not public suffixes", () => {
    // Documented limitation: shared-hosting names collapse to the platform apex.
    expect(registrableDomain("d1fcoizt7mje85.cloudfront.net")).toBe("cloudfront.net");
    expect(registrableDomain("foo.github.io")).toBe("github.io");
    expect(publicSuffix("foo.github.io")).toBe("io");
  });

  it("handles wildcard and exception rules", () => {
    // *.kawasaki.jp makes c.kawasaki.jp a public suffix.
    expect(publicSuffix("b.c.kawasaki.jp")).toBe("c.kawasaki.jp");
    expect(registrableDomain("b.c.kawasaki.jp")).toBe("b.c.kawasaki.jp");
    expect(registrableDomain("x.b.c.kawasaki.jp")).toBe("b.c.kawasaki.jp");
    expect(registrableDomain("c.kawasaki.jp")).toBeNull();
    // !city.kawasaki.jp is an exception: kawasaki.jp is the suffix.
    expect(publicSuffix("city.kawasaki.jp")).toBe("kawasaki.jp");
    expect(registrableDomain("city.kawasaki.jp")).toBe("city.kawasaki.jp");
    expect(registrableDomain("www.city.kawasaki.jp")).toBe("city.kawasaki.jp");
  });

  it("returns null for IPs, single labels, bare suffixes and invalid input", () => {
    expect(registrableDomain("localhost")).toBeNull();
    expect(registrableDomain("192.0.2.1")).toBeNull();
    expect(registrableDomain("::1")).toBeNull();
    expect(registrableDomain("[2001:db8::1]")).toBeNull();
    expect(registrableDomain("com")).toBeNull();
    expect(registrableDomain("co.uk")).toBeNull();
    expect(registrableDomain("")).toBeNull();
    expect(registrableDomain("bad host.com")).toBeNull();
    expect(publicSuffix("localhost")).toBeNull();
    expect(publicSuffix("192.0.2.1")).toBeNull();
  });

  it("falls back to the implicit * rule when no rule matches (e.g. .test)", () => {
    expect(registrableDomain("x.test")).toBe("x.test");
    expect(registrableDomain("a.b.x.test")).toBe("x.test");
    expect(publicSuffix("x.test")).toBe("test");
    expect(registrableDomain("test")).toBeNull();
  });

  it("handles internationalised names in punycode form", () => {
    expect(registrableDomain("münchen.de")).toBe("xn--mnchen-3ya.de");
    expect(registrableDomain("www.example.xn--p1ai")).toBe("example.xn--p1ai");
  });

  it("exposes version metadata", () => {
    expect(PSL_VERSION.sourceUrl).toBe("https://publicsuffix.org/list/public_suffix_list.dat");
    expect(PSL_VERSION.license).toBe("MPL-2.0");
    expect(PSL_VERSION.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(PSL_VERSION.ruleCount).toBeGreaterThan(5000);
  });

  it("performs 100k lookups in under one second", () => {
    const hosts = ["a.b.example.co.uk", "noas.mtrtb.com", "x.y.c.kawasaki.jp", "foo.github.io"];
    registrableDomain("warm.up.com");
    const start = performance.now();
    let hits = 0;
    for (let i = 0; i < 100_000; i++) {
      if (registrableDomain(hosts[i % hosts.length] as string) !== null) hits++;
    }
    const elapsed = performance.now() - start;
    expect(hits).toBe(100_000);
    expect(elapsed).toBeLessThan(1000);
  });
});
