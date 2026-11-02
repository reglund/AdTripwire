/**
 * Bounded, linear-time JavaScript technique scanner.
 *
 * Used by the Firefox response-filter sensor on narrowly selected response bodies.
 * It returns only stable marker identifiers and aggregate statistics; it never stores
 * or returns any portion of the analysed source text.
 *
 * All regular expressions are free of nested quantifiers. Proximity checks use
 * indexOf plus bounded substring tests, so runtime stays linear in the (capped) input.
 */

export const DEFAULT_JS_ANALYSIS_MAX_CHARS = 262144;

export interface JsAnalysisStats {
  length: number;
  escapeRatio: number;
  avgIdentifierLength: number;
  stringLiterals: number;
}

export interface JsAnalysisResult {
  markers: string[];
  stats: JsAnalysisStats;
  /**
   * First character offset of each emitted marker that has a location (statistical markers
   * have none). Offsets only, never text. Not persisted by the sensor; derived
   * "js.colocated_*" markers carry the co-location result into events.
   */
  proximity: Record<string, number>;
}

export const JS_MARKER_DESCRIPTIONS: Record<string, string> = {
  "js.new_function":
    "The script constructs functions from strings at runtime (new Function), which can execute code delivered later.",
  "js.eval": "The script calls eval, which executes text as code.",
  "js.websocket":
    "The script opens or references a WebSocket, a persistent two-way network channel.",
  "js.webrtc":
    "The script references WebRTC peer connections or data channels, which can be used as an alternative network channel.",
  "js.webtransport": "The script references WebTransport, a newer low-latency network channel.",
  "js.postmessage_wildcard":
    "The script sends cross-window messages with a wildcard ('*') target origin, so any embedding page can receive them.",
  "js.iframe_create": "The script creates iframe elements dynamically.",
  "js.iframe_1x1":
    "The script uses 1x1-pixel dimensions together with iframe content, a pattern used to hide frames from view.",
  "js.script_inject":
    "The script creates script elements and sets their source, loading further code dynamically.",
  "js.cookie_read": "The script reads document.cookie.",
  "js.cookie_tilde_join":
    "The script contains the '~~~' separator documented as the join string for collected cookie material.",
  "js.image_beacon":
    "The script creates Image objects and sets their source, a common way to send data in a request URL.",
  "js.high_entropy_hints":
    "The script requests high-entropy browser client hints (getHighEntropyValues).",
  "js.webgl_renderer":
    "The script queries the unmasked WebGL graphics renderer, a common fingerprinting attribute.",
  "js.battery": "The script queries battery status (getBattery), a fingerprinting attribute.",
  "js.performance_memory": "The script reads performance.memory, a device-profiling attribute.",
  "js.webdriver_probe":
    "The script checks for webdriver automation, typically to detect analysis or automated browsing.",
  "js.error_stack_trap":
    "The script defines a getter for an Error stack property, a documented anti-debugging trap.",
  "js.doh_cloudflare":
    "The script queries Cloudflare DNS-over-HTTPS directly, resolving hostnames outside the browser's normal DNS path.",
  "js.raw_ip_fetch":
    "The script fetches from a raw IP address URL or a URL assembled from a variable host and '/json' path.",
  "js.adfection_sdk_auth":
    "The script contains SDK_AUTH or remainingRequests strings documented in the AdFection delivery SDK.",
  "js.adfection_sdk_ready":
    "The script contains the 'analytics_sdk_ready' message type documented in the AdFection delivery SDK.",
  "js.adfection_script_tok":
    "The script contains the 'script_tok=' parameter documented for AdFection SDK loading.",
  "js.adfection_getad_script_id":
    "The script contains the 'getAdScript' element id documented in AdFection getAd scripts.",
  "js.crypto_subtle": "The script uses the Web Crypto API (crypto.subtle).",
  "js.ecdh": "The script references ECDH key agreement.",
  "js.aes_cbc": "The script references AES-CBC encryption.",
  "js.rsa_oaep": "The script references RSA-OAEP encryption.",
  "js.obfuscation_hex_escapes":
    "More than 5% of the script consists of hex or unicode escape sequences, an obfuscation indicator.",
  "js.obfuscation_bang_bracket":
    "The script uses '!![]' or '!0x0'-style constructs typical of automated obfuscators.",
  "js.obfuscation_short_identifiers":
    "Identifiers in the script are unusually short on average, consistent with heavy minification or obfuscation.",
  "js.timer_polling": "The script polls on a short timer (setInterval at 2 seconds or less).",
  "js.colocated_dynamic_transport":
    "Runtime code construction, a network channel and cryptography appear within 4000 characters of each other in the script.",
  "js.colocated_cookie_exfil":
    "The cookie read and the outbound beacon or '~~~' separator appear within 4000 characters of each other in the script.",
};

