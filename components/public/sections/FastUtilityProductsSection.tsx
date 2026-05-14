import { SectionCta } from "@/components/public/ui/SectionCta";
import { SectionIntro } from "@/components/public/ui/SectionIntro";
import {
  fastUtilityProducts,
  REQUEST_WORKSPACE_HREF,
  VISIBILITY_SCAN_HREF,
} from "@/content/public/home";

export function FastUtilityProductsSection() {
  return (
    <section id="utility-products" className="public-section">
      <SectionIntro
        eyebrow="Relationship execution products"
        title="Start by recovering value from the relationships you already have."
        text="Meridian utility products focus the operator on priority contacts, stale opportunities, follow-up timing, local trust, reviews, and missed revenue."
      />
      <div className="public-product-grid">
        {fastUtilityProducts.map((product, index) => (
          <article className="public-product-card" key={product.title}>
            <div className="public-product-card-topline">
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{product.price}</strong>
            </div>
            <h3>{product.title}</h3>
            <div>
              <span>Pain point</span>
              <p>{product.pain}</p>
            </div>
            <div>
              <span>Outcome</span>
              <p>{product.outcome}</p>
            </div>
            <a href={"href" in product ? product.href : VISIBILITY_SCAN_HREF}>{product.cta}</a>
          </article>
        ))}
      </div>
      <SectionCta
        eyebrow="Priority scan"
        text="Use a lightweight scan to rank contacts, expose stale opportunities, and identify the fastest relationship recovery move."
        primaryHref={VISIBILITY_SCAN_HREF}
        primaryLabel="Get a Priority Scan"
        secondaryHref={REQUEST_WORKSPACE_HREF}
        secondaryLabel="Request Workspace"
      />
    </section>
  );
}
