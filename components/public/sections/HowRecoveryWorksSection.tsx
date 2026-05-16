const recoverySteps = [
  {
    stage: "01",
    title: "Export a founder-controlled CSV",
    text: "Start with old clients, candidates, prospects, referral partners, or paused conversations the firm already owns.",
  },
  {
    stage: "02",
    title: "Receive the weekly Recovery Brief",
    text: "Meridian prepares a short brief for review, focused on the relationships worth reopening now.",
  },
  {
    stage: "03",
    title: "Review the reason and contact path",
    text: "Each item shows who to reopen, why now, what to say, and the verified path back to the person.",
  },
  {
    stage: "04",
    title: "Execute outreach manually",
    text: "The founder edits the note, chooses the channel, and sends the outreach without automated sending.",
  },
] as const;

export function HowRecoveryWorksSection() {
  return (
    <section id="how-recovery-works" className="public-section public-process-section">
      <div className="public-section-intro">
        <span className="public-eyebrow">How recovery works</span>
        <h2>Simple enough to trust. Specific enough to act on.</h2>
        <p>
          The workflow is intentionally manual: a controlled export, a weekly
          brief, founder review, and careful outreach from the person who owns
          the relationship.
        </p>
      </div>
      <ol className="public-process-list public-recovery-process-list">
        {recoverySteps.map((step) => (
          <li key={step.stage}>
            <span>{step.stage}</span>
            <strong>{step.title}</strong>
            <p>{step.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
