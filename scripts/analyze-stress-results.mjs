// Meridian AI — stress-test results analyzer.
//
// Loads data/sources/watches.stress.json, runs an inline mirror of the
// scoring + trust + acquisition engines against each record, and produces:
//   - confusion matrix (generator bucket vs final engine label)
//   - false-negative list (strong-bucket records labeled PASS/AVOID)
//   - false-positive list (bad-bucket records labeled BUY+)
//   - trust filtering accuracy
//   - sensitivity analysis under alternate thresholds
//
// The bucket is INFERRED from buyPrice/marketPrice ratio (no metadata
// dependency on the generator). priceTooGoodToBeTrue → "scam".

import { promises as fs } from "node:fs";

const watches = JSON.parse(
  await fs.readFile("data/sources/watches.stress.json", "utf8")
);

// ── Engine constants (mirror of lib/scoring/watches.ts) ─────────────────
const DEFAULT_FRICTION = 0.08;
const HOLD_DAYS = { High: 14, Med: 45, Low: 120 };
const CAPITAL_MULT = { Micro: 1.0, Small: 1.0, Mid: 1.15, Large: 1.4 };
const MIN_NET_SPREAD = 200;

const SAFE_PLATFORMS = new Set([
  "chrono24","watchbox","crown_and_caliber","hodinkee_shop","bobs_watches","watchfinder",
]);
const MEDIUM_PLATFORMS = new Set(["ebay","watchuseek","watchcharts"]);
const RISKY_PLATFORMS = new Set([
  "facebook_marketplace","craigslist","instagram_dm","telegram","unknown",
]);
const SAFE_PAYMENTS = new Set(["credit_card","paypal_goods","escrow"]);
const DANGEROUS_PAYMENTS = new Set(["wire","crypto","western_union","cash_only","cashapp"]);
const COUNTERFEIT_PHRASES = ["1:1","super clone","replica","aaa quality","mirror quality","vsf","clean factory"];

// ── Engine functions ───────────────────────────────────────────────────
function capitalTier(buy) {
  if (buy < 5000) return "Micro";
  if (buy < 15000) return "Small";
  if (buy < 30000) return "Mid";
  return "Large";
}
function netSpread(buy, market, friction = DEFAULT_FRICTION) {
  return market * (1 - friction) - buy;
}
function netMarginPct(buy, market, friction = DEFAULT_FRICTION) {
  if (buy <= 0) return 0;
  return (netSpread(buy, market, friction) / buy) * 100;
}
function annualized(netPct, holdDays) {
  if (holdDays <= 0) return 0;
  return netPct * (365 / holdDays);
}
function score(ann) {
  if (ann <= 0) return 0;
  return Math.round(Math.min(Math.sqrt(ann) / 1.7, 10) * 10) / 10;
}

const MONITOR_BY_LIQ = { High: 35, Med: 25, Low: 18 };
function buySignal(netPct, dollarSpread, ann, cap, liquidity = "Med", thresholds = { strong: 200, buy: 100 }) {
  if (netPct < 0) return "AVOID";
  if (dollarSpread < MIN_NET_SPREAD) return "PASS";
  const adjusted = ann / CAPITAL_MULT[cap];
  if (adjusted >= thresholds.strong) return "STRONG BUY";
  if (adjusted >= thresholds.buy) return "BUY";
  if (adjusted >= MONITOR_BY_LIQ[liquidity]) return "MONITOR";
  return "PASS";
}

const PLATFORM_FRICTION = {
  chrono24: 0.075, watchbox: 0.06, crown_and_caliber: 0.07, hodinkee_shop: 0.08,
  bobs_watches: 0.07, watchfinder: 0.075, ebay: 0.13, watchuseek: 0.05, watchcharts: 0.06,
  facebook_marketplace: 0.04, craigslist: 0.04, instagram_dm: 0.04, telegram: 0.04,
};
function inferFriction(platform, liquidity) {
  const base = PLATFORM_FRICTION[platform] !== undefined ? PLATFORM_FRICTION[platform] : DEFAULT_FRICTION;
  const adj = liquidity === "Low" ? 0.015 : liquidity === "High" ? -0.005 : 0;
  return Math.max(0, Math.min(0.2, base + adj));
}