const JS_KEYWORDS = new Set([
  "var",
  "let",
  "const",
  "function",
  "return",
  "if",
  "else",
  "for",
  "while",
  "do",
  "new",
  "this",
  "true",
  "false",
  "null",
  "undefined",
  "typeof",
  "in",
  "of",
  "break",
  "continue",
  "switch",
  "case",
  "default",
  "try",
  "catch",
  "finally",
  "throw",
  "void",
  "delete",
  "instanceof",
  "class",
  "extends",
  "super",
  "import",
  "export",
  "async",
  "await",
  "yield",
]);

/**
 * Maximum distance (characters, between first occurrences) for markers to count as co-located.
 * 4000 characters is roughly one large function body in unminified code, or a few hundred
 * statements in a minified bundle: wide enough to cover a loader routine, narrow enough that
 * unrelated modules concatenated into one bundle rarely satisfy it.
 */
export const JS_COLOCATION_MAX_CHARS = 4000;

/** Bound on anchor occurrences examined per marker, keeping hostile inputs linear. */
const MAX_HITS = 200;

/**
 * Build a view of `src` with comments and string/template/regex literal contents replaced by
 * spaces. Offsets are preserved (same length). Quote delimiters are kept so callers can tell a
 * real string literal from text inside a comment. Single pass, no regular expressions.
 *
 * Limits (documented): regex-literal detection uses the previous significant character, so a
 * regex after a keyword such as `return` is treated as division; single- and double-quoted
 * strings end at a newline, so a mis-detected quote blanks at most the rest of that line.
 */
