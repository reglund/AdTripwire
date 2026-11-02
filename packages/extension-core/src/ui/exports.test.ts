import { describe, expect, it } from "vitest";
import {
  checkImportFile,
  clampNote,
  IMPORT_MAX_BYTES,
  importSummary,
  isExportFile,
  isImportResult,
  NOTE_MAX_LENGTH,
  safeFilename,
} from "./exports.js";

describe("isExportFile", () => {
  it("requires filename, mediaType and text strings", () => {
    expect(isExportFile({ filename: "a.json", mediaType: "application/json", text: "{}" })).toBe(
      true,
    );
    expect(isExportFile({ filename: "a.json", text: "{}" })).toBe(false);
    expect(isExportFile(null)).toBe(false);
    expect(isExportFile("x")).toBe(false);
  });
});

describe("safeFilename", () => {
  it("strips paths and control characters", () => {
    expect(safeFilename("../../etc/passwd", "f.json")).toBe("_.._etc_passwd");
    expect(safeFilename("a\\b\u0000c.json", "f.json")).toBe("a_b_c.json");
  });
  it("falls back when nothing is left and bounds the length", () => {
    expect(safeFilename("...", "f.json")).toBe("f.json");
    expect(safeFilename("", "f.json")).toBe("f.json");
    expect(safeFilename("x".repeat(500), "f.json")).toHaveLength(120);
  });
});

describe("clampNote", () => {
  it("limits notes to the maximum length", () => {
    expect(clampNote("a".repeat(NOTE_MAX_LENGTH + 10))).toHaveLength(NOTE_MAX_LENGTH);
    expect(clampNote("short")).toBe("short");
  });
});

describe("import helpers", () => {
  it("checks the selected file", () => {
    expect(checkImportFile(null)).toMatch(/Choose/);
    expect(checkImportFile({ name: "a.json", size: 0 })).toMatch(/empty/);
    expect(checkImportFile({ name: "a.json", size: IMPORT_MAX_BYTES + 1 })).toMatch(/larger/);
    expect(checkImportFile({ name: "a.json", size: 10 })).toBeNull();
  });
  it("validates and summarises results", () => {
    expect(isImportResult({ ok: true, errors: [], warnings: ["w"] })).toBe(true);
    expect(isImportResult({ ok: true, errors: [1], warnings: [] })).toBe(false);
    expect(isImportResult({ errors: [], warnings: [] })).toBe(false);
    expect(
      importSummary({ ok: true, setId: "s", indicatorCount: 1, errors: [], warnings: [] }),
    ).toBe("Imported 1 indicator.");
    expect(importSummary({ ok: true, indicatorCount: 3, errors: [], warnings: [] })).toBe(
      "Imported 3 indicators.",
    );
    expect(importSummary({ ok: false, errors: ["bad"], warnings: [] })).toBe(
      "The file was not imported.",
    );
  });
});
