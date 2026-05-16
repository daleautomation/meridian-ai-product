import { PublicFooter } from "@/components/public/layout/PublicFooter";
import { PublicHeader } from "@/components/public/layout/PublicHeader";
import { FinalCta } from "@/components/public/sections/FinalCta";
import { HeroSection } from "@/components/public/sections/HeroSection";
import { HowRecoveryWorksSection } from "@/components/public/sections/HowRecoveryWorksSection";
import { RecoveryBriefSection } from "@/components/public/sections/RecoveryBriefSection";

export default function MeridianPublicPage() {
  return (
    <main className="public-site">
      <PublicHeader />
      <HeroSection />
      <RecoveryBriefSection />
      <HowRecoveryWorksSection />
      <FinalCta />
      <PublicFooter />
    </main>
  );
}
