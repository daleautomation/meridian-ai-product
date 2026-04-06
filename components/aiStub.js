function fmt(assessment, why, next, watchout) {
  return `${assessment}\n\nWhy it matters: ${why}\n\nNext step: ${next}\n\nWatch out: ${watchout}`;
}

function detectIntent(s) {
  if (
    /^what (is|are|does|do) /.test(s) ||
    /^(explain|define|describe) /.test(s) ||
    s.includes("what do you mean by") ||
    s.includes("what does that mean") ||
    s.includes("tell me about") ||
    (s.includes("how does") && s.includes("work"))
  ) return "concept";

  if (
    s === "why" || s === "why?" ||
    /^(why|explain that|tell me more|elaborate|say more|go on)/.test(s) ||
    s.includes("what do you mean") ||
    s.includes("how do i do that") ||
    s.includes("can you explain") ||
    s.includes("more detail") ||
    s.includes("break that down")
  ) return "followup";

  if (
    s.includes("what could go wrong") ||
    s.includes("what am i missing") ||
    s.includes("biggest risk") ||
    s.includes("what would make this a pass") ||
    s.includes("what would make this a no") ||
    s.includes("red flag") ||
    s.includes("downside") ||
    s.includes("worst case") ||
    s.includes("what to watch out")
  ) return "risk";

  if (
    s.includes("what should i do") ||
    s.includes("what do i do") ||
    s.includes("what next") ||
    s.includes("where do i start") ||
    s.includes("how should i approach") ||
    s.includes("what would you do") ||
    s.includes("what should i verify") ||
    s.includes("what should i check") ||
    s.includes("how do i prioritize") ||
    s.includes("what's the move") ||
    s.includes("what is the move")
  ) return "action";

  return "specific";
}

