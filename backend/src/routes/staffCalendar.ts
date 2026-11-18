import express from "express";
import type { PoolClient } from "pg";
import { pool } from "../db.js";
import { currentAccount, requireRole, requireUser } from "../security/sessions.js";

export const staffCalendarRouter = express.Router();
staffCalendarRouter.use(requireUser, requireRole("staff"));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d\d-\d\d$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const LOCAL = /^\d{4}-\d\d-\d\dT([01]\d|2[0-3]):[0-5]\d$/;
const ZONE = "America/Vancouver";

class CalendarError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
function reject(res: express.Response, error: unknown) {
  if (error instanceof CalendarError) {
    res.status(error.status).json({ error: error.message });
  } else if (error && typeof error === "object" && "code" in error &&
             (error.code === "23505" || error.code === "23P01")) {
    res.status(409).json({ error: "A slot or term with this schedule already exists" });
  } else {
    console.error("Staff calendar operation failed:", error);
    res.status(500).json({ error: "Unable to update staff calendar" });
  }
}
function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const dt = new Date(value + "T12:00:00Z");
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === value;
}
function validLocal(value: unknown): value is string {
  return typeof value === "string" && LOCAL.test(value) &&
    validDate(value.slice(0, 10));
}
function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) &&
    value >= min && value <= max;
}
interface TermInput {
  code: string;
  name: string;
  startsOn: string;
  endsOn: string;
  minimumNoticeDays: number;
  maximumNoticeDays: number;
  cancellationCutoffHours: number;
}
function termInput(data: any): TermInput {
  const { code, name, startsOn, endsOn, minimumNoticeDays,
          maximumNoticeDays, cancellationCutoffHours } = data ?? {};
  if (typeof code !== "string" || !/^[A-Z0-9][A-Z0-9-]{1,23}$/.test(code) ||
      typeof name !== "string" || name.trim().length < 3 ||
      name.trim().length > 100 ||
      !validDate(startsOn) || !validDate(endsOn) || endsOn < startsOn ||
      (Date.parse(endsOn) - Date.parse(startsOn)) / 86400000 > 730 ||
      !integer(minimumNoticeDays, 7, 180) ||
      !integer(maximumNoticeDays, minimumNoticeDays, 365) ||
      !integer(cancellationCutoffHours, 0, 168)) {
    throw new CalendarError(400,
      "Enter a unique code, term name, valid dates (up to 2 years), " +
      "notice window (minimum at least 7 days), and cancellation cutoff");
  }
  return {
    code, name: name.trim(), startsOn, endsOn, minimumNoticeDays,
    maximumNoticeDays, cancellationCutoffHours
  };
}
function slotInput(data: any) {
  const { startsAtLocal, durationMinutes, capacity } = data ?? {};
  if (!validLocal(startsAtLocal) ||
      !integer(durationMinutes, 5, 120) || durationMinutes % 5 !== 0 ||
      !integer(capacity, 1, 100)) {
    throw new CalendarError(
      400, "Specify a Vancouver-local start time, duration (5–120 minutes in steps of 5), and capacity (1–100)"
    );
  }
  return { startsAtLocal, durationMinutes, capacity };
}
function dateInRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}
async function tx<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); }
    catch (rollback) { console.error("Staff calendar rollback error:", rollback); }
    throw error;
  } finally {
    client.release();
  }
}
async function audit(
  client: PoolClient, actor: string, action: string, type: string,
  target: string, details: Record<string, unknown> = {}
) {
  await client.query(
    `INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [actor, action, type, target, JSON.stringify(details)]
  );
}
interface TermRow {
  id: string; code: string; name: string;
  starts_on: string; ends_on: string;
  minimum_notice_days: number;
  maximum_notice_days: number;
  cancellation_cutoff_hours: number;
}
interface SlotRow {
  id: string; term_id: string;
  starts_at: Date; ends_at: Date;
  capacity: number; is_open: boolean;
}
interface TimeRow { starts_at: Date; ends_at: Date; local_roundtrip: string; }
async function convertLocal(
  client: PoolClient, local: string, minutes: number
): Promise<TimeRow> {
  const result = await client.query<TimeRow>(
    `SELECT ($1::timestamp AT TIME ZONE 'America/Vancouver') AS starts_at,
            ($1::timestamp AT TIME ZONE 'America/Vancouver')
               + $2::integer * INTERVAL '1 minute' AS ends_at,
            to_char(
              ($1::timestamp AT TIME ZONE 'America/Vancouver')
                AT TIME ZONE 'America/Vancouver',
              'YYYY-MM-DD"T"HH24:MI') AS local_roundtrip`,
    [local, minutes]
  );
  if (result.rows[0].local_roundtrip !== local) {
    throw new CalendarError(422, "This Vancouver-local time does not exist due to a daylight-saving change");
  }
  return result.rows[0];
}
async function lockTerm(client: PoolClient, id: string): Promise<TermRow> {
  const result = await client.query<TermRow>(
    `SELECT id,code,name,
        to_char(starts_on,'YYYY-MM-DD') AS starts_on,
        to_char(ends_on,'YYYY-MM-DD') AS ends_on,
        minimum_notice_days,maximum_notice_days,cancellation_cutoff_hours
      FROM terms WHERE id=$1 FOR UPDATE`, [id]
  );
  if (!result.rows[0]) throw new CalendarError(404, "Term not found");
  return result.rows[0];
}
async function overlap(
  client: PoolClient, termId: string, start: Date, end: Date, exclude?: string
) {
  const found = await client.query(
    `SELECT id FROM appointment_slots
      WHERE term_id=$1 AND is_open
        AND starts_at < $3 AND ends_at > $2
        AND ($4::uuid IS NULL OR id<>$4::uuid)
      LIMIT 1`,
    [termId, start, end, exclude ?? null]
  );
  if (found.rows.length) {
    throw new CalendarError(409, "An open appointment slot overlaps this time");
  }
}
function localYmd(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(value);
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return part("year") + "-" + part("month") + "-" + part("day");
}
function checkRange(term: TermRow, time: TimeRow) {
  const starts = localYmd(time.starts_at);
  const ends = localYmd(time.ends_at);
  if (!dateInRange(starts, term.starts_on, term.ends_on) ||
      !dateInRange(ends, term.starts_on, term.ends_on)) {
    throw new CalendarError(422, "The appointment must begin and end within its term");
  }
  if (time.starts_at.getTime() <= Date.now()) {
    throw new CalendarError(422, "Staff cannot schedule an appointment in the past");
  }
}
function weekOf(value: Date): string {
  // ISO week Monday in the food bank's local timezone.
  const d = new Date(localYmd(value) + "T12:00:00Z");
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0,10);
}
function display(value: Date): string {
  return value.toLocaleString("en-CA", {
    timeZone: ZONE, dateStyle: "medium", timeStyle: "short"
  }) + " Vancouver time";
}
async function lockedSlot(client: PoolClient, slotId: string) {
  const result = await client.query<SlotRow>(
    "SELECT * FROM appointment_slots WHERE id=$1 FOR UPDATE", [slotId]
  );
  if (!result.rows[0]) throw new CalendarError(404, "Slot not found");
  return result.rows[0];
}
async function affectedBookings(client: PoolClient, slotId: string) {
  return client.query<{ id: string; student_id: string }>(
    "SELECT id, student_id FROM bookings WHERE slot_id=$1 AND status='booked' ORDER BY id",
    [slotId]
  );
}
async function notify(
  client: PoolClient, bookings: {id: string; student_id: string}[],
  actorId: string, category: "slot_time_changed" | "slot_closed", message: string
) {
  for (const booking of bookings) {
    await client.query(
      `INSERT INTO student_notifications
        (student_id, booking_id, actor_id, category, message)
       VALUES ($1,$2,$3,$4,$5)`,
      [booking.student_id, booking.id, actorId, category, message]
    );
  }
}

staffCalendarRouter.get("/terms", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.id,t.code,t.name,
              to_char(t.starts_on,'YYYY-MM-DD') AS starts_on,
              to_char(t.ends_on,'YYYY-MM-DD') AS ends_on,
              t.minimum_notice_days,t.maximum_notice_days,
              t.cancellation_cutoff_hours,
              count(s.id)::integer AS slot_count
       FROM terms AS t LEFT JOIN appointment_slots AS s ON s.term_id=t.id
       GROUP BY t.id ORDER BY t.starts_on DESC LIMIT 100`
    );
    res.json({ terms: result.rows });
  } catch (error) { reject(res, error); }
});
staffCalendarRouter.post("/terms", async (req, res) => {
  try {
    const x = termInput(req.body);
    const created = await tx(async client => {
      const term = await client.query<TermRow>(
        `INSERT INTO terms (code,name,starts_on,ends_on,minimum_notice_days,
                            maximum_notice_days,cancellation_cutoff_hours)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [x.code,x.name,x.startsOn,x.endsOn,x.minimumNoticeDays,
         x.maximumNoticeDays,x.cancellationCutoffHours]
      );
      await audit(client, currentAccount(req).id, "calendar_term_created", "term", term.rows[0].id);
      return lockTerm(client, term.rows[0].id);
    });
    res.status(201).json({ term: created });
  } catch (error) { reject(res, error); }
});
staffCalendarRouter.put("/terms/:termId", async (req, res) => {
  const id = req.params.termId;
  if (typeof id !== "string" || !UUID.test(id)) {
    res.status(400).json({ error: "Valid term ID is required" }); return;
  }
  try {
    const x = termInput(req.body);
    const updated = await tx(async client => {
      const term = await lockTerm(client, id);
      // Slot inserts/updates lock this term first. Lock its slots as well so
      // booking requests cannot race edits to a term's booking policy.
      await client.query(
        "SELECT id FROM appointment_slots WHERE term_id=$1 ORDER BY id FOR UPDATE",
        [id]
      );
      const changesRules =
        term.starts_on !== x.startsOn || term.ends_on !== x.endsOn ||
        term.minimum_notice_days !== x.minimumNoticeDays ||
        term.maximum_notice_days !== x.maximumNoticeDays ||
        term.cancellation_cutoff_hours !== x.cancellationCutoffHours;
      if (changesRules) {
        const active = await client.query(
          `SELECT 1 FROM bookings b
           JOIN appointment_slots s ON s.id=b.slot_id
           WHERE s.term_id=$1 AND b.status='booked' LIMIT 1`, [id]
        );
        if (active.rows[0]) {
          throw new CalendarError(409,
            "Term date or policy changes are blocked while active bookings exist");
        }
      }
      const outside = await client.query(
        `SELECT 1 FROM appointment_slots
         WHERE term_id=$1 AND
           ((starts_at AT TIME ZONE 'America/Vancouver')::date < $2::date OR
            (ends_at AT TIME ZONE 'America/Vancouver')::date > $3::date)
         LIMIT 1`,
        [id, x.startsOn, x.endsOn]
      );
      if (outside.rows[0]) {
        throw new CalendarError(409,
          "New term dates would exclude an existing slot; adjust slots first");
      }
      const result = await client.query<TermRow>(
        `UPDATE terms SET code=$1,name=$2,starts_on=$3,ends_on=$4,
          minimum_notice_days=$5,maximum_notice_days=$6,cancellation_cutoff_hours=$7
         WHERE id=$8 RETURNING *`,
        [x.code,x.name,x.startsOn,x.endsOn,x.minimumNoticeDays,
         x.maximumNoticeDays,x.cancellationCutoffHours,id]
      );
      await audit(client, currentAccount(req).id, "calendar_term_updated", "term", id);
      return lockTerm(client, id);
    });
    res.json({ term: updated });
  } catch (error) { reject(res, error); }
});

staffCalendarRouter.get("/slots", async (req, res) => {
  const termId = req.query.termId;
  const month = req.query.month;
  if (typeof termId !== "string" || !UUID.test(termId) ||
      (month !== undefined && (typeof month !== "string" ||
       !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month)))) {
    res.status(400).json({ error: "Valid term ID and optional YYYY-MM month are required" }); return;
  }
  try {
    const rows = await pool.query(
      `SELECT id,term_id,starts_at,ends_at,capacity,is_open,
              booked_count,remaining_capacity
       FROM slot_availability
       WHERE term_id=$1
         AND ($2::text IS NULL OR
           ((starts_at AT TIME ZONE 'America/Vancouver')::date >=
             (($2::text || '-01')::date)
            AND (starts_at AT TIME ZONE 'America/Vancouver')::date <
             (($2::text || '-01')::date + INTERVAL '1 month')))
       ORDER BY starts_at,id LIMIT 501`,
      [termId,month??null]
    );
    res.json({ slots: rows.rows.slice(0,500), hasMore: rows.rows.length>500 });
  } catch (error) { reject(res, error); }
});

staffCalendarRouter.post("/slots", async (req, res) => {
  const termId: unknown = req.body?.termId;
  if (typeof termId !== "string" || !UUID.test(termId)) {
    res.status(400).json({ error: "Valid term ID is required" }); return;
  }
  try {
    const x = slotInput(req.body);
    const created = await tx(async client => {
      const term = await lockTerm(client, termId);
      const time = await convertLocal(client,x.startsAtLocal,x.durationMinutes);
      checkRange(term,time);
      await overlap(client,termId,time.starts_at,time.ends_at);
      const result = await client.query(
        `INSERT INTO appointment_slots(term_id,starts_at,ends_at,capacity)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [termId,time.starts_at,time.ends_at,x.capacity]
      );
      await audit(client,currentAccount(req).id,"calendar_slot_created","slot",result.rows[0].id);
      return result.rows[0];
    });
    res.status(201).json({ slot: created });
  } catch (error) { reject(res,error); }
});