export function buildCodeView(src: string): string {
  const n = src.length;
  const parts: string[] = [];
  let last = 0;
  const blank = (from: number, to: number): void => {
    if (to <= from) return;
    parts.push(src.slice(last, from), " ".repeat(to - from));
    last = to;
  };
  const templateStack: number[] = [];
  let braceDepth = 0;
  let prevSig = 0; // last significant code character (0 = start of input)
  let noRegexBefore = 0;
  // Characters after which a '/' starts a regular-expression literal rather than a division.
  const regexAfter = (c: number): boolean =>
    c === 0 || "(,=:[!&|?{};+-*%<>~^}".includes(String.fromCharCode(c));

  /** Scan template text from `from`; returns the index after the template or after "${". */
  const template = (from: number): number => {
    let j = from;
    while (j < n) {
      const ch = src.charCodeAt(j);
      if (ch === 92) {
        j += 2;
        continue;
      }
      if (ch === 96) break;
      if (ch === 36 && src.charCodeAt(j + 1) === 123) break;
      j++;
    }
    const end = Math.min(j, n);
    blank(from, end);
    if (end >= n) return n;
    if (src.charCodeAt(end) === 96) {
      prevSig = 97;
      return end + 1;
    }
    templateStack.push(braceDepth);
    braceDepth++;
    prevSig = 123;
    return end + 2;
  };

  let i = 0;
  while (i < n) {
    const c = src.charCodeAt(i);
    if (c === 47 /* / */) {
      const next = src.charCodeAt(i + 1);
      if (next === 47) {
        const j = src.indexOf("\n", i + 2);
        const end = j < 0 ? n : j;
        blank(i, end);
        i = end;
        continue;
      }
      if (next === 42) {
        const j = src.indexOf("*/", i + 2);
        const end = j < 0 ? n : j + 2;
        blank(i, end);
        i = end;
        continue;
      }
      // `noRegexBefore`: an earlier regex scan from before this point failed to terminate up to
      // there, so retrying would rescan the same text (quadratic on hostile input).
      if (i >= noRegexBefore && regexAfter(prevSig)) {
        let j = i + 1;
        let inClass = false;
        while (j < n) {
          const ch = src.charCodeAt(j);
          if (ch === 92) {
            j += 2;
            continue;
          }
          if (ch === 10) break;
          if (inClass) {
            if (ch === 93) inClass = false;
          } else if (ch === 91) inClass = true;
          else if (ch === 47) break;
          j++;
        }
        if (j < n && src.charCodeAt(j) === 47) {
          blank(i + 1, j);
          i = j + 1;
          prevSig = 97;
          continue;
        }
        noRegexBefore = Math.min(j, n);
      }
      prevSig = c;
      i++;
      continue;
    }
    if (c === 34 || c === 39) {
      let j = i + 1;
      while (j < n) {
        const ch = src.charCodeAt(j);
        if (ch === 92) {
          j += 2;
          continue;
        }
        if (ch === c || ch === 10) break;
        j++;
      }
      const end = Math.min(j, n);
      blank(i + 1, end);
      i = end < n && src.charCodeAt(end) === c ? end + 1 : end;
      prevSig = 97;
      continue;
    }
    if (c === 96) {
      i = template(i + 1);
      continue;
    }
    if (c === 123) braceDepth++;
    else if (c === 125) {
      braceDepth--;
      if (templateStack.length > 0 && braceDepth === templateStack[templateStack.length - 1]) {
        templateStack.pop();
        i = template(i + 1);
        continue;
      }
    }
    if (c !== 32 && c !== 9 && c !== 10 && c !== 13) prevSig = c;
    i++;
  }
  if (last === 0) return src;
  parts.push(src.slice(last));
  return parts.join("");
}

/** Offset of the first match of a non-global regex, or -1. */
function at(text: string, re: RegExp): number {
  const m = re.exec(text);
  return m ? m.index : -1;
}

/**
 * First offset where the global `anchor` matches in `code` AND the sticky `tail` matches the
 * full text immediately after it (the tail usually contains a string literal blanked in code).
 */
function anchored(code: string, full: string, anchor: RegExp, tail: RegExp): number {
  anchor.lastIndex = 0;
  for (let hits = 0; hits < MAX_HITS; hits++) {
    const m = anchor.exec(code);
    if (!m) return -1;
    tail.lastIndex = m.index + m[0].length;
    if (tail.test(full)) return m.index;
    if (m[0].length === 0) anchor.lastIndex++;
  }
  return -1;
}

/**
 * True-offset of the first occurrence of `needle` in `code` after which `re` matches within
 * `windowLen` chars of the FULL text (up to MAX_HITS occurrences).
 */
function nearAfter(
  code: string,
  full: string,
  needle: string,
  re: RegExp,
  windowLen: number,
): number {
  let from = 0;
  for (let hits = 0; hits < MAX_HITS; hits++) {
    const i = code.indexOf(needle, from);
    if (i < 0) return -1;
    const slice = full.slice(i + needle.length, i + needle.length + windowLen);
    if (re.test(slice)) return i;
    from = i + needle.length;
  }
  return -1;
}

/** Offset of the first real string literal (not inside a comment) matching global `re` in full text. */
function realLiteral(code: string, full: string, re: RegExp): number {
  re.lastIndex = 0;
  for (let hits = 0; hits < MAX_HITS; hits++) {
    const m = re.exec(full);
    if (!m) return -1;
    if (code.charCodeAt(m.index) === full.charCodeAt(m.index)) return m.index;
  }
  return -1;
}

/**
 * Offset of the first `setInterval(` call whose own second argument is a numeric literal
 * <= 2000 ms. The argument list is scanned in the code view (strings and comments blanked) to
 * the matching ')' at depth 0, bounded to 2000 chars per call.
 */