function computeTrust(rec) {
  const reasons = [];
  let s = 50;
  let hardReject = false;

  if (rec.priceTooGoodToBeTrue === true) { hardReject = true; reasons.push("flagged"); }
  const hay = `${rec.title ?? ""} ${rec.notes ?? ""}`.toLowerCase();
  for (const p of COUNTERFEIT_PHRASES) {
    if (hay.includes(p)) { hardReject = true; reasons.push(`counterfeit:${p}`); break; }
  }
  if (typeof rec.buyPrice === "number" && typeof rec.marketPrice === "number" && rec.marketPrice > 0
      && rec.buyPrice / rec.marketPrice < 0.60) {
    hardReject = true; reasons.push("price anomaly");
  }
  if (rec.paymentMethod && DANGEROUS_PAYMENTS.has(rec.paymentMethod)
      && !rec.escrowAvailable && !rec.authenticityGuarantee) {
    hardReject = true; reasons.push("unsafe payment");
  }

  if (rec.sourcePlatform) {
    if (SAFE_PLATFORMS.has(rec.sourcePlatform)) s += 20;
    else if (MEDIUM_PLATFORMS.has(rec.sourcePlatform)) s += 8;
    else if (RISKY_PLATFORMS.has(rec.sourcePlatform)) { s -= 15; reasons.push("risky platform"); }
  }
  if (typeof rec.sellerFeedbackScore === "number") {
    if (rec.sellerFeedbackScore >= 99.5) s += 12;
    else if (rec.sellerFeedbackScore >= 98) s += 6;
    else if (rec.sellerFeedbackScore < 95) { s -= 10; reasons.push("low feedback"); }
  }
  if (typeof rec.sellerFeedbackCount === "number") {
    if (rec.sellerFeedbackCount >= 1000) s += 8;
    else if (rec.sellerFeedbackCount >= 100) s += 4;
    else if (rec.sellerFeedbackCount < 25) { s -= 8; reasons.push("low count"); }
  }
  if (typeof rec.sellerAccountAgeMonths === "number") {
    if (rec.sellerAccountAgeMonths >= 24) s += 8;
    else if (rec.sellerAccountAgeMonths >= 12) s += 4;
    else if (rec.sellerAccountAgeMonths < 3) { s -= 15; reasons.push("new account"); }
  }
  if (rec.paymentMethod && SAFE_PAYMENTS.has(rec.paymentMethod)) s += 8;
  if (rec.authenticityGuarantee === true) s += 12;
  else if (rec.authenticityGuarantee === false) s -= 5;
  if (rec.escrowAvailable === true) s += 8;
  if (rec.boxPapers === "full_set") s += 6;
  else if (rec.boxPapers === "papers_only" || rec.boxPapers === "box_only") s += 2;
  else if (rec.boxPapers === "neither") { s -= 6; reasons.push("no box/papers"); }
  if (rec.serviceHistory) s += 4;
  if (rec.serialProvided === true) s += 6;
  else if (rec.serialProvided === false) { s -= 8; reasons.push("no serial"); }
  if (typeof rec.listingQualityScore === "number") {
    s += Math.round((rec.listingQualityScore - 5) * 1.5);
  }
  s = Math.max(0, Math.min(100, Math.round(s)));

  let tier;
  if (hardReject) tier = "REJECTED";
  else if (s < 50) tier = "SOFT_REJECT";
  else if (s < 70) tier = "CAUTION";
  else tier = "TRUSTED";

  return { score: s, tier, hardReject, reasons };
}

function applyTrustDowngrade(label, trust) {
  const sev = { "STRONG BUY": 0, BUY: 1, MONITOR: 2, PASS: 3, AVOID: 4 };
  if (trust.tier === "REJECTED") return "AVOID";
  if (trust.tier === "SOFT_REJECT") return sev[label] >= sev.PASS ? label : "PASS";
  if (trust.tier === "CAUTION") {
    if (label === "STRONG BUY") return "BUY";
    if (label === "BUY") return "MONITOR";
    return label;
  }
  return label;
}

