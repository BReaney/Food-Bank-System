// Local CLI provisioning of known fictional accounts. This deliberately
// avoids public staff signup or letting a student choose role='staff'.
import "dotenv/config";
import { pool } from "../db.js";
import { hashPassword, validDemoPassword } from "../security/passwords.js";

if (process.env.NODE_ENV === "production" ||
    !["localhost", "127.0.0.1"].includes(process.env.PGHOST ?? "") ||
    process.env.PGDATABASE !== "foodbank_dev") {
  throw new Error("Demo provisioning is restricted to local foodbank_dev");
}

const demoAccounts = [
  {
    email: "staff.demo@example.com",
    firstName: "Sam",
    lastName: "Example",
    role: "staff",
    password: process.env.DEMO_STAFF_PASSWORD
  },
  {
    email: "alex.demo@example.com",
    firstName: "Alex",
    lastName: "Example",
    role: "student",
    password: process.env.DEMO_STUDENT_PASSWORD
  }
] as const;

if (demoAccounts.some(account => !validDemoPassword(account.password))) {
  throw new Error(
    "Set DEMO_STAFF_PASSWORD and DEMO_STUDENT_PASSWORD in backend/.env " +
    "to two different passwords, each at least 12 characters"
  );
}
if (demoAccounts[0].password === demoAccounts[1].password) {
  throw new Error("Use different passwords for the two demonstration accounts");
}

try {
  for (const account of demoAccounts) {
    const hash = await hashPassword(account.password as string);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO profiles (email, first_name, last_name, role) " +
        "VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
        [account.email, account.firstName, account.lastName, account.role]
      );
      const result = await client.query<{ id: string; role: string }>(
        "SELECT id, role FROM profiles WHERE lower(email) = $1",
        [account.email]
      );
      if (!result.rows[0] || result.rows[0].role !== account.role) {
        throw new Error("Existing demonstration profile has an unexpected role");
      }
      await client.query(
        "INSERT INTO auth_credentials (profile_id, password_hash) " +
        "VALUES ($1, $2) ON CONFLICT (profile_id) DO UPDATE " +
        "SET password_hash = EXCLUDED.password_hash, updated_at = NOW()",
        [result.rows[0].id, hash]
      );
      await client.query("COMMIT");
      console.log("Provisioned fictional " + account.role + ": " + account.email);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
