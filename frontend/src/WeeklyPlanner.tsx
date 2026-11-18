import type { CSSProperties, ReactNode } from "react";
import {
  addCalendarDays, clockLabel, dateHeading, localParts,
  todayVancouver, weekDates, weekHeading, weekOf
} from "./calendarDates";

export interface CalendarSlot {
  id: string;
  starts_at: string;
  ends_at: string;
}

interface PlannerProps<T extends CalendarSlot> {
  week: string;
  slots: T[];
  renderSlot: (slot: T) => ReactNode;
  ariaLabel: string;
}

interface Placement<T> {
  slot: T;
  start: number;
  end: number;
  lane: number;
  lanes: number;
}

// Divide overlapping appointments into side-by-side lanes rather than
// obscuring one appointment with another (e.g., across different terms).
function placeEvents<T extends CalendarSlot>(
  slots: T[], date: string
): Placement<T>[] {
  const events = slots
    .filter(slot => localParts(slot.starts_at).date === date)
    .map(slot => {
      const start = localParts(slot.starts_at).minutes;
      const endLocal = localParts(slot.ends_at);
      const end = endLocal.date === date ? endLocal.minutes : 1440;
      return { slot, start, end: Math.max(start + 1, end) };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end || a.slot.id.localeCompare(b.slot.id));

  const output: Placement<T>[] = [];
  let group: typeof events = [];
  let groupEnd = -1;

  function flush() {
    if (!group.length) return;
    const laneEnds: number[] = [];
    const placed = group.map(item => {
      let lane = laneEnds.findIndex(end => end <= item.start);
      if (lane < 0) {
        lane = laneEnds.length;
        laneEnds.push(item.end);
      } else {
        laneEnds[lane] = item.end;
      }
      return { ...item, lane };
    });
    for (const item of placed) output.push({ ...item, lanes: laneEnds.length });
    group = [];
    groupEnd = -1;
  }

  for (const event of events) {
    if (group.length && event.start >= groupEnd) flush();
    group.push(event);
    groupEnd = Math.max(groupEnd, event.end);
  }
  flush();
  return output;
}

export function WeekPicker({
  week, onChange
}: {
  week: string;
  onChange: (week: string) => void;
}) {
  return (
    <div className="weekly-picker">
      <div className="weekly-picker-navigation">
        <button type="button"
          onClick={() => onChange(addCalendarDays(week, -7))}
          aria-label="Previous week">← Previous</button>
        <strong aria-live="polite">{weekHeading(week)}</strong>
        <button type="button"
          onClick={() => onChange(addCalendarDays(week, 7))}
          aria-label="Next week">Next →</button>
      </div>
      <div className="weekly-picker-jump">
        <label htmlFor="weekly-date-jump">Jump to a date</label>
        <input id="weekly-date-jump" type="date" value={week}
          onChange={e => {
            if (e.target.value) onChange(weekOf(e.target.value));
          }} />
        <button type="button" onClick={() => onChange(weekOf(todayVancouver()))}>
          This week
        </button>
      </div>
    </div>
  );
}

export default function WeeklyPlanner<T extends CalendarSlot>({
  week, slots, renderSlot, ariaLabel
}: PlannerProps<T>) {
  const dates = weekDates(week);
  const placed = dates.map(day => placeEvents(slots, day));
  const entries = placed.flat();

  // Use the hours actually scheduled instead of showing an enormous
  // 24-hour planner. Blank weeks display a useful normal-day window.
  const first = entries.length
    ? Math.max(0, Math.floor(Math.min(...entries.map(e => e.start)) / 60) - 1)
    : 8;
  const last = entries.length
    ? Math.min(24, Math.ceil(Math.max(...entries.map(e => e.end)) / 60) + 1)
    : 18;

  const pxPerMinute = 1.65;
  const height = Math.max(90, (last - first) * 60 * pxPerMinute);
  const hours = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const dayHeight: CSSProperties = { height: height + "px" };

  return (
    <div className="weekly-planner-wrap">
      <div className="weekly-planner-scroll" role="region"
        aria-label={ariaLabel + ". Scroll sideways to see all seven days."}
        tabIndex={0}>
        <div className="weekly-planner-grid">
          <div className="weekly-planner-corner">Time</div>
          {dates.map(date => (
            <div key={date} className="weekly-planner-day-heading">
              {dateHeading(date)}
            </div>
          ))}
          <div className="weekly-planner-axis" style={dayHeight}
            aria-label="Vancouver-local time">
            {hours.map(hour => (
              <div key={hour} className="weekly-planner-hour"
                style={{ top: (hour - first) * 60 * pxPerMinute }}>
                {clockLabel(hour * 60)}
              </div>
            ))}
          </div>
          {dates.map((date, dayIndex) => (
            <div key={date} className="weekly-planner-day" style={dayHeight}
              role="group" aria-label={dateHeading(date)}>
              <div className="weekly-planner-hour-lines"
                aria-hidden="true"
                style={{
                  backgroundSize: "100% " + (pxPerMinute * 60) + "px"
                }} />
              {placed[dayIndex].map(item => {
                const left = (item.lane / item.lanes) * 100;
                const width = 100 / item.lanes;
                const top = (item.start - first * 60) * pxPerMinute;
                const availableHeight = Math.max(16, (item.end - item.start) * pxPerMinute - 2);
                const style: CSSProperties = {
                  top: top + "px",
                  height: availableHeight + "px",
                  left: "calc(" + left + "% + 2px)",
                  width: "calc(" + width + "% - 4px)"
                };
                return (
                  <div key={item.slot.id} className="weekly-planner-slot" style={style}>
                    {renderSlot(item.slot)}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {entries.length === 0 &&
        <p className="weekly-planner-empty" role="status">
          No appointment slots are scheduled for this week. Use Previous or Next to browse.
        </p>}
      <p className="auth-muted weekly-planner-hint">
        Times shown in Vancouver local time. On smaller screens, scroll the planner sideways.
      </p>
    </div>
  );
}
