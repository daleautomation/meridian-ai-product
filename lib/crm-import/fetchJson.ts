export type ApiJsonResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; status: number };

export async function fetchApiJson<T extends Record<string, unknown>>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<ApiJsonResult<T>> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message || "Network request failed", status: 0 };
  }

  const text = await res.text();
  if (!text.trim()) {
    return {
      ok: false,
      error: res.ok
        ? "Server returned an empty response."
        : `Request failed (${res.status}). The server returned no details.`,
      status: res.status,
    };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    const snippet = text.length > 120 ? `${text.slice(0, 120)}…` : text;
    return {
      ok: false,
      error: `Server returned non-JSON (${res.status}): ${snippet}`,
      status: res.status,
    };
  }

  if (!res.ok) {
    const errMsg =
      typeof parsed.error === "string"
        ? parsed.error
        : `Request failed (${res.status}).`;
    return { ok: false, error: errMsg, status: res.status };
  }

  return { ok: true, data: parsed as T, status: res.status };
}
