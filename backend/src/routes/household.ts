import express from "express";
import type { PoolClient } from "pg";
import { pool } from "../db.js";
import { currentAccount, requireRole, requireUser } from "../security/sessions.js";
import {
  UUID_PATTERN, PickupRuleError, clearFuturePickupAssignments, validDisplayName
} from "../utils/pickup.js";

export const householdRouter = express.Router();
householdRouter.use(requireUser, requireRole("student"));

export const CONSENT_VERSION = "demo-pickup-v1";
export const CONSENT_TEXT =
  "I authorize the named person to collect my food bank hamper on my behalf. " +
  "Staff may verify their identity at pickup. I may withdraw or update this " +
  "authorization, which removes this person from any upcoming appointments " +
  "until another confirmed pickup person is selected. This demonstration " +
  "consent wording requires UVSS review before use with real students.";

type Relationship = "child" | "partner" | "family_member" | "other";
const RELATIONSHIPS: Relationship[] = ["child", "partner", "family_member", "other"];

function fail(res: express.Response, error: unknown, operation: string): void {
  if (error instanceof PickupRuleError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  console.error("Household " + operation + " failed:", error);
  res.status(500).json({ error: "Unable to " + operation });
}

async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); }
    catch (rollbackError) { console.error("Household rollback failed:", rollbackError); }
    throw error;
  } finally {
    client.release();
  }
}

async function recordEvent(
  client: PoolClient, studentId: string, actorId: string,
  type: "dependent" | "contact", recordId: string,
  action: string, from: string | null, to: string | null
): Promise<void> {
  await client.query(
    `INSERT INTO household_events
      (student_id, actor_id, record_type, record_id,
       action, previous_status, new_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [studentId, actorId, type, recordId, action, from, to]
  );
}

householdRouter.get("/consent", (_req, res) => {
  res.json({ version: CONSENT_VERSION, text: CONSENT_TEXT });
});

// Student sees ONLY student_id from the session; no client ID can override it.
householdRouter.get("/dependents", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, full_name, relationship, status, reviewed_at,
              created_at, updated_at
       FROM dependent_requests
       WHERE student_id = $1 AND removed_at IS NULL
       ORDER BY created_at DESC, id DESC`,
      [currentAccount(req).id]
    );
    res.json({ dependents: result.rows });
  } catch (error) { fail(res, error, "load dependents"); }
});

householdRouter.post("/dependents", async (req, res) => {
  const { fullName, relationship } = req.body ?? {};
  if (!validDisplayName(fullName) ||
      typeof relationship !== "string" ||
      !RELATIONSHIPS.includes(relationship as Relationship)) {
    res.status(400).json({
      error: "A name (2-100 characters) and relationship are required"
    });
    return;
  }
  const studentId = currentAccount(req).id;
  try {
    const dependent = await transaction(async client => {
      const result = await client.query(
        `INSERT INTO dependent_requests (student_id, full_name, relationship)
         VALUES ($1,$2,$3)
         RETURNING id, full_name, relationship, status, created_at`,
        [studentId, fullName.trim(), relationship]
      );
      await recordEvent(
        client, studentId, studentId, "dependent",
        result.rows[0].id, "requested", null, "pending"
      );
      return result.rows[0];
    });
    res.status(201).json({ dependent });
  } catch (error) { fail(res, error, "request dependent"); }
});

// Per RSD, a student can remove a dependent *after* staff confirms it.
householdRouter.delete("/dependents/:id", async (req, res) => {
  const id = req.params.id;
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
    res.status(400).json({ error: "Invalid dependent identifier" });
    return;
  }
  const studentId = currentAccount(req).id;
  try {
    const changed = await transaction(async client => {
      const existing = await client.query<{ status: string }>(
        "SELECT status FROM dependent_requests " +
        "WHERE id=$1 AND student_id=$2 AND removed_at IS NULL FOR UPDATE",
        [id, studentId]
      );
      if (!existing.rows[0]) throw new PickupRuleError(404, "Dependent not found");
      if (existing.rows[0].status !== "confirmed") {
        throw new PickupRuleError(409, "Only confirmed dependents may be removed");
      }
      await client.query(
        "UPDATE dependent_requests SET removed_at=NOW(), updated_at=NOW() WHERE id=$1",
        [id]
      );
      const affected = await clearFuturePickupAssignments(
        client, "dependent", id, studentId, "dependent_removed"
      );
      await recordEvent(
        client, studentId, studentId, "dependent", id,
        "removed", "confirmed", null
      );
      return affected;
    });
    res.json({ message: "Dependent removed", affectedBookings: changed });
  } catch (error) { fail(res, error, "remove dependent"); }
});