function getConceptResponse(lower, moduleId, item) {
  if (moduleId === "real-estate") {
    if (lower.includes("buy box") || lower.includes("buybox")) return fmt(
      "A buy box is your pre-defined criteria a deal must meet before you'll underwrite it — market, price range, property type, and minimum spread.",
      "Without a buy box, you waste time on deals that don't fit. With one, every decision is faster and more consistent.",
      item ? `Check ${item.title} against your criteria. Score ${item.score}/10 suggests it ${item.score >= 7 ? "fits" : "may not fit — examine why you're still looking at it"}.` : "Write your buy box down: target market, min/max price, property types, minimum spread. Everything outside it is a pass.",
      "Buy boxes only work if you enforce them. The temptation to stretch 'just this once' is where discipline breaks down."
    );
    if (lower.includes("spread") && !lower.includes("spreadsheet")) return fmt(
      "The equity spread is ARV minus your total all-in cost (purchase plus rehab). It's your margin and the only number that protects you when something goes wrong.",
      "A $10K rehab surprise on a $12K spread deal wipes profit and time. Spread is the space between a good deal and a bad one.",
      item ? `On ${item.title}: ARV ${item.arv}, ask ${item.ask}. Add your rehab estimate to ask, subtract from ARV — that's your real spread.` : "Calculate spread on your top deal: ARV minus (ask plus rehab). Below $30K on a flip, there's no room for error.",
      "Spread is only as good as your ARV and rehab inputs. Garbage inputs produce fictional margin."
    );
    if (lower.includes("mao") || lower.includes("maximum allowable offer") || lower.includes("max allowable")) return fmt(
      "MAO — Maximum Allowable Offer — is the highest price you can pay and still hit your required return. It's your ceiling, not your target.",
      "Without MAO, you negotiate on emotion. With it, every offer has a mathematical floor that protects your return.",
      item ? `MAO on ${item.title} is ${item.mao}. Ask is ${item.ask}. ${item.ask <= item.mao ? "You're inside MAO — actionable." : "Ask is over MAO — you need a price drop or a pass."}` : "MAO formula: (ARV × target multiplier) minus rehab. Common target is 70% for flips. Run your own number first.",
      "Don't confuse MAO with your opening offer. Start lower and let the seller negotiate up to your ceiling — never past it."
    );
    if (lower.includes("arv") || lower.includes("after repair value") || lower.includes("after-repair")) return fmt(
      "ARV — After Repair Value — is the market value of the property after all renovations are complete. Every other underwriting number flows from this one.",
      "If your ARV is wrong, your MAO is wrong, your spread is wrong, and your deal is wrong.",
      item ? `ARV on ${item.title} is ${item.arv}. Verify with 3 closed comps within 0.5 miles, same bed/bath, sold in last 90 days.` : "Pull your own comps. Never rely on Zestimate, agent CMA, or a wholesaler's number without verifying yourself.",
      "Comps must match condition. Comparing a fully renovated comp to a mid-tier rehab inflates ARV and compresses real spread."
    );
    if (lower.includes("rehab") || lower.includes("renovation") || lower.includes("repair cost") || lower.includes("repair estimate")) return fmt(
      "Rehab is the total cost to bring the property to its ARV condition — materials, labor, carrying costs, permits, and contingency.",
      "Underestimating rehab is the most common way deals fail. A $10K surprise on a tight-margin deal turns profit into loss.",
      item ? `Get a contractor walkthrough on ${item.title} before submitting. Key risks: ${item.riskFactors.join("; ")}.` : "Always get a contractor estimate before submitting. Add 15% contingency — surprises always go up, never down.",
      "Define scope in writing with your contractor before you start. Scope creep is a cost you agreed to without knowing it."
    );
    if (lower.includes("brrrr")) return fmt(
      "BRRRR: Buy, Rehab, Rent, Refinance, Repeat. A capital recycling strategy that lets you pull invested capital back out through a cash-out refinance.",
      "Done right, BRRRR lets you own rental properties with little or no capital remaining in the deal.",
      item ? `${item.title} is tagged BRRRR. Verify post-rehab appraisal supports ${item.arv} and confirm rent covers PITI with 20%+ margin.` : "BRRRR only works if the refi appraises at or above ARV. Run rent numbers too — you need positive cash flow after the refinance payment.",
      "BRRRR breaks if the refinance doesn't appraise, rent doesn't cover debt service, or the market softens between purchase and refi."
    );
    if (lower.includes("loi") || lower.includes("letter of intent")) return fmt(
      "An LOI is a non-binding written offer outlining proposed terms — price, inspection period, closing timeline — before a formal contract.",
      "LOIs move fast and signal seriousness without full legal commitment. They start the negotiation on your terms.",
      item ? `${item.title}: if submitting an LOI, draft at or below MAO (${item.mao}) and submit within 24 hours.` : "Keep your LOI simple: purchase price at or below MAO, inspection period, closing timeline, earnest money. Get it in front of the seller fast.",
      "An LOI is non-binding — but your reputation isn't. Don't submit one you're not prepared to convert to a contract if accepted."
    );
    if (lower.includes("discipline") || lower.includes("stay disciplined") || lower.includes("emotional")) return fmt(
      "Discipline means enforcing your buy box and MAO on every deal — especially when you want to make one work that doesn't.",
      "Most bad deals are made when investors stretch criteria. One bad deal can erase the profit of several good ones.",
      "Write your buy box and MAO formula down. Refer to them before every offer. If a deal doesn't meet criteria, pass without exception.",
      "The most dangerous moment is after you've spent 20 hours on a deal that doesn't pencil. Sunk cost is not a reason to close a bad deal."
    );
  }

  if (moduleId === "saas") {
    if (lower.includes("champion") || lower.includes("internal champion")) return fmt(
      "A champion is the internal stakeholder who actively sponsors your product, advocates for renewal, and has organizational influence — not just enthusiasm.",
      "Without a champion, you have a user, not an ally. When renewal comes or a competitor shows up, a champion fights for you internally.",
      item ? `Map who your champion is at ${item.title}. If you don't have one named, renewal is at risk regardless of product quality.` : "For every account over $50K ARR, name the champion and know what success looks like for them personally.",
      "Champions leave, get reorganized, or lose influence. Always know your champion's current status and have a backup contact mapped."
    );
    if (lower.includes("churn risk") || (lower.includes("churn") && /^what/.test(lower))) return fmt(
      "Churn risk is the probability an account cancels, driven by engagement signals — login frequency, feature adoption, support tickets, and sentiment.",
      "Churn is expensive twice: you lose the ARR and reset the acquisition cost. The fully-loaded cost of losing a customer far exceeds retaining one.",
      item ? `${item.title} shows ${item.risk} churn risk. Primary signal: ${item.riskFactors[0] || "engagement trends"}. Intervene before renewal, not at it.` : "Track three churn signals per account weekly: login frequency, feature adoption, and open support tickets. Decline in any two is an intervention trigger.",
      "Churn decisions are made 60–90 days before renewal. By the time a customer says they're leaving, the decision is already made."
    );
    if (lower.includes("arr") || lower.includes("annual recurring revenue")) return fmt(
      "ARR — Annual Recurring Revenue — is the annualized value of subscription contracts. It's the primary health metric and determines valuation, growth rate, and resource allocation.",
      "Every action you take either grows, protects, or loses ARR. It's the number that matters.",
      item ? `${item.title} represents ${item.tag}. ${item.label === "AT RISK" || item.label === "PROTECT" ? "At-risk ARR costs 5–10x more to replace than to retain." : "Expansion here is zero-CAC growth — prioritize it."}` : "Sort accounts by ARR and prioritize time accordingly. The top 20% typically represent 80% of retention risk and expansion opportunity.",
      "ARR growth can mask churn. Watch Net Revenue Retention — it tells you whether you're growing or just replacing lost revenue with new logos."
    );
    if (lower.includes("expansion") && /^what/.test(lower)) return fmt(
      "Expansion is growing ARR within an existing account — through seat growth, tier upgrades, or additional products. Zero customer acquisition cost.",
      "Expansion revenue is the highest-margin revenue in SaaS. You've already paid to acquire the customer. Every expansion dollar is pure margin.",
      item ? `${item.title} has ${item.arv} expansion potential. ${item.score >= 8 ? "Move on this now." : "Build the champion relationship before pitching."}` : "Identify your top three expansion candidates: name the champion, define the use case, prepare the ROI story.",
      "Don't pitch expansion to an account with unresolved support issues or declining engagement. Fix the foundation first."
    );
    if (lower.includes("health score") || lower.includes("account health")) return fmt(
      "A health score is a composite metric combining login frequency, feature adoption, support activity, and sentiment to quantify account risk and engagement.",
      "Health scores convert qualitative relationship knowledge into a trackable, comparable number across a large portfolio.",
      item ? `${item.title} scores ${item.score}/10. Primary driver: ${item.riskFactors[0] || "engagement trends"}. Address the leading indicator, not just the score.` : "Build your health score around 3–5 metrics that actually predict churn. Login frequency and feature adoption are the most reliable.",
      "Health scores lag reality. A high score can mask a champion who just left or a budget cut that hasn't surfaced yet."
    );
    if (lower.includes("nrr") || lower.includes("net revenue retention") || lower.includes("net retention")) return fmt(
      "NRR — Net Revenue Retention — measures ARR change within your existing customer base including expansions, contractions, and churn. Above 100% means growth without new customers.",
      "NRR above 100% is the most powerful SaaS metric. It means your existing base grows itself.",
      "Calculate monthly: (starting ARR + expansion - contraction - churn) ÷ starting ARR. Target 110–130% for healthy scale.",
      "Don't confuse gross retention with net retention. Know which one your team is optimizing for."
    );
    if (lower.includes("qbr") || lower.includes("quarterly business review") || lower.includes("ebr")) return fmt(
      "A QBR is a structured meeting to review value delivered, align on goals, and surface expansion or renewal discussions — with both CSM and account leadership present.",
      "QBRs are the primary vehicle for demonstrating ROI at scale. A well-run QBR gives champions the ammunition to defend your budget internally.",
      item ? item.nextAction : "Transform your QBR format: lead with their metrics, not yours. Show what changed in their business because of your product.",
      "QBRs fail when they're product demos in disguise. If you're spending more than 20% on your roadmap, you've lost the room."
    );
    if (lower.includes("discipline") || lower.includes("prioritize") || lower.includes("where do i focus")) return fmt(
      "Prioritization discipline means allocating time by ARR risk and expansion opportunity — not by squeaky wheel or relationship comfort.",
      "Without it, low-ARR accounts with loud stakeholders consume time that belongs to high-ARR accounts at genuine risk.",
      "Sort your book by (ARR × churn probability) and work top-down. Every week, top 3 accounts should have a proactive touchpoint.",
      "Relationship comfort is a false prioritization signal. Accounts you enjoy talking to aren't necessarily the ones most worth your time."
    );
  }

  if (moduleId === "trading") {
    if (lower.includes("relative strength") || lower.includes("rs score") || lower.includes("what is rs") || lower.includes("rel str")) return fmt(
      "Relative Strength (RS) measures a stock's price performance against a benchmark. High RS means it's outperforming the market.",
      "In momentum trading, you want the strongest stocks in the strongest sectors. High RS attracts institutional buying and sustains trends longer.",
      item ? `${item.title} RS at ${item.ask}. ${item.score >= 8 ? "RS above 80 is institutional-grade momentum." : "RS is developing — wait for a higher reading."}` : "Focus on stocks with RS above 80. They're outperforming 80% of the market and have the strongest probability of continued trend.",
      "RS is backward-looking. A stock with high RS that just broke its trend line is a warning — don't chase past strength into a failed setup."
    );
    if (lower.includes("momentum") && /^what/.test(lower)) return fmt(
      "Momentum is the tendency of a trend to continue, confirmed by price making higher highs with expanding volume — both conditions must be true.",
      "Stocks that are going up tend to keep going up — until something changes. Volume tells you which scenario you're in.",
      item ? `${item.title} scores ${item.score}/10, volume ${item.mao}. ${item.score >= 8 ? "Momentum is confirmed." : "Wait for volume confirmation before committing."}` : "Check volume relative to the 20-day average on any momentum setup. A breakout on 1x average volume is suspect. On 2x+, it's real.",
      "Momentum reverses fast. Once a trend breaks, the exit is always crowded. Know your stop before you enter."
    );
    if (lower.includes("stop loss") || lower.includes("stop-loss") || lower.includes("what is a stop")) return fmt(
      "A stop loss is a pre-defined price level at which you exit a trade to cap downside. Set before entry, never adjusted wider afterward.",
      "Without a stop, there is no defined risk. Unlimited downside on any position is a path to account destruction.",
      item ? `On ${item.title}, set your stop at the level that invalidates the trade thesis — not at a dollar amount that feels comfortable.` : "Your stop should be at the price where the trade thesis is no longer valid. That's the only logical exit point.",
      "Never move a stop wider to avoid being stopped out. That's managing ego, not risk. A stop only moves one direction: tighter."
    );
    if (lower.includes("position sizing") || lower.includes("position size") || lower.includes("how much to buy") || lower.includes("how many shares")) return fmt(
      "Position sizing determines how many shares to buy based on your account risk tolerance and the distance from entry to stop. It's risk management, not preference.",
      "Most account blow-ups come from oversizing. Sizing discipline is what keeps one bad trade from being catastrophic.",
      item ? `On ${item.title}: (account × max risk %) ÷ (entry - stop) = share count. Risk is ${item.risk} — size accordingly.` : "Standard rule: risk no more than 1–2% of account per trade. Calculate shares from your stop distance, not your conviction level.",
      "High conviction is not a sizing license. The bigger your position, the more emotional your decisions become when it moves against you."
    );
    if (lower.includes("risk/reward") || lower.includes("risk reward") || (lower.includes("r/r") && lower.length < 20)) return fmt(
      "Risk/reward ratio compares potential loss to stop against potential gain to target. A 1:3 ratio means risking $1 to make $3.",
      "You don't need to be right most of the time if your wins are larger than your losses. A 40% win rate with 1:3 R/R beats 60% with 1:1.",
      item ? `Before entering ${item.title}, define your target at the next resistance level. Is R/R at least 2:1? If not, the trade isn't worth taking.` : "Minimum acceptable R/R for momentum trades is 2:1. Below that, the math doesn't support the inevitable frequency of losses.",
      "Don't move your target to achieve a better R/R on paper. Targets should be at real resistance levels — not wherever makes the math look acceptable."
    );
    if (lower.includes("breakout") || lower.includes("break out")) return fmt(
      "A breakout is when price moves above a defined resistance level with volume confirmation, signaling that supply at that level has been absorbed.",
      "Breakouts from consolidation are high-probability entries when confirmed by volume. Former resistance becomes support, giving a defined stop.",
      item ? `If ${item.title} is breaking out, confirm: volume 1.5x+ average? Sector moving? Entry within 3% of the breakout level?` : "The ideal breakout entry is within 2–3% of the breakout point with a stop just below broken resistance.",
      "Most breakouts fail. The ones that work are confirmed by volume, sector momentum, and a cooperative broad market."
    );
    if (lower.includes("discipline") || lower.includes("stay disciplined") || lower.includes("emotional") || lower.includes("impulse")) return fmt(
      "Trading discipline is consistent application of your rules — entry criteria, stop placement, position sizing — regardless of emotional state or recent results.",
      "Most traders lose not because their system is wrong, but because they deviate from it. Overtrading after wins and revenge trading after losses are the two biggest killers.",
      "Write your trading rules down. Before every entry, verify the trade meets all criteria. If it doesn't meet all of them, it's not a trade.",
      "Discipline breaks down most after streaks — both winning and losing. Know which emotional state you're in before touching the order ticket."
    );
  }

  return null;
}

