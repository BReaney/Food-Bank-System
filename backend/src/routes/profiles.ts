import express from "express";
import { pool } from "../db.js";
import { currentAccount, requireUser } from "../security/sessions.js";
import { validName } from "../security/passwords.js";
import { validStudentDesignation, validDietaryRestrictions } from "../utils/profilePreferences.js";

export const profileRouter = express.Router();
profileRouter.use(requireUser);

// The identity comes from the verified session, never from a query parameter.
profileRouter.get("/me", (req, res) => {
  res.json({ profile: currentAccount(req) });
});

// Students may update self-reported preferences; email and role stay read-only.
// Existing callers can update name fields without specifying new preference fields.
profileRouter.patch("/me", async (req, res) => {
  const { firstName, lastName, studentDesignation, dietaryRestrictions } = req.body ?? {};
  const hasDesignation = Object.prototype.hasOwnProperty.call(req.body ?? {}, "studentDesignation");
  const hasDietary = Object.prototype.hasOwnProperty.call(req.body ?? {}, "dietaryRestrictions");
  if (!validName(firstName) || !validName(lastName)) {
    res.status(400).json({ error: "First and last names are required (maximum 100 characters)" });
    return;
  }

  const account = currentAccount(req);
  if (account.role !== "student" && (hasDesignation || hasDietary)) {
    res.status(403).json({ error: "Only student profiles can set student preferences" });
    return;
  }
  if ((hasDesignation && !validStudentDesignation(studentDesignation)) ||
      (hasDietary && !validDietaryRestrictions(dietaryRestrictions))) {
    res.status(400).json({
      error: "Select domestic or international student status and valid dietary " +
        "options. None cannot be combined with other options."
    });
    return;
  }
  const result = await pool.query(
    "UPDATE profiles SET first_name=$1, last_name=$2, " +
    "student_designation=CASE WHEN $3::boolean THEN $4::text ELSE student_designation END, " +
    "dietary_restrictions=CASE WHEN $5::boolean THEN $6::text[] ELSE dietary_restrictions END " +
    "WHERE id=$7 RETURNING id, email, first_name, last_name, role, " +
    "student_designation, dietary_restrictions",
    [firstName.trim(), lastName.trim(), hasDesignation,
      hasDesignation ? studentDesignation : null, hasDietary,
      hasDietary ? dietaryRestrictions : null, account.id]
  );
  res.json({ profile: result.rows[0] });
});
