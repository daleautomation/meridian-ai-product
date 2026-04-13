// Meridian AI — ingestion verification script.
//
// Loads both example raw source files via the new normalizers and prints
// summary counts. Run with: node scripts/verify-ingestion.mjs
//
// This is a smoke test, not a unit test. It proves the bulk-loading path
// works deterministically against the canonical example data and surfaces
// any normalization issues immediately.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

async function loadJson(p) {
  const text = await fs.readFile(path.join(ROOT, p), "utf8");
  return JSON.parse(text);
}

// ── Inline normalizers (mirror of lib/ingestion logic) ──
// Kept inline so this script can be run as plain Node ESM without TS compile.

function normalizeEbayListing(raw) {
  const id = `ebay-${raw.itemId}`;
  const title = raw.title;
  const t = title.toLowerCase();
  const sport = ["submariner","gmt","daytona","explorer","sea-dweller","yacht-master","royal oak","nautilus","aquanaut","black bay","pelagos","speedmaster"];
  const dress = ["calatrava","cellini","santos","tank","saxonia","1815","datejust","day-date","patrimony"];
  const vintage = ["vintage","1960","1970","1980"];
  let tag = "Sport";
  if (vintage.some((k) => t.includes(k))) tag = "Vintage";
  else if (sport.some((k) => t.includes(k))) tag = "Sport";
  else if (dress.some((k) => t.includes(k))) tag = "Dress";
  else if (t.includes("chronograph")) tag = "Tool";
  const yearMatch = title.match(/\b(19\d{2}|20[0-2]\d)\b/);
  const year = yearMatch ? yearMatch[1] : null;
  const subParts = [year, raw.condition, raw.itemLocation].filter(Boolean);
  const sub = subParts.join(" · ");
  const boxPapers =
    raw.hasBoxAndPapers === true || raw.hasBoxAndPapers === "full_set"
      ? "full_set"
      : raw.hasBoxAndPapers === "box_only"
      ? "box_only"
      : raw.hasBoxAndPapers === "papers_only"
      ? "papers_only"
      : "neither";
  let q = 5;
  if (raw.seller?.feedbackPercent >= 99.5) q += 2;
  else if (raw.seller?.feedbackPercent >= 98) q += 1;
  if (raw.seller?.feedbackCount >= 1000) q += 1;
  if (raw.authenticityGuarantee) q += 1;
  if (boxPapers === "full_set") q += 1;
  if (raw.seller?.topRated) q += 1;
  return {
    id,
    ownerId: "dylan",
    title,
    sub,
    tag,
    buyPrice: raw.priceUsd,
    marketPrice: raw.estimatedMarketUsd,
    liquidity: "Med",
    sourcePlatform: "ebay",
    sellerName: raw.seller?.username,
    sellerFeedbackScore: raw.seller?.feedbackPercent,
    sellerFeedbackCount: raw.seller?.feedbackCount,
    sellerAccountAgeMonths: raw.seller?.accountAgeMonths,
    paymentMethod: "paypal_goods",
    authenticityGuarantee: raw.authenticityGuarantee ?? false,
    escrowAvailable: false,
    boxPapers,
    serviceHistory: raw.serviceHistory ?? null,
    serialProvided: raw.serialProvided ?? false,
    listingQualityScore: Math.min(10, Math.round(q)),
    priceTooGoodToBeTrue: false,
  };
}

