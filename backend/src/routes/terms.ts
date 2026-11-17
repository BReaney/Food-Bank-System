import express from "express";
import { pool } from "../db.js";
import { currentAccount, requireUser, requireRole } from "../security/sessions.js";

export const termsRouter = express.Router();
termsRouter.use(requireUser);

const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

// Every user sees the available terms. Student status joins ONLY their own ID.
termsRouter.get("/", async (req, res) => {
  try {
    const user = currentAccount(req);
    const sql = [
      "SELECT t.id, t.code, t.name, t.starts_on, t.ends_on,",
      "COALESCE(ev.status, 'pending') AS enrollment_status,",
      "(es.student_id IS NOT NULL) AS survey_submitted,",
      "es.submitted_at AS survey_submitted_at",
      "FROM terms AS t",
      "LEFT JOIN enrollment_verifications AS ev",
      "ON ev.term_id = t.id AND ev.student_id = $1",
      "LEFT JOIN eligibility_surveys AS es",
      "ON es.term_id = t.id AND es.student_id = $1",
      "WHERE t.ends_on >= (NOW() AT TIME ZONE 'America/Vancouver')::date",
      "ORDER BY t.starts_on ASC, t.code ASC LIMIT 30"
    ].join(" ");
    const result = await pool.query(sql, [user.id]);
    res.json({ terms: result.rows });
  } catch (error) {
    console.error("Unable to load term eligibility:", error);
    res.status(500).json({ error: "Unable to load term eligibility" });
  }
});

// These are NON-SENSITIVE placeholder questions. Actual eligibility policy
// is not established by this form, and staff verification is independent.
termsRouter.post("/:termId/survey", requireRole("student"), async (req, res) => {
  const termId = req.params.termId;
  const { enrollmentAttestation, householdType, fictionalDataConfirmation } = req.body ?? {};
  const allowedHouseholds = ["individual", "with_dependents", "prefer_not_to_say"];
  if (!isUuid(termId)) {
    res.status(400).json({ error: "A valid term ID is required" });
    return;
  }
  if (enrollmentAttestation !== true ||
      !allowedHouseholds.includes(householdType) ||
      fictionalDataConfirmation !== true) {
    res.status(400).json({
      error: "Complete all required survey questions. The demo requires a fictional enrollment affirmation and fictional data."
    });
    return;
  }

  try {
    const term = await pool.query<{ id: string }>(
      "SELECT id FROM terms WHERE id = $1 " +
      "AND ends_on >= (NOW() AT TIME ZONE 'America/Vancouver')::date",
      [termId]
    );
    if (!term.rows[0]) {
      res.status(404).json({ error: "This term is unavailable" });
      return;
    }

    const answers = {
      enrollment_attestation: true,
      household_type: householdType,
      fictional_data_confirmation: true
    };
    const result = await pool.query(
      "INSERT INTO eligibility_surveys " +
      "(student_id, term_id, survey_version, responses) " +
      "VALUES ($1, $2, 'prototype-v1', $3::jsonb) " +
      "ON CONFLICT (student_id, term_id) DO NOTHING " +
      "RETURNING submitted_at",
      [currentAccount(req).id, termId, JSON.stringify(answers)]
    );
    if (!result.rows[0]) {
      res.status(409).json({ error: "You already submitted a survey for this term" });
      return;
    }
    res.status(201).json({
      message: "Survey submitted. Staff enrollment verification is still required.",
      submittedAt: result.rows[0].submitted_at
    });
  } catch (error) {
    console.error("Survey submission failed:", error);
    res.status(500).json({ error: "Unable to save survey" });
  }
});
