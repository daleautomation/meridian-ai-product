---
name: Nicole workspace — card opens detail panel
url: "{{variable:NICOLE_WORKSPACE_URL}}"
viewport: desktop
requiresAuth: true
dependsOn: Nicole workspace — login and load
---
Verify clicking a contact card opens the detail panel with matching context.

1. Complete login on Priority Contacts
2. Wait until: At least two contact cards are visible
3. Note the name on the second contact card
4. Click the second contact card
5. Wait until: The detail panel (right column) updates
6. Verify: The detail panel heading matches the clicked contact name
7. Verify: The clicked card shows a selected state (accent border or highlight)
8. Verify: The detail panel includes at least one of: "Suggested next step", "Why this recommendation", or "Reachability"
9. Click a different card and verify the detail panel heading updates again
