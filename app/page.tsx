import { PublicFooter } from "@/components/public/layout/PublicFooter";
import { PublicHeader } from "@/components/public/layout/PublicHeader";
import { CoreCategoriesSection } from "@/components/public/sections/CoreCategoriesSection";
import { FastUtilityProductsSection } from "@/components/public/sections/FastUtilityProductsSection";
import { FinalCta } from "@/components/public/sections/FinalCta";
import { HeroSection } from "@/components/public/sections/HeroSection";
import { HowMeridianWorksSection } from "@/components/public/sections/HowMeridianWorksSection";
import { LiveSystemsSection } from "@/components/public/sections/LiveSystemsSection";
import { ProductLadderSection } from "@/components/public/sections/ProductLadderSection";
import { RoofingIntelligenceSection } from "@/components/public/sections/RoofingIntelligenceSection";
import { ShowcaseIntegrationSection } from "@/components/public/sections/ShowcaseIntegrationSection";
import { StickyConversionBar } from "@/components/public/sections/StickyConversionBar";
import { VerticalWorkspacesSection } from "@/components/public/sections/VerticalWorkspacesSection";

export default function MeridianPublicPage() {
  return (
    <main className="public-site">
      <PublicHeader />
      <HeroSection />
      <CoreCategoriesSection />
      <FastUtilityProductsSection />
      <ProductLadderSection />
      <VerticalWorkspacesSection />
      <ShowcaseIntegrationSection />
      <HowMeridianWorksSection />
      <RoofingIntelligenceSection />
      <LiveSystemsSection />
      <FinalCta />
      <StickyConversionBar />
      <PublicFooter />
    </main>
  );
}
