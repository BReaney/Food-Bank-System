import assert from "node:assert/strict";
import test from "node:test";
import { revealActionError } from "../src/noticeNavigation.ts";

function fakeNotice() {
  const actions = [];
  return {
    actions,
    focus(options) { actions.push({ name: "focus", options }); },
    scrollIntoView(options) { actions.push({ name: "scroll", options }); }
  };
}

test("an action error receives focus before smooth scrolling into view", () => {
  const notice = fakeNotice();
  revealActionError(notice, false);
  assert.deepEqual(notice.actions, [
    { name: "focus", options: { preventScroll: true } },
    { name: "scroll", options: { behavior: "smooth", block: "start" } }
  ]);
});

test("action error scrolling honors reduced motion preferences", () => {
  const notice = fakeNotice();
  revealActionError(notice, true);
  assert.deepEqual(notice.actions, [
    { name: "focus", options: { preventScroll: true } },
    { name: "scroll", options: { behavior: "auto", block: "start" } }
  ]);
});
