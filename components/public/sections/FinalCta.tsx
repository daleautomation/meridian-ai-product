import Link from "next/link";
import {
  BOOK_STRATEGY_CALL_HREF,
  CLIENT_LOGIN_HREF,
  EXPLORE_SYSTEMS_HREF,
  REQUEST_WORKSPACE_HREF,
  VISIBILITY_SCAN_HREF,
} from "@/content/public/home";

export function FinalCta() {
  return (
    <section className="public-final-cta">
      <span className="public-eyebrow">Ready when the operation is</span>
      <h2>Start with the fastest growth lever, then build the workspace around execution.</h2>
      <p>
        Meridian is built for service businesses that need clearer lead
        intelligence, stronger online presence, better follow-up, and a system
        operators can actually run.
      </p>
      <div className="public-hero-actions">
        <a className="public-primary-button" href={VISIBILITY_SCAN_HREF}>
          Get a Visibility Scan
        </a>
        <a className="public-secondary-button" href={REQUEST_WORKSPACE_HREF}>
          Request Workspace
        </a>
        <a className="public-secondary-button" href={EXPLORE_SYSTEMS_HREF}>
          Explore Systems
        </a>
        <a className="public-secondary-button" href={BOOK_STRATEGY_CALL_HREF}>
          Book Strategy Call
        </a>
        <Link className="public-login-button" href={CLIENT_LOGIN_HREF}>
          Client Login
        </Link>
      </div>
    </section>
  );
}
