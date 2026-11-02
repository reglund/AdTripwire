import { describe, expect, it } from "vitest";
import {
  pseudonymiseHostname,
  pseudonymiseHostnamesInText,
  redactDetection,
  redactEvent,
} from "./redact.js";
import {
  AD_FRAME,
  INITIATOR_HOST,
  SUBJECT,
  TOP,
  makeDetection,
  makeEvent,
} from "./test-fixtures.js";

const SALT = "salt-one";
const keepSubject = () => new Set([SUBJECT]);

describe("pseudonymiseHostname", () => {
  it("is stable for the same salt, different across salts and hosts", () => {
    const a = pseudonymiseHostname("a.example", SALT);
    expect(a).toBe(pseudonymiseHostname("a.example", SALT));
    expect(a).toMatch(/^h-[0-9a-f]{10}$/);
    expect(a).not.toBe(pseudonymiseHostname("a.example", "salt-two"));
    expect(a).not.toBe(pseudonymiseHostname("b.example", SALT));
  });

  it("is case-insensitive on the hostname", () => {
    expect(pseudonymiseHostname("A.Example", SALT)).toBe(pseudonymiseHostname("a.example", SALT));
  });

  it("does not contain the hostname", () => {
    expect(pseudonymiseHostname("secret.example", SALT)).not.toContain("secret");
  });
});

describe("pseudonymiseHostnamesInText", () => {
  it("replaces every occurrence case-insensitively, longest first", () => {
    const map = new Map([
      ["example.com", "h-1"],
      ["sub.example.com", "h-2"],
    ]);
    expect(pseudonymiseHostnamesInText("a sub.example.com b EXAMPLE.com c example.com.", map)).toBe(
      "a h-2 b h-1 c h-1.",
    );
  });

  it("handles regex metacharacters in hostnames and empty maps", () => {
    expect(pseudonymiseHostnamesInText("axb a.b", new Map([["a.b", "P"]]))).toBe("axb P");
    expect(pseudonymiseHostnamesInText("text", new Map())).toBe("text");
  });

  it("does not rescan replacement output", () => {
    const map = new Map([["a.com", "a.com-x"]]);
    expect(pseudonymiseHostnamesInText("a.com", map)).toBe("a.com-x");
  });
});

describe("redactEvent default", () => {
  it("returns a deep copy and keeps hostnames, initiator and tab", () => {
    const e = makeEvent();
    const out = redactEvent(e, "default");
    expect(out).toEqual(e);
    expect(out).not.toBe(e);
    expect(out.frameContext).not.toBe(e.frameContext);
    expect(out.frameContext.ancestorHostnames).not.toBe(e.frameContext.ancestorHostnames);
    out.frameContext.ancestorHostnames.push("x");
    expect(e.frameContext.ancestorHostnames).toHaveLength(2);
  });

  it("clamps oversize destination fields", () => {
    const e = makeEvent();
    e.destination.queryParamNames = Array.from(
      { length: 80 },
      (_, i) => `p${String(i).padStart(3, "0")}`,
    );
    e.destination.pathPattern = "/" + "a".repeat(400);
    e.destination.redacted = false;
    const out = redactEvent(e, "default");
    expect(out.destination.queryParamNames).toHaveLength(50);
    expect(out.destination.pathPattern.length).toBeLessThanOrEqual(200);
    expect(out.destination.redacted).toBe(true);
    expect(e.destination.queryParamNames).toHaveLength(80);
  });
});