function shortIntervalAt(code: string): number {
  const re = /\bsetInterval\s*\(/g;
  for (let hits = 0; hits < MAX_HITS; hits++) {
    const m = re.exec(code);
    if (!m) return -1;
    const start = m.index + m[0].length;
    const limit = Math.min(code.length, start + 2000);
    let depth = 0;
    let argStart = -1;
    let argEnd = -1;
    for (let j = start; j < limit; j++) {
      const c = code.charCodeAt(j);
      if (c === 40 || c === 91 || c === 123) depth++;
      else if (c === 41 || c === 93 || c === 125) {
        if (depth === 0) {
          if (c === 41 && argStart >= 0) argEnd = j;
          break;
        }
        depth--;
      } else if (c === 44 && depth === 0) {
        if (argStart < 0) argStart = j + 1;
        else {
          argEnd = j;
          break;
        }
      }
    }
    if (argStart >= 0 && argEnd > argStart) {
      const lit = code.slice(argStart, argEnd).trim();
      if (/^\d{1,7}(?:\.\d{1,3})?(?:e\d)?$/.test(lit)) {
        const v = Number(lit);
        if (Number.isFinite(v) && v <= 2000) return m.index;
      }
    }
  }
  return -1;
}

/** Property-form 1x1 sizing (width=1 and height=1) with "iframe" within 600 chars. */
function iframeOnePxPropertyAt(full: string): number {
  const w1 = /width["']?\s*[:=]\s*["']?1(?:px)?["']?\s*[;,)}]/gi;
  const h1 = /height["']?\s*[:=]\s*["']?1(?:px)?["']?\s*[;,)}]/i;
  for (let hits = 0; hits < MAX_HITS; hits++) {
    const m = w1.exec(full);
    if (!m) return -1;
    const win = full.slice(Math.max(0, m.index - 600), m.index + 600);
    if (h1.test(win) && win.toLowerCase().includes("iframe")) return m.index;
  }
  return -1;
}

/** Smallest span covering one marker from each group, using first offsets; Infinity if none. */
export function colocationSpan(
  proximity: Readonly<Record<string, number>>,
  groups: readonly (readonly string[])[],
): number {
  let best = Infinity;
  const walk = (g: number, lo: number, hi: number): void => {
    if (g === groups.length) {
      best = Math.min(best, hi - lo);
      return;
    }
    for (const id of groups[g]!) {
      const o = proximity[id];
      if (o === undefined) continue;
      walk(g + 1, Math.min(lo, o), Math.max(hi, o));
    }
  };
  walk(0, Infinity, -Infinity);
  return best;
}

/** Marker groups whose co-location yields a derived "js.colocated_*" marker. */
export const COLOCATION_GROUPS: Record<string, readonly (readonly string[])[]> = {
  "js.colocated_dynamic_transport": [
    ["js.new_function", "js.eval"],
    ["js.websocket", "js.webrtc", "js.webtransport", "js.timer_polling"],
    ["js.crypto_subtle", "js.ecdh", "js.aes_cbc", "js.rsa_oaep"],
  ],
  "js.colocated_cookie_exfil": [["js.cookie_read"], ["js.cookie_tilde_join", "js.image_beacon"]],
};

/** True when the input carries a standard minified-bundle banner (license, source map, .min.js). */
export function looksLikeMinifiedBundle(full: string): boolean {
  const head = full.slice(0, 2000);
  return (
    head.includes("/*!") ||
    full.includes("//# sourceMappingURL=") ||
    full.includes("//@ sourceMappingURL=") ||
    /\/[*/][^\n]{0,200}\.min\.js/.test(head)
  );
}