function getFollowupResponse(lower, moduleId, item, recentMessages) {
  const lastAssistant = [...(recentMessages || [])].reverse().find(m => m.role === "assistant");
  const ctx = lastAssistant?.content || "";

  const aboutSpread   = ctx.includes("spread") || ctx.includes("MAO") || ctx.includes("ARV");
  const aboutAction   = ctx.includes("Next step:") && (ctx.includes("submit") || ctx.includes("LOI") || ctx.includes("outreach") || ctx.includes("call"));
  const aboutChurn    = ctx.includes("churn") || ctx.includes("at risk") || ctx.includes("engagement");
  const aboutExpand   = ctx.includes("expansion") || ctx.includes("expand");
  const aboutMomentum = ctx.includes("momentum") || ctx.includes("setup") || ctx.includes("signal");
  const aboutStop     = ctx.includes("stop") || ctx.includes("exit") || ctx.includes("risk");

  const isWhy     = lower === "why" || lower === "why?" || lower.startsWith("why ");
  const isHow     = lower.includes("how do i do that") || lower.includes("how do i") || lower.startsWith("how ");
  const isExplain = lower.includes("explain that") || lower.includes("what do you mean") || lower.includes("tell me more") || lower.includes("elaborate") || lower.includes("more detail");

  if (moduleId === "real-estate") {
    if (isWhy && aboutSpread) return fmt(
      "Because spread is the only buffer between your plan and reality. Rehab always runs over. Markets shift. Carrying costs add up.",
      "Every deal has surprises. Your spread is what determines whether a surprise is a footnote or a deal-killer.",
      item ? `Apply a 15% rehab buffer to ${item.title} and recalculate spread. Does it still work?` : "Apply a 15% contingency to every rehab number and see if the spread holds.",
      "A spread that looks solid on paper can be consumed by delays, cost overruns, and a slower sale. Build margin for all three."
    );
    if (isWhy && aboutAction) return fmt(
      "Because timing matters. Motivated sellers move to the next interested buyer. Hesitation has no upside when the math works.",
      "The best deals are rarely available long. If the numbers work and the inspection holds, delay only creates risk.",
      item ? `Name the one thing stopping you from acting on ${item.title} and solve it today.` : "Identify your actual blocker. If it's not the numbers, it's financing or confidence — both are solvable.",
      "Don't mistake analysis for action. More analysis on a deal that already pencils is procrastination."
    );
    if (isHow && aboutSpread) return fmt(
      "Take ARV, subtract your estimated rehab cost, then subtract the asking price. What's left is your equity spread at closing.",
      "This tells you how much room you have before the deal stops working. Bigger spread means more protected margin.",
      item ? `On ${item.title}: ${item.arv} ARV minus ${item.ask} ask, minus rehab estimate. Run that with a real contractor number.` : "Get ARV from your own comps. Get rehab from a walkthrough. Then do the subtraction.",
      "Spread is only real if your inputs are accurate. A guessed rehab number produces a fictional spread."
    );
    if (isExplain && ctx) return fmt(
      `To expand: ${ctx.split("\n")[0]}`,
      "Every deal decision builds on the same foundation: ARV, MAO, spread, and rehab.",
      item ? `Apply this directly to ${item.title} — score ${item.score}/10, risk ${item.risk}.` : "Apply it to the top-ranked deal and make it concrete.",
      "Don't let conceptual understanding substitute for deal-level action. The goal is always a specific decision."
    );
    return fmt(
      item ? `${item.title}: score ${item.score}/10, risk ${item.risk}, ask ${item.ask} vs MAO ${item.mao}.` : "The core principle: protect your spread, enforce your MAO, don't confuse activity with progress.",
      "Every decision in acquisitions comes back to the numbers. Emotion is expensive. Discipline compounds.",
      item ? `Run your MAO on ${item.title} and confirm whether ask is inside your number.` : "Pick the top-ranked deal and run a full check — MAO, ARV, spread, rehab — before moving to the next one.",
      "Spend time on deals with a realistic path to submission, not deals you're trying to make work."
    );
  }

  if (moduleId === "saas") {
    if (isWhy && aboutChurn) return fmt(
      "Because by the time churn is visible in metrics, the relationship decision was made weeks or months earlier.",
      "Churn is always upstream of the renewal date. A missed QBR, a support failure, a champion who left — these are the actual causes.",
      item ? `Find the root cause at ${item.title}: product gap, relationship gap, or value perception gap?` : "For every churned account, run a post-mortem. The pattern across five churns tells you more than any health score.",
      "Don't treat every at-risk account with the same intervention. Diagnose before prescribing."
    );
    if (isWhy && aboutExpand) return fmt(
      "Because expansion is the most efficient revenue motion in SaaS. You've already paid to acquire the customer. Every expansion dollar is margin.",
      "Net Revenue Retention above 100% means you grow without new logos. That's the compounding mechanic that makes great SaaS businesses.",
      item ? `Map the expansion pathway at ${item.title}: who approves it, what's the use case, what's the ROI story?` : "For each expansion target, answer three questions: who's the buyer, what's the ROI, what's the timeline.",
      "Don't pitch expansion into an unhealthy account. A customer not getting value won't buy more."
    );
    if (isHow) return fmt(
      "The motion depends on the signal. Churn risk needs direct human outreach — not automated sequences. Expansion needs an ROI narrative and a champion.",
      "Matching the right motion to the right signal is the skill. Not every at-risk account needs an executive escalation.",
      item ? `For ${item.title}: ${item.nextAction}` : "Map each signal to a motion: churn risk → direct call, expansion → ROI presentation, disengaged → re-onboarding.",
      "Don't default to email for high-stakes situations. Email is easy for you and easy to ignore."
    );
    if (isExplain && ctx) return fmt(
      `To expand: ${ctx.split("\n")[0]}`,
      "Every CS decision builds on the same question: is this account getting value, and do they know it?",
      item ? `Apply this to ${item.title} — score ${item.score}/10, ${item.tag} ARR.` : "Apply it to your top at-risk account and make it actionable.",
      "Don't let conceptual clarity substitute for direct outreach."
    );
    return fmt(
      item ? `${item.title}: ${item.label} account at ${item.score}/10. Core issue: ${item.riskFactors[0] || "engagement needs attention"}.` : "Core principle: protect ARR first, then grow it. Churn costs more than acquisition.",
      "Every CS decision comes back to two questions: is this account getting value, and do they know it?",
      item ? item.nextAction : "Prioritize your top three at-risk accounts and schedule direct outreach for each.",
      "How an account feels and how it's actually performing are different things. Use data to verify."
    );
  }

  if (moduleId === "trading") {
    if (isWhy && aboutMomentum) return fmt(
      "Because stocks that are moving tend to keep moving — until something changes. Momentum is one of the most documented market phenomena.",
      "Institutional money moves in trends. When large funds are accumulating, price trends up until they stop buying or start selling.",
      item ? `${item.title} at score ${item.score}/10 — trend is ${item.score >= 8 ? "confirmed" : "developing"}. Volume is the evidence.` : "Momentum works because of supply and demand. High RS stocks have more buyers than sellers at every level — until they don't.",
      "Momentum reverses. Know what would make you exit — a breakdown below a key moving average, a volume spike on a down day."
    );
    if (isWhy && aboutStop) return fmt(
      "Because without a defined stop, you have no risk control. One bad trade can erase many good ones.",
      "Stops aren't about being wrong. They're about limiting how wrong you're allowed to be.",
      item ? `Set your stop on ${item.title} at the level that invalidates the setup — not a number that feels comfortable.` : "Your stop should be at the price where your trade thesis is no longer valid.",
      "The biggest stop mistake is setting it too wide to 'give the trade room.' Width should be dictated by the chart, not your loss tolerance."
    );
    if (isHow) return fmt(
      "To execute: define your entry trigger, calculate position size from your stop distance, set your stop before you're in the trade, then set an alert for your target.",
      "Entry → stop → size → target. In that order. Most traders do it backwards, which leads to oversizing.",
      item ? `For ${item.title}: ${item.nextAction}. Size = (account × 1%) ÷ (entry - stop).` : "Practice the pre-trade checklist: setup valid? Entry defined? Stop defined? Size calculated? Target set?",
      "Don't enter until all four elements are defined. Entering without a stop is gambling, not trading."
    );
    if (isExplain && ctx) return fmt(
      `To expand: ${ctx.split("\n")[0]}`,
      "Every trading decision comes back to one question: is my downside defined?",
      item ? `Apply this to ${item.title} — score ${item.score}/10, ${item.label}.` : "Apply it to your next intended trade and define entry, stop, and target before anything else.",
      "Don't let conceptual clarity substitute for pre-trade preparation."
    );
    return fmt(
      item ? `${item.title}: ${item.label} at ${item.score}/10, ${item.risk} risk.` : "Core principle: risk control first, returns second. Every trade starts with the stop.",
      "Every trading decision comes back to one question: is my downside defined?",
      item ? item.nextAction : "Before your next trade, write down the entry, stop, and target. If you can't in two minutes, you don't know the setup.",
      "Don't add to losing positions. Don't cut winning positions early. Never move a stop wider."
    );
  }

  return null;
}

