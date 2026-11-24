/**
 * RSD acceptance regression suite: 36 independently identified, API-backed checks.
 * Run with: cd backend && npm run test:acceptance
 *
 * The suite is deliberately isolated in /testing instead of /backend/src.
 * Uses only fictional fixture profiles and a disposable CI database by default.
 * Never run against a real student database.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pool } from "../../backend/src/db.js";

const API = "http://localhost:3001";
const ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
const PASS = "PASS";
const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
const termCode = "ACCEPT-" + suffix.toUpperCase();
const emailA = "accept-a-" + suffix + "@example.test";
const emailB = "accept-b-" + suffix + "@example.test";
const password = "FictionalAcceptanceOnly_1234";
const staffPassword = process.env.DEMO_STAFF_PASSWORD;
const UUID = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;

if (process.env.NODE_ENV === "production" ||
    !["localhost", "127.0.0.1"].includes(process.env.PGHOST ?? "") ||
    process.env.PGDATABASE !== "foodbank_dev" ||
    process.env.ENABLE_PROTOTYPE_AUTH !== "true") {
  throw new Error("Acceptance tests require gated local-only foodbank_dev and fictional data");
}
assert.ok(staffPassword, "Configure DEMO_STAFF_PASSWORD");
const results: Array<{
  id: string; requirementIds: string[]; title: string; result: string;
  detail: string; durationMs: number;
}> = [];
let studentA = "";
let studentB = "";
let staffId = "";
let cookieA = "";
let cookieB = "";
let cookieStaff = "";
let termId = "";
let slotIds: string[] = [];
let bookingCancelled = "";
let bookingActive = "";
let contactId = "";
let dependentId = "";

interface ApiResult {
  status: number;
  data: any;
  cookie: string;
  headers: Headers;
}
async function request(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  cookie = "",
  body?: unknown
): Promise<ApiResult> {
  const response = await fetch(API + path, {
    method,
    headers: {
      Origin: ORIGIN,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return {
    status: response.status,
    data: await response.json(),
    cookie: (response.headers.get("set-cookie") ?? "").split(";")[0],
    headers: response.headers
  };
}
function expectStatus(response: ApiResult, expected: number): void {
  assert.equal(response.status, expected, JSON.stringify(response.data));
}
async function login(email: string, pass: string): Promise<string> {
  const response = await request("POST", "/api/auth/login", "", { email, password: pass });
  expectStatus(response, 200);
  assert.ok(response.cookie.startsWith("foodbank_session="));
  return response.cookie;
}
async function count(table: "bookings" | "student_notifications", studentId: string): Promise<number> {
  const response = await pool.query<{ total: number }>(
    "SELECT count(*)::integer AS total FROM " + table + " WHERE student_id=$1",
    [studentId]
  );
  return response.rows[0].total;
}
async function check(
  id: string,
  requirementIds: string[],
  title: string,
  work: () => Promise<void>
): Promise<void> {
  const start = performance.now();
  try {
    await work();
    results.push({ id, requirementIds, title, result: PASS, detail: "Assertions passed",
      durationMs: Math.round(performance.now() - start) });
    console.log("PASS", id, "-", title);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    results.push({ id, requirementIds, title, result: "FAIL", detail,
      durationMs: Math.round(performance.now() - start) });
    console.error("FAIL", id, "-", title, "-", detail);
    throw error;
  }
}
async function setup(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const staff = await client.query<{ id: string }>(
      "SELECT id FROM profiles WHERE email='staff.demo@example.com' AND role='staff'"
    );
    assert.ok(staff.rows[0], "Provision the fictional staff demo account first");
    staffId = staff.rows[0].id;
    const t = await client.query<{ id: string }>(
      `INSERT INTO terms(code,name,starts_on,ends_on,minimum_notice_days,
        maximum_notice_days,cancellation_cutoff_hours)
       VALUES ($1, 'Acceptance Test Fictional Term',
         (NOW() AT TIME ZONE 'America/Vancouver')::date-1,
         (NOW() AT TIME ZONE 'America/Vancouver')::date+120,
         7,60,24) RETURNING id`,
      [termCode]
    );
    termId = t.rows[0].id;
    // Three distinct appointments in the same Vancouver week, 3 weeks ahead:
    // neither minimum notice nor cancellation cutoff will mask test intent.
    for (const halfHours of [0, 1, 2]) {
      const s = await client.query<{ id: string }>(
        `INSERT INTO appointment_slots(term_id, starts_at, ends_at, capacity)
         SELECT $1,
           (date_trunc('week', NOW() AT TIME ZONE 'America/Vancouver')
            + INTERVAL '21 days 14 hours'
            + $2::integer*INTERVAL '30 minutes') AT TIME ZONE 'America/Vancouver',
           (date_trunc('week', NOW() AT TIME ZONE 'America/Vancouver')
            + INTERVAL '21 days 14 hours 20 minutes'
            + $2::integer*INTERVAL '30 minutes') AT TIME ZONE 'America/Vancouver',
           1 RETURNING id`,
        [termId, halfHours]
      );
      slotIds.push(s.rows[0].id);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  cookieStaff = await login("staff.demo@example.com", staffPassword!);
}
async function writeResults(): Promise<void> {
  const folder = fileURLToPath(new URL("../results/", import.meta.url));
  await mkdir(folder, { recursive: true });
  const passed = results.filter(x => x.result === PASS).length;
  const failed = results.filter(x => x.result === "FAIL").length;
  const run = process.env.GITHUB_RUN_ID;
  const evidence = run
    ? "https://github.com/BReaney/Food-Bank-System/actions/runs/" + run
    : "Local developer execution (no CI link)";
  const md = [
    "# RSD acceptance test execution",
    "",
    "Automatically generated by `testing/integration/rsdAcceptance.ts`.",
    "These are **real API/database assertions**, not unverified manual scenarios.",
    "",
    "**Run (UTC):** " + new Date().toISOString(),
    "**Commit:** " + (process.env.GITHUB_SHA ?? "local working tree"),
    "**CI evidence:** " + evidence,
    "**Scope:** disposable or gated local fictional `foodbank_dev` database.",
    "",
    "| Checked | Passed | Failed |",
    "|---:|---:|---:|",
    `| ${results.length} | ${passed} | ${failed} |`,
    "",
    "| New test ID | RSD functional IDs | Scenario | Result | Duration (ms) |",
    "|---|---|---|---|---:|",
    ...results.map(x =>
      `| ${x.id} | ${x.requirementIds.join(", ")} | ${x.title.replaceAll("|", "/")} | ${x.result} | ${x.durationMs} |`),
    "",
    ...(failed ? ["## Failures", "", ...results.filter(x => x.result === "FAIL")
      .map(x => "- **" + x.id + "**: " + x.detail), ""] : []),
    "See `testing/requirements-matrix.md` for the RSD traceability and",
    "`testing/test-results.md` for the latest committed review summary.",
    ""
  ].join("\n");
  await writeFile(folder + "/latest-run.md", md);
  await writeFile(folder + "/latest-run.json",
    JSON.stringify({ commit: process.env.GITHUB_SHA ?? "local",
      runUrl: evidence, passed, failed, cases: results }, null, 2) + "\n");
}
async function cleanup(): Promise<void> {
  if (!studentA && !studentB && !termId) return;
  const ids = [studentA, studentB].filter(Boolean);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (ids.length) {
      await client.query(
        `DELETE FROM booking_events WHERE booking_id IN
         (SELECT id FROM bookings WHERE student_id=ANY($1::uuid[]))`, [ids]);
      await client.query("DELETE FROM student_notifications WHERE student_id=ANY($1::uuid[])", [ids]);
      await client.query("DELETE FROM bookings WHERE student_id=ANY($1::uuid[])", [ids]);
      await client.query("DELETE FROM household_events WHERE student_id=ANY($1::uuid[])", [ids]);
      await client.query(
        "DELETE FROM audit_logs WHERE target_id=ANY($1::uuid[])",
        [[...ids, ...[contactId, dependentId].filter(Boolean)]]);
      await client.query("DELETE FROM pickup_contacts WHERE student_id=ANY($1::uuid[])", [ids]);
      await client.query("DELETE FROM dependent_requests WHERE student_id=ANY($1::uuid[])", [ids]);
      await client.query("DELETE FROM enrollment_verification_events WHERE student_id=ANY($1::uuid[])", [ids]);
      await client.query("DELETE FROM enrollment_verifications WHERE student_id=ANY($1::uuid[])", [ids]);
      await client.query("DELETE FROM eligibility_surveys WHERE student_id=ANY($1::uuid[])", [ids]);
      await client.query("DELETE FROM auth_sessions WHERE profile_id=ANY($1::uuid[])", [ids]);
      await client.query("DELETE FROM auth_credentials WHERE profile_id=ANY($1::uuid[])", [ids]);
    }
    if (termId) {
      await client.query("DELETE FROM appointment_slots WHERE term_id=$1", [termId]);
      await client.query("DELETE FROM terms WHERE id=$1", [termId]);
    }
    if (ids.length) await client.query("DELETE FROM profiles WHERE id=ANY($1::uuid[])", [ids]);
    await client.query("COMMIT");
    console.log("Cleaned up acceptance-only fictional profiles and term");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Failed to clean acceptance test fixtures:", error);
    throw error;
  } finally {
    client.release();
  }
}

let failure: unknown = null;
try {
  await setup();

  await check("AT-01", ["F-02", "N-S05"], "Anonymous personal profile access is denied", async () => {
    expectStatus(await request("GET", "/api/profile/me"), 401);
  });
  await check("AT-02", ["F-01", "F-04"], "Registration rejects real-world email domains in demo", async () => {
    expectStatus(await request("POST", "/api/auth/register", "", {
      email: "student@uvic.ca", firstName: "Test", lastName: "Only", password }), 400);
  });
  await check("AT-03", ["F-04"], "Registration rejects missing required names", async () => {
    expectStatus(await request("POST", "/api/auth/register", "", {
      email: emailA, lastName: "Fixture", password }), 400);
  });
  await check("AT-04", ["F-01", "F-05"], "Two fictional student accounts can register without staff role", async () => {
    for (const [email, first] of [[emailA, "AcceptanceA"], [emailB, "AcceptanceB"]]) {
      expectStatus(await request("POST", "/api/auth/register", "", {
        email, firstName: first, lastName: "Fixture", password,
         studentDesignation: "domestic", dietaryRestrictions: ["none"] }), 201);
    }
    const ids = await pool.query<{ id: string; email: string; role: string }>(
      "SELECT id,email,role FROM profiles WHERE email=ANY($1::text[]) ORDER BY email",
      [[emailA, emailB]]);
    assert.equal(ids.rows.length, 2);
    assert.ok(ids.rows.every(x => x.role === "student"));
    studentA = ids.rows.find(x => x.email === emailA)!.id;
    studentB = ids.rows.find(x => x.email === emailB)!.id;
  });
  await check("AT-05", ["F-03"], "Duplicate registration is rejected case-insensitively", async () => {
    expectStatus(await request("POST", "/api/auth/register", "", {
      email: emailA.toUpperCase(), firstName: "Another", lastName: "Fixture", password,
       studentDesignation: "domestic", dietaryRestrictions: ["none"] }), 409);
  });
  await check("AT-06", ["N-S05"], "Incorrect password never starts an authenticated session", async () => {
    expectStatus(await request("POST", "/api/auth/login", "", {
      email: emailA, password: "wrong-password" }), 401);
  });
  await check("AT-07", ["F-01", "F-02"], "Signed-in students can retrieve only their session identity", async () => {
    cookieA = await login(emailA, password);
    cookieB = await login(emailB, password);
    const me = await request("GET", "/api/auth/me", cookieA);
    expectStatus(me, 200);
    assert.equal(me.data.profile.id, studentA);
    assert.equal(me.data.profile.role, "student");
    assert.equal((await request("GET", "/api/auth/me", cookieB)).data.profile.id, studentB);
  });
  await check("AT-08", ["F-04"], "Profile updates require valid nonempty names", async () => {
    expectStatus(await request("PATCH", "/api/profile/me", cookieA,
      {firstName: "", lastName: "Fixture"}), 400);
  });
  await check("AT-09", ["F-02", "N-S06"], "Profile name edit cannot escalate role or change email", async () => {
    const edited = await request("PATCH", "/api/profile/me", cookieA,
      {firstName: "UpdatedFixture", lastName: "Student", role: "staff", email: "staff@fake.test"});
    expectStatus(edited, 200);
    assert.equal(edited.data.profile.first_name, "UpdatedFixture");
    assert.equal(edited.data.profile.role, "student");
    assert.equal(edited.data.profile.email, emailA);
  });
  await check("AT-10", ["F-05", "F-24", "N-S06"], "Student role cannot search private staff records", async () => {
    expectStatus(await request("GET", "/api/staff/records", cookieA), 403);
  });
  await check("AT-11", ["F-08", "F-14"], "New student cannot book without survey and enrollment", async () => {
    expectStatus(await request("POST", "/api/bookings", cookieA,
      {slotId: slotIds[0]}), 403);
    assert.equal(await count("bookings", studentA), 0);
  });
  await check("AT-12", ["F-09"], "Required eligibility survey confirmations cannot be omitted", async () => {
    expectStatus(await request("POST", "/api/eligibility/surveys/" + termId, cookieA,
      {confirmAccurate: true, understandVerification: false}), 400);
  });
  await check("AT-13", ["F-06", "F-07"], "Student can record term-specific survey submission", async () => {
    expectStatus(await request("POST", "/api/eligibility/surveys/" + termId, cookieA,
      {confirmAccurate: true, understandVerification: true}), 201);
    const status = await request("GET", "/api/eligibility/terms", cookieA);
    expectStatus(status, 200);
    const term = status.data.terms.find((x: any) => x.id === termId);
    assert.ok(term.survey_submitted_at);
    assert.equal(term.enrollment_status, "pending");
  });
  await check("AT-14", ["F-07", "F-09"], "Repeat survey submission for the same term is rejected", async () => {
    expectStatus(await request("POST", "/api/eligibility/surveys/" + termId, cookieA,
      {confirmAccurate: true, understandVerification: true}), 409);
  });
  await check("AT-15", ["F-08"], "Survey alone does not authorize a booking", async () => {
    expectStatus(await request("POST", "/api/bookings", cookieA,
      {slotId: slotIds[0]}), 403);
  });
  await check("AT-16", ["F-05", "F-08"], "Only staff can change independent enrollment verification", async () => {
    expectStatus(await request("PUT",
      "/api/staff/enrollments/" + studentA + "/" + termId, cookieA,
      {status: "verified"}), 403);
    expectStatus(await request("PUT",
      "/api/staff/enrollments/" + studentA + "/" + termId, cookieStaff,
      {status: "verified"}), 200);
  });
  await check("AT-17", ["F-07", "F-08", "F-25"], "Staff roster distinguishes survey and enrollment states", async () => {
    const result = await request("GET",
      "/api/staff/enrollments?termId=" + termId + "&search=" + encodeURIComponent(emailA), cookieStaff);
    expectStatus(result, 200);
    const row = result.data.students.find((x: any) => x.id === studentA);
    assert.equal(row.enrollment_status, "verified");
    assert.ok(row.survey_submitted_at);
  });
  await check("AT-18", ["F-14", "F-15", "F-16", "F-18"], "Fully eligible student can book an available slot", async () => {
    const booked = await request("POST", "/api/bookings", cookieA, {slotId: slotIds[0]});
    expectStatus(booked, 201);
    bookingCancelled = booked.data.booking.id;
    assert.ok(UUID.test(bookingCancelled));
    const records = await pool.query<{ student_id: string; status: string }>(
      "SELECT student_id,status FROM bookings WHERE id=$1", [bookingCancelled]);
    assert.equal(records.rows[0].student_id, studentA);
    assert.equal(records.rows[0].status, "booked");
  });
  await check("AT-19", ["F-16", "N-Q11"], "Another eligible student cannot exceed a full slot capacity", async () => {
    expectStatus(await request("POST", "/api/eligibility/surveys/" + termId, cookieB,
      {confirmAccurate: true, understandVerification: true}), 201);
    expectStatus(await request("PUT",
      "/api/staff/enrollments/" + studentB + "/" + termId, cookieStaff,
      {status: "verified"}), 200);
    expectStatus(await request("POST", "/api/bookings", cookieB, {slotId: slotIds[0]}), 409);
    assert.equal(await count("bookings", studentB), 0);
    assert.equal(await count("student_notifications", studentB), 0);
  });
  await check("AT-20", ["F-14", "F-22"], "One active appointment per student per Vancouver week", async () => {
    expectStatus(await request("POST", "/api/bookings", cookieA,
      {slotId: slotIds[1]}), 409);
    assert.equal(await count("bookings", studentA), 1);
  });
  await check("AT-21", ["F-18", "F-25"], "Student booking history and creation event are persisted", async () => {
    const history = await request("GET", "/api/bookings/history", cookieA);
    const events = await request("GET", "/api/bookings/events", cookieA);
    expectStatus(history, 200);
    expectStatus(events, 200);
    assert.ok(history.data.bookings.some((x: any) => x.id === bookingCancelled));
    assert.ok(events.data.events.some((x: any) =>
      x.booking_id === bookingCancelled && x.event_type === "created"));
  });
  await check("AT-22", ["F-18", "F-19", "N-S06"], "Private booking and notifications cannot leak to another student", async () => {
    const bHistory = await request("GET", "/api/bookings/history", cookieB);
    const bNotices = await request("GET", "/api/notifications", cookieB);
    const aNotices = await request("GET", "/api/notifications", cookieA);
    expectStatus(bHistory, 200);
    expectStatus(bNotices, 200);
    expectStatus(aNotices, 200);
    assert.equal(bHistory.data.bookings.length, 0);
    assert.equal(bNotices.data.unreadCount, 0);
    assert.ok(aNotices.data.notifications.some((x: any) =>
      x.booking_id === bookingCancelled && x.category === "booking_confirmed"));
  });
  await check("AT-23", ["F-11", "F-12"], "Third-party contact cannot be created without explicit consent", async () => {
    expectStatus(await request("POST", "/api/household/contacts", cookieA, {
      fullName: "Fictional Pickup", contactMethod: "phone",
      contactValue: "2505550102", consentAccepted: false
    }), 400);
  });
  await check("AT-24", ["F-10", "F-11", "F-13"], "Valid contact is pending and exact consent disclosure is persisted", async () => {
    const disclosure = await request("GET", "/api/household/consent", cookieA);
    expectStatus(disclosure, 200);
    const saved = await request("POST", "/api/household/contacts", cookieA, {
      fullName: "Fictional Pickup", contactMethod: "phone",
      contactValue: "2505550102", consentAccepted: true
    });
    expectStatus(saved, 201);
    contactId = saved.data.contact.id;
    assert.equal(saved.data.contact.status, "pending");
    const row = await pool.query<{consent_text:string,consent_version:string}>(
      "SELECT consent_text,consent_version FROM pickup_contacts WHERE id=$1", [contactId]);
    assert.equal(row.rows[0].consent_text, disclosure.data.text);
    assert.equal(row.rows[0].consent_version, disclosure.data.version);
  });
  await check("AT-25", ["F-05", "F-10", "F-13", "N-S07"], "Only staff can approve a contact; another student cannot edit it", async () => {
    expectStatus(await request("PUT",
      "/api/staff/household/contacts/" + contactId + "/status", cookieA, {status: "confirmed"}), 403);
    expectStatus(await request("PUT",
      "/api/staff/household/contacts/" + contactId + "/status", cookieStaff,
      {status: "confirmed"}), 200);
    expectStatus(await request("PUT", "/api/household/contacts/" + contactId, cookieB, {
      fullName: "Inappropriate Change", contactMethod: "phone",
      contactValue: "2505550109", consentAccepted: true
    }), 404);
    const own = await request("GET", "/api/household/contacts", cookieA);
    assert.equal(own.data.contacts.find((x: any) => x.id === contactId).status, "confirmed");
    assert.equal((await request("GET", "/api/household/contacts", cookieB)).data.contacts.length, 0);
  });
  await check("AT-26", ["F-18", "F-19"], "Cancellation releases capacity and preserves booking history", async () => {
    expectStatus(await request("POST", "/api/bookings/" + bookingCancelled + "/cancel", cookieA), 200);
    const booking = await pool.query<{ status: string }>(
      "SELECT status FROM bookings WHERE id=$1", [bookingCancelled]);
    assert.equal(booking.rows[0].status, "cancelled");
    const slots = await request("GET", "/api/slots", cookieA);
    const slot = slots.data.slots.find((x: any) => x.id === slotIds[0]);
    assert.equal(slot.remaining_capacity, 1);
  });
  await check("AT-27", ["F-18", "F-19"], "Cancellation notices persist; repeated cancellation cannot double-write", async () => {
    expectStatus(await request("POST", "/api/bookings/" + bookingCancelled + "/cancel", cookieA), 409);
    const notices = await request("GET", "/api/notifications", cookieA);
    const cancellations = notices.data.notifications.filter((n: any) =>
      n.booking_id === bookingCancelled && n.category === "booking_cancelled");
    assert.equal(cancellations.length, 1);
    const events = await request("GET", "/api/bookings/events", cookieA);
    assert.equal(events.data.events.filter((e: any) =>
      e.booking_id === bookingCancelled && e.event_type === "cancelled").length, 1);
  });
  await check("AT-28", ["F-10", "F-13"], "Dependent approval changes pending registration to confirmed", async () => {
    const created = await request("POST", "/api/household/dependents", cookieA,
      {fullName: "Fictional Child", relationship: "child"});
    expectStatus(created, 201);
    dependentId = created.data.dependent.id;
    assert.equal(created.data.dependent.status, "pending");
    expectStatus(await request("PUT",
      "/api/staff/household/dependents/" + dependentId + "/status", cookieStaff,
      {status: "confirmed"}), 200);
    const own = await request("GET", "/api/household/dependents", cookieA);
    assert.equal(own.data.dependents.find((x: any) => x.id === dependentId).status, "confirmed");
  });
  await check("AT-29", ["F-15", "F-17"], "Student can book a newly freed slot using approved third-party pickup", async () => {
    const result = await request("POST", "/api/bookings", cookieA, {
      slotId: slotIds[0], pickupKind: "third_party", pickupId: contactId
    });
    expectStatus(result, 201);
    bookingActive = result.data.booking.id;
    const booking = await pool.query<{ pickup_kind: string; pickup_contact_id: string }>(
      "SELECT pickup_kind,pickup_contact_id FROM bookings WHERE id=$1", [bookingActive]);
    assert.equal(booking.rows[0].pickup_kind, "third_party");
    assert.equal(booking.rows[0].pickup_contact_id, contactId);
  });
  await check("AT-30", ["F-18", "F-19"], "Reschedule preserves booking ID, event, and private notice", async () => {
    const response = await request("POST",
      "/api/bookings/" + bookingActive + "/reschedule", cookieA, {slotId: slotIds[1]});
    expectStatus(response, 200);
    assert.equal(response.data.booking.id, bookingActive);
    const moved = await pool.query<{ slot_id: string }>(
      "SELECT slot_id FROM bookings WHERE id=$1", [bookingActive]);
    assert.equal(moved.rows[0].slot_id, slotIds[1]);
    const notices = await request("GET", "/api/notifications", cookieA);
    assert.ok(notices.data.notifications.some((x: any) =>
      x.booking_id === bookingActive && x.category === "booking_rescheduled"));
    const events = await request("GET", "/api/bookings/events", cookieA);
    assert.ok(events.data.events.some((x: any) =>
      x.booking_id === bookingActive && x.event_type === "rescheduled"));
  });
  await check("AT-31", ["F-24", "F-25"], "Staff student record contains term, household and appointment histories", async () => {
    const result = await request("GET", "/api/staff/records/" + studentA, cookieStaff);
    expectStatus(result, 200);
    assert.equal(result.data.student.id, studentA);
    assert.ok(result.data.terms.some((x: any) => x.id === termId && x.enrollment_status === "verified"));
    assert.ok(result.data.enrollmentEvents.some((x: any) => x.term_id === termId));
    assert.ok(result.data.appointments.some((x: any) => x.id === bookingActive));
    assert.ok(result.data.dependents.some((x: any) => x.id === dependentId));
    assert.ok(result.data.contacts.some((x: any) => x.id === contactId));
    assert.ok(!JSON.stringify(result.data).includes("FictionalAcceptanceOnly_1234"));
  });
  await check("AT-32", ["F-24", "F-26"], "Unmatched staff student search returns an empty result page", async () => {
    const result = await request("GET",
      "/api/staff/records?search=" + encodeURIComponent("no-match-" + suffix), cookieStaff);
    expectStatus(result, 200);
    assert.equal(result.data.pagination.total, 0);
    assert.deepEqual(result.data.students, []);
    // UI exact text "No Records Found" is validated in manual RSD TS-07.
  });
  await check("AT-33", ["F-23"], "Usage report counts active and cancelled bookings consistently", async () => {
    const result = await request("GET",
      "/api/staff/reports/usage?termId=" + termId, cookieStaff);
    expectStatus(result, 200);
    assert.equal(result.data.report.totals.booked, 1);
    assert.equal(result.data.report.totals.cancelled, 1);
    assert.equal(result.data.report.totals.total, 2);
    assert.equal(result.data.report.totals.students_served, 0);
    expectStatus(await request("GET", "/api/staff/reports/usage?termId=" + termId, cookieA), 403);
  });
  await check("AT-34", ["N-S08", "F-05"], "Staff writes audit events without private survey/contact details", async () => {
    const audits = await pool.query<{ action: string; details: any }>(
      `SELECT action,details FROM audit_logs
       WHERE (target_id=ANY($1::uuid[]))
         AND action IN ('enrollment_status_changed',
           'household_status_changed','staff_student_record_viewed')`,
      [[studentA, dependentId, contactId]]
    );
    for (const action of ["enrollment_status_changed",
      "household_status_changed", "staff_student_record_viewed"]) {
      assert.ok(audits.rows.some(x => x.action === action), action);
    }
    const details = JSON.stringify(audits.rows.map(x => x.details));
    assert.ok(!details.includes(emailA));
    assert.ok(!details.includes("2505550102"));
    assert.ok(!details.includes("Fictional Pickup"));
  });
  await check("AT-35", ["F-19", "N-S06"], "Unread notifications and read-all are scoped and idempotent", async () => {
    const aBefore = await request("GET", "/api/notifications", cookieA);
    const bBefore = await request("GET", "/api/notifications", cookieB);
    expectStatus(aBefore, 200);
    expectStatus(bBefore, 200);
    assert.ok(aBefore.data.unreadCount >= 4);
    assert.equal(bBefore.data.unreadCount, 0);
    const item = aBefore.data.notifications[0];
    expectStatus(await request("PATCH", "/api/notifications/" + item.id + "/read", cookieB), 404);
    expectStatus(await request("PATCH", "/api/notifications/read-all", cookieA), 200);
    assert.equal((await request("GET", "/api/notifications", cookieA)).data.unreadCount, 0);
    assert.equal((await request("PATCH", "/api/notifications/read-all", cookieA))
      .data.updatedCount, 0);
    assert.equal((await request("GET", "/api/notifications", cookieB)).data.unreadCount, 0);
  });
  await check("AT-36", ["N-S05"], "Logout revokes the session even if the old cookie is reused", async () => {
    expectStatus(await request("POST", "/api/auth/logout", cookieA), 200);
    expectStatus(await request("GET", "/api/auth/me", cookieA), 401);
  });

  assert.equal(results.length, 36, "Expected all 36 acceptance cases to execute");
  assert.ok(results.every(x => x.result === PASS));
  console.log("RSD acceptance suite: 36/36 new cases passed.");
} catch (error) {
  failure = error;
} finally {
  try { await writeResults(); }
  catch (error) { failure ??= error; console.error("Test report generation failed", error); }
  try { await cleanup(); }
  catch (error) { failure ??= error; }
  await pool.end();
}
if (failure) throw failure;
