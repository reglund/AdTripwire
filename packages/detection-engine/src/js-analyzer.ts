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

/** True if `re` matches within `windowLen` chars after each occurrence of `needle` (up to `maxHits` occurrences). */
function nearAfter(
  text: string,
  needle: string,
  re: RegExp,
  windowLen: number,
  maxHits = 200,
): boolean {
  let from = 0;
  for (let hits = 0; hits < maxHits; hits++) {
    const i = text.indexOf(needle, from);
    if (i < 0) return false;
    const slice = text.slice(i + needle.length, i + needle.length + windowLen);
    if (re.test(slice)) return true;
    from = i + needle.length;
  }
  return false;
}

/** Find the first numeric literal second argument in setInterval calls; true if any is <= 2000 ms. */
function hasShortInterval(text: string): boolean {
  const delayRe = /,\s*(\d{1,7}(?:\.\d{1,3})?(?:e\d)?)\s*\)/;
  let from = 0;
  for (let hits = 0; hits < 200; hits++) {
    const i = text.indexOf("setInterval", from);
    if (i < 0) return false;
    const slice = text.slice(i, i + 2000);
    const m = delayRe.exec(slice);
    if (m && m[1] !== undefined) {
      const v = Number(m[1]);
      if (Number.isFinite(v) && v <= 2000) return true;
    }
    from = i + 11;
  }
  return false;
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
 * Never returns any substring of the input.
 */
export function analyzeJavaScript(text: string, opts?: { maxChars?: number }): JsAnalysisResult {
  const max = Math.max(0, Math.floor(opts?.maxChars ?? DEFAULT_JS_ANALYSIS_MAX_CHARS));
  const src = typeof text === "string" ? text.slice(0, max) : "";
  const markers = new Set<string>();
  const add = (id: string, cond: boolean): void => {
    if (cond) markers.add(id);
  };

  const lower = src.toLowerCase();

  add("js.new_function", /\bnew\s+Function\s*\(/.test(src));
  add("js.eval", /(?:^|[^.\w$])eval\s*\(/.test(src));
  add("js.websocket", /\bWebSocket\b/.test(src));
  add(
    "js.webrtc",
    /\b(?:RTCPeerConnection|webkitRTCPeerConnection|RTCDataChannel|createDataChannel)\b/.test(src),
  );
  add("js.webtransport", /\bWebTransport\b/.test(src));
  add("js.postmessage_wildcard", nearAfter(src, "postMessage(", /,\s*(["'`])\*\1\s*[,)]/, 600));

  const iframeCreate = /createElement\s*\(\s*["'`]iframe["'`]\s*\)/i.test(src);
  add("js.iframe_create", iframeCreate);

  // Bounded separator between the two declarations: adjacent unbounded `\s*` groups around an
  // optional `;` backtrack quadratically on long whitespace runs (ReDoS).
  const cssOnePx = /width\s*:\s*1px[\s;]{0,8}height\s*:\s*1px/i.test(src);
  const w1 = /width["']?\s*[:=]\s*["']?1(?:px)?["']?\s*[;,)}]/i.test(src);
  const h1 = /height["']?\s*[:=]\s*["']?1(?:px)?["']?\s*[;,)}]/i.test(src);
  add("js.iframe_1x1", cssOnePx || (w1 && h1 && lower.includes("iframe")));

  const setsSrc = /\.src\s*=[^=]/.test(src);
  add("js.script_inject", /createElement\s*\(\s*["'`]script["'`]\s*\)/i.test(src) && setsSrc);
  add("js.cookie_read", /document\s*(?:\.\s*cookie\b|\[\s*["']cookie["']\s*\])/.test(src));
  add("js.cookie_tilde_join", src.includes("~~~"));
  add("js.image_beacon", /\bnew\s+Image\s*\(/.test(src) && setsSrc);
  add("js.high_entropy_hints", src.includes("getHighEntropyValues"));
  add(
    "js.webgl_renderer",
    src.includes("UNMASKED_RENDERER_WEBGL") || src.includes("WEBGL_debug_renderer_info"),
  );
  add("js.battery", src.includes("getBattery"));
  add("js.performance_memory", /performance\s*\.\s*memory\b/.test(src));
  add("js.webdriver_probe", /\.\s*webdriver\b|["']webdriver["']/.test(src));
  add(
    "js.error_stack_trap",
    nearAfter(src, "defineProperty", /["'`]stack["'`][\s\S]{0,200}\bget\b/, 300) ||
      /__defineGetter__\s*\(\s*["'`]stack["'`]/.test(src),
  );
  add("js.doh_cloudflare", lower.includes("cloudflare-dns.com/dns-query"));
  add(
    "js.raw_ip_fetch",
    /fetch\s*\(\s*["'`]https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}[:/"'`]/.test(src) ||
      /fetch\s*\(\s*(["'])https?:\/\/\1\s*\+\s*[\w$.]{1,64}\s*\+\s*(["'])\/json/.test(src) ||
      /fetch\s*\(\s*`https?:\/\/\$\{\s*[\w$.]{1,64}\s*\}\/json/.test(src),
  );
  add("js.adfection_sdk_auth", src.includes("SDK_AUTH") || src.includes("remainingRequests"));
  add("js.adfection_sdk_ready", src.includes("analytics_sdk_ready"));
  add("js.adfection_script_tok", src.includes("script_tok="));
  add("js.adfection_getad_script_id", src.includes("getAdScript"));
  add("js.crypto_subtle", /crypto\s*\.\s*subtle\b/.test(src));
  add("js.ecdh", /\bECDH\b/.test(src));
  add("js.aes_cbc", src.includes("AES-CBC"));
  add("js.rsa_oaep", src.includes("RSA-OAEP"));
  add("js.obfuscation_bang_bracket", src.includes("!![]") || /!0x[01]\b/.test(src));
  add("js.timer_polling", hasShortInterval(src));

  const { identifierCount, ...stats } = computeStats(src);
  add("js.obfuscation_hex_escapes", stats.escapeRatio > 0.05);
  add(
    "js.obfuscation_short_identifiers",
    identifierCount >= 200 && stats.avgIdentifierLength < 2.5,
  );

  return { markers: [...markers].sort(), stats };
}
