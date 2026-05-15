import Link from "next/link";
import { notFound } from "next/navigation";
import { getIntakeFlow } from "@/content/public/intake";
import { PublicFooter } from "@/components/public/layout/PublicFooter";
import { PublicHeader } from "@/components/public/layout/PublicHeader";
import { MeridianIntakeForm } from "@/components/public/intake/MeridianIntakeForm";
import { isIntakeType, toLeadSource } from "@/lib/intake/types";

export default async function IntakePage({
  params,
  searchParams,
}: {
  params: Promise<{ type: string }>;
  searchParams?: Promise<{ source?: string | string[] }>;
}) {
  const { type } = await params;
  if (!isIntakeType(type)) notFound();

  const flow = getIntakeFlow(type);
  const query = (await searchParams) ?? {};
  const sourceParam = Array.isArray(query.source) ? query.source[0] : query.source;
  const leadSource = toLeadSource(sourceParam ?? flow.leadSource);

  return (
    <main className="public-site public-intake-page">
      <PublicHeader />
      <section className="public-section public-intake-shell">
        <div className="public-intake-copy">
          <Link className="public-intake-back" href="/">
            Meridian AI
          </Link>
          <span className="public-eyebrow">{flow.eyebrow}</span>
          <h1>{flow.title}</h1>
          <p>{flow.text}</p>
          <div className="public-intake-queue-card">
            <span>{flow.queueLabel}</span>
            <strong>{flow.pendingLabel}</strong>
            <ul>
              {flow.reviewBullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          </div>
        </div>
        <MeridianIntakeForm flow={flow} leadSource={leadSource} />
      </section>
      <PublicFooter />
    </main>
  );
}
