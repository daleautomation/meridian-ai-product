import { SectionCta } from "@/components/public/ui/SectionCta";
import { SectionIntro } from "@/components/public/ui/SectionIntro";
import {
  coreMeridianCategories,
  REQUEST_WORKSPACE_HREF,
  VISIBILITY_SCAN_HREF,
} from "@/content/public/home";

export function CoreCategoriesSection() {
  return (
    <section id="solutions" className="public-section">
      <SectionIntro
        eyebrow="Two ways Meridian creates value"
        title="Relationships are the work. Revenue is the reason."
        text="Meridian focuses on practical systems that help businesses maintain, prioritize, recover, and execute on the relationships most likely to move revenue."
      />
      <div className="public-category-grid">
        {coreMeridianCategories.map((category) => (
          <article className="public-category-card" key={category.title}>
            <span>{category.title}</span>
            <p>{category.description}</p>
            <ul>
              {category.outcomes.map((outcome) => (
                <li key={outcome}>{outcome}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
      <SectionCta
        eyebrow="Start with clarity"
        text="Meridian begins by showing which relationships matter, why now, and what should happen next."
        primaryHref={VISIBILITY_SCAN_HREF}
        primaryLabel="Get a Priority Scan"
        secondaryHref={REQUEST_WORKSPACE_HREF}
        secondaryLabel="Request Workspace"
      />
    </section>
  );
}
