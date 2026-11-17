import express from "express";
import { pool } from "../db.js";
import { requireRole, requireUser } from "../security/sessions.js";
import { buildPageInfo, parseRosterQuery } from "../utils/rosterPagination.js";

export const staffRouter = express.Router();
staffRouter.use(requireUser, requireRole("staff"));

// Staff-only, paginated student directory.
// Search is case-insensitive and treats % and _ as literal characters.
staffRouter.get("/profiles", async (req, res) => {
  const page = parseRosterQuery(req.query);
  if (!page) {
    res.status(400).json({
      error: "Use limit 1-100, offset 0-1000000, and search up to 100 characters"
    });
    return;
  }

  try {
    const [totalResult, studentsResult] = await Promise.all([
      pool.query<{ total: number }>(
        `
        SELECT count(*)::integer AS total FROM profiles AS p
        WHERE p.role = 'student'
          AND (
            $1::text = ''
            OR strpos(lower(p.email), lower($1)) > 0
            OR strpos(lower(concat_ws(' ', p.first_name, p.last_name)), lower($1)) > 0
          )
        `,
        [page.search]
      ),
      pool.query(
        `
        SELECT p.id, p.email, p.first_name, p.last_name, p.role
        FROM profiles AS p
        WHERE p.role = 'student'
          AND (
            $1::text = ''
            OR strpos(lower(p.email), lower($1)) > 0
            OR strpos(lower(concat_ws(' ', p.first_name, p.last_name)), lower($1)) > 0
          )
        ORDER BY lower(p.last_name), lower(p.first_name), lower(p.email), p.id
        LIMIT $2 OFFSET $3
        `,
        [page.search, page.limit, page.offset]
      )
    ]);

    res.json({
      students: studentsResult.rows,
      pagination: buildPageInfo(page, totalResult.rows[0].total, studentsResult.rows.length)
    });
  } catch (error) {
    console.error("Failed to retrieve staff student directory:", error);
    res.status(500).json({ error: "Unable to load student directory" });
  }
});
