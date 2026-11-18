import assert from "node:assert/strict";
import test from "node:test";
import {
  validRescheduleChoice,
  visibleCalendarSchedule
} from "../src/calendarStateGuards.ts";

test("obsolete staff term response is never shown under another term", () => {
  const response = {
    termId: "term-A",
    week: "2026-11-16",
    slots: [{ id: "A1" }],
    hasMore: false
  };
  assert.equal(visibleCalendarSchedule(response, "2026-11-16", "term-B"), null);
  assert.deepEqual(
    visibleCalendarSchedule(response, "2026-11-16", "term-A"),
    response
  );
});

test("obsolete weekly response is hidden immediately after a week switch", () => {
  const response = {
    week: "2026-11-16",
    slots: [{ id: "old-week-slot" }],
    hasMore: false
  };
  assert.equal(visibleCalendarSchedule(response, "2026-11-23"), null);
  assert.deepEqual(visibleCalendarSchedule(response, "2026-11-16"), response);
  assert.equal(visibleCalendarSchedule(null, "2026-11-16"), null);
});

test("previous week's rescheduling choice is invalid in the selected week", () => {
  assert.equal(
    validRescheduleChoice([{ id: "new-week-slot" }], "old-week-slot"),
    ""
  );
  assert.equal(
    validRescheduleChoice([{ id: "new-week-slot" }], "new-week-slot"),
    "new-week-slot"
  );
});

test("a now-full, closed, or already-booked slot cannot remain selected", () => {
  // The UI filters unavailable, closed and current-booking slots before
  // passing alternatives to the guard.
  const available = [{ id: "open-other-slot" }];
  for (const staleId of ["full-slot", "closed-slot", "current-slot"]) {
    assert.equal(validRescheduleChoice(available, staleId), "");
  }
  assert.equal(validRescheduleChoice(available, undefined), "");
  assert.equal(validRescheduleChoice([], "open-other-slot"), "");
});
