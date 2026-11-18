/**
 * View-state guards shared by student and staff weekly calendars.
 * An older response may arrive after navigation. Its data must not
 * render under a different week (or a different staff-selected term).
 */
export function visibleCalendarSchedule<T extends { week: string; termId?: string }>(
  response: T | null,
  selectedWeek: string,
  selectedTermId?: string
): T | null {
  if (!response || response.week !== selectedWeek) return null;
  if (selectedTermId !== undefined && response.termId !== selectedTermId) {
    return null;
  }
  return response;
}

/**
 * Never submit an ID that is no longer among the displayed eligible
 * alternatives. The caller supplies only open, non-full, non-current slots.
 */
export function validRescheduleChoice(
  alternatives: readonly { id: string }[],
  candidate: string | undefined
): string {
  return candidate && alternatives.some(slot => slot.id === candidate)
    ? candidate : "";
}
