---
name: Nicole workspace — CRM-only cards omit opportunity language
url: "{{variable:NICOLE_WORKSPACE_URL}}"
viewport: desktop
requiresAuth: true
dependsOn: Nicole workspace — login and load
---
Verify CRM-only contacts do not show Opportunity, Hot Lead, Seller Signal, or market-fit language on their cards.

Definitions:
- A **CRM-only card** is a contact card that does NOT show a market opportunity badge (no uppercase tier badge like "· MED" or "· HIGH" in the accent/opportunity pill).
- Section nav labels (e.g. "Dormant Opportunities") are allowed; this test applies to **contact cards only**.

1. Complete login
2. Open the "Priority Contacts" tab, then repeat on "All Contacts"
3. For each visible contact card:
   - If the card has NO market opportunity badge (no "Ownership duration signal", "Active listing", "Public-record evidence", or similar tier pill):
     - Verify: Card body and header do NOT contain the words "Hot Lead" or "Seller Signal" (case insensitive)
     - Verify: Card body and header do NOT contain "market fit" or "market-fit"
     - Verify: Card body and header do NOT use "Opportunity" as a standalone primary label (nav section titles excluded)
     - Verify: No "HIGH tier" or pseudo-predictive sales language on the card
   - If the card HAS a market opportunity badge with public-record/listing evidence:
     - Skip the banned-word checks (market evidence is allowed to show opportunity tier copy)
