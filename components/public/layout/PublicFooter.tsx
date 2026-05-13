import Link from "next/link";
import {
  CLIENT_LOGIN_HREF,
  REQUEST_DEMO_HREF,
  START_AUDIT_HREF,
} from "@/content/public/home";

export function PublicFooter() {
  return (
    <footer className="public-footer">
      <span>Meridian AI</span>
      <span>Operator-grade intelligence systems.</span>
      <a href={START_AUDIT_HREF}>Start Audit</a>
      <a href={REQUEST_DEMO_HREF}>Request Demo</a>
      <Link href={CLIENT_LOGIN_HREF}>Client Login</Link>
    </footer>
  );
}