// Edit existing slot times/duration/capacity. Edits preserving a booking's
// Vancouver-local calendar week keep its once-per-week unique index valid.
staffCalendarRouter.put("/slots/:slotId", async (req,res) => {
  const id = req.params.slotId;
  if (typeof id !== "string" || !UUID.test(id)) {
    res.status(400).json({ error: "Valid slot ID is required" }); return;
  }
  try {
    const x = slotInput(req.body);
    const result = await tx(async client => {
      const initial = await client.query<{term_id:string}>(
        "SELECT term_id FROM appointment_slots WHERE id=$1", [id]
      );
      if (!initial.rows[0]) throw new CalendarError(404,"Slot not found");
      const term = await lockTerm(client,initial.rows[0].term_id);
      const old = await lockedSlot(client,id);
      const time = await convertLocal(client,x.startsAtLocal,x.durationMinutes);
      checkRange(term,time);
      const booked = await affectedBookings(client,id);
      if (x.capacity < booked.rows.length) {
        throw new CalendarError(409,"Cannot reduce capacity below active bookings");
      }
      const moved = time.starts_at.getTime() !== old.starts_at.getTime() ||
                    time.ends_at.getTime() !== old.ends_at.getTime();
      if (moved && booked.rows.length > 0) {
        if (weekOf(time.starts_at)!==weekOf(old.starts_at)) {
          throw new CalendarError(409,
            "Moving an occupied slot to a different calendar week is not allowed; contact students first");
        }
        if (time.starts_at.getTime() - Date.now() <
            term.cancellation_cutoff_hours*3600000) {
          throw new CalendarError(409,
            "Occupied slots may be moved only before the cancellation cutoff");
        }
      }
      if (old.is_open) await overlap(client,old.term_id,time.starts_at,time.ends_at,id);
      const updated = await client.query(
        `UPDATE appointment_slots
         SET starts_at=$1, ends_at=$2, capacity=$3 WHERE id=$4
         RETURNING *`,
        [time.starts_at,time.ends_at,x.capacity,id]
      );
      if (moved && booked.rows.length) {
        const message = "Staff changed your appointment from " + display(old.starts_at) +
          " to " + display(time.starts_at) +
          ". Your reservation is still active. Check your appointment details.";
        await notify(client,booked.rows,currentAccount(req).id,"slot_time_changed",message);
        for (const b of booked.rows) {
          await client.query(
            `INSERT INTO booking_events (booking_id,actor_id,event_type,event_data)
             VALUES ($1,$2,'slot_updated',
             jsonb_build_object('old_start',$3::text,'new_start',$4::text))`,
            [b.id,currentAccount(req).id,old.starts_at.toISOString(),time.starts_at.toISOString()]
          );
        }
      }
      await audit(client,currentAccount(req).id,"calendar_slot_updated","slot",id,
        { affectedBookings: moved ? booked.rows.length : 0 });
      return { slot: updated.rows[0], affectedBookings: moved ? booked.rows.length : 0 };
    });
    res.json(result);
  } catch (error) { reject(res,error); }
});

