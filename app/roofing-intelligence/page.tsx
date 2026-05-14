import type { Metadata } from "next";
import { PublicFooter } from "@/components/public/layout/PublicFooter";
import { PublicHeader } from "@/components/public/layout/PublicHeader";
import {
  RoofingBuiltForOperatorsSection,
  RoofingContractorUseSection,
  RoofingCtaSection,
  RoofingHeroSection,
  RoofingLeadExecutionSection,
  RoofingOpportunityWorkflowSection,
  RoofingPainPointsSection,
  RoofingRoadmapSection,
  RoofingSignalsSection,
  RoofingVisualWorkflowSection,
} from "@/components/public/roofing/RoofingLeadFinderSections";

export const metadata: Metadata = {
  title: "Roofing Lead Finder | Meridian AI",
  description:
    "Operator-grade roofing opportunity intelligence for territory prioritization, local visibility signals, and lead execution workflows.",
};

export default function RoofingIntelligencePage() {
  return (
    <main className="public-site roofing-product-page">
      <PublicHeader />
      <RoofingHeroSection />
      <RoofingPainPointsSection />
      <RoofingOpportunityWorkflowSection />
      <RoofingSignalsSection />
      <RoofingContractorUseSection />
      <RoofingVisualWorkflowSection />
      <RoofingLeadExecutionSection />
      <RoofingBuiltForOperatorsSection />
      <RoofingRoadmapSection />
      <RoofingCtaSection />
      <PublicFooter />
    </main>
  );
}