function getActionResponse(lower, moduleId, item) {
  if (moduleId === "real-estate") {
    if (item) {
      const high = item.score >= 8;
      const mid  = item.score >= 6.5;
      return fmt(
        high  ? `${item.title} scores ${item.score}/10 — high conviction. The math works and the action is clear.`
              : mid ? `${item.title} scores ${item.score}/10 — marginal. Needs price movement before you commit.`
              : `${item.title} scores ${item.score}/10 — doesn't pencil at current ask.`,
        high ? "High-conviction deals have short windows. Hesitation is the only real risk when the math works." : mid ? "Mid-conviction deals require discipline — don't force a deal that isn't ready." : "Low-scoring deals consume time that belongs to better opportunities.",
        high ? `Get contractor on-site for a real rehab number, confirm financing, and submit LOI at or below MAO (${item.mao}).` : mid ? `Set a 14-day price-drop alert. If ask doesn't move toward ${item.mao}, pass and focus on deal #1.` : `Pass. Redirect underwriting time to the top two ranked deals.`,
        item.riskFactors[0] ? `Before any action: verify your position on ${item.riskFactors[0].toLowerCase()}.` : "Confirm MAO calculation is based on current rehab estimates and ARV comps before acting."
      );
    }
    return fmt(
      "Your next move is always the same: identify the highest-conviction deal and take one concrete step to advance or kill it.",
      "A deal in limbo costs you attention and opportunity cost. Every deal should be moving toward a yes or a no.",
      "Take the top-ranked deal and make a binary decision: is your MAO inside the ask? If yes, advance it. If no, pass.",
      "Don't let your pipeline become a collection of maybes. Active deals should be in active motion."
    );
  }

  if (moduleId === "saas") {
    if (item) {
      const isRisk = item.label === "AT RISK" || item.label === "PROTECT";
      return fmt(
        `${item.title} is a ${item.label} account at ${item.score}/10. ${isRisk ? "Retention is the priority." : "Expansion is the opportunity."}`,
        isRisk ? "At-risk ARR is the most expensive to lose. Cost of churn is ARR plus CAC to replace it." : "Expansion from a healthy account is zero-CAC growth.",
        isRisk ? `Book a direct call with the decision-maker at ${item.title} this week. Come prepared with usage data and a value summary.` : `Build the ROI narrative for ${item.title}'s expansion and bring it to your champion this week.`,
        isRisk ? (item.riskFactors[0] ? `Resolve before the call: ${item.riskFactors[0].toLowerCase()}.` : "Confirm you have a champion and know their renewal date.") : `Verify your champion at ${item.title} has authority to approve expansion.`
      );
    }
    return fmt(
      "Sort your book by ARR at risk, then by expansion opportunity. Those two lists tell you exactly where your time should go.",
      "Time in CS is finite. Accounts that don't get proactive attention drift — and drifting accounts churn.",
      "This week: identify your single highest-ARR at-risk account and book a direct call. Not an email. A call.",
      "Don't let outreach default to accounts easiest to talk to. Prioritize by ARR impact, not relationship comfort."
    );
  }

  if (moduleId === "trading") {
    if (item) {
      const strong = item.label === "STRONG BUY" || item.label === "BUY";
      return fmt(
        `${item.title} is rated ${item.label} at ${item.score}/10. ${strong ? "The setup is actionable." : "The setup is not actionable yet."}`,
        strong ? "A confirmed momentum setup with defined risk is the highest-probability trade available." : "Forcing a trade on a weak setup is how small losses become large ones.",
        strong ? `Define your entry trigger, stop level, and position size before the session opens. Enter only on confirmation.` : `Wait. Set an alert at the signal level and let the setup come to you.`,
        item.riskFactors[0] ? `Before entry: ${item.riskFactors[0].toLowerCase()}.` : "Verify sector is not risk-off and total account exposure is within limits."
      );
    }
    return fmt(
      "In trading, the best action is often no action. Not every session needs a trade. Patience is a position.",
      "Overtrading is the most common cause of account underperformance. The cost of bad trades always exceeds the cost of missed good ones.",
      "Review your watchlist. Find the one setup with the cleanest signal and highest RS. If it meets all criteria, plan the entry. If not, sit on hands.",
      "Check whether you're in a post-loss or post-win emotional state. Both impair judgment. If so, reduce size by 25%."
    );
  }

  return null;
}

