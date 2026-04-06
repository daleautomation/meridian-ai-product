const RE_RESPONSES = [
  (input, item) => item
    ? `At ${item.ask}, you're ${item.risk === "Low" ? "inside" : "outside"} your buy box. ARV is ${item.arv}, MAO is ${item.mao}. ${item.risk === "Low" || item.risk === "Low-Med" ? "The spread works — move on it." : "The spread doesn't work at ask. Wait or walk."}`
    : "Run your MAO first. ARV minus rehab minus your minimum margin. If ask is above that number, the deal is dead before you start.",
  (input, item) => item
    ? `Equity spread on this one is the story. ${item.score >= 8 ? "Score is strong — the math is there. Get eyes on it this week." : item.score >= 6.5 ? "Score is mid. Negotiate or wait for a price drop." : "Score is weak. Pass unless seller comes down significantly."}`
    : "In this market, conviction comes from the spread, not the address. If you can't see meaningful equity at close, you're taking on execution risk for thin margin.",
  (input, item) => item
    ? `${item.nextAction} Don't overthink it — that's the move.`
    : "The best deals move fast. If you're still running numbers after 48 hours, someone else already submitted an LOI.",
];

const SAAS_RESPONSES = [
  (input, item) => item
    ? `${item.label === "AT RISK" || item.label === "PROTECT" ? "This account needs a human touch this week, not an email sequence." : "Expansion signal is real — map the champion and build the ROI case."} ARR at risk is the only metric that matters right now.`
    : "Churn is a lagging indicator. By the time it shows up in the numbers, the decision to leave was made 90 days ago. Focus on engagement signals.",
  (input, item) => item
    ? `${item.score >= 8.5 ? "High-value, low-risk expansion. Bring the ROI model and close this quarter." : item.score >= 7 ? "Mid-tier health. Don't let this drift — a missed QBR here becomes a churn event in 60 days." : "Intervention needed. Escalate to AE and loop in Solutions before the renewal window closes."}`
    : "Your expansion pipeline is only as strong as your champion relationships. No champion, no expansion — it's that simple.",
  (input, item) => item
    ? `${item.nextAction} Every day this sits is ARR at risk.`
    : "Revenue retention is the floor, not the ceiling. If you're fighting churn, you've already lost the expansion conversation.",
];

const TRADING_RESPONSES = [
  (input, item) => item
    ? `${item.label === "STRONG BUY" || item.label === "BUY" ? "Momentum is confirmed and risk is defined. Size appropriately — this isn't the time to be a hero." : item.label === "CAUTION" || item.label === "NEUTRAL" ? "Signal is mixed. No new entries until the setup clarifies." : "Risk-off. Protect capital first."}`
    : "Every entry needs a defined exit before you put on the position. If you don't know your stop, you don't have a trade — you have a hope.",
  (input, item) => item
    ? `${item.score >= 8.5 ? "High-conviction setup. The signal cluster is clean — enter on confirmation, not anticipation." : item.score >= 7 ? "Moderate signal. Wait for volume confirmation before sizing up." : "Weak setup. Sitting on hands is a position."}`
    : "Momentum trading is about probability stacks, not predictions. You need volume, price action, and sector confirmation all pointing the same direction.",
  (input, item) => item
    ? `${item.nextAction} Risk first, reward second — always.`
    : "The market will give you another setup. Missing a move is recoverable. Blowing up your account is not. Manage the downside.",
];

function pickResponse(pool, input, item) {
  const idx = (input.length + (item ? item.id : 0)) % pool.length;
  return pool[idx](input, item);
}

export function generateResponse({ module, input, selectedItem }) {
  const id = module.id;
  const lower = input.toLowerCase();

  if (id === "real-estate") {
    if (lower.includes("mao") || lower.includes("offer") || lower.includes("loi") || lower.includes("submit")) {
      return selectedItem
        ? `MAO on this one is ${selectedItem.mao} against an ask of ${selectedItem.ask}. Submit only if you can stay disciplined on price.`
        : "MAO is your ceiling, not your starting point. Work backward from ARV, subtract rehab and your minimum margin. That's your number.";
    }
    if (lower.includes("risk") || lower.includes("factor") || lower.includes("concern")) {
      return selectedItem
        ? `Key risks on ${selectedItem.title}: ${selectedItem.riskFactors.join("; ")}. Price those into your rehab contingency before submitting.`
        : "Risk factors to underwrite first: foundation, roof, HVAC, electrical, and days on market.";
    }
    return pickResponse(RE_RESPONSES, input, selectedItem);
  }

  if (id === "saas") {
    if (lower.includes("churn") || lower.includes("risk") || lower.includes("cancel")) {
      return selectedItem
        ? `Churn signal on ${selectedItem.title} is ${selectedItem.risk}. ${selectedItem.riskFactors[0] || "Engagement is declining"}. Get a call on the calendar this week.`
        : "Churn doesn't happen at renewal — it happens when a user stops getting value.";
    }
    if (lower.includes("expand") || lower.includes("upsell") || lower.includes("grow") || lower.includes("arr")) {
      return selectedItem
        ? `Expansion potential here is ${selectedItem.arv}. ${selectedItem.score >= 8 ? "Champion is engaged — present the ROI model this week." : "Build the champion relationship first, then bring the expansion conversation."}`
        : "Expansion revenue has a 0% CAC. Your highest-value accounts are already in your book.";
    }
    return pickResponse(SAAS_RESPONSES, input, selectedItem);
  }

  if (id === "trading") {
    if (lower.includes("enter") || lower.includes("buy") || lower.includes("long") || lower.includes("position")) {
      return selectedItem
        ? `${selectedItem.label === "STRONG BUY" || selectedItem.label === "BUY" ? `Setup on ${selectedItem.title} is constructive. Enter on confirmation with a defined stop.` : `${selectedItem.title} is not a buy signal right now. Patience.`}`
        : "Entries should be planned, not reactive. Define your trigger, your size, and your stop before the session opens.";
    }
    if (lower.includes("stop") || lower.includes("risk") || lower.includes("loss") || lower.includes("protect")) {
      return selectedItem
        ? `Risk on ${selectedItem.title} is rated ${selectedItem.risk}. Size accordingly — higher risk means smaller position, tighter stop.`
        : "Your stop is your maximum acceptable loss per trade, set before entry.";
    }
    return pickResponse(TRADING_RESPONSES, input, selectedItem);
  }

  return "Ask me something specific about the current module and I'll give you a direct answer.";
}
