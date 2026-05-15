// Meridian — Hunter configuration helpers.
//
// Reads HUNTER_API_KEY server-side and accepts only a raw API key value.
// URL-style values are rejected so a pasted request URL cannot become a
// malformed Hunter request with duplicated query parameters.

export type HunterApiKeyStatus = "configured" | "missing" | "malformed";

export type HunterApiKeyRead = {
  status: HunterApiKeyStatus;
  key: string | null;
  reason?: string;
};

const PLACEHOLDER_VALUES = new Set([
  "your_real_hunter_key_here",
  "your_hunter_api_key",
  "hunter_api_key",
]);

const RAW_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;
const warnedReasons = new Set<string>();

export function parseHunterApiKey(raw: string | undefined | null): HunterApiKeyRead {
  if (typeof raw !== "string") return { status: "missing", key: null, reason: "missing" };

  const value = raw.trim();
  if (value.length === 0) return { status: "missing", key: null, reason: "empty" };

  const lower = value.toLowerCase();
  if (PLACEHOLDER_VALUES.has(lower)) {
    return { status: "missing", key: null, reason: "placeholder" };
  }

  if (
    lower.startsWith("http://")
    || lower.startsWith("https://")
    || lower.includes("api.hunter.io")
    || lower.includes("api_key=")
  ) {
    return { status: "malformed", key: null, reason: "url_style_value" };
  }

  if (/[/?&=#]/.test(value)) {
    return { status: "malformed", key: null, reason: "query_or_path_syntax" };
  }

  if (/\s/.test(value)) {
    return { status: "malformed", key: null, reason: "embedded_whitespace" };
  }

  if (!RAW_KEY_PATTERN.test(value)) {
    return { status: "malformed", key: null, reason: "unsupported_characters" };
  }

  return { status: "configured", key: value };
}

function warnMalformedHunterKey(reason: string): void {
  if (typeof window !== "undefined") return;
  if (warnedReasons.has(reason)) return;
  warnedReasons.add(reason);
  console.warn(`[hunter-config] HUNTER_API_KEY ignored: expected raw API key (${reason})`);
}

export function readHunterApiKey(env: NodeJS.ProcessEnv = process.env): HunterApiKeyRead {
  const parsed = parseHunterApiKey(env.HUNTER_API_KEY);
  if (parsed.status === "malformed") {
    warnMalformedHunterKey(parsed.reason ?? "malformed");
  }
  return parsed;
}

export function getHunterApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  return readHunterApiKey(env).key;
}

export function isHunterConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return readHunterApiKey(env).status === "configured";
}
