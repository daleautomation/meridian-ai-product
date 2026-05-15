import Link from "next/link";
import {
  BOOK_STRATEGY_CALL_HREF,
  CLIENT_LOGIN_HREF,
  EXPLORE_SYSTEMS_HREF,
  REQUEST_WORKSPACE_HREF,
  SHOWCASE_HREF,
  VISIBILITY_SCAN_HREF,
} from "@/content/public/home";

export function FinalCta() {
  return (
    <section className="public-final-cta">
      <span className="public-eyebrow">Relationships to revenue</span>
      <h2>Start by finding the relationships that can move revenue now.</h2>
      <p>
        Meridian helps businesses protect revenue already inside their pipeline,
        recover stale opportunities, and build calm workspaces operators can
        actually use.
      </p>
      <div className="public-hero-actions">
        <a className="public-primary-button" href={VISIBILITY_SCAN_HREF}>
          Get a Priority Scan
        </a>
        <a className="public-secondary-button" href={SHOWCASE_HREF}>
          View Showcase
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
