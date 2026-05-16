import Link from "next/link";
import {
  CLIENT_LOGIN_HREF,
  RECOVERY_SAMPLE_BRIEF_HREF,
  REQUEST_FIRST_BRIEF_HREF,
} from "@/content/public/home";

export function PublicFooter() {
  return (
    <footer className="public-footer">
      <span>Meridian</span>
      <span>Founder-reviewed weekly Recovery Briefs for boutique firms.</span>
      <a href={RECOVERY_SAMPLE_BRIEF_HREF}>Sample brief</a>
      <a href={REQUEST_FIRST_BRIEF_HREF}>Request first brief</a>
      <Link href={CLIENT_LOGIN_HREF}>Client Login</Link>
    </footer>
  );
}
