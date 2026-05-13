import { PublicFooter } from "@/components/public/layout/PublicFooter";
import { PublicHeader } from "@/components/public/layout/PublicHeader";
import { AboutSection } from "@/components/public/sections/AboutSection";
import { AudienceSection } from "@/components/public/sections/AudienceSection";
import { AuditsSection } from "@/components/public/sections/AuditsSection";
import { BeforeAfterSection } from "@/components/public/sections/BeforeAfterSection";
import { FinalCta } from "@/components/public/sections/FinalCta";
import { HeroSection } from "@/components/public/sections/HeroSection";
import { NotMeridianSection } from "@/components/public/sections/NotMeridianSection";
import { OperationalClaritySection } from "@/components/public/sections/OperationalClaritySection";
import { PlatformSection } from "@/components/public/sections/PlatformSection";
import { ProcessSection } from "@/components/public/sections/ProcessSection";
import { ReasonsSection } from "@/components/public/sections/ReasonsSection";
import { ReceiveSection } from "@/components/public/sections/ReceiveSection";
import { ServicesSection } from "@/components/public/sections/ServicesSection";
import { SignalExecutionSection } from "@/components/public/sections/SignalExecutionSection";
import { StickyConversionBar } from "@/components/public/sections/StickyConversionBar";
import { TrustProofStrip } from "@/components/public/sections/TrustProofStrip";
import { WorkspacesSection } from "@/components/public/sections/WorkspacesSection";

export default function MeridianPublicPage() {
  return (
    <main className="public-site">
      <PublicHeader />
      <HeroSection />
      <TrustProofStrip />
      <OperationalClaritySection />
      <BeforeAfterSection />
      <ServicesSection />
      <AuditsSection />
      <ReceiveSection />
      <SignalExecutionSection />
      <WorkspacesSection />
      <AudienceSection />
      <ReasonsSection />
      <PlatformSection />
      <NotMeridianSection />
      <ProcessSection />
      <AboutSection />
      <FinalCta />
      <StickyConversionBar />
      <PublicFooter />
    </main>
  );
}