// ── Bucket inference (no generator metadata) ────────────────────────────
function deriveBucket(rec) {
  if (rec.priceTooGoodToBeTrue) return "scam";
  if (!rec.buyPrice || !rec.marketPrice) return "unknown";
  const r = rec.buyPrice / rec.marketPrice;
  if (r < 0.88) return "strong";
  if (r < 0.96) return "average";
  if (r < 1.02) return "marginal";
  return "overpriced";
}

// ── Score one record under given thresholds ────────────────────────────
function analyze(rec, thresholds) {
  const bucket = deriveBucket(rec);
  if (!rec.buyPrice || !rec.marketPrice) {
    return { id: rec.id, bucket, finalLabel: "MONITOR", trustTier: "?", score: 0 };
  }
  const buy = rec.buyPrice, market = rec.marketPrice;
  const liquidity = rec.liquidity || "Med";
  const fr = inferFriction(rec.sourcePlatform, liquidity);
  const spread = netSpread(buy, market, fr);
  const np = netMarginPct(buy, market, fr);
  const ann = annualized(np, HOLD_DAYS[liquidity] || 45);
  const cap = capitalTier(buy);
  const econLabel = buySignal(np, spread, ann, cap, liquidity, thresholds);
  const trust = computeTrust(rec);
  const finalLabel = applyTrustDowngrade(econLabel, trust);
  return {
    id: rec.id,
    title: rec.title,
    bucket,
    buyPrice: buy,
    marketPrice: market,
    grossPct: +(((market - buy) / buy) * 100).toFixed(1),
    netPct: +np.toFixed(1),
    ann: Math.round(ann),
    liquidity,
    cap,
    econLabel,
    finalLabel,
    trustTier: trust.tier,
    trustScore: trust.score,
    score: trust.hardReject ? 0 : score(ann),
  };
}

// ── Run with current thresholds ─────────────────────────────────────────
const CURRENT = { strong: 200, buy: 100, monitor: 40 };
const results = watches.map((w) => analyze(w, CURRENT));

// Confusion matrix
const cm = {};
for (const r of results) {
  if (!cm[r.bucket]) cm[r.bucket] = {};
  cm[r.bucket][r.finalLabel] = (cm[r.bucket][r.finalLabel] || 0) + 1;
}

console.log("=== CONFUSION MATRIX (bucket → engine label) ===");
const buckets = ["scam","strong","average","marginal","overpriced"];
const labels = ["STRONG BUY","BUY","MONITOR","PASS","AVOID"];
console.log(`${"bucket".padEnd(12)} | ${labels.map(l => l.padStart(10)).join(" | ")}`);
console.log("-".repeat(75));
for (const b of buckets) {
  const row = cm[b] || {};
  const cells = labels.map((l) => String(row[l] || 0).padStart(10));
  console.log(`${b.padEnd(12)} | ${cells.join(" | ")}`);
}
const total = Object.values(cm).reduce((s, row) => s + Object.values(row).reduce((a,b) => a+b, 0), 0);
console.log(`(total: ${total})`);

// False negatives: strong bucket → PASS/AVOID
console.log();
console.log("=== FALSE NEGATIVES (strong-bucket records labeled PASS/AVOID) ===");
const fn = results.filter((r) => r.bucket === "strong" && (r.finalLabel === "PASS" || r.finalLabel === "AVOID"));
console.log(`count: ${fn.length}`);
fn.slice(0, 10).forEach((r) =>
  console.log(`  ${r.id}  gross=${r.grossPct}% net=${r.netPct}% ann=${r.ann}% liq=${r.liquidity} → ${r.finalLabel}`)
);

// False positives: bad bucket → BUY+
console.log();
console.log("=== FALSE POSITIVES (marginal/overpriced labeled BUY/STRONG BUY) ===");
const fp = results.filter((r) => (r.bucket === "marginal" || r.bucket === "overpriced") && (r.finalLabel === "BUY" || r.finalLabel === "STRONG BUY"));
console.log(`count: ${fp.length}`);
fp.forEach((r) =>
  console.log(`  ${r.id}  bucket=${r.bucket} gross=${r.grossPct}% net=${r.netPct}% ann=${r.ann}% liq=${r.liquidity} → ${r.finalLabel}`)
);