function getRiskResponse(lower, moduleId, item) {
  const isPass = lower.includes("pass") || lower.includes("walk away") || lower.includes("disqualif") || lower.includes("no ");

  if (moduleId === "real-estate") {
    if (isPass && item) return fmt(
      `Conditions that make ${item.title} a pass: ask materially above MAO (${item.mao}), ARV unsupported by comps, or rehab scope beyond your capacity.`,
      "Knowing when to pass is as valuable as knowing when to buy. A pass protects time and capital for a deal that fits.",
      "Run MAO one more time with a conservative ARV and worst-case rehab. If it still pencils, it's real. If not, pass now.",
      `Current risk factors: ${item.riskFactors.join("; ")}. Any one becoming materially worse is a pass signal.`
    );
    if (item) return fmt(
      `Top risks on ${item.title}: ${item.riskFactors.join("; ")}. Risk level: ${item.risk}.`,
      "Unpriced risk is what turns a good spread into a loss. Every risk factor should be quantified or treated as a pass condition.",
      `Get a specialist to quantify the top risk before submitting: ${item.riskFactors[0]?.toLowerCase() || "the primary concern"}.`,
      "The risk you identified is not the one that kills deals. It's the one you didn't. Ask: what am I not seeing?"
    );
    return fmt(
      "Biggest acquisition risks: inflated ARV, underestimated rehab, overpaying vs MAO, and undercapitalized execution.",
      "Any one of these can turn a deal with good spread on paper into a loss in reality.",
      "Run a stress test on your top deal: what happens if ARV comes in 5% low and rehab runs 20% over?",
      "The risk you're most blind to is the one you assumed away. Go back and check every assumption."
    );
  }

  if (moduleId === "saas") {
    if (isPass && item) return fmt(
      `Conditions that make ${item.title} a write-off: renewal decision already made internally, champion left with no replacement, executive actively evaluating competitors.`,
      "Not every at-risk account is savable. Knowing when to cut time investment is as important as knowing when to intervene.",
      `Assess: does ${item.title} still have an internal advocate? If not, escalate for one final executive call and accept the outcome.`,
      "Don't let hope substitute for signal. If engagement is still declining after two proactive touches, the account is probably leaving."
    );
    if (item) return fmt(
      `Biggest risks at ${item.title}: ${item.riskFactors.join("; ")}. Health: ${item.score}/10.`,
      "Churn risk compounds. One missed signal leads to another. By the time the customer sends the cancellation, the decision was made months ago.",
      `Address the primary risk first: ${item.riskFactors[0] ? item.riskFactors[0].toLowerCase() : "confirm your champion is still active and engaged"}.`,
      "The risk you're most likely missing is a stakeholder change you haven't heard about. Ask your main contact directly."
    );
    return fmt(
      "Biggest churn risks: champion departure, unresolved P1 tickets, active competitor trial, budget cuts, and a customer who stopped seeing ROI.",
      "All five are detectable before renewal if you're tracking the right signals.",
      "Audit your top 10 accounts by ARR: can you name the champion for each and confirm they're still active?",
      "The risk you're most likely missing is a stakeholder change. Ask your main contact directly."
    );
  }

  if (moduleId === "trading") {
    if (isPass && item) return fmt(
      `Conditions that make ${item.title} a pass: setup breaks below key support, volume collapses, sector moves risk-off, or RS drops below 70.`,
      "Knowing when not to trade is as valuable as knowing when to trade. Pass conditions are what keep your account intact.",
      "If any pass condition is triggered, exit the consideration entirely. Don't renegotiate criteria to make the trade work.",
      "The most dangerous moment is when you've been watching a setup for days and want it to work. Want is not a signal."
    );
    if (item) return fmt(
      `Key risks on ${item.title}: ${item.riskFactors.join("; ")}. Risk level: ${item.risk}.`,
      "Every setup has risks. The goal is not to eliminate them — it's to define them precisely and size accordingly.",
      `Before entering: is your stop at a logical technical level? Is size calculated from that stop? Is R/R at least 2:1?`,
      "The risk you're not accounting for: a broad market shift that takes down even the strongest setups. Check market regime first."
    );
    return fmt(
      "Biggest trading risks: oversizing on conviction, widening stops to avoid being stopped out, chasing extended setups, and trading in a risk-off regime.",
      "All four are behavioral risks, not analytical ones. Your system is probably fine — the question is whether you're following it.",
      "Pre-trade checklist: setup clean? Sized correctly? Stop at a logical level? Market regime favorable?",
      "The risk you're most blind to is your own emotional state. After a big winner or a losing streak, trade smaller."
    );
  }

  return null;
}

