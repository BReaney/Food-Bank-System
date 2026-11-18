import assert from "node:assert/strict";
import test from "node:test";
import {
  studentPages,
  staffPages,
  pagesForRole,
  pageHash,
  resolvePage,
  canonicalPageHash
} from "../src/pageNavigation.ts";

test("student and staff have separate page menus, with a personal profile page", () => {
  assert.deepEqual(
    studentPages.map(page => page.id),
    ["appointments", "eligibility", "household", "notifications", "profile"]
  );
  assert.deepEqual(
    staffPages.map(page => page.id),
    ["calendar", "appointments", "enrollment", "household", "records", "reports", "profile"]
  );
  assert.deepEqual(pagesForRole("student"), studentPages);
  assert.deepEqual(pagesForRole("staff"), staffPages);
  for (const pages of [studentPages, staffPages]) {
    assert.equal(new Set(pages.map(p => p.id)).size, pages.length);
    assert.ok(pages.every(p => p.label && p.description));
  }
});

test("all route links are stable across refresh and browser history navigation", () => {
  for (const role of ["student", "staff"]) {
    for (const page of pagesForRole(role)) {
      const hash = pageHash(role, page.id);
      assert.equal(resolvePage(role, hash).id, page.id);
      assert.equal(canonicalPageHash(role, hash), hash);
    }
  }
});

test("cross-role, old, unknown and malformed URLs fall back to safe role pages", () => {
  for (const role of ["student", "staff"]) {
    const defaultPage = pagesForRole(role)[0];
    for (const hash of ["", "#", "#/dashboard", "#/staff/nonexistent",
      "#/student/nonexistent", "#/student/appointments?x=1",
      "#/student/../../records", "#/STAFF/records"]) {
      assert.equal(resolvePage(role, hash)?.id, defaultPage.id);
      assert.equal(canonicalPageHash(role, hash), pageHash(role, defaultPage.id));
    }
  }
  assert.equal(resolvePage("student", "#/staff/records").id, "appointments");
  assert.equal(resolvePage("staff", "#/student/household").id, "calendar");
  assert.equal(resolvePage("student", "#/student/profile").id, "profile");
  assert.equal(resolvePage("staff", "#/staff/profile").id, "profile");
});
