---
name: Nicole workspace — login and load
url: "{{variable:NICOLE_WORKSPACE_URL}}"
viewport: desktop
requiresAuth: true
---
Prerequisite login test for the Nicole Lonergan personal workspace.

1. Navigate to {{variable:MERIDIAN_BASE_URL}}/login
2. Wait until: The login form is visible
3. Enter {{variable:NICOLE_USERNAME}} in the username field
4. Enter {{variable:NICOLE_PASSWORD}} in the password field
5. Click Sign in / Log in
6. Wait until: Signed-in portal or workspace picker appears
7. If a "Continue to Nicole Lonergan Workspace" button is visible, click it
8. Otherwise navigate to {{variable:NICOLE_WORKSPACE_URL}}
9. Wait until: The page title or heading includes "Nicole" or "Brookside"
10. Verify: At least one contact card or an empty-state message is visible (not an error page)
11. Verify: The Priority Contacts navigation tab is visible
