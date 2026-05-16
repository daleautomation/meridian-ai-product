import {
  RECOVERY_SAMPLE_BRIEF_HREF,
  REQUEST_FIRST_BRIEF_HREF,
} from "@/content/public/home";

export function HeroSection() {
  return (
    <section className="public-hero">
      <div className="public-hero-copy">
        <span className="public-eyebrow">Founder-reviewed weekly Recovery Briefs</span>
        <h1>Weekly Recovery Briefs for dormant relationships.</h1>
        <p>
          See who is worth reopening, why now, and what to say. Built for
          boutique firms; outreach stays manual.
        </p>
        <div className="public-hero-actions">
          <a className="public-primary-button" href={RECOVERY_SAMPLE_BRIEF_HREF}>
            See a sample brief
          </a>
          <a className="public-secondary-button" href={REQUEST_FIRST_BRIEF_HREF}>
            Request the first brief on your list
          </a>
        </div>
        <div className="public-hero-proof" aria-label="Recovery Brief trust signals">
          <span>Built for boutique firms</span>
          <span>No automated outreach</span>
          <span>No invented context</span>
          <span>Manual weekly delivery</span>
        </div>
      </div>
      <div
        id="sample-brief-preview"
        className="public-brief-hero-card"
        aria-label="Sample Recovery Brief preview"
      >
        <div className="public-brief-card-header">
          <span>Recovery Brief - Week 20</span>
          <strong>Founder review</strong>
        </div>
        <div className="public-brief-card-body">
          <p>Weekly recovery memo</p>
          <h2>This week&apos;s relationships worth reopening.</h2>
          <ul className="public-brief-card-list">
            <li>
              <span>Who to reopen</span>
              <strong>Past client with a paused expansion conversation</strong>
            </li>
            <li>
              <span>Why now</span>
              <strong>Recent hiring signal suggests the original need may be active again.</strong>
            </li>
            <li>
              <span>What to say</span>
              <strong>Lead with the prior context and ask whether the role is still open.</strong>
            </li>
            <li>
              <span>Contact path</span>
              <strong>Verified email, LinkedIn, then known direct phone.</strong>
            </li>
          </ul>
          <p className="public-brief-card-note">
            Founder-reviewed. No automated outreach.
          </p>
        </div>
      </div>
    </section>
  );
}
