export const ABOUT_HREF = "/about";
export const CLIENT_LOGIN_HREF = "/login?next=/operator";

// Points at a real Recovery Brief so the CTA delivers what it promises.
// Staffing Pipeline Recovery matches the recruiting/staffing outreach cohort
// and is the strongest brief currently generated on disk. Swap to another
// generated brief slug if the cohort changes (or regenerate the desired
// brief first — slugs live under data/recovery-briefs/).
export const RECOVERY_SAMPLE_BRIEF_HREF = "/brief/staffing-pipeline-recovery/2026-W20";

// Founder-led intake: the "first brief" request is intentionally a mailto
// rather than a form. Manual reply preserves the founder-reviewed promise
// of the product itself.
export const REQUEST_FIRST_BRIEF_HREF =
  "mailto:dylan@meridian.ai?subject=First%20Recovery%20Brief&body=Hi%20Dylan%20%E2%80%94%20I%27d%20like%20a%20first%20Recovery%20Brief%20on%20my%20list.%0A%0AFirm%3A%20%0AContacts%20I%27d%20like%20included%3A%20%0AFormat%20I%20can%20share%20(CSV%2C%20HubSpot%20export%2C%20etc.)%3A%20";
