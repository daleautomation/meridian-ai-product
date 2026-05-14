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
        eyebrow="Fast utility products"
        title="Start with a focused tool that can turn into revenue movement quickly."
        text="Meridian utility products solve visible growth problems first: lead quality, online presence, follow-up, local search, reviews, and missed revenue."
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
            <a href={VISIBILITY_SCAN_HREF}>{product.cta}</a>
          </article>
        ))}
      </div>
      <SectionCta
        eyebrow="Visibility scan"
        text="Use a lightweight scan to find the fastest conversion, local visibility, follow-up, or revenue leak opportunity."
        primaryHref={VISIBILITY_SCAN_HREF}
        primaryLabel="Get a Visibility Scan"
        secondaryHref={REQUEST_WORKSPACE_HREF}
        secondaryLabel="Request Workspace"
      />
    </section>
  );
}
