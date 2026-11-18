import express from "express";
import type { PoolClient } from "pg";
import { pool } from "../db.js";
import { currentAccount, requireRole, requireUser } from "../security/sessions.js";
import { parseRosterQuery, buildPageInfo } from "../utils/rosterPagination.js";
import {
  UUID_PATTERN, PickupRuleError, clearFuturePickupAssignments
} from "../utils/pickup.js";

export const staffHouseholdRouter = express.Router();
staffHouseholdRouter.use(requireUser, requireRole("staff"));

type Status = "pending" | "confirmed" | "denied";
type Kind = "dependent" | "contact";

function settings(kind: Kind) {
  return {
    table: kind === "dependent" ? "dependent_requests" : "pickup_contacts",
    label: kind === "dependent" ? "dependent" : "contact",
    pickupKind: kind === "dependent" ? "dependent" : "third_party"
  } as const;
}

function errorResponse(res: express.Response, error: unknown): void {
  if (error instanceof PickupRuleError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  console.error("Staff household action failed:", error);
  res.status(500).json({ error: "Unable to manage household record" });
}

async function staffList(req: express.Request, res: express.Response, kind: Kind) {
  const page = parseRosterQuery(req.query);
  const status = req.query.status ?? "all";
  if (!page || !["pending", "confirmed", "denied", "all"].includes(
    typeof status === "string" ? status : ""
  )) {
    res.status(400).json({ error: "Valid pagination, search and status are required" });
    return;
  }
  const { table } = settings(kind);
  const recordFields = kind === "dependent"
    ? "h.relationship"
    : "h.contact_method, h.contact_value, h.consent_version, h.consent_text, h.consent_given_at";
  const filter = [
    "FROM " + table + " AS h",
    "JOIN profiles AS p ON p.id = h.student_id",
    "WHERE p.role='student' AND h.removed_at IS NULL",
    "AND ($1::text='all' OR h.status=$1::text)",
    "AND ($2::text='' OR",
    " strpos(lower(h.full_name),lower($2))>0 OR",
    " strpos(lower(p.email),lower($2))>0 OR",
    " strpos(lower(concat_ws(' ',p.first_name,p.last_name)),lower($2))>0)"
  ].join("\n");

  try {
    const params = [status, page.search];
    const [count, list] = await Promise.all([
      pool.query<{ total: number }>(
        "SELECT count(*)::integer AS total " + filter, params
      ),
      pool.query(
        [
          "SELECT h.id, h.student_id, h.full_name, h.status,",
          "h.created_at, h.updated_at, h.reviewed_at,",
          recordFields + ",",
          "p.first_name AS student_first_name,",
          "p.last_name AS student_last_name, p.email AS student_email",
          filter,
          "ORDER BY h.created_at DESC, h.id DESC LIMIT $3 OFFSET $4"
        ].join("\n"),
        [...params, page.limit, page.offset]
      )
    ]);
    res.json({
      records: list.rows,
      pagination: buildPageInfo(page, count.rows[0].total, list.rows.length)
    });
  } catch (error) {
    console.error("Failed to list staff household records:", error);
    res.status(500).json({ error: "Unable to retrieve household records" });
  }
}

staffHouseholdRouter.get("/dependents", (req, res) => {
  void staffList(req, res, "dependent");
});
staffHouseholdRouter.get("/contacts", (req, res) => {
  void staffList(req, res, "contact");
});

async function changeStatus(req: express.Request, res: express.Response, kind: Kind) {
  const id = req.params.id;
  const status: unknown = req.body?.status;
  if (!UUID_PATTERN.test(id ?? "") ||
      (status !== "pending" && status !== "confirmed" && status !== "denied")) {
    res.status(400).json({ error: "Valid record ID and status are required" });
    return;
  }
  const newStatus = status as Status;
  const actorId = currentAccount(req).id;
  const { table, pickupKind } = settings(kind);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const record = await client.query<{ student_id: string; status: Status }>(
      "SELECT student_id,status FROM " + table +
      " WHERE id=$1 AND removed_at IS NULL FOR UPDATE",
      [id]
    );
    const current = record.rows[0];
    if (!current) throw new PickupRuleError(404, "Record not found");
    if (current.status === newStatus) {
      throw new PickupRuleError(409, "Record already has that status");
    }

    await client.query(
      "UPDATE " + table +
      " SET status=$1, reviewed_by=$2, reviewed_at=NOW(), updated_at=NOW() WHERE id=$3",
      [newStatus, actorId, id]
    );
    let affectedBookings = 0;
    if (current.status === "confirmed" && newStatus !== "confirmed") {
      affectedBookings = await clearFuturePickupAssignments(
        client, pickupKind, id, actorId, kind + "_approval_withdrawn"
      );
    }
    await client.query(
      \`INSERT INTO household_events
        (student_id, actor_id, record_type, record_id,
         action, previous_status, new_status)
       VALUES ($1,$2,$3,$4,'status_changed',$5,$6)\`,
      [current.student_id, actorId, kind, id, current.status, newStatus]
    );
    await client.query(
      \`INSERT INTO audit_logs
        (actor_id, action, target_type, target_id, details)
       VALUES ($1, 'household_status_changed', $2, $3,
         jsonb_build_object(
           'from',$4::text,'to',$5::text,
           'affectedBookings',$6::integer))\`,
      [actorId, kind, id, current.status, newStatus, affectedBookings]
    );
    await client.query("COMMIT");
    res.json({ id, status: newStatus, affectedBookings });
  } catch (error) {
    try { await client.query("ROLLBACK"); }
    catch (rollbackError) { console.error("Household staff rollback failed:", rollbackError); }
    errorResponse(res, error);
  } finally {
    client.release();
  }
}

staffHouseholdRouter.put("/dependents/:id/status", (req, res) => {
  void changeStatus(req, res, "dependent");
});
staffHouseholdRouter.put("/contacts/:id/status", (req, res) => {
  void changeStatus(req, res, "contact");
});
