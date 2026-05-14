import Link from "next/link";
import {
  CLIENT_LOGIN_HREF,
  REQUEST_WORKSPACE_HREF,
  VISIBILITY_SCAN_HREF,
} from "@/content/public/home";

export function PublicFooter() {
  return (
    <footer className="public-footer">
      <span>Meridian AI</span>
      <span>Operator-grade growth and intelligence systems.</span>
      <a href={VISIBILITY_SCAN_HREF}>Visibility Scan</a>
      <a href={REQUEST_WORKSPACE_HREF}>Request Workspace</a>
      <Link href={CLIENT_LOGIN_HREF}>Client Login</Link>
    </footer>
  );
}
