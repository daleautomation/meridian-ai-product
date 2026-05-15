import type { CSSProperties, ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { demoBriefs } from "@/lib/outreach/demoBriefs";
import { outreachScripts, type OutreachScript } from "@/lib/outreach/scripts";
import { socialPostDrafts } from "@/lib/outreach/socialPosts";
import { readinessChecklist } from "@/lib/outreach/checklist";
import { getSession } from "@/lib/auth";
import { isAdminOperator } from "@/lib/workspaceAccess";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Outreach Readiness | Meridian Admin",
  description: "Founder-controlled outreach preparation assets for Meridian Recovery Briefs.",
};

const positioning = [
  "Start with boutique staffing and recruiting firms. They understand dormant relationships, paused searches, and timing-sensitive follow-up.",
  "Lead with Recovery Briefs as a manual founder aid: a short memo that ranks who to call, why now, and what to say first.",
  "Keep every promise modest. Meridian helps prepare better outreach; the founder still reviews, decides, calls, and sends.",
];

const firstCallScript = [
  "Hi [Name], this is [Founder] with Meridian.",
  "I am calling because many boutique firms have good relationships sitting dormant in old notes or spreadsheets, and the next follow-up gets vague.",
  "I have a short fictional Recovery Brief for staffing firms. It shows a ranked call list, why-now context, and a suggested opener for a real human call.",
  "Does that problem show up in your world with past clients, candidates, or paused searches?",
];

const pricingLanguage = [
  "Free first sample brief so the prospect can judge usefulness before any paid work.",
  "If useful, offer a fixed-scope paid pilot: one controlled CSV export, one Recovery Brief, and one review call.",
  "Quote the paid pilot before sensitive data is shared or ongoing work is implied.",
];

const objectionReminders = [
  "We already have a CRM: Great. Meridian can work from an export when the CRM has too much history and not enough next-step clarity.",
  "We do not want automated outreach: Good. Meridian does not send messages; it prepares a founder-reviewed call list and brief.",
  "Our data is messy: A small imperfect CSV is fine for a first sample as long as sensitive details are removed.",
  "Will this guarantee meetings? No. It helps choose better follow-up targets and openers; outcomes still depend on the relationship and the call.",
];

const notToClaim = [
  "Do not claim automated sending, scraping, enrichment, CRM syncing, or mass outreach.",
  "Do not claim customer traction, revenue lift, or enterprise deployment unless it is true and approved.",
  "Do not say Meridian invents context or fills gaps. If the data is thin, the brief should say so.",
  "Do not describe samples as real customer work. They are fictional/internal demos.",
];

export default async function OutreachReadinessPage() {
  const user = await getSession();
  if (!user) redirect("/login?next=/admin/outreach");
  if (!isAdminOperator(user)) {
    return <AccessDenied />;
  }

  const callScripts = selectScripts(["call-opener", "voicemail", "pricing-close"]);
  const csvScript = outreachScripts.find((script) => script.id === "csv-request");
  const deliveryScript = outreachScripts.find((script) => script.id === "brief-delivery-email");

  return (
    <main style={styles.root}>
      <section style={styles.hero}>
        <div style={styles.eyebrow}>Founder outreach readiness</div>
        <h1 style={styles.title}>Manual outreach assets for Meridian Recovery Briefs.</h1>
        <p style={styles.heroCopy}>
          A restrained preparation surface for posting demo briefs, calling prospects, and sending sample links without building outreach automation.
        </p>
        <div style={styles.heroBadges}>
          {["Manual only", "No sending tools", "No scraping", "No CRM integration"].map((label) => (
            <span style={styles.badge} key={label}>{label}</span>
          ))}
        </div>
      </section>

      <Section title="Strongest demo briefs" kicker="Catalog">
        <div style={styles.briefGrid}>
          {demoBriefs.map((brief) => (
            <article style={styles.briefCard} key={brief.briefUrl}>
              <div style={styles.cardTopline}>{brief.vertical}</div>
              <h2 style={styles.cardTitle}>{brief.title}</h2>
              <p style={styles.cardCopy}>{brief.bestUseCase}</p>
              <div style={styles.callout}>
                <strong>Strongest card</strong>
                <span>{brief.strongestCardSummary}</span>
              </div>
              <p style={styles.note}>{brief.positioningNote}</p>
              <Link href={brief.briefUrl} style={styles.linkButton}>
                Open demo brief
              </Link>
            </article>
          ))}
        </div>
      </Section>

      <Section title="Recommended first vertical" kicker="Focus">
        <div style={styles.featurePanel}>
          <h2 style={styles.panelTitle}>Boutique staffing and recruiting firms</h2>
          <p style={styles.panelCopy}>
            Start where the pain is easy to understand: warm desks, dormant client relationships, paused searches, and candidates who went quiet but may still matter.
          </p>
        </div>
      </Section>

      <TwoColumnSection
        leftTitle="Outreach positioning"
        leftItems={positioning}
        rightTitle="What NOT to claim"
        rightItems={notToClaim}
      />

      <TwoColumnSection
        leftTitle="First-call script"
        leftItems={firstCallScript}
        rightTitle="Pricing language"
        rightItems={pricingLanguage}
      />

      <Section title="Objection-handling reminders" kicker="Founder notes">
        <List items={objectionReminders} />
      </Section>

      <Section title="Social post copy blocks" kicker="Drafts">
        <div style={styles.scriptGrid}>
          {socialPostDrafts.map((post) => (
            <CopyBlock title={post.title} lines={post.draft} key={post.id} />
          ))}
        </div>
      </Section>

      <Section title="Call script blocks" kicker="Phone">
        <div style={styles.scriptGrid}>
          {callScripts.map((script) => (
            <ScriptBlock script={script} key={script.id} />
          ))}
        </div>
      </Section>

      <TwoColumnScriptSection
        leftTitle="CSV request script"
        leftScript={csvScript}
        rightTitle="Brief delivery script"
        rightScript={deliveryScript}
      />

      <Section title="Readiness QA checklist" kicker="Before posting or calling">
        <div style={styles.checklist}>
          {readinessChecklist.map((item) => (
            <article style={styles.checkItem} key={item.id}>
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
            </article>
          ))}
        </div>
      </Section>
    </main>
  );
}

