---
name: Nicole workspace — relationship primary labels
url: "{{variable:NICOLE_WORKSPACE_URL}}"
viewport: desktop
requiresAuth: true
dependsOn: Nicole workspace — login and load
---
Verify relationship classifications render as the primary label on priority contact cards.

1. Complete login (depends on login test)
2. Ensure the "Priority Contacts" tab is active
3. Wait until: At least one contact card is visible in the list
4. For each visible priority contact card (up to 8):
   - Verify: A relationship chip appears in the card header row (near the rank #)
   - Verify: The chip text is one of:
     - "Past Seller Reconnect"
     - "Seller History (Verify Recency)"
     - "Sphere Reengagement"
     - "Cold Relationship"
     - "Not Reachable"
   - Verify: The relationship chip is visually above the contact name (not buried in the detail panel only)
5. Verify: No card uses a numeric CRM score (e.g. "Baseline import" or raw "68") as the primary header label instead of a relationship class
