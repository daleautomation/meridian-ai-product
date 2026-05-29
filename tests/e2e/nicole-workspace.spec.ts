/**
 * Playwright mirror of autonoma/tests/* for Nicole workspace UI checks.
 * UI-only — hits live deployment HTML, no Neon or migrations.
 */
import { test, expect, type Page, type BrowserContext } from "@playwright/test";

const WORKSPACE = "nicole-lonergan";
const USERNAME = process.env.NICOLE_USERNAME ?? "nicole";
const PASSWORD = process.env.NICOLE_PASSWORD ?? "brookside";

const VALID_RELATIONSHIP_LABELS = [
  "Past Seller Reconnect",
  "Seller History (Verify Recency)",
  "Sphere Reengagement",
  "Cold Relationship",
  "Not Reachable",
] as const;

const BANNED_CRM_ONLY = [
  /hot lead/i,
  /seller signal/i,
  /market[- ]fit/i,
  /\bopportunity\b/i,
] as const;

const MARKET_OPPORTUNITY_RE = /ownership duration signal|active listing|public-record evidence|listed by another agent/i;

async function loginNicole(context: BrowserContext, baseURL: string) {
  const res = await context.request.post(`${baseURL}/api/auth/login`, {
    data: { username: USERNAME, password: PASSWORD },
  });
  expect(res.ok(), `login failed: ${res.status()} ${await res.text()}`).toBeTruthy();
}

async function openNicoleWorkspace(page: Page, baseURL: string) {
  await loginNicole(page.context(), baseURL);
  await page.goto(`/personal?workspace=${WORKSPACE}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

function contactCards(page: Page) {
  return page.locator("button").filter({ has: page.locator("h3") });
}

async function cardSnapshot(card: ReturnType<typeof contactCards>["nth"]) {
  const text = (await card.innerText()).replace(/\s+/g, " ").trim();
  const name = (await card.locator("h3").first().innerText()).trim();
  const relationshipMatch = VALID_RELATIONSHIP_LABELS.find((label) => text.includes(label)) ?? null;
  const hasMarketBadge = MARKET_OPPORTUNITY_RE.test(text) || /· (MED|HIGH|REVIEW|WEAK)\b/.test(text);
  const reachable = /Not Reachable/.test(text) ? "Not Reachable" : /Reachable/.test(text) ? "Reachable" : null;
  return { text, name, relationshipMatch, hasMarketBadge, reachable };
}

test.describe("Nicole workspace — desktop @desktop", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    test.skip(!baseURL, "MERIDIAN_BASE_URL required");
    await openNicoleWorkspace(page, baseURL!);
  });

  test("00 — workspace loads with priority nav", async ({ page }) => {
    await expect(page.getByRole("button", { name: /Priority Contacts/i })).toBeVisible();
    const cards = contactCards(page);
    const count = await cards.count();
    if (count === 0) {
      await expect(page.getByText(/import|contact/i).first()).toBeVisible();
    } else {
      expect(count).toBeGreaterThan(0);
    }
  });

  test("01 — relationship classifications as primary labels", async ({ page }) => {
    const cards = contactCards(page);
    const count = Math.min(await cards.count(), 8);
    test.skip(count === 0, "no contacts in workspace");
    for (let i = 0; i < count; i++) {
      const snap = await cardSnapshot(cards.nth(i));
      expect(snap.relationshipMatch, `card ${i + 1} (${snap.name}): missing relationship label in: ${snap.text.slice(0, 120)}`).not.toBeNull();
      expect(snap.text).not.toMatch(/Baseline import/i);
    }
  });

  test("02 — CRM-only cards omit opportunity language", async ({ page }) => {
    for (const tab of [/Priority Contacts/i, /All Contacts/i] as const) {
      await page.getByRole("button", { name: tab }).click();
      const cards = contactCards(page);
      const count = await cards.count();
      for (let i = 0; i < count; i++) {
        const snap = await cardSnapshot(cards.nth(i));
        if (snap.hasMarketBadge) continue;
        for (const banned of BANNED_CRM_ONLY) {
          expect(snap.text, `CRM-only card "${snap.name}" matched ${banned}`).not.toMatch(banned);
        }
      }
    }
  });

  test("03 — reachability, recency, confidence badges", async ({ page }) => {
    const cards = contactCards(page);
    const count = Math.min(await cards.count(), 8);
    test.skip(count === 0, "no contacts");
    for (let i = 0; i < count; i++) {
      const snap = await cardSnapshot(cards.nth(i));
      expect(snap.reachable, `card ${snap.name}`).not.toBeNull();
      expect(snap.text).toMatch(/Last contact|No last-contact date on file/);
      expect(snap.text).toMatch(/Confidence:\s*(medium|low)/i);
    }
    await cards.first().click();
    const detail = page.locator("aside").first();
    await expect(detail).toContainText(/Confidence:/i);
  });

  test("04 — clicking a card opens detail panel", async ({ page }) => {
    const cards = contactCards(page);
    test.skip((await cards.count()) < 2, "need at least 2 contacts");
    const second = cards.nth(1);
    const { name } = await cardSnapshot(second);
    await second.click();
    const detail = page.locator("aside").first();
    await expect(detail.getByRole("heading", { level: 2 })).toHaveText(name);
    await expect(detail.getByText(/Suggested next step|Why this recommendation|Reachability/i).first()).toBeVisible();
  });

  test("05 — Not Reachable not in top three", async ({ page }) => {
    const cards = contactCards(page);
    const count = await cards.count();
    test.skip(count < 2, "insufficient contacts");
    const top = Math.min(3, count);
    for (let i = 0; i < top; i++) {
      const snap = await cardSnapshot(cards.nth(i));
      expect(snap.relationshipMatch, `#${i + 1} ${snap.name}`).not.toBe("Not Reachable");
    }
  });
});

test.describe("Nicole workspace — mobile @mobile", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test.beforeEach(async ({ page, baseURL }) => {
    test.skip(!baseURL, "MERIDIAN_BASE_URL required");
    await openNicoleWorkspace(page, baseURL!);
  });

  test("06 — no horizontal overflow; key labels visible", async ({ page }) => {
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return doc.scrollWidth > doc.clientWidth + 1;
    });
    expect(overflow, "horizontal page overflow on mobile").toBe(false);

    const cards = contactCards(page);
    test.skip((await cards.count()) === 0, "no contacts");
    const first = cards.first();
    await expect(first.locator("h3").first()).toBeVisible();
    const relText = await first.innerText();
    const hasRelationship = VALID_RELATIONSHIP_LABELS.some((l) => relText.includes(l));
    expect(hasRelationship).toBe(true);
    expect(relText).toMatch(/Reachable|Not Reachable/);

    await first.click();
    await expect(page.locator("aside").first().getByRole("heading", { level: 2 })).toBeVisible();
  });
});