function computeStats(text: string): JsAnalysisStats & { identifierCount: number } {
  const length = text.length;
  // Escape ratio: characters belonging to \xHH or \uHHHH sequences.
  let escapeChars = 0;
  const escRe = /\\x[0-9a-fA-F]{2}|\\u[0-9a-fA-F]{4}/g;
  let m: RegExpExecArray | null;
  while ((m = escRe.exec(text)) !== null) escapeChars += m[0].length;

  // Identifiers (rough lexical approximation; keywords excluded).
  let idCount = 0;
  let idLenSum = 0;
  const idRe = /[A-Za-z_$][\w$]{0,255}/g;
  while ((m = idRe.exec(text)) !== null) {
    const id = m[0];
    // Skip identifier-looking tokens that are part of hex/number literals or escapes.
    const prev = m.index > 0 ? text.charCodeAt(m.index - 1) : 0;
    if ((prev >= 48 && prev <= 57) || prev === 92 /* \ */) continue;
    if (JS_KEYWORDS.has(id)) continue;
    idCount++;
    idLenSum += id.length;
  }

  // String literals: single linear scan honouring backslash escapes.
  let stringLiterals = 0;
  let quote = 0;
  for (let i = 0; i < length; i++) {
    const c = text.charCodeAt(i);
    if (quote !== 0) {
      if (c === 92) i++;
      else if (c === quote) {
        quote = 0;
        stringLiterals++;
      } else if (c === 10 && quote !== 96) quote = 0; // unterminated single-line string
    } else if (c === 34 || c === 39 || c === 96) {
      quote = c;
    }
  }

  return {
    length,
    escapeRatio: length === 0 ? 0 : escapeChars / length,
    avgIdentifierLength: idCount === 0 ? 0 : idLenSum / idCount,
    stringLiterals,
    identifierCount: idCount,
  };
}

/**
 * Analyse at most `maxChars` characters of `text` and return technique markers.
 * API/technique markers are evaluated on a code view (comments and literal contents blanked);
 * string-content markers on the full text. Never returns any substring of the input.
 */