staffCalendarRouter.post("/slots/:slotId/close", async (req,res) => {
  const id = req.params.slotId;
  if (typeof id !== "string" || !UUID.test(id)) {
    res.status(400).json({ error: "Valid slot ID is required" }); return;
  }
  try {
    const result = await tx(async client => {
      const initial = await client.query<{term_id:string}>(
        "SELECT term_id FROM appointment_slots WHERE id=$1",[id]
      );
      if (!initial.rows[0]) throw new CalendarError(404,"Slot not found");
      await lockTerm(client,initial.rows[0].term_id);
      const slot = await lockedSlot(client,id);
      if (!slot.is_open) throw new CalendarError(409,"Slot is already closed");
      if (slot.starts_at.getTime() <= Date.now()) {
        throw new CalendarError(422,"Past or in-progress appointments cannot be closed");
      }
      await client.query("UPDATE appointment_slots SET is_open=false WHERE id=$1",[id]);
      const cancelled = await client.query<{id:string;student_id:string}>(
        `UPDATE bookings SET status='cancelled',cancelled_at=NOW()
         WHERE slot_id=$1 AND status='booked'
         RETURNING id,student_id`,[id]
      );
      const message = "Staff closed your appointment on "+display(slot.starts_at)+
        ". Your booking has been cancelled; please choose a new available slot.";
      await notify(client,cancelled.rows,currentAccount(req).id,"slot_closed",message);
      for (const b of cancelled.rows) {
        await client.query(
          `INSERT INTO booking_events (booking_id,actor_id,event_type,event_data)
           VALUES ($1,$2,'cancelled',
           jsonb_build_object('reason','staff_slot_closed','slot_id',$3::text))`,
          [b.id,currentAccount(req).id,id]
        );
      }
      await audit(client,currentAccount(req).id,"calendar_slot_closed","slot",id,
        { cancelledBookings: cancelled.rows.length });
      return { closed:true,cancelledBookings:cancelled.rows.length };
    });
    res.json(result);
  } catch (error) { reject(res,error); }
});

