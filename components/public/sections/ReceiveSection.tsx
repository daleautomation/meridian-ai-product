import { SectionCta } from "@/components/public/ui/SectionCta";
import { SectionIntro } from "@/components/public/ui/SectionIntro";
import {
  receiveGroups,
  REQUEST_DEMO_HREF,
  START_AUDIT_HREF,
} from "@/content/public/home";

export function ReceiveSection() {
  return (
    <section id="receive" className="public-section public-receive-section">
      <SectionIntro
        eyebrow="What you actually receive"
        title="Concrete operating assets, not vague AI recommendations."
        text="Audits and builds turn into the infrastructure your team needs to prioritize, route, brief, execute, report, and attribute work."
      />
      <div className="public-receive-grid">
        {receiveGroups.map((group) => (
          <article className="public-receive-card" key={group.title}>
            <div>
              <span>{group.title}</span>
              <p>{group.text}</p>
            </div>
            <ul>
              {group.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
      <SectionCta
        eyebrow="Build path"
        text="Use an audit to define the system, then build the workspace around your real operating rhythm."
        primaryHref={START_AUDIT_HREF}
        primaryLabel="Start Audit"
        secondaryHref={REQUEST_DEMO_HREF}
        secondaryLabel="Request Workspace Demo"
      />
    </section>
  );
}
