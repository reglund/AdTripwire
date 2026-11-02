/** Pure helpers for file exports and indicator imports. No DOM access, so they are unit-testable. */
import type { ExportFile, ImportResult } from "@adtripwire/shared";

/** Maximum analyst note length, in UTF-16 code units (matches the textarea `maxlength`). */
export const NOTE_MAX_LENGTH = 4000;

/** Largest indicator file the UI will read into memory before sending it to the background. */
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;

export function isExportFile(value: unknown): value is ExportFile {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["filename"] === "string" &&
    typeof v["mediaType"] === "string" &&
    typeof v["text"] === "string"
  );
}

/**
 * Reduces a background-supplied file name to a plain base name: no path separators, no control
 * characters, bounded length. Falls back when nothing usable is left.
 */
export function safeFilename(name: string, fallback: string): string {
  const noControls = Array.from(name)
    .map((c) => (c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f ? "/" : c))
    .join("");
  const cleaned = noControls
    .replace(/[\\/]+/g, "_")
    .replace(/^\.+/, "")
    .trim();
  const bounded = cleaned.slice(0, 120);
  return bounded.length > 0 ? bounded : fallback;
}

export function clampNote(text: string): string {
  return text.length > NOTE_MAX_LENGTH ? text.slice(0, NOTE_MAX_LENGTH) : text;
}

/** Returns an error message for a file that should not be imported, or null when acceptable. */
export function checkImportFile(file: { name: string; size: number } | null): string | null {
  if (file === null) return "Choose a .json file to import.";
  if (file.size === 0) return "The selected file is empty.";
  if (file.size > IMPORT_MAX_BYTES) {
    return `The selected file is larger than ${Math.round(IMPORT_MAX_BYTES / (1024 * 1024))} MB, which is more than this page will read.`;
  }
  return null;
}

export function isImportResult(value: unknown): value is ImportResult {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["ok"] === "boolean" &&
    Array.isArray(v["errors"]) &&
    Array.isArray(v["warnings"]) &&
    (v["errors"] as unknown[]).every((e) => typeof e === "string") &&
    (v["warnings"] as unknown[]).every((e) => typeof e === "string")
  );
}

/** One-line outcome for an import result, with conservative wording. */
export function importSummary(result: ImportResult): string {
  if (!result.ok) return "The file was not imported.";
  const n = result.indicatorCount ?? 0;
  return `Imported ${n} indicator${n === 1 ? "" : "s"}.`;
}
