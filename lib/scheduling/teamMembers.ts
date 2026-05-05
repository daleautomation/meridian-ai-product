// Meridian — LaborTech team roster.
//
// Each rep declares the trades they cover and their daily call cap.
// The scheduler honors rep.trades when assigning leads — a rep never
// receives a lead from a trade outside their list.

export type TeamMemberRole = "sales" | "service" | "ops";

export type TeamMember = {
  id: string;
  name: string;
  role: TeamMemberRole;
  trades: string[];
  maxCallsPerDay: number;
};

export const DEFAULT_TEAM_MEMBERS: TeamMember[] = [
  {
    id: "rep_1",
    name: "Rep 1",
    role: "sales",
    trades: ["roofing", "hvac", "plumbing"],
    maxCallsPerDay: 10,
  },
  {
    id: "rep_2",
    name: "Rep 2",
    role: "sales",
    trades: ["painting", "electrical", "carpentry"],
    maxCallsPerDay: 10,
  },
];

export function repsForTrade(team: TeamMember[], trade: string | undefined | null): TeamMember[] {
  if (!trade) return team;
  const t = trade.toLowerCase();
  const eligible = team.filter((r) => r.trades.includes(t));
  // Fallback so a lead is never orphaned by a missing rep mapping.
  return eligible.length > 0 ? eligible : team;
}
