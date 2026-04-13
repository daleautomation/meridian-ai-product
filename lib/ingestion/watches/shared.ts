// Meridian AI — shared watch ingestion utilities.
//
// Pure functions extracted from ebayAdapter so all adapters (eBay, Facebook,
// Reddit, future sources) produce consistent tag/year/box-papers signals.

const SPORT_KEYWORDS = [
  "submariner",
  "gmt",
  "daytona",
  "explorer",
  "sea-dweller",
  "yacht-master",
  "royal oak",
  "nautilus",
  "aquanaut",
  "black bay",
  "pelagos",
  "speedmaster",
];
const DRESS_KEYWORDS = [
  "calatrava",
  "cellini",
  "santos",
  "tank",
  "saxonia",
  "1815",
  "datejust",
  "day-date",
  "patrimony",
];
const VINTAGE_KEYWORDS = ["vintage", "1960", "1970", "1980", "no-date"];

export function guessTag(title: string): string {
  const t = title.toLowerCase();
  if (VINTAGE_KEYWORDS.some((k) => t.includes(k))) return "Vintage";
  if (SPORT_KEYWORDS.some((k) => t.includes(k))) return "Sport";
  if (DRESS_KEYWORDS.some((k) => t.includes(k))) return "Dress";
  if (t.includes("speedmaster") || t.includes("chronograph")) return "Tool";
  return "Sport";
}

export function extractYear(title: string): string | null {
  const m = title.match(/\b(19\d{2}|20[0-2]\d)\b/);
  return m ? m[1] : null;
}

export function normalizeBoxPapers(
  raw: boolean | "full_set" | "box_only" | "papers_only" | "neither" | undefined
): string {
  if (raw === true || raw === "full_set") return "full_set";
  if (raw === "box_only") return "box_only";
  if (raw === "papers_only") return "papers_only";
  return "neither";
}

/**
 * Parse free-form description text for box/papers mentions.
 * Used by Facebook/Reddit adapters where there's no structured field.
 */
export function parseBoxPapersFromText(text: string): string {
  const t = text.toLowerCase();
  const hasBox =
    t.includes("box") ||
    t.includes("inner box") ||
    t.includes("outer box") ||
    t.includes("full kit");
  const hasPapers =
    t.includes("papers") ||
    t.includes("card") ||
    t.includes("warranty") ||
    t.includes("certificate") ||
    t.includes("full kit") ||
    t.includes("full set");
  if (hasBox && hasPapers) return "full_set";
  if (hasBox) return "box_only";
  if (hasPapers) return "papers_only";
  return "neither";
}
