import type { PoolClient } from "pg";

export type BookingNoticeCategory =
  "booking_confirmed" | "booking_cancelled" | "booking_rescheduled";

// Format an existing database instant in the Food Bank's local time zone,
// regardless of the browser or server host's configured time zone.
const localTime = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Vancouver",
  dateStyle: "medium",
  timeStyle: "short"
});

export async function recordBookingNotice(
  client: PoolClient,
  studentId: string,
  bookingId: string,
  category: BookingNoticeCategory,
  oldStart: Date,
  newStart?: Date
): Promise<void> {
  const before = localTime.format(oldStart);
  let message: string;
  if (category === "booking_confirmed") {
    message = "Your appointment for " + before +
      " (Vancouver time) is confirmed. Check My appointments for details.";
  } else if (category === "booking_cancelled") {
    message = "Your appointment for " + before +
      " (Vancouver time) was cancelled. You may book another eligible slot.";
  } else {
    if (!newStart) throw new Error("Reschedule notice requires the new appointment time");
    message = "Your appointment was rescheduled from " + before + " to " +
      localTime.format(newStart) +
      " (Vancouver time). Your reservation remains active.";
  }
  // This insert is part of the caller's booking transaction. Failed booking
  // mutations cannot leave behind a misleading confirmation notice.
  // Never place student/contact names, survey responses or consent data here.
  await client.query(
    `INSERT INTO student_notifications
      (student_id, booking_id, actor_id, category, message)
     VALUES ($1, $2, $1, $3, $4)`,
    [studentId, bookingId, category, message]
  );
}
