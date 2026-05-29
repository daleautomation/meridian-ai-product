---
name: Nicole workspace — mobile layout no overflow
url: "{{variable:NICOLE_WORKSPACE_URL}}"
viewport: mobile
viewportWidth: 375
viewportHeight: 812
requiresAuth: true
dependsOn: Nicole workspace — login and load
---
Verify mobile layout does not overflow or hide key relationship labels.

1. Set viewport to iPhone-sized (375×812)
2. Complete login and land on Priority Contacts
3. Wait until: Contact cards or empty state is visible
4. Verify: `document.documentElement.scrollWidth` is less than or equal to viewport width (no horizontal page overflow)
5. Verify: The relationship chip on the first visible card is not clipped to zero width (text must be readable — at least 8 characters visible or full label if shorter)
6. Verify: Reachability badge ("Reachable" or "Not Reachable") is visible without horizontal scrolling
7. Verify: Contact name heading is visible on the first card
8. Tap the first contact card
9. Verify: Detail panel content appears (below or beside list) with the contact name visible without horizontal scroll
10. Scroll the priority list vertically and verify cards remain within the viewport width
