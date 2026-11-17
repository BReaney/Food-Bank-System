import express from "express";
import { pool } from "../db.js";
import { currentAccount, requireRole, requireUser } from "../security/sessions.js";

export const eligibilityRouter = express.Router();
eligibilityRouter.use(requireUser, requireRole("student"));

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface TermStatus {
  id: string;
  code: string;
  name: string;
  starts_on: string;
  ends_on: string;
  enrollment_status: "pending" | "verified" | "rejected";
  survey_submitted_at: string | null;
  enrollment_verified_at: string | null;
}

// A student's data comes only from their authenticated session ID.
// Includes past terms for viewing history; UI labels expired terms.
eligibilityRouter.get("/terms", async (req, res) => {
  try {
    const result = await pool.query<TermStatus>(
      \`
      SELECT t.id, t.code, t.name, t.starts_on, t.ends_on,
             COALESCE(v.status, 'pending') AS enrollment_status,
             v.verified_at AS enrollment_verified_at,
             s.submitted_at AS survey_submitted_at
      FROM terms t
      LEFT JOIN enrollment_verifications v
        ON v.term_id = t.id AND v.student_id = $1
      LEFT JOIN eligibility_surveys s
        ON s.term_id = t.id AND s.student_id = $1
      ORDER BY t.starts_on DESC
      \`,
      [currentAccount(req).id]
    );
    res.json({ terms: result.rows });
  } catch (error) {
    console.error("Failed to retrieve student eligibility:", error);
    res.status(500).json({ error: "Unable to load term eligibility" });
  }
});

// Minimal NON-SENSITIVE demonstration questions. Actual student needs
// questionnaire requires client sign-off and privacy approval.
eligibilityRouter.post("/surveys/:termId", async (req, res) => {
  const { termId } = req.params;
  const { confirmAccurate, understandVerification } = req.body ?? {};

  if (!uuidPattern.test(termId ?? "")) {
    res.status(400).json({ error: "Invalid term identifier" });
    return;
  }
  if (confirmAccurate !== true || understandVerification !== true) {
    res.status(400).json({
      error: "Both required survey confirmations must be acknowledged"
    });
    return;
  }

  try {
    const result = await pool.query(
      \`
      INSERT INTO eligibility_surveys
        (student_id, term_id, survey_version, responses)
      SELECT $1, t.id, 'demo-v2',
             jsonb_build_object(
               'confirmAccurate', $3::boolean,
               'understandVerification', $4::boolean
             )
      FROM terms AS t
      WHERE t.id = $2
        AND t.ends_on >= (NOW() AT TIME ZONE 'America/Vancouver')::date
      ON CONFLICT (student_id, term_id) DO NOTHING
      RETURNING student_id, term_id, submitted_at
      \`,
      [currentAccount(req).id, termId, confirmAccurate, understandVerification]
    );

    if (result.rowCount === 1) {
      res.status(201).json({
        message: "Survey recorded. Staff must separately verify enrollment.",
        survey: result.rows[0]
      });
      return;
    }

    const term = await pool.query<{ id: string }>(
      "SELECT id FROM terms WHERE id = $1 AND ends_on >= (NOW() AT TIME ZONE 'America/Vancouver')::date",
      [termId]
    );
    if (term.rowCount === 0) {
      res.status(404).json({ error: "No active or upcoming term with that ID" });
    } else {
      res.status(409).json({ error: "A survey was already submitted for this term" });
    }
  } catch (error) {
    console.error("Failed to submit survey:", error);
    res.status(500).json({ error: "Unable to save survey" });
  }
});
