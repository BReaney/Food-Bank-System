import express from "express";
import { pool } from "../db.js";
import { currentAccount, requireUser, requireRole } from "../security/sessions.js";

export const notificationsRouter = express.Router();
notificationsRouter.use(requireUser, requireRole("student"));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function integerQuery(value: unknown, fallback: number, min: number, max: number): number | null {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= min && result <= max ? result : null;
}

// One student's private inbox. Paging prevents older messages from
// silently disappearing when the student has received more than 50 notices.
notificationsRouter.get("/", async (req, res) => {
  const limit = integerQuery(req.query.limit, 25, 1, 100);
  const offset = integerQuery(req.query.offset, 0, 0, 1_000_000);
  if (limit === null || offset === null) {
    res.status(400).json({ error: "Use limit 1-100 and offset 0-1000000" });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const studentId = currentAccount(req).id;
    const counts = await client.query<{ total: number; unread_count: number }>(
      `SELECT count(*)::integer AS total,
         count(*) FILTER (WHERE read_at IS NULL)::integer AS unread_count
       FROM student_notifications WHERE student_id=$1`,
      [studentId]
    );
    const results = await client.query(
      `SELECT id, booking_id, category, message, created_at, read_at
       FROM student_notifications
       WHERE student_id=$1
       ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
      [studentId, limit, offset]
    );
    await client.query("COMMIT");
    res.json({
      notifications: results.rows,
      unreadCount: counts.rows[0].unread_count,
      pagination: {
        limit, offset, total: counts.rows[0].total,
        hasNext: offset + results.rows.length < counts.rows[0].total,
        hasPrevious: offset > 0
      }
    });
  } catch (error) {
    try { await client.query("ROLLBACK"); }
    catch (rollbackError) { console.error("Notification inbox rollback failed:", rollbackError); }
    console.error("Failed to load private notifications:", error);
    res.status(500).json({ error: "Unable to retrieve notifications" });
  } finally {
    client.release();
  }
});

// Mark unread notifications for the signed-in student only.
// Existing read timestamps are preserved, and the action is idempotent.
notificationsRouter.patch("/read-all", async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE student_notifications SET read_at=NOW()
       WHERE student_id=$1 AND read_at IS NULL`,
      [currentAccount(req).id]
    );
    res.json({ updatedCount: result.rowCount ?? 0 });
  } catch (error) {
    console.error("Unable to mark private notifications read:", error);
    res.status(500).json({ error: "Unable to mark notifications read" });
  }
});

notificationsRouter.patch("/:id/read", async (req, res) => {
  const id = req.params.id;
  if (typeof id !== "string" || !UUID.test(id)) {
    res.status(400).json({ error: "Invalid notification ID" });
    return;
  }
  try {
    const result = await pool.query(
      `UPDATE student_notifications SET read_at=COALESCE(read_at,NOW())
       WHERE id=$1 AND student_id=$2 RETURNING id,read_at`,
      [id, currentAccount(req).id]
    );
    if (!result.rows[0]) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }
    res.json({ notification: result.rows[0] });
  } catch (error) {
    console.error("Failed to acknowledge notification:", error);
    res.status(500).json({ error: "Unable to acknowledge notification" });
  }
});
