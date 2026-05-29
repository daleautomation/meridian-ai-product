---
name: Nicole workspace — reachability recency confidence badges
url: "{{variable:NICOLE_WORKSPACE_URL}}"
viewport: desktop
requiresAuth: true
dependsOn: Nicole workspace — login and load
---
Verify reachable, recency, and confidence badges appear on priority contact cards.

1. Complete login
2. Open "Priority Contacts"
3. Wait until: At least one contact card is visible
4. For each visible priority card (up to 8):
   - Verify: A reachability badge shows either "Reachable" or "Not Reachable"
   - Verify: A recency badge is present containing "Last contact" or "No last-contact date on file"
   - Verify: A confidence badge is present containing "Confidence:" followed by "medium" or "low"
5. Click the first card
6. Verify: The detail panel on the right repeats reachability, recency, and confidence badges for the selected contact
