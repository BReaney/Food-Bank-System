import express from "express";
import { pool } from "../db.js";
import { requireRole, requireUser } from "../security/sessions.js";

export const staffRouter = express.Router();
staffRouter.use(requireUser, requireRole("staff"));

// Limited staff-only roster to demonstrate server-side authorization.
// More sensitive enrollment and dependent records are future work.
staffRouter.get("/profiles", async (_req, res) => {
  const result = await pool.query(
    "SELECT id, email, first_name, last_name, role " +
    "FROM profiles WHERE role = 'student' " +
    "ORDER BY last_name, first_name LIMIT 100"
  );
  res.json({ students: result.rows });
});
