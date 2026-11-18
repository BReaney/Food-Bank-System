// Vancouver-local calendar helpers. Date-only values use UTC noon for
// calendar arithmetic, so browser time zones and DST cannot shift weekdays.
const ZONE = "America/Vancouver";

export function localParts(iso: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(iso));
  const get = (kind: string) => parts.find(p => p.type === kind)?.value ?? "";
  const date = get("year") + "-" + get("month") + "-" + get("day");
  return { date, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

export function addCalendarDays(date: string, days: number): string {
  const value = new Date(date + "T12:00:00Z");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function weekOf(date: string): string {
  const weekday = new Date(date + "T12:00:00Z").getUTCDay();
  return addCalendarDays(date, -((weekday + 6) % 7));
}

export function todayVancouver(): string {
  return localParts(new Date().toISOString()).date;
}

export function weekDates(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addCalendarDays(monday, i));
}

export function dateHeading(ymd: string): string {
  return new Date(ymd + "T12:00:00Z").toLocaleDateString("en-CA", {
    timeZone: "UTC", weekday: "short", month: "short", day: "numeric"
  });
}

export function weekHeading(monday: string): string {
  const last = addCalendarDays(monday, 6);
  return new Date(monday + "T12:00:00Z").toLocaleDateString("en-CA", {
    timeZone: "UTC", month: "short", day: "numeric", year: "numeric"
  }) + " – " + new Date(last + "T12:00:00Z").toLocaleDateString("en-CA", {
    timeZone: "UTC", month: "short", day: "numeric", year: "numeric"
  });
}

export function clockLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  return (hour % 12 || 12) + ":" + String(minutes % 60).padStart(2, "0") +
    (hour < 12 ? " AM" : " PM");
}
