import Link from "next/link";
import {
  CLIENT_LOGIN_HREF,
  RECOVERY_SAMPLE_BRIEF_HREF,
  REQUEST_FIRST_BRIEF_HREF,
} from "@/content/public/home";

export function PublicHeader() {
  return (
    <header className="public-header">
      <Link className="public-brand" href="/" aria-label="Meridian home">
        <span className="public-brand-mark">M</span>
        <span>Meridian</span>
      </Link>
      <nav className="public-nav" aria-label="Meridian website navigation">
        <Link href="/#recovery-brief">Recovery Brief</Link>
        <Link href="/#how-recovery-works">How it works</Link>
        <Link href={RECOVERY_SAMPLE_BRIEF_HREF}>Sample brief</Link>
        <Link href={CLIENT_LOGIN_HREF}>Login</Link>
      </nav>
      <div className="public-header-actions">
        <a className="public-link-button" href={RECOVERY_SAMPLE_BRIEF_HREF}>
          Sample brief
        </a>
        <a className="public-link-button" href={REQUEST_FIRST_BRIEF_HREF}>
          Request first brief
        </a>
        <Link className="public-login-button" href={CLIENT_LOGIN_HREF}>
          Client Login
        </Link>
      </div>
    </header>
  );
}
