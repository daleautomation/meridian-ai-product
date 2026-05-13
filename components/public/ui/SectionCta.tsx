export function SectionCta({
  eyebrow,
  text,
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
}: {
  eyebrow: string;
  text: string;
  primaryHref: string;
  primaryLabel: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}) {
  return (
    <div className="public-section-cta">
      <div>
        <span>{eyebrow}</span>
        <p>{text}</p>
      </div>
      <div className="public-section-cta-actions">
        <a className="public-primary-button" href={primaryHref}>
          {primaryLabel}
        </a>
        {secondaryHref && secondaryLabel ? (
          <a className="public-secondary-button" href={secondaryHref}>
            {secondaryLabel}
          </a>
        ) : null}
      </div>
    </div>
  );
}
