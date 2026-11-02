/**
 * Chromium exposes the WebExtensions API as `chrome.*` (promise-returning in MV3). The shared
 * code is written against the `browser` global; alias it here. Loaded first in every bundle.
 */
const g = globalThis as unknown as { browser?: unknown; chrome?: unknown };
if (!g.browser && g.chrome) g.browser = g.chrome;
