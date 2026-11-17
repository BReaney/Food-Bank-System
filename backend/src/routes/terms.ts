import express from "express";
import { pool } from "../db.js";
import { requireUser } from "../security/sessions.js";

export const termsRouter = express.Router();
termsRouter.use(requireUser);

// Both students and staff may read configured terms.
termsRouter.get("/", async (_req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, code, name, starts_on, ends_on " +
      "FROM terms ORDER BY starts_on DESC LIMIT 100"
    );
    res.json({ terms: result.rows });
  } catch (error) {
    console.error("Failed to retrieve terms:", error);
    res.status(500).json({ error: "Unable to retrieve terms" });
  }
});