export function analyzeJavaScript(text: string, opts?: { maxChars?: number }): JsAnalysisResult {
  const max = Math.max(0, Math.floor(opts?.maxChars ?? DEFAULT_JS_ANALYSIS_MAX_CHARS));
  const src = typeof text === "string" ? text.slice(0, max) : "";
  const code = buildCodeView(src);
  const markers = new Set<string>();
  const proximity: Record<string, number> = {};
  const mark = (id: string, offset: number): void => {
    if (offset < 0) return;
    markers.add(id);
    if (proximity[id] === undefined) proximity[id] = offset;
  };
  const firstOf = (...offsets: number[]): number => {
    let best = -1;
    for (const o of offsets) if (o >= 0 && (best < 0 || o < best)) best = o;
    return best;
  };

  const lower = src.toLowerCase();

  // --- API / technique markers: code view ---
  mark("js.new_function", at(code, /\bnew\s+Function\s*\(/));
  mark("js.eval", at(code, /(?:^|[^.\w$])eval\s*\(/));
  mark("js.websocket", at(code, /\bWebSocket\b/));
  mark(
    "js.webrtc",
    at(code, /\b(?:RTCPeerConnection|webkitRTCPeerConnection|RTCDataChannel|createDataChannel)\b/),
  );
  mark("js.webtransport", at(code, /\bWebTransport\b/));
  mark(
    "js.cookie_read",
    firstOf(
      at(code, /document\s*\.\s*cookie\b/),
      anchored(code, src, /document\s*\[\s*/g, /["']cookie["']\s*\]/y),
    ),
  );
  mark(
    "js.webdriver_probe",
    firstOf(at(code, /\.\s*webdriver\b/), realLiteral(code, src, /["']webdriver["']/g)),
  );
  mark("js.battery", code.indexOf("getBattery"));
  mark("js.performance_memory", at(code, /performance\s*\.\s*memory\b/));
  mark(
    "js.webgl_renderer",
    firstOf(
      code.indexOf("UNMASKED_RENDERER_WEBGL"),
      code.indexOf("WEBGL_debug_renderer_info"),
      anchored(code, src, /getExtension\s*\(\s*/g, /["'`]WEBGL_debug_renderer_info["'`]/y),
    ),
  );
  mark("js.high_entropy_hints", code.indexOf("getHighEntropyValues"));
  mark("js.crypto_subtle", at(code, /crypto\s*\.\s*subtle\b/));
  mark(
    "js.iframe_create",
    anchored(code, src, /createElement\s*\(\s*/g, /["'`]iframe["'`]\s*\)/iy),
  );
  const setsSrc = at(code, /\.src\s*=[^=]/) >= 0;
  if (setsSrc) {
    mark(
      "js.script_inject",
      anchored(code, src, /createElement\s*\(\s*/g, /["'`]script["'`]\s*\)/iy),
    );
    mark("js.image_beacon", at(code, /\bnew\s+Image\s*\(/));
  }
  mark("js.timer_polling", shortIntervalAt(code));
  mark(
    "js.error_stack_trap",
    firstOf(
      nearAfter(code, src, "defineProperty", /["'`]stack["'`][\s\S]{0,200}\bget\b/, 300),
      anchored(code, src, /__defineGetter__\s*\(\s*/g, /["'`]stack["'`]/y),
    ),
  );
  // postMessage call in code; its '*' target origin is a string literal read from the full text.
  mark(
    "js.postmessage_wildcard",
    nearAfter(code, src, "postMessage(", /,\s*(["'`])\*\1\s*[,)]/, 600),
  );
  mark(
    "js.raw_ip_fetch",
    anchored(
      code,
      src,
      /\bfetch\s*\(\s*/g,
      /["'`]https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}[:/"'`]|(["'])https?:\/\/\1\s*\+\s*[\w$.]{1,64}\s*\+\s*(["'])\/json|`https?:\/\/\$\{\s*[\w$.]{1,64}\s*\}\/json/y,
    ),
  );

  // --- string-content markers: full text ---
  // Bounded separator between the two declarations: adjacent unbounded `\s*` groups around an
  // optional `;` backtrack quadratically on long whitespace runs (ReDoS).
  mark(
    "js.iframe_1x1",
    firstOf(at(src, /width\s*:\s*1px[\s;]{0,8}height\s*:\s*1px/i), iframeOnePxPropertyAt(src)),
  );
  mark("js.cookie_tilde_join", src.indexOf("~~~"));
  mark("js.doh_cloudflare", lower.indexOf("cloudflare-dns.com/dns-query"));
  mark("js.adfection_sdk_auth", firstOf(src.indexOf("SDK_AUTH"), src.indexOf("remainingRequests")));
  mark("js.adfection_sdk_ready", src.indexOf("analytics_sdk_ready"));
  mark("js.adfection_script_tok", src.indexOf("script_tok="));
  mark("js.adfection_getad_script_id", src.indexOf("getAdScript"));
  mark("js.ecdh", at(src, /\bECDH\b/));
  mark("js.aes_cbc", src.indexOf("AES-CBC"));
  mark("js.rsa_oaep", src.indexOf("RSA-OAEP"));
  mark("js.obfuscation_bang_bracket", firstOf(src.indexOf("!![]"), at(src, /!0x[01]\b/)));

  // --- co-location (derived markers; the offsets themselves stay in `proximity`) ---
  for (const [id, groups] of Object.entries(COLOCATION_GROUPS)) {
    if (colocationSpan(proximity, groups) <= JS_COLOCATION_MAX_CHARS) markers.add(id);
  }

  // --- statistics: full text ---
  const { identifierCount, ...stats } = computeStats(src);
  if (stats.escapeRatio > 0.05) markers.add("js.obfuscation_hex_escapes");
  if (identifierCount >= 200 && stats.avgIdentifierLength < 2.5) {
    // Standard minified bundles have short identifiers by design: only keep the marker for
    // them when another obfuscation indicator is present.
    const accompanied =
      markers.has("js.obfuscation_hex_escapes") || markers.has("js.obfuscation_bang_bracket");
    if (accompanied || !looksLikeMinifiedBundle(src))
      markers.add("js.obfuscation_short_identifiers");
  }

  return { markers: [...markers].sort(), stats, proximity };
}
