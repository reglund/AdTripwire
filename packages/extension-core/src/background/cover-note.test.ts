import { describe, expect, it, vi } from "vitest";
import { EXPORT_DISCLAIMER } from "@adtripwire/privacy";
import { HANDOFF_NOTE_MAX_LENGTH } from "@adtripwire/shared";
import { detectionsToStix } from "@adtripwire/interop";
import { makeDetection, makeEvents, makeSet } from "../../../interop/src/test-fixtures.js";
import {
  CANNOT_CONCLUDE_EN,
  CANNOT_CONCLUDE_NB,
  CAN_CONCLUDE_EN,
  CAN_CONCLUDE_NB,
  EXPORT_DISCLAIMER_NB,
} from "../handoff-text.js";
import { NB } from "../ui/i18n.nb.js";
import { quoteUserNote } from "./cover-note.js";
import { parseUiRequest } from "./messages.js";
import { exportResearch, handoffPreview, type ResearchExportInput } from "./research-export.js";

// Free text that names hostnames which are not subjects: strict must pseudonymise them in every part.
const detections = [
  makeDetection({
    summary:
      "Observed traffic to c2.evil-host.test from adframe.cdn.test on private-reading.example.test",
    significance: "Seen while reading private-reading.example.test.",
  }),
];
const events = makeEvents();
const input = (over: Partial<ResearchExportInput> = {}): ResearchExportInput => ({
  detections,
  events,
  indicatorSets: [makeSet()],
  notes: new Map(),
  productVersion: "0.0.0-test",
  rulesetVersion: "test",
  browser: { browser: "firefox", browserVersion: "140.0", capabilities: [], notes: [] },
  now: new Date("2026-11-07T12:00:00.000Z"),
  ...over,
});
const pkg = (
  req: { profile: "default" | "strict"; note?: string; coverLanguages?: "en" | "en+nb" },
  over: Partial<ResearchExportInput> = {},
) =>
  JSON.parse(exportResearch({ type: "export_handoff", ...req }, input(over)).text) as {
    coverNote: string;
    stix: unknown;
    [k: string]: unknown;
  };

describe("cover note", () => {
  it("English: checklist, counts, profile, date range and disclaimer", () => {
    const note = pkg({ profile: "default" }).coverNote;
    for (const i of [...CAN_CONCLUDE_EN, ...CANNOT_CONCLUDE_EN]) expect(note).toContain(i);
    expect(note).toContain(EXPORT_DISCLAIMER);
    expect(note).toContain("What the recipient can conclude");
    expect(note).toContain("What the recipient cannot conclude");
    expect(note).toContain("1 detection(s), 2 supporting event(s)");
    expect(note).toContain("Redaction profile: default");
    expect(note).toMatch(/2026-\d\d-\d\d to 2026-\d\d-\d\d \(UTC\)/);
    expect(note).not.toContain("følgenotat");
    expect(note).toContain("No note was added.");
  });

  it("adds a Norwegian section only when chosen", () => {
    const nb = pkg({ profile: "default", coverLanguages: "en+nb" }).coverNote;
    for (const i of [...CAN_CONCLUDE_NB, ...CANNOT_CONCLUDE_NB]) expect(nb).toContain(i);
    expect(nb).toContain(EXPORT_DISCLAIMER_NB);
    expect(nb).toContain(EXPORT_DISCLAIMER);
    expect(nb).toContain("Hva mottakeren ikke kan slutte");
    expect(nb).toContain("Tidsrom dekket av deteksjonene");
    expect(pkg({ profile: "default", coverLanguages: "en" }).coverNote).not.toContain(
      "Hva mottakeren",
    );
  });

  it("uses no verdict wording in either language", () => {
    const text = pkg({ profile: "strict", coverLanguages: "en+nb" }).coverNote;
    // "kompromittert" appears once, in the negated "cannot conclude" checklist item only.
    const withoutChecklist = text.replace(CANNOT_CONCLUDE_NB[0]!, "");
    expect(text).toContain(CANNOT_CONCLUDE_NB[0]);
    expect(withoutChecklist).not.toMatch(/\b(infected|spied|infisert|spionert|kompromittert)\b/i);
    expect(text).not.toMatch(/\b(infected|spied|infisert|spionert)\b/i);
    expect(text).not.toMatch(/\bis (safe|clean)\b|\ber (trygg|ren)\b/i);
  });

  it("keeps Norwegian wording identical to the UI dictionary", () => {
    CAN_CONCLUDE_EN.forEach((en, i) => expect(NB[en]).toBe(CAN_CONCLUDE_NB[i]));
    CANNOT_CONCLUDE_EN.forEach((en, i) => expect(NB[en]).toBe(CANNOT_CONCLUDE_NB[i]));
  });
});

