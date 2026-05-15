import { NextResponse } from "next/server";
import { createDemoSessionResponse, resolveDemoProfile } from "@/lib/demo/session";

export async function GET(
  req: Request,
  context: { params: Promise<{ profile: string }> },
) {
  const { profile } = await context.params;
  const demoProfile = resolveDemoProfile(profile);
  if (!demoProfile) {
    return NextResponse.json({ error: "Unknown demo link" }, { status: 404 });
  }
  return createDemoSessionResponse({
    req,
    profile: demoProfile,
    entry: `/demo/priority/${demoProfile.slug}`,
    destination: "relationship-priority",
  });
}
