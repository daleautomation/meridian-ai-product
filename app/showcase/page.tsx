import type { Metadata } from "next";
import Link from "next/link";
import { PublicFooter } from "@/components/public/layout/PublicFooter";
import { PublicHeader } from "@/components/public/layout/PublicHeader";
import {
  getShowcasePath,
  SHOWCASE_DEMOS,
  SHOWCASE_GROUPS,
  type ShowcaseDemo,
} from "@/lib/relationship-priority/showcaseCatalog";
import { CopyShowcaseLinkButton } from "./CopyShowcaseLinkButton";

export const metadata: Metadata = {
  title: "Meridian Showcase Demo Library",
  description:
    "Clean Meridian showcase demos for TikTok content, outreach, onboarding, sales, positioning, and relationship-priority demo generation.",
};

export default function ShowcaseLibraryPage() {
  return (
    <main className="public-site showcase-library-page">
      <PublicHeader />
      <section className="showcase-library-hero">
        <div className="public-eyebrow">Showcase Demo Library</div>
        <h1>Clean demo routes for relationship-priority content.</h1>
        <p>
          One reusable Meridian workspace, packaged into screen-recordable demos for vertical positioning,
          tactical outreach, onboarding, and sales storytelling.
        </p>
        <div className="showcase-library-proof">
          <span>Who matters</span>
          <span>Why now</span>
          <span>What next</span>
          <span>Clutter to clarity</span>
        </div>
      </section>

      <section className="showcase-library-system" aria-label="Showcase system">
        <article>
          <span>Reusable core</span>
          <strong>Relationship-priority engine</strong>
          <p>Clean URLs translate into showcase configs. The workspace, overlays, presets, and demo session redirects stay shared.</p>
        </article>
        <article>
          <span>Content-ready</span>
          <strong>9:16 safe storytelling</strong>
          <p>Each demo centers a dominant relationship, why-now explanation, and next operator action for short-form recording.</p>
        </article>
        <article>
          <span>Premium motion</span>
          <strong>Cinematic queue hierarchy</strong>
          <p>Orange/blue accents, before/after panels, and execution-compression copy preserve the Meridian visual language.</p>
        </article>
      </section>

      {SHOWCASE_GROUPS.map((group) => {
        const demos = SHOWCASE_DEMOS.filter((demo) => demo.category === group.id);
        return (
          <section className="showcase-library-section" key={group.id}>
            <div className="showcase-library-section-heading">
              <span>{group.label}</span>
              <p>{group.description}</p>
            </div>
            <div className="showcase-demo-grid">
              {demos.map((demo) => (
                <ShowcaseDemoCard demo={demo} key={demo.id} />
              ))}
            </div>
          </section>
        );
      })}

      <PublicFooter />
    </main>
  );
}

function ShowcaseDemoCard({ demo }: { demo: ShowcaseDemo }) {
  const path = getShowcasePath(demo);
  return (
    <article className="showcase-demo-card">
      <div className="showcase-demo-card-topline">
        <span>{demo.verticalName}</span>
        <strong>{demo.presetName}</strong>
      </div>
      <h2>{demo.angle}</h2>
      <p>{demo.description}</p>
      <div className="showcase-demo-signals" aria-label={`${demo.title} signals`}>
        {demo.signals.map((signal) => (
          <span key={signal}>{signal}</span>
        ))}
      </div>
      <div className="showcase-demo-storyline">
        <div>
          <span>Who</span>
          <strong>Highest-value relationship</strong>
        </div>
        <div>
          <span>Why</span>
          <strong>Live timing signal</strong>
        </div>
        <div>
          <span>Next</span>
          <strong>One clear action</strong>
        </div>
      </div>
      <div className="showcase-demo-actions">
        <Link className="showcase-open-button" href={path}>
          Open Demo
        </Link>
        <CopyShowcaseLinkButton path={path} />
      </div>
    </article>
  );
}