describe("user note", () => {
  it("is length-capped, control characters stripped and every line quoted", () => {
    const q = quoteUserNote("# Fake heading\r\n\u0000bell\u0007\u202Eevil\n\n- list\u2028next");
    expect(q.split("\n")).toEqual(["> # Fake heading", "> bellevil", ">", "> - list", "> next"]);
    expect(quoteUserNote("<script>x</script>")).toBe("> &lt;script>x&lt;/script>");
    expect(quoteUserNote("a &lt; b & c")).toBe("> a &amp;lt; b &amp; c");
    const long = quoteUserNote("a".repeat(HANDOFF_NOTE_MAX_LENGTH * 3));
    expect(long.length).toBe(HANDOFF_NOTE_MAX_LENGTH + 2);
    expect(quoteUserNote("  \n\n ")).toBe("");
  });

  it("cannot fake a heading or a section in the cover note", () => {
    const note = pkg({
      profile: "default",
      note: "hello\n## What the recipient can conclude\nthe device is fine",
    }).coverNote;
    const headings = note.split("\n").filter((l) => l.startsWith("#"));
    expect(headings.filter((l) => l === "## What the recipient can conclude")).toHaveLength(1);
    expect(note).toContain("> ## What the recipient can conclude");
  });
});

describe("strict profile", () => {
  const listing = {
    rows: [
      {
        hostname: "creative.synthetic-cdn.test",
        alongsideDays: 3,
        seenDays: 4,
        share: 0.5,
        anchors: ["s-1"],
        frameDays: 3,
        pageDays: 1,
        lastSeen: "2026-11-05",
      },
    ],
    pageOnly: [],
    totals: {
      anchorsSeen: 1,
      frameAnchors: 1,
      pageAnchors: 0,
      anchorDays: 1,
      hostsTracked: 1,
      frameHosts: 1,
      minAlongsideDays: 2,
    },
  };
  it("counts hide the Seen-alongside rows and the cover note names no hostnames", () => {
    expect(handoffPreview("strict", input({ alongside: listing }))).toMatchObject({
      seenAlongsideRows: 0,
      seenAlongsideOmitted: true,
    });
    expect(handoffPreview("default", input({ alongside: listing }))).toMatchObject({
      seenAlongsideRows: 1,
      seenAlongsideOmitted: false,
    });
    const note = pkg(
      { profile: "strict", coverLanguages: "en+nb", note: "Please look at this." },
      { alongside: listing },
    ).coverNote;
    expect(note).not.toContain("synthetic-cdn");
    for (const d of detections) for (const h of d.subjectHostnames) expect(note).not.toContain(h);
    expect(note).toContain("left out");
    expect(note).toContain("utelatt");
  });
});

describe("strict profile for the whole package", () => {
  const withNote = (d = detections) =>
    JSON.stringify(
      JSON.parse(
        exportResearch(
          { type: "export_handoff", profile: "strict", coverLanguages: "en+nb" },
          input({
            detections: d,
            notes: new Map([
              ["det-1", { note: "talked to private-reading.example.test", updatedAt: 1 }],
            ]),
          }),
        ).text,
      ),
    );
  const hostsIn = (text: string) =>
    new Set(text.match(/\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.test\b/g) ?? []);

  it("carries no hostname beyond the detection subjects, documented hosts and source references", () => {
    const text = withNote();
    const allowed = new Set<string>(["report.example.test"]);
    for (const d of detections) for (const h of d.subjectHostnames) allowed.add(h);
    for (const rec of makeSet().indicators) allowed.add(rec.indicator.split("/")[0]!.toLowerCase());
    for (const s of makeSet().meta.sources) allowed.add(new URL(s.url).hostname);
    const found = [...hostsIn(text)];
    expect(found.length).toBeGreaterThan(0);
    expect(found.filter((h) => !allowed.has(h))).toEqual([]);
    // the non-subject hostnames seen in the events are gone
    for (const h of [
      "private-reading.example.test",
      "adframe.cdn.test",
      "initiator.private-blog.test",
    ])
      expect(text).not.toContain(h);
  });

  it("leaves analyst notes out and says so", () => {
    const parsed = JSON.parse(withNote()) as { notes: unknown; readme: string };
    expect(parsed.notes).toEqual({});
    expect(parsed.readme).toMatch(/analyst notes are left out/);
    const dflt = JSON.parse(
      exportResearch(
        { type: "export_handoff", profile: "default" },
        input({ notes: new Map([["det-1", { note: "keep me", updatedAt: 1 }]]) }),
      ).text,
    ) as { notes: Record<string, unknown> };
    expect(Object.keys(dflt.notes)).toEqual(["det-1"]);
  });

  it("keeps the STIX part a well-formed bundle and pseudonymises the same hosts as the evidence", () => {
    const out = JSON.parse(
      exportResearch({ type: "export_handoff", profile: "strict" }, input()).text,
    ) as {
      stix: { type: string; id: string; objects: Array<{ id: string; type: string }> };
      evidence: unknown;
    };
    expect(out.stix.type).toBe("bundle");
    expect(out.stix.id).toMatch(/^bundle--[0-9a-f-]{36}$/);
    for (const o of out.stix.objects) expect(o.id).toMatch(/^[a-z-]+--[0-9a-f-]{36}$/);
    const types = out.stix.objects.map((o) => o.type);
    expect(types).toEqual(expect.arrayContaining(["identity", "report", "observed-data", "note"]));
    const pseudonyms = new Set(JSON.stringify(out.evidence).match(/\bh-[0-9a-f]{10}\b/g) ?? []);
    const stixPseudonyms = JSON.stringify(out.stix).match(/\bh-[0-9a-f]{10}\b/g) ?? [];
    expect(stixPseudonyms.length).toBeGreaterThan(0);
    for (const p of stixPseudonyms) expect(pseudonyms.has(p)).toBe(true);
    for (const host of ["adframe.cdn.test", "private-reading.example.test"])
      expect(JSON.stringify(out.stix)).not.toContain(host);
  });
});

