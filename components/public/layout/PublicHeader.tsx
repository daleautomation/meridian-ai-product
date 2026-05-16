import Link from "next/link";
import {
  ABOUT_HREF,
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
        <Link href={RECOVERY_SAMPLE_BRIEF_HREF}>Sample brief</Link>
        <a href={REQUEST_FIRST_BRIEF_HREF}>Request first brief</a>
        <Link href={ABOUT_HREF}>About</Link>
        <Link href={CLIENT_LOGIN_HREF}>Login</Link>
      </nav>
    </header>
  );
}
