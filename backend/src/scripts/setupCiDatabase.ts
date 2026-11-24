// CI-only setup for a throwaway PostgreSQL instance.
// Do not run against a normal development or production database.
import { readFile } from "node:fs/promises";
import "dotenv/config";
import { pool } from "../db.js";

if (process.env.CI !== "true" ||
    !["localhost", "127.0.0.1"].includes(process.env.PGHOST ?? "") ||
    process.env.PGDATABASE !== "foodbank_dev" ||
    process.env.NODE_ENV === "production") {
  throw new Error("Refusing to initialize database outside local CI fixture");
}

const migration1 = new URL("../../../database/migrations/001_core.sql", import.meta.url);
const migration2 = new URL("../../../database/migrations/002_auth.sql", import.meta.url);
const migration3 = new URL("../../../database/migrations/003_enrollment_history.sql", import.meta.url);
const migration4 = new URL("../../../database/migrations/004_household_pickups.sql", import.meta.url);
const migration5 = new URL("../../../database/migrations/005_staff_calendar.sql", import.meta.url);
const migration6 = new URL("../../../database/migrations/006_booking_notifications.sql", import.meta.url);
const migration7 = new URL("../../../database/migrations/007_student_profile_preferences.sql", import.meta.url);
const seed = new URL("../../../database/seed/demo.sql", import.meta.url);

try {
  for (const url of [migration1, migration2, migration3, migration4, migration5, migration6, migration7, seed]) {
    const sql = await readFile(url, "utf8");
    await pool.query(sql);
    console.log("Applied CI SQL fixture:", url.pathname.split("/").pop());
  }
} finally {
  await pool.end();
}
