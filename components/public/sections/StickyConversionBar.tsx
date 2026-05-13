import Link from "next/link";
import {
  CLIENT_LOGIN_HREF,
  REQUEST_DEMO_HREF,
  START_AUDIT_HREF,
} from "@/content/public/home";

export function StickyConversionBar() {
  return (
    <aside className="public-sticky-cta" aria-label="Meridian conversion actions">
      <span>Ready to see the operating system?</span>
      <a className="public-primary-button" href={START_AUDIT_HREF}>
        Start Audit
      </a>
      <a className="public-secondary-button" href={REQUEST_DEMO_HREF}>
        Request Demo
      </a>
      <Link className="public-login-button" href={CLIENT_LOGIN_HREF}>
        Client Login
      </Link>
    </aside>
  );
}