function handleSpecific(lower, moduleId, item) {
  if (moduleId === "real-estate") {
    if (lower.includes("mao") || lower.includes("offer") || lower.includes("loi") || lower.includes("submit")) return item
      ? fmt(`MAO on ${item.title} is ${item.mao}, ask is ${item.ask}. ${item.risk === "Low" || item.risk === "Low-Med" ? "You are inside your buy box." : "You are outside your buy box at this ask."}`, "Every dollar above MAO compresses margin. You cannot rehab your way back to profitability if you overpay.", item.risk === "Low" || item.risk === "Low-Med" ? `Submit LOI at or below ${item.mao} within 24 hours.` : `Counter at ${item.mao} and give the seller 5 business days.`, `Do not submit without a contractor walkthrough on ${item.riskFactors[0] ? item.riskFactors[0].toLowerCase() : "the key risk items"}.`)
      : fmt("MAO is your ceiling, not your starting point. Work backward from ARV, subtract rehab and your minimum equity requirement.", "Without MAO, every negotiation is emotional. With it, every offer has a mathematical floor.", "Recalculate your MAO with a 15% rehab buffer and confirm the deal still works.", "Don't submit before your rehab estimate is grounded in a contractor walkthrough.");
    if (lower.includes("arv") || lower.includes("comp") || lower.includes("value")) return item
      ? fmt(`ARV on ${item.title} is ${item.arv}. Equity spread at ask is the delta between that and your all-in cost.`, "If your comps are wrong, your spread is fictional.", "Pull 3 closed comps within 0.5 miles, same bed/bath, sold in last 90 days — run them yourself.", "Do not rely on agent CMA or Zestimate. Verify comp condition matches your projected after-repair state.")
      : fmt("ARV is only as good as your comps. Pull them yourself.", "A wrong ARV inflates spread on paper and compresses it in reality.", "Run your own comp analysis on your top deal before discussing price.", "Comps must match condition. A fully renovated comp is not valid for a mid-tier rehab property.");
    if (lower.includes("risk") || lower.includes("concern") || lower.includes("factor")) return item
      ? fmt(`Key risks on ${item.title}: ${item.riskFactors.join("; ")}. Risk level: ${item.risk}.`, "Unpriced risk turns a good spread into a bad deal.", `Quantify: ${item.riskFactors[0]?.toLowerCase() || "the primary concern"}.`, "The risk you identify is not the one that kills deals. It's the one you didn't.")
      : fmt("Risk factors to always underwrite: foundation, roof, HVAC, electrical, and days on market.", "Every unquantified risk is a hidden cost.", "Add a risk line item to your underwriting sheet for every deal.", "If a seller is motivated, ask why. The answer usually reveals the risk they're selling you.");
  }

  if (moduleId === "saas") {
    if (lower.includes("churn") || lower.includes("cancel") || lower.includes("lose")) return item
      ? fmt(`Churn signal on ${item.title} is ${item.risk}. Primary indicator: ${item.riskFactors[0] || "declining engagement"}.`, "The window to save an at-risk account is the 90 days before renewal — not renewal day itself.", `Book a direct call with the main contact at ${item.title} this week.`, "Confirm you have a named champion before the call.")
      : fmt("Churn doesn't happen at renewal — it happens when a user stops getting value.", "Engagement signals lead churn by weeks or months. Track them weekly.", "Set up a weekly engagement report for your top 20 accounts by ARR.", "Don't treat every at-risk account identically. Diagnose the root cause before prescribing the motion.");
    if (lower.includes("expand") || lower.includes("upsell") || lower.includes("grow") || lower.includes("arr")) return item
      ? fmt(`Expansion potential at ${item.title}: ${item.arv}. ${item.score >= 8 ? "Conditions are favorable." : "Champion relationship needs strengthening first."}`, "Expansion is zero-CAC revenue. Every expansion dollar from an existing account is higher margin than a new logo.", item.score >= 8 ? `Build the ROI model for ${item.title} and schedule the expansion conversation this week.` : `Map stakeholders at ${item.title} and identify the economic buyer before pitching expansion.`, `Verify your champion at ${item.title} has authority to approve — or know who does.`)
      : fmt("Your highest-value expansion opportunities are in accounts already getting value with a healthy champion.", "Expansion into an unhealthy account accelerates churn.", "Identify your top three expansion candidates and confirm each has an engaged champion and a clear use case.", "Don't pitch expansion without a ROI story. Buyers need to justify the spend internally.");
    if (lower.includes("qbr") || lower.includes("call") || lower.includes("contact") || lower.includes("meeting")) return item
      ? fmt(`${item.title} needs direct outreach. ${item.nextAction}`, "Skipped check-ins are the clearest leading indicators of churn.", "Book a call directly — not an email. Frame it as a value review.", "Before the call, pull their product engagement data for the last 30 days.")
      : fmt("High-performing CSMs run monthly value check-ins, not quarterly reviews.", "QBRs happen four times per year. Don't miss those four chances to demonstrate ROI.", "Replace your next QBR with a shorter monthly value review and test the format.", "Lead with their metrics, not yours.");
  }

  if (moduleId === "trading") {
    if (lower.includes("enter") || lower.includes("buy") || lower.includes("long") || lower.includes("position")) return item
      ? fmt(`${item.title} is rated ${item.label} at ${item.ask} with volume ${item.mao}.`, item.label === "STRONG BUY" || item.label === "BUY" ? "Confirmed momentum setups with volume are the highest-probability entries available." : "Unconfirmed setups have asymmetric downside. Patience is a position.", item.label === "STRONG BUY" || item.label === "BUY" ? "Set your entry alert at the trigger level. Define stop and size before the session opens." : "Do not enter. Set an alert for a label change to BUY or STRONG BUY.", item.label === "STRONG BUY" || item.label === "BUY" ? "Verify sector strength is aligned before sizing your full position." : "Wait for volume confirmation on the next session before reconsidering.")
      : fmt("Entries should be planned, not reactive.", "Reactive entries produce reactive exits. The edge is in the plan.", "Write out your exact entry criteria before the session opens.", "Never enter a trade without a defined stop and calculated position size — in that order.");
    if (lower.includes("stop") || lower.includes("loss") || lower.includes("protect") || lower.includes("exit")) return item
      ? fmt(`Risk on ${item.title} is ${item.risk}. Higher risk means smaller position, tighter stop.`, "Most account blow-ups come from oversizing, not from being wrong about direction.", `Position size: (account × max risk %) ÷ (entry - stop). Apply to ${item.title} before the order.`, "Check that your stop is at a logical technical level — not just a dollar amount you're comfortable losing.")
      : fmt("Your stop is your maximum acceptable loss per trade. Set it before entry — never adjust it wider.", "Stops aren't about being wrong. They're about limiting how wrong you're allowed to be.", "Review your last five trades — if you moved a stop wider on any, size down 25% on your next.", "Moving a stop wider is managing ego, not risk.");
    if (lower.includes("momentum") || lower.includes("signal") || lower.includes("trend") || lower.includes("chart")) return item
      ? fmt(`${item.title} momentum score is ${item.score}/10. Volume: ${item.mao}.`, "Momentum is confirmed by volume, not price alone. A breakout on light volume is a trap.", item.score >= 8 ? "Confirm sector strength aligns before entering." : "Set a price alert and check back when volume picks up.", item.score >= 8 ? "Know your exit criteria before you enter." : "Do not enter a developing setup ahead of a major catalyst or earnings event.")
      : fmt("Momentum is confirmed by volume, price action, and sector participation — all three together.", "A strong stock in a weak sector is a trap.", "Check sector relative strength before entering any momentum trade.", "Momentum reverses. Know your exit criteria before you enter.");
  }

  return null;
}

