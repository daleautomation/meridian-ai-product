import Link from "next/link";
import {
  ABOUT_HREF,
  CLIENT_LOGIN_HREF,
  REQUEST_WORKSPACE_HREF,
  SHOWCASE_HREF,
  VISIBILITY_SCAN_HREF,
} from "@/content/public/home";

export function PublicHeader() {
  return (
    <header className="public-header">
      <Link className="public-brand" href="/" aria-label="Meridian home">
        <span className="public-brand-mark">M</span>
        <span>Meridian</span>
      </Link>
      <nav className="public-nav" aria-label="Meridian website navigation">
        <Link href="/#solutions">Solutions</Link>
        <Link href={SHOWCASE_HREF}>Showcase</Link>
        <Link href="/#products">Products</Link>
        <Link href={ABOUT_HREF}>Company</Link>
        <Link href="/#plans">Plans</Link>
        <Link href={CLIENT_LOGIN_HREF}>Login</Link>
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
