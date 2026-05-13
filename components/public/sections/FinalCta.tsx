import Link from "next/link";
import {
  CLIENT_LOGIN_HREF,
  REQUEST_DEMO_HREF,
  START_AUDIT_HREF,
} from "@/content/public/home";

export function FinalCta() {
  return (
    <section className="public-final-cta">
      <span className="public-eyebrow">Ready when the operation is</span>
      <h2>Turn scattered work into a system your operators can trust.</h2>
      <p>
        Start with an audit, see the workspace, or enter the operator console
        when your team is ready for clearer ownership, stronger prioritization,
        and a calmer system for daily execution.
      </p>
      <div className="public-hero-actions">
        <a className="public-primary-button" href={START_AUDIT_HREF}>
          Start Audit
        </a>
        <a className="public-secondary-button" href={REQUEST_DEMO_HREF}>
          Request Demo
        </a>
        <Link className="public-login-button" href={CLIENT_LOGIN_HREF}>
          Client Login
        </Link>
      </div>
    </section>
  );
}
