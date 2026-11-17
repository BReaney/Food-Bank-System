// Run with: npm run test:auth (from backend)
// This exercises the LOCAL HTTP API and only creates fictional test records.
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = "http://localhost:3001";
const origin = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";

async function send(
  path: string,
  method: "GET" | "POST" | "PATCH" = "GET",
  body?: unknown,
  cookie?: string
): Promise<Response> {
  const headers: Record<string, string> = { Origin: origin };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;

  return fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

function sessionCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const firstCookie = setCookie.split(";")[0];
  assert.ok(firstCookie.startsWith("foodbank_session="), "Login did not set a session cookie");
  return firstCookie;
}

const studentPassword = "LocallyGeneratedTest_" + randomUUID();
const email = "test-" + randomUUID() + "@example.test";
const registration = {
  email, firstName: "Taylor", lastName: "Example",
  password: studentPassword, role: "staff" // Must be ignored.
};

assert.equal((await send("/api/auth/me")).status, 401);
console.log("PASS: anonymous requests cannot read a profile");

assert.equal((await send("/api/auth/register", "POST", registration)).status, 201);
assert.equal((await send("/api/auth/register", "POST", registration)).status, 409);
console.log("PASS: register a fictional student, block duplicate email");

assert.equal(
  (await send("/api/auth/login", "POST", {email, password: "IncorrectPassword123"})).status,
  401
);
const studentLogin = await send("/api/auth/login", "POST", {
  email, password: studentPassword
});
assert.equal(studentLogin.status, 200);
const studentCookie = sessionCookie(studentLogin);
console.log("PASS: invalid password rejected, valid login creates session");

const me = await send("/api/auth/me", "GET", undefined, studentCookie);
const myData = await me.json() as { profile: { id: string; role: string } };
assert.equal(me.status, 200);
assert.equal(myData.profile.role, "student");
assert.equal(
  (await send("/api/staff/profiles", "GET", undefined, studentCookie)).status,
  403
);
console.log("PASS: student cannot self-assign staff role or read staff records");

const edited = await send("/api/profile/me", "PATCH", {
  firstName: "New Taylor", lastName: "Example", role: "staff"
}, studentCookie);
const editedData = await edited.json() as {
  profile: { first_name: string; role: string }
};
assert.equal(edited.status, 200);
assert.equal(editedData.profile.first_name, "New Taylor");
assert.equal(editedData.profile.role, "student");
console.log("PASS: student can edit their own name but cannot change role");

const staffPassword = process.env.DEMO_STAFF_PASSWORD;
assert.ok(staffPassword, "Set DEMO_STAFF_PASSWORD in backend/.env first");
const staffLogin = await send("/api/auth/login", "POST", {
  email: "staff.demo@example.com", password: staffPassword
});
assert.equal(staffLogin.status, 200, "Seed/provision the fictional staff login first");
const staffCookie = sessionCookie(staffLogin);
const directory = await send("/api/staff/profiles", "GET", undefined, staffCookie);
assert.equal(directory.status, 200);
assert.equal(
  (await send("/api/bookings", "GET", undefined, staffCookie)).status,
  403
);
console.log("PASS: staff sees student directory but cannot use student booking endpoint");

assert.equal(
  (await send("/api/auth/logout", "POST", {}, studentCookie)).status,
  200
);
assert.equal(
  (await send("/api/auth/me", "GET", undefined, studentCookie)).status,
  401
);
console.log("PASS: logout revokes the session");
console.log("Authentication smoke tests passed.");
