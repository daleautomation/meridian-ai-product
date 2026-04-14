import type { DecisionItem } from "../lib/types";

interface PlatformShellProps {
  realEstateItems?: DecisionItem[] | null;
  watchesItems?: DecisionItem[] | null;
  initialModule?: string | null;
}

declare function PlatformShell(props: PlatformShellProps): React.JSX.Element;
export default PlatformShell;
