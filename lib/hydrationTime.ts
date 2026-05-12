// Shared helpers for SSR-hydrated UI that needs an initial clock.
// Initial render must use serialized ISO props, not Date.now()/new Date().

export function parseHydrationTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function dateFromHydrationTime(value: string | null | undefined, fallback?: string | null): Date {
  return new Date(parseHydrationTime(value) ?? parseHydrationTime(fallback) ?? 0);
}

export function formatStableUtcTimestamp(value: string | null | undefined): string | null {
  const ms = parseHydrationTime(value);
  if (ms === null) return null;
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min} UTC`;
}
