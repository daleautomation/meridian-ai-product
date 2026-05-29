import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bundle deploy-time JSON under bounded `data/` paths for serverless routes
  // that read schedule overrides or CRM file fallbacks (local dev).
  outputFileTracingIncludes: {
    "/api/scheduling/override": [
      "./data/scheduling/overrides.json",
      "./data/usage-events.jsonl",
    ],
    "/api/scheduling/overrides": ["./data/scheduling/overrides.json"],
    "/api/crm-import/status": [
      "./data/crmImportJobs.json",
      "./data/crm-import-jobs/**/*",
    ],
  },
};

export default nextConfig;
