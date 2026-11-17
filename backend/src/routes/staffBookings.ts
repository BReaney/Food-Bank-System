import express from "express";
import { pool } from "../db.js";
import { requireUser, requireRole } from "../security/sessions.js";
import { parseRosterQuery, buildPageInfo } from "../utils/rosterPagination.js";

export const staffBookingsRouter = express.Router();
staffBookingsRouter.use(requireUser, requireRole("staff"));

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

staffBookingsRouter.get("/", async (req, res) => {
  const pagination = parseRosterQuery(req.query);
  const termId = req.query.termId ?? "";
  const status = req.query.status ?? "booked";

  if (!pagination || typeof termId !== "string" ||
      (termId !== "" && !uuidPattern.test(termId)) ||
      (status !== "booked" && status !== "all")) {
    res.status(400).json({
      error: "Invalid booking filters; use optional termId, status booked/all, and valid paging"
    });
    return;
  }

  try {
    // Student identities are returned only through the staff-authorized route.
    // The default shows all UPCOMING booked appointments, across all students.
    const filters = [
      "FROM bookings AS b",
      "JOIN profiles AS p ON p.id = b.student_id",
      "JOIN appointment_slots AS s ON s.id = b.slot_id",
      "JOIN terms AS t ON t.id = s.term_id",
      "WHERE p.role = 'student'",
      "AND ($1::uuid IS NULL OR t.id = $1::uuid)",
      "AND (",
      "  $2::text = '' OR",
      "  strpos(lower(p.email), lower($2)) > 0 OR",
      "  strpos(lower(concat_ws(' ', p.first_name, p.last_name)), lower($2)) > 0",
      ")",
      "AND (",
      "  ($3::text = 'booked' AND b.status = 'booked' AND s.starts_at >= NOW())",
      "  OR $3::text = 'all'",
      ")"
    ].join("\n");

    const values = [termId || null, pagination.search, status];
    const [countResult, bookingsResult] = await Promise.all([
      pool.query<{ total: number }>(
        "SELECT count(*)::integer AS total " + filters, values
      ),
      pool.query(
        [
          "SELECT b.id, b.student_id, b.slot_id, b.status, b.week_start, b.booked_at,",
          "b.cancelled_at, s.starts_at, s.ends_at,",
          "p.email, p.first_name, p.last_name, t.code AS term_code, t.name AS term_name",
          filters,
          "ORDER BY",
          " CASE WHEN $3::text = 'booked' THEN s.starts_at END ASC,",
          " CASE WHEN $3::text = 'all' THEN b.booked_at END DESC,",
          " b.id",
          "LIMIT $4 OFFSET $5"
        ].join("\n"),
        [...values, pagination.limit, pagination.offset]
      )
    ]);

    res.set("Cache-Control", "no-store");
    res.json({
      bookings: bookingsResult.rows,
      pagination: buildPageInfo(
        pagination, countResult.rows[0].total, bookingsResult.rows.length
      )
    });
  } catch (error) {
    console.error("Unable to load staff bookings:", error);
    res.status(500).json({ error: "Unable to retrieve staff appointments" });
  }
});
