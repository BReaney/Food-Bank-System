// Verify links in the current documentation entry points before publishing.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const pages = [
  "README.md",
  "docs/README.md",
  "docs/architecture.md",
  "database/README.md",
  "frontend/README.md",
  "backend/BOOKING_DEMO.md",
  "testing/README.md"
];
const failures = [];
let checked = 0;

for (const filename of pages) {
  const fullPath = resolve(root, filename);
  assert.ok(existsSync(fullPath), filename + " must exist");
  const text = readFileSync(fullPath, "utf8");

  // This lightweight check verifies local file destinations; it does not
  // access external links or guarantee that heading anchors exist.
  const markdownLink = /!?\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of text.matchAll(markdownLink)) {
    let target = match[1].trim().split(/\s+["']/)[0];
    if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
    if (!target || target.startsWith("#") ||
        /^(https?:|mailto:|tel:|data:)/i.test(target)) continue;
    const pathOnly = target.split("#")[0].split("?")[0];
    const linkPath = resolve(dirname(fullPath), decodeURIComponent(pathOnly));
    if (isAbsolute(pathOnly) || relative(root, linkPath).startsWith("..") ||
        !existsSync(linkPath)) {
      failures.push(filename + " -> " + target);
    }
    checked++;
  }
}

const readme = readFileSync(resolve(root, "README.md"), "utf8");
for (const heading of [
  "# Food Bank Booking System",
  "## Features",
  "## Technology stack",
  "## Run locally",
  "## Testing and results",
  "## Repository structure",
  "## Known limitations and security"
]) {
  assert.ok(readme.includes(heading), "Root README missing: " + heading);
}
assert.match(readme, /NOT affiliated[^\n]+University of Victoria/);
assert.match(readme, /Students' Society \(UVSS\)/);
assert.match(readme, /personal development/);

if (failures.length > 0) {
  console.error("Broken local documentation links:\n" + failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Documentation verified: " + pages.length +
    " entry points and " + checked + " local links.");
}
