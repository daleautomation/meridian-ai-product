import Link from "next/link";
import {
  ABOUT_HREF,
  CLIENT_LOGIN_HREF,
  REQUEST_WORKSPACE_HREF,
  SHOWCASE_HREF,
  VISIBILITY_SCAN_HREF,
} from "@/content/public/home";

export function PublicFooter() {
  return (
    <footer className="public-footer">
      <span>Meridian</span>
      <span>Relationship-priority and revenue execution systems.</span>
      <a href={VISIBILITY_SCAN_HREF}>Priority Scan</a>
      <Link href={SHOWCASE_HREF}>Showcase</Link>
      <a href={REQUEST_WORKSPACE_HREF}>Request Workspace</a>
      <Link href={ABOUT_HREF}>About</Link>
      <Link href={CLIENT_LOGIN_HREF}>Client Login</Link>
    </footer>
  );
}