describe("redactEvent strict", () => {
  const opts = () => ({ keepHostnames: keepSubject(), salt: SALT });

  it("requires a salt", () => {
    expect(() => redactEvent(makeEvent(), "strict")).toThrow();
    expect(() =>
      redactEvent(makeEvent(), "strict", { keepHostnames: new Set(), salt: "" }),
    ).toThrow();
  });

  it("keeps kept hostnames and pseudonymises everything else", () => {
    const out = redactEvent(makeEvent(), "strict", opts());
    expect(out.destination.hostname).toBe(SUBJECT);
    expect(out.frameContext.topHostname).toBe(pseudonymiseHostname(TOP, SALT));
    expect(out.frameContext.documentHostname).toBe(pseudonymiseHostname(AD_FRAME, SALT));
    expect(out.frameContext.ancestorHostnames).toEqual([
      pseudonymiseHostname(AD_FRAME, SALT),
      pseudonymiseHostname(TOP, SALT),
    ]);
    expect(out.redirectHostname).toBe(pseudonymiseHostname("redirect.other-tracker.io", SALT));
  });

  it("drops initiatorOrigin and tabId, and hashes correlationId", () => {
    const out = redactEvent(makeEvent(), "strict", opts());
    expect("initiatorOrigin" in out).toBe(false);
    expect("tabId" in out).toBe(false);
    expect(out.correlationId).toMatch(/^c-[0-9a-f]{10}$/);
  });

  it("reduces path to placeholder unless allow-listed", () => {
    expect(redactEvent(makeEvent(), "strict", opts()).destination.pathPattern).toBe("/{…}");
    for (const p of ["/getAd", "/cplatform/getAd", "/"]) {
      const e = makeEvent();
      e.destination.pathPattern = p;
      expect(redactEvent(e, "strict", opts()).destination.pathPattern).toBe(p);
    }
    const e = makeEvent();
    e.destination.pathPattern = "/getAd/more";
    expect(redactEvent(e, "strict", opts()).destination.pathPattern).toBe("/{…}");
  });

  it("keeps only identifier query param names", () => {
    const out = redactEvent(makeEvent(), "strict", opts());
    expect(out.destination.queryParamNames).toEqual(["idfa", "ipv4"]);
    expect(out.destination.redacted).toBe(true);
  });

  it("is stable for the same salt and different for another salt", () => {
    const a = redactEvent(makeEvent(), "strict", opts());
    const b = redactEvent(makeEvent(), "strict", opts());
    const c = redactEvent(makeEvent(), "strict", { keepHostnames: keepSubject(), salt: "other" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it("leaves no raw non-kept hostname anywhere in the output", () => {
    const json = JSON.stringify(redactEvent(makeEvent(), "strict", opts()));
    for (const h of [TOP, AD_FRAME, INITIATOR_HOST, "redirect.other-tracker.io"]) {
      expect(json).not.toContain(h);
    }
    expect(json).toContain(SUBJECT);
  });

  it("does not mutate the input", () => {
    const e = makeEvent();
    const snapshot = JSON.stringify(e);
    redactEvent(e, "strict", opts());
    expect(JSON.stringify(e)).toBe(snapshot);
  });

  it("pseudonymises a subject host that is not in the keep set", () => {
    const out = redactEvent(makeEvent(), "strict", { keepHostnames: new Set(), salt: SALT });
    expect(out.destination.hostname).toBe(pseudonymiseHostname(SUBJECT, SALT));
  });

  it("matches keep set case-insensitively", () => {
    const out = redactEvent(makeEvent(), "strict", {
      keepHostnames: new Set([SUBJECT.toUpperCase()]),
      salt: SALT,
    });
    expect(out.destination.hostname).toBe(SUBJECT);
  });
});

describe("redactDetection", () => {
  it("default: deep copy with text unchanged", () => {
    const d = makeDetection();
    const out = redactDetection(d, "default");
    expect(out).toEqual(d);
    expect(out).not.toBe(d);
    expect(out.evidence[0]).not.toBe(d.evidence[0]);
  });

  it("strict: pseudonymises non-kept subjects in fields and text, keeps kept ones", () => {
    const out = redactDetection(makeDetection(), "strict", {
      keepHostnames: keepSubject(),
      salt: SALT,
    });
    const pseudo = pseudonymiseHostname(TOP, SALT);
    expect(out.subjectHostnames).toEqual([SUBJECT, pseudo]);
    expect(out.summary).toBe(`Contact with ${SUBJECT} while viewing ${pseudo}`);
    expect(out.evidence[0]!.observed).toContain(pseudo);
    expect(out.evidence[0]!.observed).toContain(SUBJECT.toUpperCase());
    expect(out.evidence[0]!.observed).not.toContain(TOP);
    expect("tabId" in out).toBe(false);
  });

  it("strict: extraHostnames are pseudonymised in free text", () => {
    const out = redactDetection(makeDetection(), "strict", {
      keepHostnames: keepSubject(),
      salt: SALT,
      extraHostnames: [AD_FRAME],
    });
    expect(JSON.stringify(out)).not.toContain(AD_FRAME);
    expect(out.evidence[0]!.observed).toContain(pseudonymiseHostname(AD_FRAME, SALT));
  });

  it("strict: dedupKey, rationale and all text fields are covered", () => {
    const d = makeDetection({
      dedupKey: `R:${TOP}`,
      confidenceRationale: TOP,
      significance: TOP,
      missingVisibility: [TOP],
      alternativeExplanations: [TOP],
      recommendedActions: [TOP],
      limitations: [TOP],
    });
    const json = JSON.stringify(
      redactDetection(d, "strict", { keepHostnames: keepSubject(), salt: SALT }),
    );
    expect(json).not.toContain(TOP);
  });

  it("scrubs credentials and query values that slipped into free text (both profiles)", () => {
    const d = makeDetection({
      evidence: [
        {
          eventIds: [],
          observed: "Saw https://u:p4ss@host.example/x?token=SECRETVALUE&a=b#frag",
          kind: "observed",
        },
      ],
    });
    for (const profile of ["default", "strict"] as const) {
      const out = redactDetection(d, profile, { keepHostnames: keepSubject(), salt: SALT });
      const text = out.evidence[0]!.observed;
      expect(text).not.toContain("SECRETVALUE");
      expect(text).not.toContain("p4ss");
      expect(text).not.toContain("@");
    }
  });

  it("strict requires a salt", () => {
    expect(() => redactDetection(makeDetection(), "strict")).toThrow();
  });
});
