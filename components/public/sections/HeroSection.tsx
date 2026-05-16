import {
  RECOVERY_SAMPLE_BRIEF_HREF,
  REQUEST_FIRST_BRIEF_HREF,
} from "@/content/public/home";

export function HeroSection() {
  return (
    <section className="public-hero">
      <div className="public-hero-copy">
        <span className="public-eyebrow">Founder-reviewed weekly Recovery Briefs</span>
        <h1>Recover dormant relationships without guessing who to call next.</h1>
        <p>
          Meridian helps boutique firms turn a founder-controlled CSV into a
          weekly Recovery Brief: who to reopen, why now, what to say, and the
          verified contact path to use.
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
          <p>Relationship recovery memo</p>
          <h2>4 dormant relationships worth reopening this week.</h2>
          <ul className="public-brief-card-list">
            <li>
              <span>Who to reopen</span>
              <strong>Past client with an inactive expansion conversation</strong>
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
              <strong>Founder email, LinkedIn, then direct phone if already known.</strong>
            </li>
          </ul>
          <p className="public-brief-card-note">
            Founder reviews the brief, edits the note, and sends outreach manually.
          </p>
        </div>
      </div>
    </section>
  );
}
