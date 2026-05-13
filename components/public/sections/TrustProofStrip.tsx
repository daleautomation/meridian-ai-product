import { trustProofPoints } from "@/content/public/home";

export function TrustProofStrip() {
  return (
    <section className="public-trust-strip" aria-label="Meridian trust proof">
      {trustProofPoints.map((point) => (
        <span key={point}>{point}</span>
      ))}
    </section>
  );
}