function validContact(body: any): boolean {
  const method: unknown = body?.contactMethod;
  const value: unknown = body?.contactValue;
  if (!validDisplayName(body?.fullName) ||
      (method !== "phone" && method !== "email") ||
      typeof value !== "string" ||
      value.trim().length > 160 ||
      body?.consentAccepted !== true) return false;

  if (method === "email") {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  }
  return /^[+0-9() .-]{7,30}$/.test(value.trim()) &&
    (value.match(/[0-9]/g)?.length ?? 0) >= 7;
}

householdRouter.get("/contacts", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, full_name, contact_method, contact_value,
              status, consent_version, consent_text, consent_given_at,
              reviewed_at, created_at, updated_at
       FROM pickup_contacts
       WHERE student_id=$1 AND removed_at IS NULL
       ORDER BY created_at DESC, id DESC`,
      [currentAccount(req).id]
    );
    res.json({ contacts: result.rows });
  } catch (error) { fail(res, error, "load pickup contacts"); }
});

// Consent is deliberately explicit on EVERY creation/edit, and recorded
// with the exact text/version the student agreed to.
householdRouter.post("/contacts", async (req, res) => {
  if (!validContact(req.body)) {
    res.status(400).json({
      error: "Name, valid phone/email, and explicit pickup consent are all required"
    });
    return;
  }
  const studentId = currentAccount(req).id;
  const { fullName, contactMethod, contactValue } = req.body;
  try {
    const contact = await transaction(async client => {
      const result = await client.query(
        `INSERT INTO pickup_contacts
          (student_id, full_name, contact_method, contact_value,
           consent_version, consent_text)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, full_name, contact_method, contact_value, status,
                   consent_version, consent_given_at`,
        [
          studentId, fullName.trim(), contactMethod, contactValue.trim(),
          CONSENT_VERSION, CONSENT_TEXT
        ]
      );
      await recordEvent(
        client, studentId, studentId, "contact", result.rows[0].id,
        "created", null, "pending"
      );
      return result.rows[0];
    });
    res.status(201).json({ contact });
  } catch (error) { fail(res, error, "create pickup contact"); }
});

householdRouter.put("/contacts/:id", async (req, res) => {
  const id = req.params.id;
  if (typeof id !== "string" || !UUID_PATTERN.test(id) || !validContact(req.body)) {
    res.status(400).json({
      error: "Valid contact ID, name, contact method/value, and renewed consent required"
    });
    return;
  }
  const studentId = currentAccount(req).id;
  const { fullName, contactMethod, contactValue } = req.body;
  try {
    const result = await transaction(async client => {
      const before = await client.query<{ status: string }>(
        "SELECT status FROM pickup_contacts " +
        "WHERE id=$1 AND student_id=$2 AND removed_at IS NULL FOR UPDATE",
        [id, studentId]
      );
      if (!before.rows[0]) throw new PickupRuleError(404, "Pickup contact not found");
      const updated = await client.query(
        `UPDATE pickup_contacts SET
           full_name=$1, contact_method=$2, contact_value=$3,
           consent_version=$4, consent_text=$5, consent_given_at=NOW(),
           status='pending', reviewed_by=NULL, reviewed_at=NULL,
           updated_at=NOW()
         WHERE id=$6 RETURNING
           id, full_name, contact_method, contact_value,
           status, consent_version, consent_given_at`,
        [
          fullName.trim(), contactMethod, contactValue.trim(),
          CONSENT_VERSION, CONSENT_TEXT, id
        ]
      );
      const affected = await clearFuturePickupAssignments(
        client, "third_party", id, studentId, "contact_edited"
      );
      await recordEvent(
        client, studentId, studentId, "contact", id,
        "edited", before.rows[0].status, "pending"
      );
      return { contact: updated.rows[0], affectedBookings: affected };
    });
    res.json(result);
  } catch (error) { fail(res, error, "edit pickup contact"); }
});

householdRouter.delete("/contacts/:id", async (req, res) => {
  const id = req.params.id;
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
    res.status(400).json({ error: "Invalid pickup contact identifier" });
    return;
  }
  const studentId = currentAccount(req).id;
  try {
    const affected = await transaction(async client => {
      const before = await client.query<{ status: string }>(
        "SELECT status FROM pickup_contacts " +
        "WHERE id=$1 AND student_id=$2 AND removed_at IS NULL FOR UPDATE",
        [id, studentId]
      );
      if (!before.rows[0]) throw new PickupRuleError(404, "Pickup contact not found");
      await client.query(
        "UPDATE pickup_contacts SET removed_at=NOW(), updated_at=NOW() WHERE id=$1",
        [id]
      );
      const changed = await clearFuturePickupAssignments(
        client, "third_party", id, studentId, "contact_removed"
      );
      await recordEvent(
        client, studentId, studentId, "contact", id,
        "removed", before.rows[0].status, null
      );
      return changed;
    });
    res.json({ message: "Pickup contact removed", affectedBookings: affected });
  } catch (error) { fail(res, error, "remove pickup contact"); }
});
