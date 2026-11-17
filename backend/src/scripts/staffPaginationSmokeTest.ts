// Staff pagination integration check; creates and removes ONLY its own
// fictional profiles. Run while the backend is active (npm run dev).
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../db.js";

const API = "http://localhost:3001";
const ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";

interface PageResponse {
  students: { id: string; email: string }[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
}

async function get(path: string, cookie?: string): Promise<{ status: number; data: unknown }> {
  const response = await fetch(API + path, {
    headers: {
      Origin: ORIGIN,
      ...(cookie ? { Cookie: cookie } : {})
    }
  });
  return { status: response.status, data: await response.json() };
}

async function signIn(email: string, password: string): Promise<string> {
  const response = await fetch(API + "/api/auth/login", {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  assert.equal(response.status, 200, "Fictional account login must succeed");
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
  assert.ok(cookie.startsWith("foodbank_session="));
  return cookie;
}

function assertPage(result: { status: number; data: unknown }): PageResponse {
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data as PageResponse;
}

const staffPassword = process.env.DEMO_STAFF_PASSWORD;
const studentPassword = process.env.DEMO_STUDENT_PASSWORD;
assert.ok(staffPassword && studentPassword,
  "Set DEMO_STAFF_PASSWORD and DEMO_STUDENT_PASSWORD in backend/.env");

const emailPrefix = "pagination-" + randomUUID();
const emails = Array.from(
  { length: 55 },
  (_, index) => emailPrefix + "-" + String(index + 1).padStart(3, "0") + "@example.test"
);
let createdIds: string[] = [];

try {
  const created = await pool.query<{ id: string }>(
    "INSERT INTO profiles (email, first_name, last_name, role) " +
    "SELECT item.email, 'Paged', 'Fixture', 'student' " +
    "FROM unnest($1::text[]) AS item(email) RETURNING id",
    [emails]
  );
  createdIds = created.rows.map(row => row.id);
  assert.equal(createdIds.length, 55);

  const staffCookie = await signIn("staff.demo@example.com", staffPassword);
  const studentCookie = await signIn("alex.demo@example.com", studentPassword);
  const termsResponse = await get("/api/terms", staffCookie);
  assert.equal(termsResponse.status, 200);
  const terms = (termsResponse.data as { terms: { id: string; code: string }[] }).terms;
  const term = terms.find(value => value.code === "DEMO");
  assert.ok(term, "Demo term is required");

  const base = "/api/staff/enrollments?termId=" + encodeURIComponent(term.id);
  assert.equal((await get(base)).status, 401);
  assert.equal((await get(base, studentCookie)).status, 403);
  assert.equal((await get("/api/staff/profiles", studentCookie)).status, 403);
  console.log("PASS: only logged-in staff may read rosters");

  for (const suffix of ["&limit=0", "&limit=101", "&offset=-1", "&offset=1000001",
                         "&search=" + "A".repeat(101), "&search=a&search=b"]) {
    assert.equal((await get(base + suffix, staffCookie)).status, 400, suffix);
  }
  assert.equal((await get("/api/staff/profiles?limit=101", staffCookie)).status, 400);
  console.log("PASS: invalid pagination and search parameters are rejected");

  const search = "&search=" + encodeURIComponent(emailPrefix);
  const first = assertPage(await get(base + search + "&limit=10&offset=0", staffCookie));
  const second = assertPage(await get(base + search + "&limit=10&offset=10", staffCookie));
  const last = assertPage(await get(base + search + "&limit=10&offset=50", staffCookie));
  const pastLast = assertPage(await get(base + search + "&limit=10&offset=60", staffCookie));

  assert.equal(first.pagination.total, 55);
  assert.equal(first.students.length, 10);
  assert.equal(first.pagination.limit, 10);
  assert.equal(first.pagination.offset, 0);
  assert.equal(first.pagination.hasNext, true);
  assert.equal(first.pagination.hasPrevious, false);
  assert.equal(second.students.length, 10);
  assert.equal(second.pagination.hasPrevious, true);
  assert.equal(last.students.length, 5);
  assert.equal(last.pagination.hasNext, false);
  assert.equal(pastLast.students.length, 0);
  assert.equal(pastLast.pagination.total, 55);
  assert.equal(pastLast.pagination.hasNext, false);
  const distinctIds = new Set([...first.students, ...second.students, ...last.students]
    .map(student => student.id));
  assert.equal(distinctIds.size, 25, "Pages must not repeat profiles");
  console.log("PASS: stable pages, total count, final partial page, and out-of-range offset");

  const upper = assertPage(await get(
    base + "&search=" + encodeURIComponent(emailPrefix.toUpperCase()) + "&limit=25",
    staffCookie
  ));
  assert.equal(upper.pagination.total, 55);
  const missing = assertPage(await get(
    base + "&search=" + encodeURIComponent("NO_MATCH_" + randomUUID()), staffCookie
  ));
  assert.equal(missing.pagination.total, 0);
  assert.equal(missing.students.length, 0);
  const wildcardLiteral = assertPage(await get(base + "&search=%25", staffCookie));
  assert.equal(wildcardLiteral.pagination.total, 0, "Percent sign must be literal");
  console.log("PASS: literal, case-insensitive search and empty-result state");

  const directory = assertPage(await get(
    "/api/staff/profiles?search=" + encodeURIComponent(emailPrefix) + "&limit=25&offset=25",
    staffCookie
  ));
  assert.equal(directory.pagination.total, 55);
  assert.equal(directory.students.length, 25);
  assert.equal(directory.pagination.offset, 25);
  assert.equal(directory.pagination.hasNext, true);
  console.log("PASS: staff student directory supports the same pagination");

  const unfiltered = assertPage(await get(base + "&limit=25", staffCookie));
  assert.ok(unfiltered.pagination.total >= 55);
  assert.equal(unfiltered.students.length, 25);
  console.log("PASS: unfiltered staff roster no longer stops at 200 students");
  console.log("Staff pagination integration tests passed.");
} finally {
  if (createdIds.length > 0) {
    await pool.query(
      "DELETE FROM profiles WHERE id = ANY($1::uuid[])",
      [createdIds]
    );
    console.log("Cleaned up pagination-only fictional student profiles");
  }
  await pool.end();
}
