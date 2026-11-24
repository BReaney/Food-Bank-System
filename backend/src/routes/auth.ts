import express from "express";
import { pool } from "../db.js";
import { hashPassword, normalizeDemoEmail, validDemoPassword, validName, verifyPassword } from "../security/passwords.js";
import { currentAccount, endSession, requireUser, startSession } from "../security/sessions.js";
import { validStudentDesignation, validDietaryRestrictions } from "../utils/profilePreferences.js";

export const authRouter = express.Router();

// Public student registration. For this prototype, allow only fictional
// example.test / example.com email addresses, not real university email.
authRouter.post("/register", async (req, res) => {
  const { email: rawEmail, firstName, lastName, password,
    studentDesignation, dietaryRestrictions } = req.body ?? {};
  const email = normalizeDemoEmail(rawEmail);

  if (!email || !validName(firstName) || !validName(lastName) ||
      !validDemoPassword(password)) {
    res.status(400).json({
      error: "Enter a fictional @example.test email, first and last names, " +
        "and a password of 12–128 characters"
    });
    return;
  }

  if (!validStudentDesignation(studentDesignation) ||
      !validDietaryRestrictions(dietaryRestrictions)) {
    res.status(400).json({
      error: "Select domestic or international student status and at least one " +
        "valid dietary option. None cannot be combined with other options."
    });
    return;
  }

  const passwordHash = await hashPassword(password);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const created = await client.query<{ id: string }>(
      "INSERT INTO profiles (email, first_name, last_name, role, " +
      "student_designation, dietary_restrictions) " +
      "VALUES ($1, $2, $3, 'student', $4, $5::text[]) RETURNING id",
      [email, firstName.trim(), lastName.trim(), studentDesignation, dietaryRestrictions]
    );
    await client.query(
      "INSERT INTO auth_credentials (profile_id, password_hash) VALUES ($1, $2)",
      [created.rows[0].id, passwordHash]
    );
    await client.query("COMMIT");
    res.status(201).json({
      message: "Student profile created. You can now sign in. " +
        "Staff approval and a survey are required before booking."
    });
  } catch (error) {
    await client.query("ROLLBACK");
    if (typeof error === "object" && error !== null &&
        "code" in error && error.code === "23505") {
      res.status(409).json({ error: "An account with this email already exists" });
      return;
    }
    throw error;
  } finally {
    client.release();
  }
});

authRouter.post("/login", async (req, res) => {
  const email = normalizeDemoEmail(req.body?.email);
  const password: unknown = req.body?.password;
  if (!email || typeof password !== "string" || password.length > 128) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const result = await pool.query<{ id: string; password_hash: string }>(
    "SELECT p.id, c.password_hash FROM profiles AS p " +
    "JOIN auth_credentials AS c ON c.profile_id = p.id " +
    "WHERE lower(p.email) = $1",
    [email]
  );
  const record = result.rows[0];

  if (!record || !(await verifyPassword(password, record.password_hash))) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  await startSession(res, record.id);
  res.json({ message: "Signed in" });
});

authRouter.get("/me", requireUser, (req, res) => {
  res.json({ profile: currentAccount(req) });
});

authRouter.post("/logout", async (req, res) => {
  await endSession(req, res);
  res.json({ message: "Signed out" });
});
