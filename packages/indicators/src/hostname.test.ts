import { describe, expect, it } from "vitest";
import {
  hostnameMatchesDomain,
  isIpAddress,
  normalizeHostname,
  parentDomains,
} from "./hostname.js";

describe("normalizeHostname", () => {
  it("lower-cases", () => {
    expect(normalizeHostname("NoAs.MTRTB.com")).toBe("noas.mtrtb.com");
  });
  it("strips one trailing dot", () => {
    expect(normalizeHostname("noas.mtrtb.com.")).toBe("noas.mtrtb.com");
  });
  it("converts [.] defanging", () => {
    expect(normalizeHostname("noas.mtrtb[.]com")).toBe("noas.mtrtb.com");
    expect(normalizeHostname("a[.]b[.]c")).toBe("a.b.c");
  });
  it("strips IPv6 brackets", () => {
    expect(normalizeHostname("[::1]")).toBe("::1");
    expect(normalizeHostname("[2001:DB8::1]")).toBe("2001:db8::1");
  });
  it("accepts underscores, hyphens, digits and IPv4", () => {
    expect(normalizeHostname("_dmarc.ex-ample1.test")).toBe("_dmarc.ex-ample1.test");
    expect(normalizeHostname("1.2.3.4")).toBe("1.2.3.4");
  });
  it("converts IDN to punycode", () => {
    expect(normalizeHostname("bücher.example")).toBe("xn--bcher-kva.example");
    expect(normalizeHostname("BÜCHER.example.")).toBe("xn--bcher-kva.example");
  });
  it.each([
    "",
    " ",
    "a b.com",
    " a.com",
    "a..com",
    ".",
    "a/b.com",
    "a.com/path",
    "user@a.com",
    "a.com:8080",
    "a*b.com",
    "a%20b.com",
    "[]",
    "[::zz]",
    "bü/cher.example",
    "-".repeat(1) + "x".repeat(70) + ".com",
  ])("returns null for invalid input %j", (input) => {
    expect(normalizeHostname(input)).toBeNull();
  });
  it("never throws on non-string input", () => {
    expect(normalizeHostname(undefined as unknown as string)).toBeNull();
    expect(normalizeHostname(42 as unknown as string)).toBeNull();
  });
});

describe("isIpAddress", () => {
  it("detects IPv4", () => {
    expect(isIpAddress("1.2.3.4")).toBe(true);
    expect(isIpAddress("255.255.255.255")).toBe(true);
    expect(isIpAddress("256.1.1.1")).toBe(false);
    expect(isIpAddress("1.2.3")).toBe(false);
  });
  it("detects IPv6", () => {
    expect(isIpAddress("::1")).toBe(true);
    expect(isIpAddress("[2001:db8::1]")).toBe(true);
    expect(isIpAddress("::ffff:1.2.3.4")).toBe(true);
    expect(isIpAddress("::zz")).toBe(false);
  });
  it("rejects hostnames", () => {
    expect(isIpAddress("example.com")).toBe(false);
    expect(isIpAddress("1.2.3.4.example.com")).toBe(false);
  });
});

describe("hostnameMatchesDomain", () => {
  it("matches equal and subdomains", () => {
    expect(hostnameMatchesDomain("mtrtb.com", "mtrtb.com")).toBe(true);
    expect(hostnameMatchesDomain("noas.mtrtb.com", "mtrtb.com")).toBe(true);
    expect(hostnameMatchesDomain("a.b.mtrtb.com", "mtrtb.com")).toBe(true);
  });
  it("is boundary safe", () => {
    expect(hostnameMatchesDomain("notmtrtb.com", "mtrtb.com")).toBe(false);
    expect(hostnameMatchesDomain("mtrtb.com.evil.test", "mtrtb.com")).toBe(false);
    expect(hostnameMatchesDomain("mtrtb.co", "mtrtb.com")).toBe(false);
    expect(hostnameMatchesDomain("com", "mtrtb.com")).toBe(false);
    expect(hostnameMatchesDomain("a.com", "")).toBe(false);
  });
});

describe("parentDomains", () => {
  it("lists the host and parents, never the bare TLD", () => {
    expect(parentDomains("a.b.c.d")).toEqual(["a.b.c.d", "b.c.d", "c.d"]);
    expect(parentDomains("mtrtb.com")).toEqual(["mtrtb.com"]);
    expect(parentDomains("localhost")).toEqual([]);
  });
});
