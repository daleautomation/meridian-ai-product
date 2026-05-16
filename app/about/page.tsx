import type { Metadata } from "next";
import { PublicFooter } from "@/components/public/layout/PublicFooter";
import { PublicHeader } from "@/components/public/layout/PublicHeader";
import {
  RECOVERY_SAMPLE_BRIEF_HREF,
  REQUEST_FIRST_BRIEF_HREF,
} from "@/content/public/home";

export const metadata: Metadata = {
  title: "About Meridian | Weekly Recovery Briefs for Boutique Firms",
  description:
    "Meridian is a founder-led service that sends boutique firms a weekly Recovery Brief: who to reopen, why now, what to say, and the verified contact path.",
};

const storyPoints = [
  {
    title: "It started with construction pressure.",
    text: "The earliest Meridian thinking came from real operational work: estimates, schedules, handoffs, customer promises, and the daily cost of work living in memory.",
  },
  {
    title: "Systems thinking came before software.",
    text: "The pattern was obvious before the product was: teams did not need more noise. They needed to know what mattered, who owned it, and what action should happen next.",
  },
  {
    title: "Automation curiosity became product work.",
    text: "Building small automations led into software because the operational problems were too specific, too human, and too commercially important for generic tools.",
  },
  {
    title: "Software happened almost by accident.",
    text: "The goal was not to start with a big platform idea. The work kept pointing back to small systems that removed friction, saved time, and made the next step obvious.",
  },
  {
    title: "The work became relationship recovery.",
    text: "Solving operational problems pointed back to the same shape: relationships a business had earned, then lost track of. Recovery Briefs are the practical version of that.",
  },
  {
    title: "The product should help both sides succeed.",
    text: "Meridian sends a weekly brief that helps a founder act with care on the relationships they already own. The work is manual on both ends — that is the promise.",
  },
] as const;

const principles = [
  "Practical over performative",
  "Founder judgment over black-box automation",
  "Manual outreach over auto-sending",
  "Evidence over invented context",
] as const;

export default function About() {
  return (
    <main className="public-site about-public-page">
      <PublicHeader />
      <section className="about-public-hero">
        <span className="public-eyebrow">About Meridian</span>
        <h1>Built by following operational problems until they became software.</h1>
        <p>
          Meridian is a founder-led service that sends boutique firms a weekly
          Recovery Brief: who to reopen, why now, what to say, and the verified
          contact path. It grew from construction experience and a practical
          curiosity about how the right small note can save a relationship.
        </p>
      </section>

      <section className="about-public-section about-public-split">
        <div>
          <span className="public-eyebrow">Founder-led and grounded</span>
          <h2>A weekly memo, not a platform.</h2>
          <p>
            The work is grounded: help boutique firms see which relationships
            deserve attention, why now, and what to say first. Briefs are
            founder-reviewed and outreach stays manual on both ends — that is
            the entire promise.
          </p>
          <div className="public-pill-row">
            {principles.map((principle) => (
              <span key={principle}>{principle}</span>
            ))}
          </div>
        </div>
        <div className="about-public-card-stack">
          {storyPoints.map((point) => (
            <article key={point.title}>
              <h3>{point.title}</h3>
              <p>{point.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="about-public-section">
        <div className="about-public-statement">
          <span className="public-eyebrow">What Meridian believes</span>
          <h2>Good software should reduce the amount of business a person has to carry in their head.</h2>
          <p>
            Meridian sends a weekly Recovery Brief that surfaces which dormant
            relationships deserve a careful follow-up, with a verified contact
            path and a restrained opener the founder can edit before sending.
          </p>
          <div className="public-hero-actions">
            <a className="public-primary-button" href={RECOVERY_SAMPLE_BRIEF_HREF}>
              See a sample brief
            </a>
            <a className="public-secondary-button" href={REQUEST_FIRST_BRIEF_HREF}>
              Request the first brief on your list
            </a>
          </div>
        </div>
      </section>
      <PublicFooter />
    </main>
  );
}
