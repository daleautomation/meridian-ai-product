import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import {
  getShowcaseDemoByRoute,
  getShowcaseDemoRedirectHref,
  SHOWCASE_DEMOS,
} from "@/lib/relationship-priority/showcaseCatalog";

type ShowcaseRoutePageProps = {
  params: Promise<{
    vertical: string;
    workflow: string;
  }>;
};

export function generateStaticParams() {
  return SHOWCASE_DEMOS.map((demo) => ({
    vertical: demo.route.vertical,
    workflow: demo.route.workflow,
  }));
}

export async function generateMetadata({
  params,
}: ShowcaseRoutePageProps): Promise<Metadata> {
  const { vertical, workflow } = await params;
  const demo = getShowcaseDemoByRoute(vertical, workflow);
  if (!demo) {
    return {
      title: "Meridian Showcase",
      description: "Meridian relationship-priority showcase demo.",
    };
  }

  return {
    title: `${demo.title} | Meridian`,
    description: demo.metadataDescription,
    openGraph: {
      title: `${demo.title} | Meridian`,
      description: demo.metadataDescription,
      type: "website",
    },
  };
}

export default async function ShowcaseRoutePage({ params }: ShowcaseRoutePageProps) {
  const { vertical, workflow } = await params;
  const demo = getShowcaseDemoByRoute(vertical, workflow);
  if (!demo) notFound();

  redirect(getShowcaseDemoRedirectHref(demo));
}
