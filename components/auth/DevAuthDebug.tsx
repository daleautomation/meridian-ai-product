import { TENANTS, toPublicUser } from "@/config/tenants";
import { workspaceSelectCardsForUser } from "@/lib/auth/postLoginRouting";

export const DEV_AUTH_BUILD_MARKER = "brookside-login-fix";

const LOGIN_TENANT_IDS = ["john", "nicole", "dylan"] as const;

type DevAuthDebugProps = {
  page: "login" | "workspace-select";
};

/** Temporary dev-only proof that the browser is running updated auth config. */
export function DevAuthDebug({ page }: DevAuthDebugProps) {
  if (process.env.NODE_ENV !== "development") return null;

  const dylan = TENANTS.dylan;
  const dylanCards = dylan
    ? workspaceSelectCardsForUser(toPublicUser(dylan)).map((c) => c.title)
    : [];

  return (
    <aside
      className="dev-auth-debug"
      data-build-marker={DEV_AUTH_BUILD_MARKER}
      aria-label="Development auth debug"
    >
      <p>
        <strong>build marker:</strong> {DEV_AUTH_BUILD_MARKER}
      </p>
      <p>
        <strong>available tenants:</strong> {LOGIN_TENANT_IDS.join(", ")}
      </p>
      <p>
        <strong>selector workspaces for Dylan:</strong>{" "}
        {dylanCards.length > 0 ? dylanCards.join(" · ") : "(none)"}
      </p>
      <p>
        <strong>page:</strong> {page}
      </p>
    </aside>
  );
}
