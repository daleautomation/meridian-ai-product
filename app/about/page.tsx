import type { Metadata } from "next";
import { PublicFooter } from "@/components/public/layout/PublicFooter";
import { PublicHeader } from "@/components/public/layout/PublicHeader";
import { REQUEST_WORKSPACE_HREF, SHOWCASE_HREF, VISIBILITY_SCAN_HREF } from "@/content/public/home";

export const metadata: Metadata = {
  title: "About Meridian | Relationship Priority and Operator Systems",
  description:
    "Meridian is a founder-led relationship-priority and execution company building practical software for revenue clarity, workflow simplification, and operator focus.",
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
    title: "The work became relationship execution.",
    text: "Solving operational problems became the part worth building around: relationship priority, stale opportunity recovery, follow-up execution, workspace generation, and calm operator surfaces.",
  },
  {
    title: "The systems should help both sides succeed.",
    text: "Meridian builds tools that improve its own operating rhythm while giving clients practical systems they can use to recover revenue and execute with less confusion.",
  },
] as const;

const principles = [
  "Practical software over AI hype",
  "Revenue clarity over dashboard volume",
  "Operator judgment over black-box automation",
  "Workflow simplification over tool sprawl",
] as const;

export default function About() {
  return (
    <main className="public-site about-public-page">
      <PublicHeader />
      <section className="about-public-hero">
        <span className="public-eyebrow">About Meridian</span>
        <h1>Built by following operational problems until they became software.</h1>
        <p>
          Meridian is a founder-led relationship-priority and execution company.
          It grew from construction experience, systems thinking, and a practical
          curiosity about how software can make real business work calmer,
          clearer, and more commercially useful.
        </p>
      </section>

      <section className="about-public-section about-public-split">
        <div>
          <span className="public-eyebrow">Founder-led and operator-minded</span>
          <h2>Meridian is not trying to be an AI spectacle.</h2>
          <p>
            The work is grounded: help businesses see which relationships matter,
            why now, and what should happen next. The product should help
            Meridian run better and help clients recover revenue from the
            relationships they already own.
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
            Meridian builds toward simple execution surfaces: relationship queues,
            recovery desks, demo systems, and workspaces that translate messy
            operations into clear next moves.
          </p>
          <div className="public-hero-actions">
            <a className="public-primary-button" href={VISIBILITY_SCAN_HREF}>
              Start with a Priority Scan
            </a>
            <a className="public-secondary-button" href={SHOWCASE_HREF}>
              View Showcase
            </a>
            <a className="public-secondary-button" href={REQUEST_WORKSPACE_HREF}>
              Request Workspace
            </a>
          </div>
        </div>
      </section>
      <PublicFooter />
    </main>
  );
}
