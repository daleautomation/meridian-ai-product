import Link from "next/link";

const REQUEST_DEMO_HREF =
  "mailto:hello@meridian.ai?subject=Meridian%20workspace%20demo";
const START_AUDIT_HREF =
  "mailto:hello@meridian.ai?subject=Meridian%20AI%20business%20audit";
const CLIENT_LOGIN_HREF = "/login?next=/operator";

const services = [
  {
    title: "AI Business Audit",
    text: "A focused review of where decisions, handoffs, and follow-up lose money.",
  },
  {
    title: "Lead Quality & Revenue Audit",
    text: "Find the leads worth pursuing, the ones draining time, and the gaps between both.",
  },
  {
    title: "Website + Conversion Audit",
    text: "Turn public traffic into cleaner actions, stronger intake, and better sales context.",
  },
  {
    title: "Sales Workflow Audit",
    text: "Map how opportunities move from first signal to close, then remove the friction.",
  },
  {
    title: "Custom Meridian Workspace Build",
    text: "A private command center shaped around your data, pipeline, team, and execution rules.",
  },
  {
    title: "AI Automation & Operator Systems",
    text: "Practical automations that route work, prepare calls, summarize context, and track outcomes.",
  },
  {
    title: "Client Portal / Internal Dashboard Buildout",
    text: "Client-facing or internal dashboards that make status, ownership, and next actions obvious.",
  },
] as const;

// Edit audit pricing and package copy here. The page renders from this data only.
const auditTiers = [
  {
    name: "Starter Audit",
    price: "$250",
    bestFor: "Quick website, workflow, or lead-quality review.",
    points: ["Signal scan", "Priority fixes", "Next-step memo"],
  },
  {
    name: "Growth Audit",
    price: "$750",
    bestFor: "Deeper review of lead flow, customer journey, CRM gaps, and revenue leaks.",
    points: ["Journey map", "Leak diagnosis", "Workspace roadmap"],
  },
  {
    name: "Operator Audit",
    price: "$1,500+",
    bestFor: "Full operational intelligence review for teams ready to systemize execution.",
    points: ["Automation plan", "Dashboard spec", "Custom build path"],
  },
] as const;

const workspaceAudiences = [
  "Agencies",
  "Real estate teams",
  "Contractors",
  "Service businesses",
  "Sales teams",
  "Founders",
  "Operations teams",
] as const;

const workspaceExamples = [
  "LaborTech-style lead execution workspace",
  "Brookside real estate deal workspace",
  "Founder command center",
  "Revenue attribution workspace",
  "Client operations dashboard",
] as const;

const platformModules = [
  "Lead Intelligence",
  "Closeability Scoring",
  "Deep Reports",
  "Call Planning",
  "Revenue Attribution",
  "Contact Verification",
  "Workflow Automation",
  "Client Portal",
] as const;

const operatingSteps = [
  "Audit the business",
  "Identify the revenue leaks",
  "Build the workspace",
  "Train the operator flow",
  "Track execution and outcomes",
] as const;

