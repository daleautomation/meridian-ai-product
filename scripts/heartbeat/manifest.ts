import type { HeartbeatCheck } from "./types";

/** Phase 1 observer-safe checks — approved manifest only. */
export const PHASE1_CHECKS: HeartbeatCheck[] = [
  {
    id: "contact-trust",
    script: "contact-trust:check",
    label: "Contact Trust",
    description: "Contact path trust, conflict detection, and lead scoring invariants.",
  },
  {
    id: "personal-workspace",
    script: "personal-workspace:check",
    label: "Personal Workspace",
    description: "Personal workspace routing, access boundaries, and tenant isolation.",
  },
  {
    id: "auth",
    script: "auth:check",
    label: "Workspace Auth",
    description: "Credential lookup, post-login routing, and workspace selection paths.",
  },
  {
    id: "operational-events-replay",
    script: "operational-events:replay-fixtures",
    label: "Operational Events — Replay Fixtures",
    description: "Fixture replay produces expected canonical operational event streams.",
  },
  {
    id: "operational-events-contracts",
    script: "operational-events:command-contracts",
    label: "Operational Events — Command Contracts",
    description: "Command schemas satisfy operational event contract invariants.",
  },
  {
    id: "operational-events-translation",
    script: "operational-events:command-translation",
    label: "Operational Events — Command Translation",
    description: "Commands translate to canonical events without drift.",
  },
  {
    id: "smoke-field-test",
    script: "smoke:field-test",
    label: "Field-Test Smoke",
    description: "Field-test schedule window, slot table, and outcome status invariants.",
  },
];

export const COVERAGE_LINE =
  "Scope: 7 of 24 audit scripts (29%) run as observer-safe. 3 excluded this phase, 2 external, 12 deferred. Compile (build) not covered in Phase 1.";

export const NOT_COVERED_YET = [
  "Brookside health",
  "Revenue health",
  "Build health",
  "Credentialed DB checks",
];
