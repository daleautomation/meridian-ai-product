---
name: Nicole workspace — not reachable not at top
url: "{{variable:NICOLE_WORKSPACE_URL}}"
viewport: desktop
requiresAuth: true
dependsOn: Nicole workspace — login and load
---
Verify Not Reachable contacts are not surfaced at the top of the priority queue.

1. Complete login on Priority Contacts
2. Wait until: Contact cards are visible (or empty state if no contacts)
3. If fewer than 2 cards, pass with note "insufficient contacts to rank"
4. Examine the first three priority cards (ranks #1, #2, #3):
   - Verify: NONE of the first three cards show "Not Reachable" as the primary relationship chip
   - Verify: NONE of the first three cards show a "Not Reachable" reachability badge as the dominant classification
5. If any card in the full priority list (up to 8) shows "Not Reachable":
   - Verify: Its rank number is greater than the count of reachable cards above it (i.e. it sorts below reachable contacts)
6. Open "All Contacts" tab
7. Verify: Sort order still places reachable relationship classes above "Not Reachable" when both exist (Not Reachable cards appear lower in the list, not at #1)
