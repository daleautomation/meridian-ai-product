# PR Review Checklist

Every PR — code, copy, config, or doc — answers these five questions before merge.

This checklist exists because design conversations are easy to lose. The questions are short on purpose; copy them into the PR description and answer them explicitly.

---

## The five questions

### 1. Does this increase operator trust?

A change increases trust when the operator can:
- See *what* the change produces
- Understand *why* it produces that
- Predict *when* it will fire next time

A change decreases trust when it introduces opacity, surprise, fabricated confidence, or any output the operator cannot trace.

**Common ways to fail:** adding a score with no exposed component; auto-firing an action without operator opt-in; using "AI" / "intelligent" / "predictive" in customer-facing language.

---

### 2. Does this remain explainable?

A change is explainable when:
- Every output traces back to a signal documented in `scoring-principles.md`
- A founder can answer "where did this line come from?" for every line in the brief
- The customer can understand the reasoning without reading code

**Common ways to fail:** a new ML model; a hidden weight; a magic number with no comment; a templated phrase that doesn't anchor on real data.

---

### 3. Does this improve commercial prioritization?

A change improves commercial prioritization when it makes Meridian better at answering: *"What relationships deserve attention right now based on observable commercial signals?"*

**Common ways to fail:** adding a feature unrelated to ranking, scoring, or surfacing dormant accounts; adding a "nice to have" view that doesn't change which card the operator acts on; adding a setting nobody asked for.

---

### 4. Does this reduce operator noise?

A change reduces noise when it removes a decision, surfaces a clearer next action, or hides information the operator didn't ask for.

A change adds noise when it introduces a new tab, panel, badge, score, or screen the operator must now consider.

**Common ways to fail:** new dashboard widgets; sticky bars; persistent notifications; "intelligence" panels; chat assistants.

---

### 5. Does this avoid AI theater?

AI theater = behavior that looks autonomous but isn't; or wording that implies intelligence Meridian doesn't have.

A change avoids theater when:
- The mechanism is deterministic and traceable
- The wording matches the mechanism (`copywriting-principles.md § Approved phrasings`)
- The output never claims more certainty than the data justifies
- No chat / agent / "assistant" surface is introduced

**Common ways to fail:** chat panels; "powered by AI" badges; "predictive scoring" labels; "intelligent recommendations" copy; auto-send mechanisms.

---

## How to use

1. Open a draft PR.
2. Paste the five questions into the PR description.
3. Answer each one in 1–2 sentences. Yes-with-justification beats yes-with-no-explanation.
4. If **any** answer is no — or unclear — fix the PR or convert it back to a roadmap entry. Don't merge.
5. The PR template at `.github/pull_request_template.md` does this automatically; this doc explains it.

---

## Failure mode

A PR that scores 5/5 but expands scope still warrants rejection. The bar is **alignment with the one governing question:**

> *"Does this help businesses focus attention on the relationships most connected to commercial opportunity in a calm, trustworthy, explainable way?"*

If the change passes the five but doesn't serve that question, it belongs to a different product.

---

## Exception: canon amendments

PRs that change one of the seven canonical documents (`meridian-philosophy.md`, `product-principles.md`, `scoring-principles.md`, `ingestion-principles.md`, `ux-principles.md`, `copywriting-principles.md`, or this file) bypass the five questions — because they ARE the questions. See `README.md § Amending the canon`.

---

## Reference

- Master philosophy: [`meridian-philosophy.md`](./meridian-philosophy.md)
- Product principles: [`product-principles.md`](./product-principles.md)
- Scoring principles: [`scoring-principles.md`](./scoring-principles.md)
- Ingestion principles: [`ingestion-principles.md`](./ingestion-principles.md)
- UX principles: [`ux-principles.md`](./ux-principles.md)
- Copywriting principles: [`copywriting-principles.md`](./copywriting-principles.md)
