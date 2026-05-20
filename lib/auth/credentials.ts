/** Normalize username for tenant lookup. */
export function normalizeLoginUsername(value: string): string {
  return value.trim().toLowerCase();
}

/** Normalize password input (trim whitespace only; preserve case for exact match). */
export function normalizeLoginPassword(value: string): string {
  return value.trim();
}

function foldAscii(c: number): number {
  return c >= 65 && c <= 90 ? c + 32 : c;
}

/**
 * Constant-time compare with optional case-insensitive match (demo / field-test).
 * Accepts exact match first, then ASCII case-folded match.
 */
export function passwordsMatch(stored: string, provided: string): boolean {
  const s = normalizeLoginPassword(stored);
  const p = normalizeLoginPassword(provided);
  if (s.length !== p.length) return false;

  let exact = 0;
  let folded = 0;
  for (let i = 0; i < s.length; i++) {
    const sc = s.charCodeAt(i);
    const pc = p.charCodeAt(i);
    exact |= sc ^ pc;
    folded |= foldAscii(sc) ^ foldAscii(pc);
  }
  return exact === 0 || folded === 0;
}