export function generateResponse({ module, input, selectedItem, recentMessages = [] }) {
  const id     = module.id;
  const lower  = input.toLowerCase().trim();
  const item   = selectedItem;
  const intent = detectIntent(lower);

  if (intent === "concept") { const r = getConceptResponse(lower, id, item); if (r) return r; }
  if (intent === "followup") { const r = getFollowupResponse(lower, id, item, recentMessages); if (r) return r; }
  if (intent === "risk")    { const r = getRiskResponse(lower, id, item); if (r) return r; }
  if (intent === "action")  { const r = getActionResponse(lower, id, item); if (r) return r; }

  const specific = handleSpecific(lower, id, item);
  if (specific) return specific;

  if (item) {
    if (id === "real-estate") return fmt(
      `${item.title} scores ${item.score}/10 with ${item.risk} risk. Ask ${item.ask} vs MAO ${item.mao}.`,
      item.score >= 8 ? "High-conviction deals move fast." : item.score >= 6.5 ? "Mid-conviction deals need price movement." : "Low-conviction deals belong off your list.",
      item.score >= 8 ? `Submit LOI at or below ${item.mao} within 24 hours.` : item.score >= 6.5 ? "Set a 14-day price-drop alert." : "Pass and focus on deal #1.",
      item.riskFactors[0] ? `Address before acting: ${item.riskFactors[0].toLowerCase()}.` : "Confirm financing is lined up before submitting."
    );
    if (id === "saas") return fmt(
      `${item.title} is a ${item.label} account at ${item.score}/10. ARR: ${item.tag}.`,
      item.label === "AT RISK" || item.label === "PROTECT" ? "At-risk ARR costs 5–10x more to replace than to retain." : "Expansion here is zero-CAC growth.",
      item.nextAction,
      item.riskFactors[0] ? `Resolve before acting: ${item.riskFactors[0].toLowerCase()}.` : "Confirm your champion is still active before any outreach."
    );
    if (id === "trading") return fmt(
      `${item.title} is rated ${item.label} at score ${item.score}/10, ${item.risk} risk.`,
      item.label === "STRONG BUY" || item.label === "BUY" ? "Confirmed setups with defined risk are the highest-probability opportunities." : "Unconfirmed setups carry asymmetric downside — patience is a position.",
      item.nextAction,
      item.riskFactors[0] ? `Before entry: ${item.riskFactors[0].toLowerCase()}.` : "Verify account exposure is within limits before adding this position."
    );
  }

  if (id === "real-estate") return fmt(
    "Focus on your buy box. Every deal outside it is a distraction from one that fits.",
    "Discipline on criteria compounds over time. Dealmakers who chase marginal deals burn time that belongs to good ones.",
    "Run MAO on your top-ranked deal and confirm whether ask is inside your number.",
    "Before touching any deal, confirm financing is lined up — the best opportunities close in days."
  );
  if (id === "saas") return fmt(
    "Churn is a lagging indicator. By the time it surfaces in metrics, the decision was made 60–90 days earlier.",
    "Every account that churns without warning was sending signals — they just weren't being tracked.",
    "Pull login frequency and feature adoption for your top 10 accounts by ARR and identify the drop.",
    "Before any retention or expansion move, confirm you have a named, active champion in the account."
  );
  if (id === "trading") return fmt(
    "Every trade needs a defined entry, stop, and target before the order is placed.",
    "Reactive trading produces reactive results. The edge is in the plan, not the execution speed.",
    "Write down entry criteria, stop level, and target for your next trade before opening a chart.",
    "Before any new position, check total account exposure — adding size when already extended is where blow-ups start."
  );

  return fmt(
    "Ask something specific about the current module and the analyst will give you a direct read.",
    "Vague questions produce vague answers. The more specific your input, the more actionable the output.",
    "Select the top-ranked item and ask about its key risk or recommended action.",
    "Before acting on any recommendation, verify the underlying data — scores and signals are inputs, not instructions."
  );
}
