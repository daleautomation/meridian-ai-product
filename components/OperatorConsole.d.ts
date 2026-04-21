interface OperatorConsoleProps {
  user: { name: string; id: string };
  callTheseFirst: unknown[];
  todayList: unknown[];
  remaining: unknown[];
  rest?: unknown[];
  pendingReviews: unknown[];
  totalPipeline: number;
  pipelineMap?: Record<string, unknown>;
  roi?: unknown;
  calendarEvents?: unknown[];
  recentActivities?: unknown[];
  lastPipelineJob?: { completedAt: string; errors: number; enriched: number } | null;
}

declare function OperatorConsole(props: OperatorConsoleProps): React.JSX.Element;
export default OperatorConsole;
