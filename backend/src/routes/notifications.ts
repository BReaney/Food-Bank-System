import express from "express";
import { pool } from "../db.js";
import { currentAccount, requireUser, requireRole } from "../security/sessions.js";

export const notificationsRouter = express.Router();
notificationsRouter.use(requireUser, requireRole("student"));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Only the signed-in student's messages; no arbitrary user ID input.
notificationsRouter.get("/", async (req,res) => {
  try {
    const result=await pool.query(
      `SELECT id, booking_id, category, message, created_at, read_at
       FROM student_notifications
       WHERE student_id=$1
       ORDER BY created_at DESC,id DESC LIMIT 50`,
      [currentAccount(req).id]
    );
    res.json({ notifications:result.rows });
  } catch(error) {
    console.error("Failed to load private notifications:",error);
    res.status(500).json({error:"Unable to retrieve notifications"});
  }
});
notificationsRouter.patch("/:id/read", async(req,res) => {
  const id=req.params.id;
  if(typeof id!=="string"||!UUID.test(id)) {
    res.status(400).json({error:"Invalid notification ID"});
    return;
  }
  try {
    const result=await pool.query(
      `UPDATE student_notifications SET read_at=COALESCE(read_at,NOW())
       WHERE id=$1 AND student_id=$2 RETURNING id,read_at`,
      [id,currentAccount(req).id]
    );
    if(!result.rows[0]) {
      res.status(404).json({error:"Notification not found"});return;
    }
    res.json({notification:result.rows[0]});
  } catch(error) {
    console.error("Failed to acknowledge notification:",error);
    res.status(500).json({error:"Unable to acknowledge notification"});
  }
});