function SectionIntro({
  eyebrow,
  title,
  text,
}: {
  eyebrow: string;
  title: string;
  text: string;
}) {
  return (
    <div className="public-section-intro">
      <span className="public-eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}

export default function MeridianPublicPage() {
  return (
    <main className="public-site">
      <header className="public-header">
        <Link className="public-brand" href="/" aria-label="Meridian AI home">
          <span className="public-brand-mark">M</span>
          <span>Meridian AI</span>
        </Link>
        <nav className="public-nav" aria-label="Meridian website navigation">
          <a href="#services">Services</a>
          <a href="#audits">Audits</a>
          <a href="#workspaces">Workspaces</a>
          <a href="#platform">Platform</a>
          <a href="#about">About</a>
        </nav>
        <div className="public-header-actions">
          <a className="public-link-button" href={REQUEST_DEMO_HREF}>
            Request Demo
          </a>
          <Link className="public-login-button" href={CLIENT_LOGIN_HREF}>
            Client Login
          </Link>
        </div>
      </header>

      <section className="public-hero">
        <div className="public-hero-copy">
          <span className="public-eyebrow">Operator-grade intelligence</span>
          <h1>Operator-grade intelligence systems for modern businesses.</h1>
          <p>
            Meridian AI audits your operation, identifies revenue leaks, and
            builds custom AI-powered workspaces that help your team know what to
            do next.
          </p>
          <div className="public-hero-actions">
            <a className="public-primary-button" href={START_AUDIT_HREF}>
              Start with an Audit
            </a>
            <a className="public-secondary-button" href={REQUEST_DEMO_HREF}>
              Request a Workspace Demo
            </a>
          </div>
        </div>
        <div className="public-hero-panel" aria-label="Meridian platform preview">
          <div className="public-panel-topline">
            <span>Meridian workspace</span>
            <strong>Live operating view</strong>
          </div>
          <div className="public-signal-card public-signal-card-primary">
            <span>Lead quality</span>
            <strong>High-intent accounts first</strong>
            <p>Score, route, and prepare outreach from one execution queue.</p>
          </div>
          <div className="public-panel-grid">
            {["Revenue leaks", "Call plan", "Owner", "Next action"].map((item) => (
              <div key={item}>
                <span>{item}</span>
                <strong>{item === "Owner" ? "Assigned" : "Ready"}</strong>
              </div>
            ))}
          </div>
          <div className="public-panel-footer">
            <span className="public-live-dot" />
            Audit insight converted to operator workflow
          </div>
        </div>
      </section>

      <section id="services" className="public-section">
        <SectionIntro
          eyebrow="Services"
          title="Modular services that become one operating system."
          text="Start with a focused business problem, then connect the findings into a workspace your team can run every day."
        />
        <div className="public-service-grid">
          {services.map((service) => (
            <article className="public-card" key={service.title}>
              <span className="public-card-index">
                {String(services.indexOf(service) + 1).padStart(2, "0")}
              </span>
              <h3>{service.title}</h3>
              <p>{service.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="audits" className="public-section public-audit-section">
        <SectionIntro
          eyebrow="Audits"
          title="Start with a focused audit."
          text="Walk away with a clear diagnosis, priority fixes, and a roadmap for turning your business into an operator-grade system."
        />
        <div className="public-audit-grid">
          {auditTiers.map((tier) => (
            <article className="public-pricing-card" key={tier.name}>
              <div>
                <span>{tier.name}</span>
                <strong>{tier.price}</strong>
              </div>
              <p>{tier.bestFor}</p>
              <ul>
                {tier.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section id="workspaces" className="public-section public-split-section">
        <div>
          <span className="public-eyebrow">Workspaces</span>
          <h2>Personalized command centers for teams that execute.</h2>
          <p>
            Meridian workspaces are built around the way each business sells,
            services clients, tracks ownership, and measures outcomes.
          </p>
          <div className="public-pill-row">
            {workspaceAudiences.map((audience) => (
              <span key={audience}>{audience}</span>
            ))}
          </div>
        </div>
        <div className="public-example-stack">
          {workspaceExamples.map((example) => (
            <div key={example}>
              <span className="public-live-dot" />
              {example}
            </div>
          ))}
        </div>
      </section>

      <section id="platform" className="public-section">
        <SectionIntro
          eyebrow="Platform"
          title="A unified intelligence layer for cleaner execution."
          text="Meridian organizes the signals, decisions, and next actions that operators need without adding another noisy dashboard."
        />
        <div className="public-module-grid">
          {platformModules.map((module) => (
            <div key={module}>
              <span />
              {module}
            </div>
          ))}
        </div>
      </section>

      <section className="public-section public-process-section">
        <SectionIntro
          eyebrow="How Meridian works"
          title="From diagnosis to daily operating rhythm."
          text="The work begins with evidence, turns into a practical system, and keeps improving as your team executes."
        />
        <ol className="public-process-list">
          {operatingSteps.map((step, index) => (
            <li key={step}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{step}</strong>
            </li>
          ))}
        </ol>
      </section>

      <section id="about" className="public-section public-about-section">
        <div>
          <span className="public-eyebrow">About</span>
          <h2>Founder-led, operator-focused, practical.</h2>
        </div>
        <p>
          Meridian is built from real workflow problems: missed follow-up,
          unclear priorities, scattered lead context, and teams guessing what to
          do next. The product philosophy is simple: fewer abstractions, better
          decisions, cleaner execution, measurable outcomes.
        </p>
      </section>

      <section className="public-final-cta">
        <span className="public-eyebrow">Ready when the operation is</span>
        <h2>Start with an audit or request a custom workspace demo.</h2>
        <div className="public-hero-actions">
          <a className="public-primary-button" href={START_AUDIT_HREF}>
            Start with an Audit
          </a>
          <a className="public-secondary-button" href={REQUEST_DEMO_HREF}>
            Request Demo
          </a>
        </div>
      </section>

      <footer className="public-footer">
        <span>Meridian AI</span>
        <span>Operator-grade intelligence systems.</span>
        <Link href={CLIENT_LOGIN_HREF}>Client Login</Link>
      </footer>
    </main>
  );
}
