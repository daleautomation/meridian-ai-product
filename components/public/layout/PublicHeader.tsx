import Link from "next/link";
import { CLIENT_LOGIN_HREF, REQUEST_DEMO_HREF } from "@/content/public/home";

export function PublicHeader() {
  return (
    <header className="public-header">
      <Link className="public-brand" href="/" aria-label="Meridian AI home">
        <span className="public-brand-mark">M</span>
        <span>Meridian AI</span>
      </Link>
      <nav className="public-nav" aria-label="Meridian website navigation">
        <a href="#services">Services</a>
        <a href="#audits">Audits</a>
        <a href="#workspaces">Workspaces</a>
        <a href="#platform">Platform</a>
        <a href="#about">About</a>
      </nav>
      <div className="public-header-actions">
        <a className="public-link-button" href={REQUEST_DEMO_HREF}>
          Request Demo
        </a>
        <Link className="public-login-button" href={CLIENT_LOGIN_HREF}>
          Client Login
        </Link>
      </div>
    </header>
  );
}
