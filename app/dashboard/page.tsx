import { redirect } from "next/navigation";

// Dashboard now redirects to the Roofing Operator Console.
// The multi-module PlatformShell is no longer the primary interface.
export default function DashboardPage() {
  redirect("/operator");
}
