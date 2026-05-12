import Link from "next/link";
import { CLIENT_LOGIN_HREF } from "@/content/public/home";

export function PublicFooter() {
  return (
    <footer className="public-footer">
      <span>Meridian AI</span>
      <span>Operator-grade intelligence systems.</span>
      <Link href={CLIENT_LOGIN_HREF}>Client Login</Link>
    </footer>
  );
}