function selectScripts(ids: string[]): OutreachScript[] {
  return ids.flatMap((id) => {
    const script = outreachScripts.find((item) => item.id === id);
    return script ? [script] : [];
  });
}

function Section({ title, kicker, children }: { title: string; kicker: string; children: ReactNode }) {
  return (
    <section style={styles.section}>
      <div style={styles.sectionHeading}>
        <span style={styles.eyebrow}>{kicker}</span>
        <h2 style={styles.sectionTitle}>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function TwoColumnSection({
  leftTitle,
  leftItems,
  rightTitle,
  rightItems,
}: {
  leftTitle: string;
  leftItems: string[];
  rightTitle: string;
  rightItems: string[];
}) {
  return (
    <section style={styles.twoColumn}>
      <InfoPanel title={leftTitle} items={leftItems} />
      <InfoPanel title={rightTitle} items={rightItems} />
    </section>
  );
}

function TwoColumnScriptSection({
  leftTitle,
  leftScript,
  rightTitle,
  rightScript,
}: {
  leftTitle: string;
  leftScript?: OutreachScript;
  rightTitle: string;
  rightScript?: OutreachScript;
}) {
  return (
    <section style={styles.twoColumn}>
      {leftScript ? <ScriptBlock script={{ ...leftScript, title: leftTitle }} /> : null}
      {rightScript ? <ScriptBlock script={{ ...rightScript, title: rightTitle }} /> : null}
    </section>
  );
}

function InfoPanel({ title, items }: { title: string; items: string[] }) {
  return (
    <article style={styles.panel}>
      <h2 style={styles.panelTitle}>{title}</h2>
      <List items={items} />
    </article>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul style={styles.list}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function ScriptBlock({ script }: { script: OutreachScript }) {
  return (
    <article style={styles.copyBlock}>
      <div style={styles.cardTopline}>{script.channel}</div>
      <h3 style={styles.copyBlockTitle}>{script.title}</h3>
      <p style={styles.note}>{script.intent}</p>
      <div style={styles.scriptBody}>
        {script.body.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </article>
  );
}

function CopyBlock({ title, lines }: { title: string; lines: string[] }) {
  return (
    <article style={styles.copyBlock}>
      <h3 style={styles.copyBlockTitle}>{title}</h3>
      <div style={styles.scriptBody}>
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </article>
  );
}

function AccessDenied() {
  return (
    <main style={styles.root}>
      <section style={styles.hero}>
        <div style={styles.eyebrow}>Admin</div>
        <h1 style={styles.title}>Access denied</h1>
        <p style={styles.heroCopy}>Founder/admin access is required for outreach readiness assets.</p>
      </section>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  root: {
    minHeight: "100dvh",
    background: "#F8FAFC",
    color: "#0F172A",
    padding: "32px 20px 64px",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', sans-serif",
  },
  hero: {
    maxWidth: "1080px",
    margin: "0 auto 18px",
    border: "1px solid #E2E8F0",
    borderRadius: "22px",
    background: "#FFFFFF",
    padding: "30px",
    boxShadow: "0 18px 50px rgba(15, 23, 42, 0.06)",
  },
  eyebrow: {
    color: "#64748B",
    fontSize: "11px",
    fontWeight: 850,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
  },
  title: {
    maxWidth: "840px",
    margin: "8px 0 12px",
    fontSize: "clamp(36px, 6vw, 62px)",
    lineHeight: 0.96,
    letterSpacing: "-0.055em",
  },
  heroCopy: {
    maxWidth: "760px",
    margin: 0,
    color: "#475569",
    fontSize: "16px",
    lineHeight: 1.65,
  },
  heroBadges: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    marginTop: "22px",
  },
  badge: {
    border: "1px solid #CBD5E1",
    borderRadius: "999px",
    background: "#F8FAFC",
    color: "#334155",
    padding: "8px 10px",
    fontSize: "12px",
    fontWeight: 800,
  },
  section: {
    maxWidth: "1080px",
    margin: "18px auto 0",
    border: "1px solid #E2E8F0",
    borderRadius: "18px",
    background: "#FFFFFF",
    padding: "24px",
  },
  sectionHeading: {
    marginBottom: "16px",
  },
  sectionTitle: {
    margin: "6px 0 0",
    fontSize: "28px",
    letterSpacing: "-0.035em",
  },
  briefGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
    gap: "14px",
  },
  briefCard: {
    display: "grid",
    alignContent: "start",
    gap: "12px",
    border: "1px solid #E2E8F0",
    borderRadius: "16px",
    background: "#FAFBFC",
    padding: "18px",
  },
  cardTopline: {
    color: "#64748B",
    fontSize: "11px",
    fontWeight: 850,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  cardTitle: {
    margin: 0,
    fontSize: "22px",
    lineHeight: 1.1,
    letterSpacing: "-0.03em",
  },
  cardCopy: {
    margin: 0,
    color: "#475569",
    fontSize: "14px",
    lineHeight: 1.55,
  },
  callout: {
    display: "grid",
    gap: "5px",
    borderLeft: "3px solid #2563EB",
    paddingLeft: "12px",
    color: "#1E293B",
    fontSize: "13px",
    lineHeight: 1.45,
  },
  note: {
    margin: 0,
    color: "#64748B",
    fontSize: "13px",
    lineHeight: 1.5,
  },
  linkButton: {
    display: "inline-flex",
    width: "fit-content",
    marginTop: "4px",
    borderRadius: "999px",
    background: "#0F172A",
    color: "#FFFFFF",
    padding: "10px 14px",
    fontSize: "13px",
    fontWeight: 800,
    textDecoration: "none",
  },
  featurePanel: {
    border: "1px solid #BFDBFE",
    borderRadius: "16px",
    background: "#EFF6FF",
    padding: "18px",
  },
  panel: {
    border: "1px solid #E2E8F0",
    borderRadius: "18px",
    background: "#FFFFFF",
    padding: "22px",
  },
  panelTitle: {
    margin: "0 0 10px",
    fontSize: "22px",
    letterSpacing: "-0.03em",
  },
  panelCopy: {
    margin: 0,
    color: "#334155",
    fontSize: "15px",
    lineHeight: 1.6,
  },
  twoColumn: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
    gap: "18px",
    maxWidth: "1080px",
    margin: "18px auto 0",
  },
  list: {
    display: "grid",
    gap: "10px",
    margin: 0,
    paddingLeft: "20px",
    color: "#334155",
    fontSize: "14px",
    lineHeight: 1.55,
  },
  scriptGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: "14px",
  },
  copyBlock: {
    display: "grid",
    gap: "10px",
    border: "1px solid #E2E8F0",
    borderRadius: "16px",
    background: "#FAFBFC",
    padding: "18px",
  },
  copyBlockTitle: {
    margin: 0,
    fontSize: "20px",
    letterSpacing: "-0.025em",
  },
  scriptBody: {
    display: "grid",
    gap: "10px",
    color: "#1E293B",
    fontSize: "14px",
    lineHeight: 1.55,
  },
  checklist: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
    gap: "12px",
  },
  checkItem: {
    display: "grid",
    gap: "6px",
    border: "1px solid #E2E8F0",
    borderRadius: "14px",
    background: "#FAFBFC",
    padding: "14px",
    color: "#334155",
    fontSize: "13px",
    lineHeight: 1.45,
  },
};
