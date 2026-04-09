// Meridian AI — stress test data generator.
// Deterministic (seeded RNG) so the same seed always produces the same dataset.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── Seedable LCG RNG ─────────────────────────────────────────────────────
function createRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const rng = createRng(20260408);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const intRange = (min, max) => Math.floor(min + rng() * (max - min + 1));
const fmtUsd = (n) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1000)}K`);

// ── WATCH REFERENCES ─────────────────────────────────────────────────────
const WATCH_REFS = [
  { brand: "Rolex", model: "Submariner Date 126610LN", base: 13500, liquidity: "High", cat: "Sport" },
  { brand: "Rolex", model: "Submariner No-Date 124060", base: 11500, liquidity: "High", cat: "Sport" },
  { brand: "Rolex", model: "GMT-Master II 126710BLNR Batman", base: 19500, liquidity: "High", cat: "Sport" },
  { brand: "Rolex", model: "GMT-Master II 126710BLRO Pepsi", base: 22000, liquidity: "High", cat: "Sport" },
  { brand: "Rolex", model: "Daytona 116500LN White", base: 32000, liquidity: "High", cat: "Sport" },
  { brand: "Rolex", model: "Daytona 116500LN Black", base: 31500, liquidity: "High", cat: "Sport" },
  { brand: "Rolex", model: "Explorer 124270 36mm", base: 8200, liquidity: "High", cat: "Sport" },
  { brand: "Rolex", model: "Explorer II 226570 White", base: 10800, liquidity: "Med", cat: "Sport" },
  { brand: "Rolex", model: "Datejust 41 126334 Blue", base: 11500, liquidity: "High", cat: "Dress" },
  { brand: "Rolex", model: "Datejust 36 126200", base: 8800, liquidity: "Med", cat: "Dress" },
  { brand: "Rolex", model: "Day-Date 40 228238 Yellow Gold", base: 38000, liquidity: "Med", cat: "Dress" },
  { brand: "Rolex", model: "Sea-Dweller 126600", base: 12500, liquidity: "Med", cat: "Sport" },
  { brand: "Rolex", model: "Yacht-Master 40 126622", base: 13800, liquidity: "Med", cat: "Sport" },
  { brand: "Audemars Piguet", model: "Royal Oak 15500ST Blue", base: 51000, liquidity: "Med", cat: "Sport" },
  { brand: "Audemars Piguet", model: "Royal Oak 15400ST Black", base: 44000, liquidity: "Med", cat: "Sport" },
  { brand: "Audemars Piguet", model: "Royal Oak Offshore 26470ST", base: 32000, liquidity: "Low", cat: "Sport" },
  { brand: "Patek Philippe", model: "Aquanaut 5167A Black", base: 58000, liquidity: "Med", cat: "Sport" },
  { brand: "Patek Philippe", model: "Nautilus 5711/1A Blue", base: 130000, liquidity: "Med", cat: "Sport" },
  { brand: "Patek Philippe", model: "Calatrava 5196G", base: 22000, liquidity: "Low", cat: "Dress" },
  { brand: "Omega", model: "Speedmaster Professional 310.30", base: 6200, liquidity: "Med", cat: "Tool" },
  { brand: "Omega", model: "Speedmaster Moonshine 310.60", base: 14000, liquidity: "Med", cat: "Tool" },
  { brand: "Omega", model: "Seamaster 300M 210.30", base: 4400, liquidity: "Med", cat: "Sport" },
  { brand: "Omega", model: "Seamaster Aqua Terra 220.10", base: 4900, liquidity: "Med", cat: "Dress" },
  { brand: "Omega", model: "Constellation Globemaster", base: 5800, liquidity: "Low", cat: "Dress" },
  { brand: "Cartier", model: "Santos Large WSSA0009", base: 7500, liquidity: "Med", cat: "Dress" },
  { brand: "Cartier", model: "Tank Must Large WSTA0041", base: 3200, liquidity: "Low", cat: "Dress" },
  { brand: "Cartier", model: "Santos Chrono WSSA0017", base: 9800, liquidity: "Low", cat: "Dress" },
  { brand: "Tudor", model: "Black Bay 58 79030N Blue", base: 4100, liquidity: "Med", cat: "Sport" },
  { brand: "Tudor", model: "Black Bay 41 79680", base: 4200, liquidity: "Med", cat: "Sport" },
  { brand: "Tudor", model: "Pelagos FXD 25707B", base: 4700, liquidity: "Med", cat: "Sport" },
  { brand: "Tudor", model: "Pelagos 39 25407N", base: 4500, liquidity: "Low", cat: "Sport" },
  { brand: "Grand Seiko", model: "SBGA413 Shunbun", base: 8200, liquidity: "Low", cat: "Dress" },
  { brand: "Grand Seiko", model: "SBGA211 Snowflake", base: 6400, liquidity: "Low", cat: "Dress" },
  { brand: "JLC", model: "Reverso Classic Medium", base: 9200, liquidity: "Low", cat: "Dress" },
  { brand: "JLC", model: "Master Control Date", base: 6800, liquidity: "Low", cat: "Dress" },
  { brand: "Vacheron Constantin", model: "Overseas 4500V", base: 24500, liquidity: "Low", cat: "Sport" },
  { brand: "IWC", model: "Pilot Mark XX IW328201", base: 5400, liquidity: "Med", cat: "Tool" },
  { brand: "IWC", model: "Portugieser Chrono 3716", base: 8200, liquidity: "Low", cat: "Dress" },
  { brand: "Breitling", model: "Navitimer B01 Chrono 43", base: 7900, liquidity: "Med", cat: "Tool" },
  { brand: "Breitling", model: "Superocean Heritage 57", base: 4800, liquidity: "Med", cat: "Sport" },
];

const VINTAGE_REFS = [
  { brand: "Rolex", model: "Submariner 1680 Vintage", base: 18500, year: 1976, liquidity: "Low", cat: "Vintage" },
  { brand: "Rolex", model: "GMT-Master 1675 Vintage", base: 22000, year: 1972, liquidity: "Low", cat: "Vintage" },
  { brand: "Rolex", model: "Datejust 1601 Pie Pan", base: 6800, year: 1968, liquidity: "Low", cat: "Vintage" },
  { brand: "Omega", model: "Speedmaster 145.022 Vintage", base: 11500, year: 1971, liquidity: "Low", cat: "Vintage" },
  { brand: "Cartier", model: "Tank Vermeil Vintage", base: 3400, year: 1985, liquidity: "Low", cat: "Vintage" },
];

const SELLER_PROFILES = {
  premium: { fbLow: 99.5, fbHigh: 99.9, countLow: 1500, countHigh: 8000, ageLow: 60, ageHigh: 120, authProb: 0.95,
    namePrefix: ["luxury", "premier", "swiss", "global", "collector", "master", "heritage", "haute"],
    nameSuffix: ["WatchCo", "_Geneva", "_Authenticated", "Horology", "Time", "_NY"] },
  good: { fbLow: 98.5, fbHigh: 99.4, countLow: 200, countHigh: 1499, ageLow: 24, ageHigh: 60, authProb: 0.7,
    namePrefix: ["modern", "watch", "elite", "private", "boutique", "fine"],
    nameSuffix: ["_dealer", "_co", "_pre_owned", "watches", "_ny", "_la"] },
  ok: { fbLow: 97.0, fbHigh: 98.4, countLow: 50, countHigh: 199, ageLow: 12, ageHigh: 24, authProb: 0.3,
    namePrefix: ["estate", "private", "watch", "time", "vintage"],
    nameSuffix: ["_seller", "_owned", "deals", "shop", "_used"] },
  sketchy: { fbLow: 94.0, fbHigh: 96.9, countLow: 10, countHigh: 49, ageLow: 3, ageHigh: 12, authProb: 0.05,
    namePrefix: ["watch", "luxury", "deals", "trader", "vip"],
    nameSuffix: ["_77", "_88", "_global", "_intl", "_deals"] },
  scam: { fbLow: 80.0, fbHigh: 93.9, countLow: 0, countHigh: 20, ageLow: 0, ageHigh: 3, authProb: 0,
    namePrefix: ["rolex", "watch", "luxury", "swiss", "vip", "ap"],
    nameSuffix: ["_88", "_99", "_intl", "_dealer", "_official"] },
};

const SCAM_TITLE_MARKERS = [" 1:1 Quality", " AAA Mirror", " Brand New Sealed", " Super Clone Quality", " Best Price", " VIP Quality"];

function makeSellerName(profile) {
  return `${pick(profile.namePrefix)}${pick(profile.nameSuffix)}`;
}

function generateWatch(index) {
  const q = rng();
  let bucket;
  if (q < 0.05) bucket = "scam";
  else if (q < 0.27) bucket = "strong";
  else if (q < 0.62) bucket = "average";
  else if (q < 0.87) bucket = "marginal";
  else bucket = "overpriced";

  const useVintage = rng() < 0.08;
  const ref = useVintage ? pick(VINTAGE_REFS) : pick(WATCH_REFS);
  const year = useVintage ? ref.year : intRange(2017, 2024);
  const marketPrice = Math.round(ref.base * (0.95 + rng() * 0.10));

  let buyPrice;
  if (bucket === "scam") buyPrice = Math.round(marketPrice * (0.10 + rng() * 0.20));
  else if (bucket === "strong") buyPrice = Math.round(marketPrice * (0.78 + rng() * 0.10));
  else if (bucket === "average") buyPrice = Math.round(marketPrice * (0.88 + rng() * 0.08));
  else if (bucket === "marginal") buyPrice = Math.round(marketPrice * (0.96 + rng() * 0.06));
  else buyPrice = Math.round(marketPrice * (1.02 + rng() * 0.15));
  buyPrice = Math.round(buyPrice / 50) * 50;

  let profileKey;
  if (bucket === "scam") profileKey = "scam";
  else if (bucket === "strong") profileKey = pick(["premium", "good"]);
  else if (bucket === "average") profileKey = pick(["good", "ok"]);
  else if (bucket === "marginal") profileKey = pick(["ok", "sketchy"]);
  else profileKey = pick(["good", "ok"]);

  const profile = SELLER_PROFILES[profileKey];
  const sellerName = makeSellerName(profile);
  const sellerFeedbackScore = parseFloat((profile.fbLow + rng() * (profile.fbHigh - profile.fbLow)).toFixed(1));
  const sellerFeedbackCount = intRange(profile.countLow, profile.countHigh);
  const sellerAccountAgeMonths = intRange(profile.ageLow, profile.ageHigh);
  const authenticityGuarantee = bucket !== "scam" && rng() < profile.authProb;
  const escrowAvailable = profileKey === "premium" && rng() < 0.6;

  let boxPapers;
  if (bucket === "scam") boxPapers = "neither";
  else {
    const r = rng();
    if (r < 0.55) boxPapers = "full_set";
    else if (r < 0.75) boxPapers = "papers_only";
    else if (r < 0.90) boxPapers = "box_only";
    else boxPapers = "neither";
  }

  const serviceOptions = ["documented dealer service 2023", "factory service 2024", "Rolex Service Center 2022"];
  const serviceHistory = bucket === "scam" ? null : (rng() < 0.35 ? pick(serviceOptions) : null);

  const conditionOptions = ["Mint", "Excellent", "Very Good", "Good"];
  const condition = bucket === "scam" ? "Brand New (claimed)" : pick(conditionOptions);

  let title = `${ref.brand} ${ref.model} ${year}`;
  if (bucket === "scam" && rng() < 0.6) title += pick(SCAM_TITLE_MARKERS);

  const fullSetSuffix = boxPapers === "full_set" ? " · Full Set" : boxPapers === "papers_only" ? " · Papers Only" : "";
  const sub = `${year} · ${condition}${fullSetSuffix}`;

  const tag = useVintage ? "Vintage" : ref.cat;
  const liquidity = ref.liquidity;

  const sourcePlatform = profileKey === "premium" ? pick(["chrono24", "watchbox", "ebay"])
    : profileKey === "scam" ? pick(["instagram_dm", "telegram", "facebook_marketplace"])
    : "ebay";

  const paymentMethod = bucket === "scam" ? "wire" : "paypal_goods";
  const priceTooGoodToBeTrue = bucket === "scam";

  let listingQ = 5;
  if (sellerFeedbackScore >= 99.5) listingQ += 2;
  else if (sellerFeedbackScore >= 98) listingQ += 1;
  if (sellerFeedbackCount >= 1000) listingQ += 1;
  if (authenticityGuarantee) listingQ += 1;
  if (boxPapers === "full_set") listingQ += 1;
  if (bucket === "scam") listingQ = intRange(2, 4);
  const listingQualityScore = Math.min(10, listingQ);

  let notes;
  if (bucket === "scam") {
    notes = pick([
      "Seller messages mention factory and ships from overseas. No returns.",
      "Description says 'mirror quality' and 'best replica seller'.",
      "Asks for wire transfer, refuses escrow. Stock photos only.",
      "Claims authentic but no auth guarantee, no serial provided.",
    ]);
  } else if (bucket === "strong") {
    notes = pick([
      "Clean piece, well documented, motivated seller.",
      "Recent listing with full transparency on condition.",
      "Established seller with consistent feedback and clean photos.",
    ]);
  } else if (bucket === "average") {
    notes = "Standard listing with reasonable details and verifiable seller.";
  } else if (bucket === "marginal") {
    notes = "Asking is at or near market — limited room to negotiate.";
  } else {
    notes = "Listed above market — seller is anchoring high.";
  }

  const margin = Math.round(((marketPrice - buyPrice) / buyPrice) * 100);
  let thesis;
  if (bucket === "scam") thesis = "Multiple fraud indicators: below-market pricing, sketchy seller, unsafe payment. Walk away.";
  else if (bucket === "strong") thesis = `${margin}% gross margin on a ${liquidity}-liquidity ${tag} reference — clean economics, verified seller.`;
  else if (bucket === "average") thesis = `${margin}% margin — workable but not exceptional. Worth negotiating to a stronger entry.`;
  else if (bucket === "marginal") thesis = `Margin is thin at ${margin}% — only worth pursuing if you can negotiate down significantly.`;
  else thesis = `Asking is ${Math.abs(margin)}% above market — no path to a profitable trade at current price.`;

  let nextAction;
  if (bucket === "scam") nextAction = "DO NOT BUY — multiple fraud indicators flagged.";
  else if (bucket === "strong") nextAction = `Submit offer at $${Math.round(buyPrice * 0.93).toLocaleString("en-US")}. Move within 24-48 hours.`;
  else if (bucket === "average") nextAction = "Counter at 7-10% below ask. Negotiate hard.";
  else if (bucket === "marginal") nextAction = "Only at significantly below ask. Otherwise pass.";
  else nextAction = "Pass. Re-engage if seller drops price 15%+.";

  const riskFactors = [];
  if (bucket === "scam") {
    riskFactors.push(`Listed at ${Math.round((buyPrice / marketPrice) * 100)}% of market value`);
    riskFactors.push("Wire payment with no buyer protection");
    if (rng() < 0.5) riskFactors.push("Counterfeit wording detected in title or description");
  } else {
    if (boxPapers === "neither") riskFactors.push("No box, no papers — 12-15% market discount");
    if (boxPapers === "box_only") riskFactors.push("Papers missing — verify serial against registry");
    if (sellerFeedbackCount < 100) riskFactors.push(`Seller has only ${sellerFeedbackCount} feedback ratings`);
    if (sellerAccountAgeMonths < 12) riskFactors.push(`Seller account age only ${sellerAccountAgeMonths} months`);
    if (!authenticityGuarantee) riskFactors.push("No authenticity guarantee — verify in-hand");
    if (riskFactors.length === 0) riskFactors.push("Standard market risk for this reference");
  }

  return {
    id: `stress-w-${String(index + 1).padStart(3, "0")}`,
    ownerId: "dylan",
    title,
    sub,
    tag,
    buyPrice,
    marketPrice,
    liquidity,
    sourcePlatform,
    sellerName,
    sellerFeedbackScore,
    sellerFeedbackCount,
    sellerAccountAgeMonths,
    paymentMethod,
    authenticityGuarantee,
    escrowAvailable,
    boxPapers,
    serviceHistory,
    serialProvided: bucket !== "scam",
    listingQualityScore,
    priceTooGoodToBeTrue,
    notes,
    thesis,
    nextAction,
    riskFactors: riskFactors.slice(0, 4),
  };
}

// ── REAL ESTATE ──────────────────────────────────────────────────────────
const ZIP_PROFILES = {
  "64113": { city: "Kansas City", state: "MO", arvLow: 380000, arvHigh: 680000 },
  "64114": { city: "Kansas City", state: "MO", arvLow: 320000, arvHigh: 540000 },
  "64111": { city: "Kansas City", state: "MO", arvLow: 280000, arvHigh: 460000 },
  "64108": { city: "Kansas City", state: "MO", arvLow: 240000, arvHigh: 420000 },
  "64109": { city: "Kansas City", state: "MO", arvLow: 90000, arvHigh: 180000 },
  "64127": { city: "Kansas City", state: "MO", arvLow: 80000, arvHigh: 160000 },
  "64129": { city: "Kansas City", state: "MO", arvLow: 95000, arvHigh: 175000 },
  "64130": { city: "Kansas City", state: "MO", arvLow: 110000, arvHigh: 200000 },
  "64131": { city: "Kansas City", state: "MO", arvLow: 220000, arvHigh: 380000 },
  "64132": { city: "Kansas City", state: "MO", arvLow: 130000, arvHigh: 240000 },
  "66206": { city: "Leawood", state: "KS", arvLow: 480000, arvHigh: 850000 },
  "66207": { city: "Leawood", state: "KS", arvLow: 420000, arvHigh: 720000 },
  "66209": { city: "Leawood", state: "KS", arvLow: 550000, arvHigh: 950000 },
  "66211": { city: "Overland Park", state: "KS", arvLow: 380000, arvHigh: 640000 },
};

const STREET_NAMES = [
  "Brookside", "Oak", "Maple", "Cedar", "Pine", "Elm", "Walnut", "Mission", "Lee",
  "Holmes", "Wornall", "Main", "Broadway", "Roe", "Nall", "Metcalf", "Antioch",
  "Ward Parkway", "Belleview", "Jefferson", "Madison", "Washington", "Lincoln",
  "Charlotte", "Wabash", "Olive", "Prospect", "Bellefontaine", "Mersington",
  "Chestnut", "Quivira", "Switzer", "Pflumm", "Cherry", "Forest", "Locust",
];
const STREET_TYPES = ["St", "Ave", "Blvd", "Rd", "Ln", "Pl", "Ter"];

const RISK_POOL = {
  Low: ["Roof age 10-15 years", "HVAC near end of life", "Minor cosmetic updates needed", "Driveway resurface needed"],
  "Low-Med": ["Older HVAC system", "Kitchen needs minor refresh", "Driveway resurface needed", "Single-pane windows"],
  Medium: ["Roof age 18+ years", "Kitchen original — full update needed", "Bathroom modernization required", "HVAC at end of life", "Electrical panel update needed"],
  High: ["Foundation crack noted", "Structural concerns flagged", "Significant rehab budget required", "Major systems failing", "Basement water intrusion"],
};

function generateProperty(index, usedAddresses) {
  const zipKeys = Object.keys(ZIP_PROFILES);
  const zip = pick(zipKeys);
  const profile = ZIP_PROFILES[zip];

  let address;
  let attempts = 0;
  do {
    const num = intRange(100, 12000);
    const street = pick(STREET_NAMES);
    const type = pick(STREET_TYPES);
    address = `${num} ${street} ${type}`;
    attempts++;
  } while (usedAddresses.has(address) && attempts < 12);
  usedAddresses.add(address);

  const arv = Math.round(intRange(profile.arvLow, profile.arvHigh) / 1000) * 1000;

  const q = rng();
  let bucket, askMult, riskBias;
  if (q < 0.20) { bucket = "strong"; askMult = 0.50 + rng() * 0.15; riskBias = "low"; }
  else if (q < 0.55) { bucket = "average"; askMult = 0.65 + rng() * 0.10; riskBias = "med"; }
  else if (q < 0.85) { bucket = "marginal"; askMult = 0.75 + rng() * 0.15; riskBias = "med"; }
  else { bucket = "overpriced"; askMult = 0.90 + rng() * 0.20; riskBias = "high"; }

  const ask = Math.round((arv * askMult) / 1000) * 1000;
  const rehabCost = intRange(10000, 80000);
  const mao = Math.max(0, Math.round((arv * 0.7 - rehabCost) / 1000) * 1000);

  let risk;
  if (riskBias === "low") risk = pick(["Low", "Low", "Low-Med"]);
  else if (riskBias === "med") risk = pick(["Low-Med", "Medium", "Medium"]);
  else risk = pick(["Medium", "High", "High"]);

  const equityRatio = (arv - ask) / arv;
  const baseScore = Math.min(equityRatio * 22, 10);
  const riskMult = risk === "High" ? 0.4 : risk === "Medium" ? 0.7 : risk === "Low-Med" ? 0.85 : 1.0;
  const score = Math.max(0, Math.round(baseScore * riskMult * 10) / 10);

  let label, labelType;
  if (score >= 8.5) { label = "ACT NOW"; labelType = "green"; }
  else if (score >= 7.0) { label = "STRONG BUY"; labelType = "green"; }
  else if (score >= 5.0) { label = "MONITOR"; labelType = "amber"; }
  else { label = "PASS"; labelType = "red"; }

  let tag;
  if (equityRatio >= 0.40) tag = "Equity Play";
  else if (rehabCost > 50000) tag = "BRRRR";
  else if (equityRatio >= 0.25) tag = "Flip";
  else tag = pick(["Rental", "Flip"]);

  const pool = RISK_POOL[risk] || RISK_POOL.Medium;
  const numFlags = intRange(1, 3);
  const usedFlags = new Set();
  const riskFactors = [];
  for (let i = 0; i < numFlags; i++) {
    let f;
    let safety = 0;
    do { f = pick(pool); safety++; } while (usedFlags.has(f) && safety < 6);
    usedFlags.add(f);
    riskFactors.push(f);
  }

  let thesis;
  const equityPctBelowArv = Math.round((1 - askMult) * 100);
  if (bucket === "strong") thesis = `Asking ${equityPctBelowArv}% below ARV with ${risk.toLowerCase()} execution risk — clean equity play in ${profile.city}.`;
  else if (bucket === "average") thesis = `Workable equity at ${equityPctBelowArv}% below ARV — needs negotiation to close to MAO.`;
  else if (bucket === "marginal") thesis = `Margin is thin — asking is ${equityPctBelowArv}% below ARV but rehab and risk eat into spread.`;
  else thesis = `Asking is at or above ARV — no equity play here. Walk unless price drops 15%+.`;

  let nextAction;
  if (label === "ACT NOW") nextAction = `Submit LOI at $${ask.toLocaleString("en-US")} immediately — well under MAO with low risk.`;
  else if (label === "STRONG BUY") nextAction = "Engage seller. Verify comps and rehab estimate before LOI.";
  else if (label === "MONITOR") nextAction = "Wait — re-engage at 30 days on market or after price drop.";
  else nextAction = "Pass — math doesn't work at current ask.";

  return {
    id: `stress-re-${String(index + 1).padStart(3, "0")}`,
    zip,
    title: address,
    sub: `${profile.city}, ${profile.state} ${zip}`,
    score,
    label,
    labelType,
    tag,
    arv: fmtUsd(arv),
    mao: fmtUsd(mao),
    ask: fmtUsd(ask),
    risk,
    thesis,
    nextAction,
    riskFactors,
  };
}

// ── Generate ──────────────────────────────────────────────────────────────
const WATCH_COUNT = 160;
const REAL_ESTATE_COUNT = 160;

const watches = [];
for (let i = 0; i < WATCH_COUNT; i++) watches.push(generateWatch(i));

const realEstate = [];
const usedAddresses = new Set();
for (let i = 0; i < REAL_ESTATE_COUNT; i++) realEstate.push(generateProperty(i, usedAddresses));

// Verify uniqueness
const watchIds = new Set(watches.map((w) => w.id));
const reIds = new Set(realEstate.map((r) => r.id));
if (watchIds.size !== watches.length) throw new Error("duplicate watch ids");
if (reIds.size !== realEstate.length) throw new Error("duplicate real estate ids");

// Distribution stats
function counts(arr, key) {
  const c = {};
  for (const x of arr) c[x[key]] = (c[x[key]] || 0) + 1;
  return c;
}

// ── Write files ──────────────────────────────────────────────────────────
const sourcesDir = path.join(ROOT, "data", "sources");
await fs.mkdir(sourcesDir, { recursive: true });

await fs.writeFile(
  path.join(sourcesDir, "watches.stress.json"),
  JSON.stringify(watches, null, 2)
);
await fs.writeFile(
  path.join(sourcesDir, "real-estate.stress.json"),
  JSON.stringify(realEstate, null, 2)
);
await fs.writeFile(
  path.join(sourcesDir, "stress-test-dataset.json"),
  JSON.stringify({ watches, realEstate }, null, 2)
);

console.log(JSON.stringify({
  ok: true,
  watches: {
    count: watches.length,
    uniqueIds: watchIds.size,
    byTag: counts(watches, "tag"),
    byLiquidity: counts(watches, "liquidity"),
    scamCount: watches.filter((w) => w.priceTooGoodToBeTrue).length,
  },
  realEstate: {
    count: realEstate.length,
    uniqueIds: reIds.size,
    uniqueAddresses: new Set(realEstate.map((r) => r.title)).size,
    byLabel: counts(realEstate, "label"),
    byRisk: counts(realEstate, "risk"),
    byTag: counts(realEstate, "tag"),
  },
  files: [
    "data/sources/watches.stress.json",
    "data/sources/real-estate.stress.json",
    "data/sources/stress-test-dataset.json",
  ],
}, null, 2));