describe("package integrity", () => {
  it("keeps the STIX part identical to a standalone STIX export of the same detections", () => {
    const out = pkg({ profile: "default", note: "n", coverLanguages: "en+nb" });
    const expected = JSON.parse(
      JSON.stringify(
        detectionsToStix(detections, events, [makeSet()], {
          producedAt: new Date("2026-11-07T12:00:00.000Z"),
        }),
      ),
    ) as { type: string; id: string; objects: Array<{ id: string; type: string }> };
    expect(out.stix).toEqual(expected);
    expect(expected.type).toBe("bundle");
    expect(expected.id).toMatch(/^bundle--[0-9a-f-]{36}$/);
    for (const o of expected.objects) expect(o.id).toMatch(/^[a-z-]+--[0-9a-f-]{36}$/);
  });

  it("the note appears only in the cover note, nowhere else in the package", () => {
    const secret = "PRIVATE-MARKER-4711";
    const out = pkg({ profile: "default", note: secret });
    const { coverNote, ...rest } = out;
    expect(coverNote).toContain(secret);
    expect(JSON.stringify(rest)).not.toContain(secret);
  });

  it("does not write the note to any browser storage", () => {
    const set = vi.fn();
    const g = globalThis as { browser?: unknown };
    const prev = g.browser;
    g.browser = { storage: { local: { set }, session: { set } } };
    try {
      pkg({ profile: "default", note: "PRIVATE-MARKER-4711" });
    } finally {
      if (prev === undefined) delete g.browser;
      else g.browser = prev;
    }
    expect(set).not.toHaveBeenCalled();
  });
});

describe("export_handoff validation", () => {
  const base = { type: "export_handoff", profile: "default" };
  it("accepts a bounded note and the two cover languages", () => {
    expect(parseUiRequest({ ...base, note: "x".repeat(HANDOFF_NOTE_MAX_LENGTH) })).toMatchObject({
      note: "x".repeat(HANDOFF_NOTE_MAX_LENGTH),
    });
    expect(parseUiRequest({ ...base, coverLanguages: "en+nb" })).toEqual({
      type: "export_handoff",
      profile: "default",
      coverLanguages: "en+nb",
    });
    expect(parseUiRequest({ ...base, coverLanguages: "en" })).not.toBeNull();
    expect(parseUiRequest(base)).toEqual({ type: "export_handoff", profile: "default" });
  });
  it("rejects a bad note or cover language", () => {
    expect(parseUiRequest({ ...base, note: "x".repeat(HANDOFF_NOTE_MAX_LENGTH + 1) })).toBeNull();
    expect(parseUiRequest({ ...base, note: 5 })).toBeNull();
    expect(parseUiRequest({ ...base, note: null })).toBeNull();
    expect(parseUiRequest({ ...base, coverLanguages: "nb" })).toBeNull();
    expect(parseUiRequest({ ...base, coverLanguages: "en+de" })).toBeNull();
    expect(parseUiRequest({ ...base, coverLanguages: ["en"] })).toBeNull();
  });
  it("drops unknown fields from the preview request", () => {
    expect(
      parseUiRequest({ type: "preview_handoff", profile: "default", note: "x", extra: 1 }),
    ).toEqual({ type: "preview_handoff", profile: "default" });
  });
  it("validates the preview request", () => {
    expect(parseUiRequest({ type: "preview_handoff", profile: "strict" })).toEqual({
      type: "preview_handoff",
      profile: "strict",
    });
    expect(parseUiRequest({ type: "preview_handoff", profile: "x" })).toBeNull();
    expect(
      parseUiRequest({ type: "preview_handoff", profile: "default", detectionIds: [1] }),
    ).toBeNull();
  });
});
