import { PublicFooter } from "@/components/public/layout/PublicFooter";
import { PublicHeader } from "@/components/public/layout/PublicHeader";
import { AboutSection } from "@/components/public/sections/AboutSection";
import { AuditsSection } from "@/components/public/sections/AuditsSection";
import { FinalCta } from "@/components/public/sections/FinalCta";
import { HeroSection } from "@/components/public/sections/HeroSection";
import { PlatformSection } from "@/components/public/sections/PlatformSection";
import { ProcessSection } from "@/components/public/sections/ProcessSection";
import { ServicesSection } from "@/components/public/sections/ServicesSection";
import { WorkspacesSection } from "@/components/public/sections/WorkspacesSection";

export default function MeridianPublicPage() {
  return (
    <main className="public-site">
      <PublicHeader />
      <HeroSection />
      <ServicesSection />
      <AuditsSection />
      <WorkspacesSection />
      <PlatformSection />
      <ProcessSection />
      <AboutSection />
      <FinalCta />
      <PublicFooter />
    </main>
  );
}