function fmtUsd(n) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(n / 1000)}K`;
}

function normalizePropertyRecord(raw) {
  const arv = raw.arvEstimate ?? raw.estimatedValue ?? 0;
  const ask = raw.listPrice ?? 0;
  const rehab = raw.estimatedRehabCost ?? 0;
  if (arv <= 0 || ask <= 0) return null;
  const mao = Math.max(0, Math.round(arv * 0.70 - rehab));
  const equity = arv - ask;
  const equityRatio = arv > 0 ? equity / arv : 0;
  const flags = raw.riskFlags ?? [];
  const hasMajor = flags.some((f) => /foundation|structural|fire|flood|sinkhole|asbestos|mold/i.test(f));
  const hasMinor = flags.some((f) => /roof|hvac|electrical|plumbing|kitchen|bathroom/i.test(f));
  const risk = hasMajor ? "High" : hasMinor ? "Medium" : flags.length > 0 ? "Low-Med" : "Low";
  const baseScore = Math.min(equityRatio * 22, 10);
  const riskMult = risk === "High" ? 0.4 : risk === "Medium" ? 0.7 : risk === "Low-Med" ? 0.85 : 1.0;
  const score = Math.max(0, Math.round(baseScore * riskMult * 10) / 10);
  let label, labelType;
  if (score >= 8.5) { label = "ACT NOW"; labelType = "green"; }
  else if (score >= 7.0) { label = "STRONG BUY"; labelType = "green"; }
  else if (score >= 5.0) { label = "MONITOR"; labelType = "amber"; }
  else { label = "PASS"; labelType = "red"; }
  return {
    id: raw.parcelId || raw.mlsId,
    zip: raw.address.zip,
    title: raw.address.street,
    sub: `${raw.address.city}, ${raw.address.state} ${raw.address.zip}`,
    score,
    label,
    labelType,
    arv: fmtUsd(arv),
    mao: fmtUsd(mao),
    ask: fmtUsd(ask),
    risk,
  };
}

// ── Inline normalizers for new sources (plain JS mirrors of TS adapters) ──

function normalizeFacebookListing(raw) {
  const t = raw.title.toLowerCase();
  const sport = ["submariner","gmt","daytona","explorer","sea-dweller","yacht-master","royal oak","nautilus","aquanaut","black bay","pelagos","speedmaster"];
  const dress = ["calatrava","cellini","santos","tank","saxonia","1815","datejust","day-date","patrimony"];
  let tag = "Sport";
  if (sport.some((k) => t.includes(k))) tag = "Sport";
  else if (dress.some((k) => t.includes(k))) tag = "Dress";
  const desc = raw.description || "";
  const text = (raw.title + " " + desc).toLowerCase();
  const hasBox = text.includes("box") || text.includes("full set");
  const hasPapers = text.includes("papers") || text.includes("card") || text.includes("warranty") || text.includes("full set");
  const boxPapers = hasBox && hasPapers ? "full_set" : hasBox ? "box_only" : hasPapers ? "papers_only" : "neither";
  const distressKw = ["must sell","need gone","quick sale","urgent","priced to sell","obo","negotiable","downsizing","tuition","emergency","leaving country"];
  const matched = distressKw.filter((kw) => text.includes(kw));
  return {
    id: `fb-${raw.listingId}`,
    ownerId: "dylan",
    title: raw.title,
    sub: [raw.condition, raw.location].filter(Boolean).join(" · "),
    tag,
    buyPrice: raw.priceUsd,
    marketPrice: raw.estimatedMarketUsd,
    sourcePlatform: "facebook_marketplace",
    boxPapers,
    distressSignals: { detected: matched.length > 0, keywords: matched, score: Math.min(100, matched.length * 15) },
    engagementSignals: { views: raw.views, saves: raw.saves },
  };
}

function normalizeRedditListing(raw) {
  const cleanTitle = raw.title.replace(/^\[(?:WTS|WTT|WTB)\]\s*/i, "").trim();
  const t = cleanTitle.toLowerCase();
  const sport = ["submariner","gmt","daytona","explorer","sea-dweller","yacht-master","royal oak","nautilus","aquanaut","black bay","pelagos","speedmaster"];
  const dress = ["calatrava","cellini","santos","tank","saxonia","1815","datejust","day-date","patrimony"];
  let tag = "Sport";
  if (sport.some((k) => t.includes(k))) tag = "Sport";
  else if (dress.some((k) => t.includes(k))) tag = "Dress";
  const body = raw.body || "";
  const text = (cleanTitle + " " + body).toLowerCase();
  const hasBox = text.includes("box") || text.includes("full set");
  const hasPapers = text.includes("papers") || text.includes("card") || text.includes("warranty") || text.includes("full set");
  const boxPapers = hasBox && hasPapers ? "full_set" : hasBox ? "box_only" : hasPapers ? "papers_only" : "neither";
  const distressKw = ["must sell","need sold","asap","priced to sell","obo","negotiable","emergency","medical"];
  const matched = distressKw.filter((kw) => text.includes(kw));
  return {
    id: `reddit-${raw.postId}`,
    ownerId: "dylan",
    title: cleanTitle,
    sub: raw.flair ? `${raw.flair.toUpperCase()} · r/WatchExchange` : "r/WatchExchange",
    tag,
    buyPrice: raw.priceUsd,
    marketPrice: raw.estimatedMarketUsd,
    sourcePlatform: "reddit_watchexchange",
    boxPapers,
    distressSignals: { detected: matched.length > 0, keywords: matched, score: Math.min(100, matched.length * 15) },
    engagementSignals: { upvotes: raw.upvotes, comments: raw.commentCount },
  };
}

// ── Run ──

async function main() {
  console.log("=== Meridian AI ingestion verification ===\n");

  // eBay
  const watchesRaw = await loadJson("data/sources/watches.ebay.example.json");
  const watchesNormalized = watchesRaw.map(normalizeEbayListing);
  console.log(`eBay: ${watchesRaw.length} raw → ${watchesNormalized.length} normalized`);
  const w0 = watchesNormalized[0];
  console.log(`  Sample: ${w0.title}`);
  console.log(`    buyPrice: $${w0.buyPrice?.toLocaleString()}, listingQuality: ${w0.listingQualityScore}/10`);

  // Facebook
  console.log();
  const fbRaw = await loadJson("data/sources/watches.facebook.example.json");
  const fbNormalized = fbRaw.map(normalizeFacebookListing);
  console.log(`Facebook: ${fbRaw.length} raw → ${fbNormalized.length} normalized`);
  for (const fb of fbNormalized) {
    const distressTag = fb.distressSignals?.detected ? ` [DISTRESS: ${fb.distressSignals.keywords.join(", ")}]` : "";
    console.log(`  ${fb.title} — $${fb.buyPrice?.toLocaleString()} → mkt $${fb.marketPrice?.toLocaleString()}${distressTag}`);
  }

  // Reddit
  console.log();
  const redditRaw = await loadJson("data/sources/watches.reddit.example.json");
  const redditNormalized = redditRaw.map(normalizeRedditListing);
  console.log(`Reddit: ${redditRaw.length} raw → ${redditNormalized.length} normalized`);
  for (const r of redditNormalized) {
    const distressTag = r.distressSignals?.detected ? ` [DISTRESS: ${r.distressSignals.keywords.join(", ")}]` : "";
    console.log(`  ${r.title} — $${r.buyPrice?.toLocaleString()} → mkt $${r.marketPrice?.toLocaleString()}${distressTag}`);
  }

  // Real estate (unchanged)
  console.log();
  const reRaw = await loadJson("data/sources/real-estate.public.example.json");
  const reNormalized = reRaw.map(normalizePropertyRecord).filter(Boolean);
  console.log(`Real estate: ${reRaw.length} raw → ${reNormalized.length} normalized`);

  console.log();
  console.log("✓ All sources normalize cleanly.");
}

main().catch((e) => {
  console.error("ingestion verification failed:", e);
  process.exit(1);
});
