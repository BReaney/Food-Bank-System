import express from "express";
import { pool } from "../db.js";
import { currentAccount, requireUser } from "../security/sessions.js";
import { validName } from "../security/passwords.js";

export const profileRouter = express.Router();
profileRouter.use(requireUser);

// The identity comes from the verified session, never from a query parameter.
profileRouter.get("/me", (req, res) => {
  res.json({ profile: currentAccount(req) });
});

// Only name fields are editable for now; role and email cannot be changed
// through this endpoint. Email changes will need verification in future.
profileRouter.patch("/me", async (req, res) => {
  const { firstName, lastName } = req.body ?? {};
  if (!validName(firstName) || !validName(lastName)) {
    res.status(400).json({ error: "First and last names are required (maximum 100 characters)" });
    return;
  }

  const account = currentAccount(req);
  const result = await pool.query(
    "UPDATE profiles SET first_name = $1, last_name = $2 " +
    "WHERE id = $3 RETURNING id, email, first_name, last_name, role",
    [firstName.trim(), lastName.trim(), account.id]
  );
  res.json({ profile: result.rows[0] });
});