staffCalendarRouter.post("/slots/:slotId/reopen", async (req,res) => {
  const id = req.params.slotId;
  if (typeof id !== "string" || !UUID.test(id)) {
    res.status(400).json({ error: "Valid slot ID is required" }); return;
  }
  try {
    const result = await tx(async client => {
      const initial = await client.query<{term_id:string}>(
        "SELECT term_id FROM appointment_slots WHERE id=$1",[id]
      );
      if (!initial.rows[0]) throw new CalendarError(404,"Slot not found");
      const term = await lockTerm(client,initial.rows[0].term_id);
      const slot = await lockedSlot(client,id);
      if (slot.is_open) throw new CalendarError(409,"Slot is already open");
      checkRange(term,{
        starts_at:slot.starts_at,ends_at:slot.ends_at,local_roundtrip:""
      });
      await overlap(client,term.id,slot.starts_at,slot.ends_at,id);
      await client.query("UPDATE appointment_slots SET is_open=true WHERE id=$1",[id]);
      await audit(client,currentAccount(req).id,"calendar_slot_reopened","slot",id);
      return { reopened:true, reinstatedBookings:0 };
    });
    res.json(result);
  } catch (error) { reject(res,error); }
});

// Generate fixed, nonoverlapping slots for selected Vancouver-local weekdays,
// over an inclusive date range; either every slot is created or none is.
staffCalendarRouter.post("/terms/:termId/generate", async (req,res) => {
  const termId = req.params.termId;
  if (typeof termId !== "string" || !UUID.test(termId)) {
    res.status(400).json({ error: "Valid term ID required" }); return;
  }
  const { fromDate,toDate,weekdays,startTime,endTime,durationMinutes,capacity } = req.body ?? {};
  if (!validDate(fromDate)||!validDate(toDate)||fromDate>toDate||
      (Date.parse(toDate)-Date.parse(fromDate))/86400000>370 ||
      !Array.isArray(weekdays)||weekdays.length<1||weekdays.length>7||
      !weekdays.every((w:unknown)=>integer(w,0,6))||
      new Set(weekdays).size !== weekdays.length ||
      typeof startTime!=="string"||!TIME.test(startTime)||
      typeof endTime!=="string"||!TIME.test(endTime)||endTime<=startTime||
      !integer(durationMinutes,5,120)||durationMinutes%5!==0||
      !integer(capacity,1,100)) {
    res.status(400).json({
      error:"Valid dates, weekdays, daytime range, duration and capacity are required"
    });
    return;
  }
  const first = Number(startTime.slice(0,2))*60+Number(startTime.slice(3));
  const last = Number(endTime.slice(0,2))*60+Number(endTime.slice(3));
  if ((last-first)%durationMinutes!==0) {
    res.status(400).json({error:"Hours must divide evenly into the selected slot duration"});
    return;
  }
  const localStarts: string[] = [];
  for(let day=Date.parse(fromDate);day<=Date.parse(toDate);day+=86400000) {
    const date = new Date(day);
    if (!weekdays.includes(date.getUTCDay())) continue;
    const ymd = date.toISOString().slice(0,10);
    for(let minute=first;minute<last;minute+=durationMinutes) {
      const hh=String(Math.floor(minute/60)).padStart(2,"0");
      const mm=String(minute%60).padStart(2,"0");
      localStarts.push(ymd+"T"+hh+":"+mm);
      if(localStarts.length>600) break;
    }
    if(localStarts.length>600) break;
  }
  if(localStarts.length===0||localStarts.length>600) {
    res.status(400).json({error:"Select a range creating 1–600 slots per operation"});
    return;
  }
  try {
    const result = await tx(async client => {
      const term = await lockTerm(client,termId);
      if(fromDate<term.starts_on||toDate>term.ends_on) {
        throw new CalendarError(422,"Generated dates must be within the term");
      }
      const values = await client.query<{local_start:string;starts_at:Date;ends_at:Date;roundtrip:string}>(
        `SELECT local_start,
             (local_start::timestamp AT TIME ZONE 'America/Vancouver') AS starts_at,
             (local_start::timestamp AT TIME ZONE 'America/Vancouver')
               + $2::integer * INTERVAL '1 minute' AS ends_at,
             to_char((local_start::timestamp AT TIME ZONE 'America/Vancouver')
               AT TIME ZONE 'America/Vancouver','YYYY-MM-DD"T"HH24:MI') AS roundtrip
         FROM unnest($1::text[]) AS v(local_start)`,
        [localStarts,durationMinutes]
      );
      const times = values.rows;
      for(const value of times) {
        if(value.roundtrip!==value.local_start) {
          throw new CalendarError(422,"Some generated times fall in a daylight-saving gap");
        }
        checkRange(term,{starts_at:value.starts_at,ends_at:value.ends_at,local_roundtrip:value.roundtrip});
      }
      times.sort((a,b)=>a.starts_at.getTime()-b.starts_at.getTime());
      for(let i=1;i<times.length;i++) {
        if(times[i-1].ends_at>times[i].starts_at) {
          throw new CalendarError(409,"Generated times overlap one another");
        }
      }
      const starts=times.map(t=>t.starts_at),ends=times.map(t=>t.ends_at);
      const collisions = await client.query(
        `SELECT 1 FROM appointment_slots s
          JOIN unnest($2::timestamptz[],$3::timestamptz[]) AS v(start_at,end_at)
            ON s.starts_at<v.end_at AND s.ends_at>v.start_at
         WHERE s.term_id=$1 AND s.is_open LIMIT 1`,
        [termId,starts,ends]
      );
      if(collisions.rows.length) {
        throw new CalendarError(409,"Generated schedule overlaps existing open slots");
      }
      const created = await client.query(
        `INSERT INTO appointment_slots(term_id,starts_at,ends_at,capacity)
         SELECT $1,v.start_at,v.end_at,$4
         FROM unnest($2::timestamptz[],$3::timestamptz[]) AS v(start_at,end_at)`,
        [termId,starts,ends,capacity]
      );
      await audit(client,currentAccount(req).id,"calendar_slots_generated","term",termId,
        {createdSlots:created.rowCount,fromDate,toDate,weekdays});
      return { createdSlots:created.rowCount };
    });
    res.status(201).json(result);
  } catch (error) { reject(res,error); }
});
