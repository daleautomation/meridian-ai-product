import {
  REQUEST_ROOFING_DEMO_HREF,
  ROOFING_STRATEGY_CALL_HREF,
  ROOFING_VISIBILITY_SCAN_HREF,
  roofingAvailableSignals,
  roofingContractorUses,
  roofingExecutionWorkflow,
  roofingFutureSignals,
  roofingHero,
  roofingOperatorPoints,
  roofingOpportunityWorkflow,
  roofingPainPoints,
  roofingRoadmapConcepts,
  roofingVisualWorkflow,
} from "@/content/public/roofing";

function RoofingSectionIntro({
  eyebrow,
  title,
  text,
}: {
  eyebrow: string;
  title: string;
  text: string;
}) {
  return (
    <div className="roofing-section-intro">
      <span className="public-eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}

export function RoofingHeroSection() {
  return (
    <section className="roofing-hero">
      <div className="roofing-hero-copy">
        <span className="public-eyebrow">{roofingHero.eyebrow}</span>
        <h1>{roofingHero.title}</h1>
        <p>{roofingHero.text}</p>
        <div className="public-hero-actions">
          <a className="public-primary-button" href={REQUEST_ROOFING_DEMO_HREF}>
            Request Roofing Demo
          </a>
          <a className="public-secondary-button" href={ROOFING_VISIBILITY_SCAN_HREF}>
            Get Visibility Scan
          </a>
        </div>
        <div className="roofing-proof-row" aria-label="Roofing Lead Finder proof points">
          {roofingHero.proof.map((point) => (
            <span key={point}>{point}</span>
          ))}
        </div>
      </div>
      <div className="roofing-hero-map" aria-label="Roofing opportunity map preview">
        <div className="roofing-map-header">
          <span>Opportunity desk</span>
          <strong>Operator view</strong>
        </div>
        <div className="roofing-map-grid">
          <span className="roofing-map-zone roofing-map-zone-hot">Dense reviews gap</span>
          <span className="roofing-map-zone">Weak website path</span>
          <span className="roofing-map-zone roofing-map-zone-priority">Priority route</span>
          <span className="roofing-map-zone">Follow-up risk</span>
          <span className="roofing-map-zone roofing-map-zone-ready">Owner ready</span>
          <span className="roofing-map-zone">Visibility scan</span>
        </div>
        <div className="roofing-map-action">
          <span className="public-live-dot" />
          High-probability areas become assigned work, not just a report.
        </div>
      </div>
    </section>
  );
}

export function RoofingPainPointsSection() {
  return (
    <section id="roofing-pain-points" className="roofing-section">
      <RoofingSectionIntro
        eyebrow="Roofing pain points"
        title="Most growth waste starts before the first knock, call, or estimate."
        text="Roofing teams lose time when they cannot see which streets, signals, and follow-up moments deserve attention now."
      />
      <div className="roofing-card-grid">
        {roofingPainPoints.map((point) => (
          <article className="roofing-card" key={point.title}>
            <h3>{point.title}</h3>
            <p>{point.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function RoofingOpportunityWorkflowSection() {
  return (
    <section id="roofing-workflow" className="roofing-section roofing-workflow-section">
      <RoofingSectionIntro
        eyebrow="Opportunity intelligence workflow"
        title="From local signal to operator action."
        text="Meridian keeps the workflow practical: find the signal, rank the work, route the next step, and keep ownership visible."
      />
      <div className="roofing-workflow-line" aria-label="Roofing opportunity intelligence workflow">
        {roofingOpportunityWorkflow.map((step) => (
          <article className="roofing-workflow-step" key={step.stage}>
            <span>{step.stage}</span>
            <h3>{step.title}</h3>
            <p>{step.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function RoofingSignalsSection() {
  return (
    <section id="roofing-signals" className="roofing-section roofing-signals-section">
      <RoofingSectionIntro
        eyebrow="Signals Meridian looks for"
        title="The first version focuses on visible, actionable contractor signals."
        text="Available signals are separated from roadmap concepts so the funnel stays honest about what is live now."
      />
      <div className="roofing-signal-columns">
        <article className="roofing-signal-column">
          <span>Available now</span>
          <h3>Operational and visibility signals</h3>
          <ul>
            {roofingAvailableSignals.map((signal) => (
              <li key={signal}>{signal}</li>
            ))}
          </ul>
        </article>
        <article className="roofing-signal-column roofing-signal-column-roadmap">
          <span>Future roadmap concepts</span>
          <h3>Property and storm intelligence targets</h3>
          <ul>
            {roofingFutureSignals.map((signal) => (
              <li key={signal}>{signal}</li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  );
}

export function RoofingContractorUseSection() {
  return (
    <section id="contractor-use" className="roofing-section">
      <RoofingSectionIntro
        eyebrow="How contractors use Meridian"
        title="The point is not more data. The point is cleaner daily execution."
        text="Roofing operators use the intelligence layer to decide where to focus, who owns follow-up, and what should move next."
      />
      <div className="roofing-use-grid">
        {roofingContractorUses.map((use) => (
          <article className="roofing-use-card" key={use.title}>
            <h3>{use.title}</h3>
            <p>{use.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function RoofingVisualWorkflowSection() {
  return (
    <section id="roofing-visual-workflow" className="roofing-section">
      <RoofingSectionIntro
        eyebrow="Visual workflow"
        title="A lightweight operating loop for roofing opportunity work."
        text="The visual system stays CSS-driven and simple: signal detection, prioritization, routing, and operator action."
      />
      <div className="roofing-visual-flow" aria-label="Roofing Lead Finder visual workflow">
        {roofingVisualWorkflow.map((item, index) => (
          <article className="roofing-flow-card" key={item.label}>
            <span>{String(index + 1).padStart(2, "0")} / {item.label}</span>
            <h3>{item.title}</h3>
            <p>{item.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function RoofingLeadExecutionSection() {
  return (
    <section id="lead-execution" className="roofing-section roofing-execution-section">
      <div>
        <span className="public-eyebrow">Lead execution workflow</span>
        <h2>Opportunity intelligence only matters when it changes the workday.</h2>
        <p>
          Meridian turns scans and local signals into a ranked execution path:
          where to look, who owns the next step, and how follow-up should keep moving.
        </p>
      </div>
      <ol className="roofing-execution-list">
        {roofingExecutionWorkflow.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </section>
  );
}

export function RoofingBuiltForOperatorsSection() {
  return (
    <section id="built-for-operators" className="roofing-section">
      <RoofingSectionIntro
        eyebrow="Built for operators"
        title="Built from the field side of the problem, not from a marketing playbook."
        text="Roofing Lead Finder is positioned around operational clarity, cleaner handoffs, and simpler execution systems for contractors."
      />
      <div className="roofing-card-grid">
        {roofingOperatorPoints.map((point) => (
          <article className="roofing-card" key={point.title}>
            <h3>{point.title}</h3>
            <p>{point.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function RoofingRoadmapSection() {
  return (
    <section id="roofing-roadmap" className="roofing-section">
      <RoofingSectionIntro
        eyebrow="Future roadmap concepts"
        title="Property and weather intelligence are roadmap concepts, not current claims."
        text="These concepts show where the product can deepen as integrations and data sources are validated."
      />
      <div className="roofing-card-grid">
        {roofingRoadmapConcepts.map((concept) => (
          <article className="roofing-card roofing-roadmap-card" key={concept.title}>
            <h3>{concept.title}</h3>
            <p>{concept.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function RoofingCtaSection() {
  return (
    <section id="roofing-cta" className="roofing-final-cta">
      <span className="public-eyebrow">Start the roofing funnel</span>
      <h2>Get a tactical view of where your next roofing opportunities may be hiding.</h2>
      <p>
        Start with a demo, a strategy call, or a visibility scan focused on local roofing growth and lead execution.
      </p>
      <div className="public-hero-actions">
        <a className="public-primary-button" href={REQUEST_ROOFING_DEMO_HREF}>
          Request Roofing Demo
        </a>
        <a className="public-secondary-button" href={ROOFING_STRATEGY_CALL_HREF}>
          Book Strategy Call
        </a>
        <a className="public-secondary-button" href={ROOFING_VISIBILITY_SCAN_HREF}>
          Get Visibility Scan
        </a>
      </div>
    </section>
  );
}
