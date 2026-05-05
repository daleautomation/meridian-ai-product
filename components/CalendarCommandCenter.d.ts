import type { TaskItem } from "../lib/calendar/tasks";

interface CalendarCommandCenterProps {
  tasks?: TaskItem[];
}

declare function CalendarCommandCenter(
  props: CalendarCommandCenterProps,
): React.JSX.Element;

export default CalendarCommandCenter;
