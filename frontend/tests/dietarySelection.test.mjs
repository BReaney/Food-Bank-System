import test from "node:test";
import assert from "node:assert/strict";
import { changeDietarySelection, DIETARY_OPTIONS } from "../src/dietarySelection.ts";

test("the menu contains exactly the six agreed dietary options", () => {
  assert.deepEqual(DIETARY_OPTIONS.map(option => option.value), [
    "vegetarian", "kosher", "gluten-free", "vegan", "halal", "none"
  ]);
});
test("multiple dietary restrictions can be selected together", () => {
  assert.deepEqual(changeDietarySelection(["vegetarian"], "gluten-free", true),
    ["vegetarian", "gluten-free"]);
});
test("selecting None clears prior restrictions", () => {
  assert.deepEqual(changeDietarySelection(["vegan", "halal"], "none", true), ["none"]);
});
test("selecting a restriction after None removes None", () => {
  assert.deepEqual(changeDietarySelection(["none"], "kosher", true), ["kosher"]);
});
test("unchecking a restriction removes only that restriction", () => {
  assert.deepEqual(changeDietarySelection(["vegetarian", "gluten-free"], "vegetarian", false),
    ["gluten-free"]);
});
test("deselecting None returns to unspecified, not an invented restriction", () => {
  assert.deepEqual(changeDietarySelection(["none"], "none", false), []);
});
test("rechecking an existing restriction does not add duplicate values", () => {
  assert.deepEqual(changeDietarySelection(["vegan"], "vegan", true), ["vegan"]);
});
