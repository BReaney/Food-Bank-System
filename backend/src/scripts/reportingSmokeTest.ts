// Staff usage reporting integration test: fictional-only data and aggregate API.
// Requires the local running backend (CI uses disposable foodbank_dev).
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { pool } from "../db.js";

const API = "http://localhost:3001";
const ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
const STAFF_PASSWORD = process.env.DEMO_STAFF_PASSWORD;
if (process.env.NODE_ENV === "production" ||
    !["127.0.0.1", "localhost"].includes(process.env.PGHOST ?? "") ||
    process.env.PGDATABASE !== "foodbank_dev" || !STAFF_PASSWORD) {
  throw new Error("Reporting tests require the fictional local foodbank_dev only");
}
const suffix = randomUUID().slice(0, 10).toUpperCase();
const termCode = "REP-" + suffix;
const emails = ["A","B","C","D"].map(label =>
  "report-" + label.toLowerCase() + "-" + suffix.toLowerCase() + "@example.test"
);
const password = "FictionalReportTest_1234";
const userIds: string[] = [];
const bookingIds: string[] = [];
let termId = "";
const dependentIds: string[] = [];
let contactId = "";
function dateAtOffset(days: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver", year: "numeric",
    month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  const today = get("year") + "-" + get("month") + "-" + get("day");
  const d = new Date(today + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0,10);
}

