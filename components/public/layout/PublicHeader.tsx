import Link from "next/link";
import {
  CLIENT_LOGIN_HREF,
  REQUEST_WORKSPACE_HREF,
  ROOFING_INTELLIGENCE_HREF,
  VISIBILITY_SCAN_HREF,
} from "@/content/public/home";

export function PublicHeader() {
  return (
    <header className="public-header">
      <Link className="public-brand" href="/" aria-label="Meridian AI home">
        <span className="public-brand-mark">M</span>
        <span>Meridian AI</span>
      </Link>
      <nav className="public-nav" aria-label="Meridian website navigation">
        <a href="/#utility-products">Priority Queue</a>
        <a href="/#vertical-workspaces">Workspaces</a>
        <a href={ROOFING_INTELLIGENCE_HREF}>Roofing</a>
        <a href="/#built-from-field">Field-built</a>
        <a href="/#how-meridian-works">Workflow</a>
      </nav>
      <div className="public-header-actions">
        <a className="public-link-button" href={VISIBILITY_SCAN_HREF}>
          Priority Scan
        </a>
        <a className="public-link-button" href={REQUEST_WORKSPACE_HREF}>
          Request Workspace
        </a>
        <Link className="public-login-button" href={CLIENT_LOGIN_HREF}>
          Client Login
        </Link>
      </div>
    </header>
  );
}
