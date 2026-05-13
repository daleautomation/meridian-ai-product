# Meridian demo access and workspace login

This document describes Meridian's current auth, demo-link, and workspace access model.

## Roles

| Role | Intended user | Access |
| --- | --- | --- |
| `public` | Anonymous visitor | Public site only (`/`, `/login`, public assets). |
| `demo_viewer` | Generic controlled demo viewer | Demo-safe workspaces only, read-only. |
| `advisor_viewer` | Advisor or investor | Selected demo-safe workspaces only, read-only. |
| `client_user` | Actual client operator | Assigned client workspace only. |
| `admin_operator` | Internal Meridian operator | Assigned client/demo workspaces and admin-only APIs. |

## Current auth flow

1. Public pages load without a session.
2. Protected routes pass through `proxy.ts`.
3. Missing or malformed cookies redirect page requests to `/login?next=<original path and query>`.
4. `/login` posts credentials to `/api/auth/login`.
5. The login route validates server-side tenant credentials, signs `meridian_session`, and sets an HTTP-only `SameSite=Lax` cookie.
6. `/operator` reads the cookie through `getSession()`, validates the requested `workspace`, and renders either the workspace, a picker, or a clear access-denied state.

## Session cookie behavior

- Cookie name: `meridian_session`.
- Format: `uid.exp.signature`.
- Signature: HMAC-SHA256 with `SESSION_SECRET`.
- Lifetime: 7 days.
- Flags: `httpOnly`, `sameSite=lax`, `path=/`.
- `secure` is true for production or when `x-forwarded-proto` includes `https`.
- Missing, expired, malformed, or invalid-signature cookies are treated as logged out.

## Workspace authorization

Workspace access requires both:

1. The workspace slug is assigned to the signed-in user.
2. The user's role is allowed by the workspace config.

`labortech` allows only `client_user` and `admin_operator`.

`advisor-demo` allows `demo_viewer`, `advisor_viewer`, and `admin_operator`, uses demo-mode isolation, and is read-only by default.

## Demo links

Supported controlled demo links:

- `/demo/john` -> signs in John and redirects to `/operator?workspace=labortech`.
- `/demo/max` -> signs in Max and redirects to `/operator?workspace=advisor-demo`.
- `/demo/advisor` -> signs in Advisor Demo and redirects to `/operator?workspace=advisor-demo`.
- `/demo/investor` -> signs in Investor Demo and redirects to `/operator?workspace=advisor-demo`.
- `/demo/public` -> signs in Demo Viewer and redirects to `/operator?workspace=advisor-demo`.

`/api/auth/demo-login?user=<profile>` remains available for compatibility and uses the same checks.

Demo links are host-gated in production by `MERIDIAN_DEMO_ALLOWED_HOSTS`. If unset, `meridianai.work` is allowed by default. Set it to an empty string to disable demo links in production.

## Safe client links

- Public website: `/`
- Login page: `/login`
- LaborTech client login: `/login?next=/operator?workspace=labortech`
- John one-click client entry: `/demo/john`

Do not send advisor/investor users `/demo/john` or direct LaborTech workspace links unless they should have real LaborTech workspace access.

## Production environment requirements

- `SESSION_SECRET` must be set and stable across deployments.
- `SESSION_SECRET` must be at least 16 characters.
- Rotating `SESSION_SECRET` invalidates existing cookies.
- `MERIDIAN_DEMO_ALLOWED_HOSTS` should include every trusted public demo host, for example `meridianai.work`.
- Production must be served over HTTPS so secure cookies are stored by browsers.

## Failure scenarios to check

- A missing production `SESSION_SECRET` causes login/demo session creation to return an auth configuration error.
- A changed `SESSION_SECRET` makes old cookies invalid and users must log in again.
- A host not in `MERIDIAN_DEMO_ALLOWED_HOSTS` receives a 403 for `/demo/*`.
- An advisor/demo session requesting `workspace=labortech` receives an access-denied workspace page.
- An unauthenticated `/operator?workspace=labortech` request redirects to `/login?next=/operator?workspace=labortech` and preserves workspace intent.
