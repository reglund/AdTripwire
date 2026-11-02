import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { scoId, sha1, stixId, uuidV5 } from "./uuid.js";

describe("uuid", () => {
  it("sha1 matches node:crypto for several lengths", () => {
    for (const s of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "ø".repeat(200)]) {
      const ours = Buffer.from(sha1(new TextEncoder().encode(s))).toString("hex");
      expect(ours).toBe(createHash("sha1").update(s, "utf8").digest("hex"));
    }
  });

  it("uuidV5 matches the RFC test vector", () => {
    expect(uuidV5("6ba7b810-9dad-11d1-80b4-00c04fd430c8", "www.example.com")).toBe(
      "2ed6657d-e927-568b-95e1-2665a8aea6a2",
    );
  });

  it("STIX SCO ids follow the STIX 2.1 deterministic id rule", () => {
    // Example from the STIX 2.1 specification-conformant libraries (stix2 python).
    expect(scoId("domain-name", { value: "example.com" })).toMatch(
      /^domain-name--[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(stixId("indicator", "a")).toBe(stixId("indicator", "a"));
    expect(stixId("indicator", "a")).not.toBe(stixId("indicator", "b"));
  });
});
