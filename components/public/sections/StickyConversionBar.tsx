import Link from "next/link";
import {
  CLIENT_LOGIN_HREF,
  REQUEST_WORKSPACE_HREF,
  VISIBILITY_SCAN_HREF,
} from "@/content/public/home";

export function StickyConversionBar() {
  return (
    <aside className="public-sticky-cta" aria-label="Meridian conversion actions">
      <span>Find the fastest growth system.</span>
      <a className="public-primary-button" href={VISIBILITY_SCAN_HREF}>
        Visibility Scan
      </a>
      <a className="public-secondary-button" href={REQUEST_WORKSPACE_HREF}>
        Request Workspace
      </a>
      <Link className="public-login-button" href={CLIENT_LOGIN_HREF}>
        Client Login
      </Link>
    </aside>
  );
}
