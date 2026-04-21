// Meridian AI — contact resolution engine types.
//
// Identity-first pipeline: normalize business → resolve across sources in
// parallel → score candidates → extract contact → score confidence → output.

export type ContactSource =
  | "google_places"
  | "yelp"
  | "bbb"
  | "angi"
  | "facebook"
  | "bing"
  | "scrape";

export type BusinessInput = {
  companyName: string;
  city?: string;
  state?: string;
  category?: string;
  website?: string;
  phone?: string;
};

export type Identity = {
  rawName: string;
  normalizedName: string;
  city: string;
  state: string;
  locationKey: string;      // "city|ST"
  category: string;
};

export type ContactCandidate = {
  name: string;
  address?: string;
  phone?: string;
  website?: string;
  rating?: number;
  reviewCount?: number;
  source: ContactSource;
  sourceId?: string;
  fallbackUrl?: string;     // facebook page, contact page, etc.
};

export type CandidateScore = {
  name: number;             // 0..1
  location: number;         // 0..1
  category: number;         // 0..1
  total: number;            // 0..1 — (name*0.6) + (location*0.3) + (category*0.1)
};

export type MatchedCandidate = ContactCandidate & { score: CandidateScore };

export type ContactSummary = "found" | "fallback" | "empty";

export type ContactConfidence = "high" | "medium" | "low" | "none";

export type FallbackRoute = "facebook" | "contact_page" | null;

// Final output shape consumed by the UI.
export type ContactResolution = {
  phone: string | null;
  email: string | null;
  fallbackRoute: FallbackRoute;
  fallbackUrl: string | null;
  source: ContactSource | "none";
  confidence: ContactConfidence;
  checkedSources: ContactSource[];
  matchedName?: string;
  matchedAddress?: string;
  rating?: number;
  reviewCount?: number;
  lastCheckedAt: string;    // ISO
  summary: ContactSummary;
};
