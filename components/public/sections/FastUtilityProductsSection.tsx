import { SectionCta } from "@/components/public/ui/SectionCta";
import { SectionIntro } from "@/components/public/ui/SectionIntro";
import {
  fastUtilityProducts,
  REQUEST_WORKSPACE_HREF,
  VISIBILITY_SCAN_HREF,
} from "@/content/public/home";

export function FastUtilityProductsSection() {
  return (
    <section id="products" className="public-section">
      <SectionIntro
        eyebrow="Products"
        title="Focused systems for relationship recovery and execution."
        text="The public product ladder stays simple: scans to find the revenue movement, single-user systems for personal execution, shared workspaces for teams, and strategic systems for deeper workflow builds."
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
