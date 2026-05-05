// Meridian — source readiness check.
//
// Read-only, server-side detection of which lead-data sources are
// currently wired. Used to surface an honest readiness strip in the
// workspace so the operator knows why a bucket is empty.

export type SourceStatus = "Connected" | "Available" | "Not connected" | "Error";

export type SourceReadinessItem = {
  id: string;
  label: string;
  status: SourceStatus;
  detail?: string;
};

export function getSourceReadiness(): SourceReadinessItem[] {
  const env = process.env;

  const googlePlacesKey = !!(env.GOOGLE_API_KEY || env.GOOGLE_PLACES_API_KEY);
  const yelpKey = !!env.YELP_API_KEY;
  // Defensive parse: trim and reject empty / placeholder values. Catches
  // the "HUNTER_API_KEY=" empty-line case AND the leading-space typo
  // ("HUNTER_API_KEY = abc") that Next.js loads as a key with literal
  // leading-space content.
  const rawHunter = typeof env.HUNTER_API_KEY === "string" ? env.HUNTER_API_KEY.trim() : "";
  const hunterKey = rawHunter.length > 0 && rawHunter.toLowerCase() !== "your_real_hunter_key_here";
  // Safe diagnostic — boolean only, never the key value. Logs once per
  // call to getSourceReadiness (i.e. once per page render). Lets you
  // verify .env.local actually loaded after a dev-server restart.
  // eslint-disable-next-line no-console
  console.log(`[hunter-env-audit] HUNTER_API_KEY present: ${hunterKey}`);
  const serpKey = !!(env.SERPAPI_KEY || env.SERP_API_KEY);
  const stormKey = !!(env.STORM_API_KEY || env.NOAA_API_TOKEN);

  return [
    {
      id: "google_places",
      label: "Google Places",
      status: googlePlacesKey ? "Connected" : "Not connected",
      detail: googlePlacesKey ? "Phones, reviews, ratings" : "Set GOOGLE_PLACES_API_KEY to populate",
    },
    {
      id: "site_scan",
      label: "Site scan",
      status: "Available",
      detail: "Built-in: runs on import + refresh",
    },
    {
      id: "yelp",
      label: "Yelp",
      status: yelpKey ? "Connected" : "Not connected",
      detail: yelpKey ? "Business listings" : "Set YELP_API_KEY to enable",
    },
    {
      id: "hunter",
      label: "Hunter (email)",
      status: hunterKey ? "Connected" : "Not connected",
      detail: hunterKey ? "Domain → email" : "Set HUNTER_API_KEY to enable",
    },
    {
      id: "serp",
      label: "Serp / local ranking",
      status: serpKey ? "Connected" : "Not connected",
      detail: serpKey ? "Local-pack visibility" : "Set SERPAPI_KEY to enable",
    },
    {
      id: "storm",
      label: "Storm / weather",
      status: stormKey ? "Connected" : "Not connected",
      detail: stormKey ? "Storm-event triggers" : "Roofing trigger feed",
    },
    {
      id: "bbb",
      label: "BBB",
      status: env.BBB_SEARCH_URL ? "Connected" : "Not connected",
      detail: env.BBB_SEARCH_URL ? "Directory search" : "Set BBB_SEARCH_URL to enable",
    },
    {
      id: "manual",
      label: "Manual upload",
      status: "Available",
      detail: "Built-in CSV import",
    },
  ];
}