async function request(method: string, path: string, cookie = "", body?: unknown) {
  const response = await fetch(API + path, {
    method,
    headers: {
      Origin: ORIGIN,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const type = response.headers.get("content-type") ?? "";
  return {
    status: response.status,
    contentType: type,
    data: type.includes("text/csv")
      ? await response.text()
      : await response.json() as any,
    cookie: (response.headers.get("set-cookie") ?? "").split(";")[0]
  };
}
function requireStatus(r: Awaited<ReturnType<typeof request>>, status: number) {
  assert.equal(r.status, status, JSON.stringify(r.data));
}
async function login(email: string, pass: string) {
  const result = await request("POST","/api/auth/login","",{email,password:pass});
  requireStatus(result,200);
  assert.ok(result.cookie.startsWith("foodbank_session="));
  return result.cookie;
}
function reportPath(scope: string, from?: string, to?: string, csv = false) {
  const q = new URLSearchParams({termId:scope});
  if (from) q.set("fromDate",from);
  if (to) q.set("toDate",to);
  return "/api/staff/reports/usage" + (csv ? ".csv?" : "?") + q.toString();
}

try {
  for(let i=0;i<emails.length;i++){
    const r=await request("POST","/api/auth/register","",{
      email:emails[i],password,firstName:"Fixture"+(i+1),lastName:"Reporting",
       studentDesignation:"domestic",dietaryRestrictions:["none"]
    });
    requireStatus(r,201);
  }
  const users=await pool.query<{id:string;email:string}>(
    "SELECT id,email FROM profiles WHERE email=ANY($1::text[])",[emails]
  );
  for(const email of emails){
    const id=users.rows.find(u=>u.email===email)?.id;
    assert.ok(id);userIds.push(id);
  }
  const [studentCookie,staffCookie]=await Promise.all([
    login(emails[0],password),
    login("staff.demo@example.com",STAFF_PASSWORD)
  ]);
  const staffUser=await pool.query<{id:string}>(
    "SELECT id FROM profiles WHERE email='staff.demo@example.com'"
  );
  const staffId=staffUser.rows[0].id;

  requireStatus(await request("GET","/api/staff/reports/terms"),401);
  requireStatus(await request("GET","/api/staff/reports/terms",studentCookie),403);
  requireStatus(await request("GET",
    "/api/staff/reports/usage?termId=" + randomUUID(),studentCookie),403);
  requireStatus(await request("GET",
    "/api/staff/reports/usage.csv?termId=" + randomUUID(),studentCookie),403);
  requireStatus(await request("GET",
    "/api/staff/reports/usage?termId=invalid",staffCookie),400);
  requireStatus(await request("GET",
    "/api/staff/reports/usage?termId="+randomUUID(),staffCookie),404);
  console.log("PASS: anonymous/student report and CSV access blocked; invalid IDs rejected");

  const first=dateAtOffset(-100), last=dateAtOffset(100);
  const t=await pool.query<{id:string}>(
    `INSERT INTO terms (code,name,starts_on,ends_on)
     VALUES ($1,'=2+2',$2::date,$3::date) RETURNING id`,
    [termCode,first,last]
  );
  termId=t.rows[0].id;
  const terms=await request("GET","/api/staff/reports/terms",staffCookie);
  requireStatus(terms,200);
  assert.ok(terms.data.terms.some((x:any)=>x.id===termId));

  // Current confirmed dependents: student A has 2, B has 1, D has 0.
  for(const [studentIndex,name] of [
    [0,"Fictional Dependent A1"],[0,"Fictional Dependent A2"],[1,"Fictional Dependent B1"]
  ] as const) {
    const r=await pool.query<{id:string}>(
      `INSERT INTO dependent_requests
        (student_id,full_name,relationship,status,reviewed_by,reviewed_at)
       VALUES ($1,$2,'family_member','confirmed',$3,NOW())
       RETURNING id`,
      [userIds[studentIndex],name,staffId]
    );
    dependentIds.push(r.rows[0].id);
  }
  const c=await pool.query<{id:string}>(
    `INSERT INTO pickup_contacts
       (student_id,full_name,contact_method,contact_value,status,
        consent_version,consent_text,reviewed_by,reviewed_at)
      VALUES ($1,'Fictional Third Party','email','fictional@example.test',
        'confirmed','demo-v1','Fictional consent for CI only',$2,NOW())
      RETURNING id`,
    [userIds[1],staffId]
  );
  contactId=c.rows[0].id;

  type Fixture = {
    student:number;offset:number;status:string;
    pickupKind?:string;dependentId?:string;contactId?:string;
  };
  const fixtures:Fixture[]=[
    {student:0,offset:-42,status:"completed"},
    {student:0,offset:-28,status:"completed",
      pickupKind:"dependent",dependentId:dependentIds[0]},
    {student:1,offset:-35,status:"completed",
      pickupKind:"third_party",contactId},
    {student:3,offset:-21,status:"completed"},
    {student:2,offset:-14,status:"no_show"},
    {student:1,offset:-10,status:"cancelled"},
    {student:0,offset:-7,status:"booked"},
    {student:2,offset:14,status:"booked"}
  ];
  let overdueBookingId="";
  for(const row of fixtures){
    const day=dateAtOffset(row.offset);
    const slot=await pool.query<{id:string}>(
      `INSERT INTO appointment_slots (term_id,starts_at,ends_at,capacity)
       VALUES ($1,($2::date + TIME '12:00') AT TIME ZONE 'America/Vancouver',
                  ($2::date + TIME '12:20') AT TIME ZONE 'America/Vancouver',2)
       RETURNING id`,
      [termId,day]
    );
    const booking=await pool.query<{id:string}>(
      `INSERT INTO bookings
        (student_id,slot_id,week_start,status,cancelled_at,
         pickup_kind,pickup_dependent_id,pickup_contact_id)
       SELECT $1,s.id,date_trunc('week',
           s.starts_at AT TIME ZONE 'America/Vancouver')::date,
         $3::text,
         CASE WHEN $3::text='cancelled' THEN NOW() ELSE NULL END,
         $4,$5,$6
       FROM appointment_slots AS s WHERE s.id=$2 RETURNING id`,
      [userIds[row.student],slot.rows[0].id,row.status,
       row.pickupKind??"self",row.dependentId??null,row.contactId??null]
    );
    bookingIds.push(booking.rows[0].id);
    if(row.student===0&&row.offset===-7)overdueBookingId=booking.rows[0].id;
  }
  assert.ok(overdueBookingId);

  const started=performance.now();
  const full=await request("GET",reportPath(termId),staffCookie);
  const elapsed=performance.now()-started;
  requireStatus(full,200);
  const report=full.data.report;
  assert.equal(report.term.code,termCode);
  assert.equal(report.timeZone,"America/Vancouver");
  assert.equal(report.fromDate,first);
  assert.equal(report.toDate,last);
  assert.deepEqual(report.totals,{
    total:8,booked:2,completed:4,no_show:1,cancelled:1,
    students_served:3,awaiting_outcome:1
  });
  assert.deepEqual(report.completedPickupTypes,{
    self:2,dependent:1,third_party:1
  });
  assert.deepEqual(report.servedStudentsByCurrentDependents,{
    none:1,one:1,two_or_more:1
  });
  assert.equal(report.needsReportingAvailable,false);
  assert.equal(report.weekly.reduce((n:number,w:any)=>n+w.total,0),8);
  for(const field of ["booked","completed","no_show","cancelled"]){
    assert.equal(report.weekly.reduce((n:number,w:any)=>n+w[field],0),
      report.totals[field]);
  }
  assert.ok(!JSON.stringify(report).includes(emails[0]));
  assert.ok(!JSON.stringify(report).includes("Fictional Dependent A1"));
  console.log("PASS: term RSD counts, unique students served, weekly totals, pickup and household breakdown");
  console.log("Fixture report generation:",Math.round(elapsed),"ms; full 1,100-account load not tested");

  const startSub=dateAtOffset(-40), endSub=dateAtOffset(-20);
  const subset=await request("GET",
    reportPath(termId,startSub,endSub),staffCookie);
  requireStatus(subset,200);
  assert.deepEqual(subset.data.report.totals,{
    total:3,booked:0,completed:3,no_show:0,cancelled:0,
    students_served:3,awaiting_outcome:0
  });

  requireStatus(await request("GET",reportPath(termId,first,undefined),staffCookie),400);
  requireStatus(await request("GET",reportPath(termId,"2026-02-30",last),staffCookie),400);
  requireStatus(await request("GET",reportPath(termId,last,first),staffCookie),400);
  requireStatus(await request("GET",reportPath(termId,dateAtOffset(-110),last),staffCookie),422);
  requireStatus(await request("GET",reportPath("all"),staffCookie),400);
  requireStatus(await request("GET",
    reportPath("all",dateAtOffset(-400),last),staffCookie),400);
  const acrossTerms=await request("GET",
    reportPath("all",dateAtOffset(-55),dateAtOffset(20)),staffCookie);
  requireStatus(acrossTerms,200);
  assert.equal(acrossTerms.data.report.term.id,"all");
  assert.ok(acrossTerms.data.report.totals.completed >= 4);
  console.log("PASS: inclusive partial dates, annual all-terms mode and input validation");

  // Existing staff outcome endpoint must be reflected on next report.
  const marked=await request("POST",
    "/api/staff/bookings/"+overdueBookingId+"/outcome",
    staffCookie,{outcome:"completed"});
  requireStatus(marked,200);
  const changed=await request("GET",reportPath(termId),staffCookie);
  requireStatus(changed,200);
  assert.equal(changed.data.report.totals.completed,5);
  assert.equal(changed.data.report.totals.booked,1);
  assert.equal(changed.data.report.totals.students_served,3);
  assert.equal(changed.data.report.totals.awaiting_outcome,0);

  const csv=await request("GET",reportPath(termId,undefined,undefined,true),
    staffCookie);
  requireStatus(csv,200);
  assert.ok(csv.contentType.includes("text/csv"));
  assert.ok(typeof csv.data==="string");
  // Fetch's TextDecoder strips a UTF-8 BOM from decoded text by design.
  // The exported CSV still contains a BOM at the byte level.
  assert.ok(csv.data.replace(/^\uFEFF/, "").startsWith(
    '"section","period","metric","value"'
  ));
  assert.ok(csv.data.includes('"summary","","appointments_completed","5"'));
  assert.ok(csv.data.includes('"summary","","distinct_students_served","3"'));
  assert.ok(csv.data.includes(`"metadata","","term_name","'=2+2"`));
  for(const email of emails) assert.ok(!csv.data.includes(email));
  assert.ok(!csv.data.includes("Fictional Third Party"));
  console.log("PASS: staff outcome flows into report and CSV; spreadsheet formula escaped, no personal data");
  console.log("System usage reporting integration tests passed.");
} finally {
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    const userRows=await client.query<{id:string}>(
      "SELECT id FROM profiles WHERE email=ANY($1::text[])",[emails]
    );
    const currentIds=userRows.rows.map(x=>x.id);
    const t=await client.query<{id:string}>(
      "SELECT id FROM terms WHERE code=$1",[termCode]
    );
    if(currentIds.length){
      await client.query(
        `DELETE FROM booking_events
         WHERE booking_id IN (
           SELECT id FROM bookings WHERE student_id=ANY($1::uuid[])
         )`,
        [currentIds]
      );
      if(bookingIds.length){
        await client.query(
          "DELETE FROM audit_logs WHERE action='booking_outcome_recorded' " +
          "AND target_id=ANY($1::uuid[])",[bookingIds]
        );
      }
      await client.query(
        "DELETE FROM student_notifications WHERE student_id=ANY($1::uuid[])",
        [currentIds]
      );
      await client.query(
        "DELETE FROM bookings WHERE student_id=ANY($1::uuid[])",[currentIds]
      );
      await client.query(
        "DELETE FROM pickup_contacts WHERE student_id=ANY($1::uuid[])",
        [currentIds]
      );
      await client.query(
        "DELETE FROM dependent_requests WHERE student_id=ANY($1::uuid[])",
        [currentIds]
      );
    }
    if(t.rows[0]){
      await client.query(
        "DELETE FROM appointment_slots WHERE term_id=$1",[t.rows[0].id]
      );
      await client.query("DELETE FROM terms WHERE id=$1",[t.rows[0].id]);
    }
    if(currentIds.length){
      await client.query(
        "DELETE FROM auth_sessions WHERE profile_id=ANY($1::uuid[])",
        [currentIds]
      );
      await client.query(
        "DELETE FROM auth_credentials WHERE profile_id=ANY($1::uuid[])",
        [currentIds]
      );
      await client.query(
        "DELETE FROM profiles WHERE id=ANY($1::uuid[])",[currentIds]
      );
    }
    await client.query("COMMIT");
    console.log("Cleaned up fictional reporting fixtures");
  } catch(error) {
    await client.query("ROLLBACK");
    console.error("Reporting fixture cleanup failed:",error);
  } finally {
    client.release();
    await pool.end();
  }
}
