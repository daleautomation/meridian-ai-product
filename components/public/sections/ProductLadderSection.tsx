import { SectionCta } from "@/components/public/ui/SectionCta";
import { SectionIntro } from "@/components/public/ui/SectionIntro";
import {
  productLadderGroups,
  REQUEST_WORKSPACE_HREF,
  VISIBILITY_SCAN_HREF,
} from "@/content/public/home";

export function ProductLadderSection() {
  return (
    <section id="plans" className="public-section">
      <SectionIntro
        eyebrow="Product ladder"
        title="Simple offers that grow from scan to workspace."
        text="Every Meridian product connects back to relationship execution and revenue movement, from the first recovery scan to a custom operator system."
      />
      <div className="public-ladder-grid">
        {productLadderGroups.map((group) => (
          <article className="public-ladder-card" key={group.tier}>
            <span>{group.tier}</span>
            <p>{group.text}</p>
            <ul>
              {group.products.map((product) => (
                <li key={product}>{product}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
      <SectionCta
        eyebrow="Commercial path"
        text="Start with a focused scan, then build the smallest useful workspace around the relationships that can move revenue."
        primaryHref={VISIBILITY_SCAN_HREF}
        primaryLabel="Start with a Scan"
        secondaryHref={REQUEST_WORKSPACE_HREF}
        secondaryLabel="Request Workspace"
      />
    </section>
  );
}