// Trust filtering
console.log();
console.log("=== TRUST FILTERING ===");
const scams = results.filter((r) => r.bucket === "scam");
const scamCaught = scams.filter((r) => r.trustTier === "REJECTED").length;
console.log(`Scams in dataset: ${scams.length}`);
console.log(`Scams caught (REJECTED): ${scamCaught} (${Math.round((scamCaught/scams.length)*100)}%)`);
const falseRejects = results.filter((r) => r.bucket !== "scam" && r.trustTier === "REJECTED");
console.log(`False trust rejects (non-scam → REJECTED): ${falseRejects.length}`);
falseRejects.forEach((r) =>
  console.log(`  ${r.id} bucket=${r.bucket} gross=${r.grossPct}% (probably price anomaly)`)
);

// Final distribution
console.log();
console.log("=== FINAL LABEL DISTRIBUTION ===");
const dist = {};
for (const r of results) dist[r.finalLabel] = (dist[r.finalLabel] || 0) + 1;
console.log(dist);
const actionable = (dist["STRONG BUY"]||0) + (dist["BUY"]||0) + (dist["MONITOR"]||0);
console.log(`Actionable: ${actionable}/${total} (${Math.round((actionable/total)*100)}%)`);

// ── SENSITIVITY: try alternate thresholds ──────────────────────────────
console.log();
console.log("=== SENSITIVITY: alternate threshold sets ===");
const ALTERNATIVES = [
  { name: "current",       strong: 200, buy: 100, monitor: 40 },
  { name: "relaxed-mon",   strong: 200, buy: 100, monitor: 25 },
  { name: "relaxed-buy",   strong: 180, buy:  80, monitor: 30 },
  { name: "aggressive",    strong: 150, buy:  70, monitor: 25 },
];

console.log(`${"threshold set".padEnd(16)} | ${labels.map(l => l.padStart(10)).join(" | ")} | actionable`);
console.log("-".repeat(95));
for (const t of ALTERNATIVES) {
  const rs = watches.map((w) => analyze(w, t));
  const d = {};
  for (const r of rs) d[r.finalLabel] = (d[r.finalLabel] || 0) + 1;
  const cells = labels.map((l) => String(d[l] || 0).padStart(10));
  const a = (d["STRONG BUY"]||0) + (d["BUY"]||0) + (d["MONITOR"]||0);
  console.log(`${t.name.padEnd(16)} | ${cells.join(" | ")} | ${a}`);
}

// ── Friction sensitivity ────────────────────────────────────────────────
console.log();
console.log("=== FRICTION SENSITIVITY (current thresholds) ===");
console.log(`friction | STRONG BUY |        BUY |    MONITOR |       PASS |      AVOID | actionable`);
console.log("-".repeat(95));
for (const f of [0.04, 0.06, 0.08, 0.10, 0.13]) {
  const dist2 = { "STRONG BUY":0, BUY:0, MONITOR:0, PASS:0, AVOID:0 };
  for (const w of watches) {
    if (!w.buyPrice || !w.marketPrice) continue;
    const np = netMarginPct(w.buyPrice, w.marketPrice, f);
    const sp = netSpread(w.buyPrice, w.marketPrice, f);
    const ann = annualized(np, HOLD_DAYS[w.liquidity || "Med"]);
    const cap = capitalTier(w.buyPrice);
    const econ = buySignal(np, sp, ann, cap, CURRENT);
    const trust = computeTrust(w);
    const fin = applyTrustDowngrade(econ, trust);
    dist2[fin] = (dist2[fin] || 0) + 1;
  }
  const a = dist2["STRONG BUY"] + dist2.BUY + dist2.MONITOR;
  console.log(`  ${(f*100).toFixed(0)}%    | ${String(dist2["STRONG BUY"]).padStart(10)} | ${String(dist2.BUY).padStart(10)} | ${String(dist2.MONITOR).padStart(10)} | ${String(dist2.PASS).padStart(10)} | ${String(dist2.AVOID).padStart(10)} | ${a}`);
}

console.log();
console.log("=== HEALTH METRICS ===");
const trustDist = {};
for (const r of results) trustDist[r.trustTier] = (trustDist[r.trustTier] || 0) + 1;
console.log("Trust tier distribution:", trustDist);
const cautionRate = (trustDist["CAUTION"] || 0) / total;
console.log(`Caution rate: ${(cautionRate*100).toFixed(1)}% (target: 10-20%)`);
