// Sequential staff calendar workflow checks with fictional accounts only.
// Requires running localhost backend and a local or disposable foodbank_dev.
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../db.js";

const API = "http://localhost:3001";
const ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
const STAFF_PASSWORD = process.env.DEMO_STAFF_PASSWORD;
if (process.env.NODE_ENV === "production" ||
    !["localhost", "127.0.0.1"].includes(process.env.PGHOST ?? "") ||
    process.env.PGDATABASE !== "foodbank_dev" || !STAFF_PASSWORD) {
  throw new Error("Calendar integration tests only run on local foodbank_dev with fictional credentials");
}
const suffix = randomUUID().slice(0,12).toUpperCase();
const termCode = "CAL-" + suffix;
const emails = [
  "calendar-a-"+suffix.toLowerCase()+"@example.test",
  "calendar-b-"+suffix.toLowerCase()+"@example.test"
];
const password = "FictionalCalendarTest_1234";
const studentIds: string[] = [];
let termId = "";
const startDate = (days: number) => new Date(Date.now() + days*86400000)
  .toISOString().slice(0,10);

interface ApiResult { status:number; body:any; cookie:string; }
async function request(
  method: string, path: string, cookie = "", body?:unknown
):Promise<ApiResult>{
  const r=await fetch(API+path,{
    method,
    headers:{
      Origin:ORIGIN,
      ...(cookie?{Cookie:cookie}:{}),
      ...(body===undefined?{}:{"Content-Type":"application/json"})
    },
    body:body===undefined?undefined:JSON.stringify(body)
  });
  return {
    status:r.status,body:await r.json(),
    cookie:(r.headers.get("set-cookie")??"").split(";")[0]
  };
}
function expectStatus(r:ApiResult, status:number):void {
  assert.equal(r.status,status,JSON.stringify(r.body));
}
async function login(email:string,pass:string):Promise<string>{
  const r=await request("POST","/api/auth/login","",{email,password:pass});
  expectStatus(r,200);
  assert.ok(r.cookie.startsWith("foodbank_session="));
  return r.cookie;
}
async function register(email:string,firstName:string):Promise<void>{
  const r=await request("POST","/api/auth/register","",{
    email,password,firstName,lastName:"Fixture",
     studentDesignation:"domestic",dietaryRestrictions:["none"]
  });
  expectStatus(r,201);
  const p=await pool.query<{id:string}>(
    "SELECT id FROM profiles WHERE email=$1",[email]
  );
  studentIds.push(p.rows[0].id);
}
function termInput(start:string,end:string,maxNotice=60){
  return {
    code:termCode,name:"Fictional Staff Calendar Fixture",
    startsOn:start,endsOn:end,minimumNoticeDays:7,
    maximumNoticeDays:maxNotice,cancellationCutoffHours:24
  };
}
async function readNotices(cookie:string){
  const r=await request("GET","/api/notifications",cookie);
  expectStatus(r,200);
  return r.body.notifications as {
    id:string;booking_id:string;message:string;category:string;read_at:string|null
  }[];
}

try {
  await register(emails[0],"CalendarA");
  await register(emails[1],"CalendarB");
  const [a,b,staff]=await Promise.all([
    login(emails[0],password), login(emails[1],password),
    login("staff.demo@example.com",STAFF_PASSWORD)
  ]);

  expectStatus(await request("GET","/api/staff/calendar/terms"),401);
  expectStatus(await request("GET","/api/staff/calendar/terms",a),403);
  expectStatus(await request("POST","/api/staff/calendar/terms",a,termInput(
    startDate(15),startDate(90))),403);
  expectStatus(await request("GET","/api/notifications",staff),403);
  expectStatus(await request("POST","/api/staff/calendar/terms",staff,termInput(
    "2027-04-31","2027-05-15")),400);
  console.log("PASS: protected calendar APIs and required term validation");

  const firstDay=startDate(19);
  const lastDay=startDate(90);
  const create=await request("POST","/api/staff/calendar/terms",staff,
    termInput(firstDay,lastDay));
  expectStatus(create,201);
  termId=create.body.term.id as string;
  const createdTerm=await request("GET","/api/staff/calendar/terms",staff);
  expectStatus(createdTerm,200);
  assert.ok(createdTerm.body.terms.some((t:any)=>t.id===termId));
  const termChanged={...termInput(firstDay,lastDay),name:"Edited Fictional Calendar"};
  expectStatus(await request("PUT","/api/staff/calendar/terms/"+termId,
    staff,termChanged),200);

  const fromDate=startDate(22);
  const toDate=startDate(43);
  const weekday=new Date(fromDate+"T12:00:00Z").getUTCDay();
  const generate={
    fromDate,toDate,weekdays:[weekday],startTime:"09:00",endTime:"10:00",
    durationMinutes:20,capacity:2
  };
  const generated=await request(
    "POST","/api/staff/calendar/terms/"+termId+"/generate",staff,generate
  );
  expectStatus(generated,201);
  assert.ok(generated.body.createdSlots>=9);
  const list=await request("GET",
    "/api/staff/calendar/slots?termId="+termId,staff);
  expectStatus(list,200);
  assert.equal(list.body.slots.length,generated.body.createdSlots);
  const again=await request(
    "POST","/api/staff/calendar/terms/"+termId+"/generate",staff,generate
  );
  expectStatus(again,409);
  assert.equal((await request("GET",
    "/api/staff/calendar/slots?termId="+termId,staff))
    .body.slots.length,generated.body.createdSlots);
  console.log("PASS: term management and atomic weekly slot generation, overlap rejection");

  // Create a separate fixture appointment later than the generated range.
  const day=startDate(45);
  const originalLocal=day+"T14:00";
  const targetLocal=day+"T15:00";
  const slotCreated=await request("POST","/api/staff/calendar/slots",staff,{
    termId,startsAtLocal:originalLocal,durationMinutes:20,capacity:2
  });
  expectStatus(slotCreated,201);
  const slotId=slotCreated.body.slot.id as string;
  expectStatus(await request("POST","/api/staff/calendar/slots",staff,{
    termId,startsAtLocal:day+"T14:10",durationMinutes:20,capacity:2
  }),409);
  expectStatus(await request("POST","/api/staff/calendar/slots",a,{
    termId,startsAtLocal:day+"T16:00",durationMinutes:20,capacity:2
  }),403);
  const futureMonth=day.slice(0,7);
  const availability=await request("GET","/api/slots?month="+futureMonth,b);
  expectStatus(availability,200);
  assert.ok(availability.body.slots.some((x:any)=>x.id===slotId));
  assert.ok(!JSON.stringify(availability.body).includes(emails[0]));
  expectStatus(await request("GET","/api/slots?month=wrong",b),400);

  // A week begins on Monday in Vancouver, regardless of browser timezone.
  const monday = new Date(day+"T12:00:00Z");
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay()+6)%7));
  const week = monday.toISOString().slice(0,10);
  const otherMonday = new Date(monday.getTime()+7*86400000)
    .toISOString().slice(0,10);
  const studentWeek = await request("GET","/api/slots?week="+week,b);
  expectStatus(studentWeek,200);
  assert.ok(studentWeek.body.slots.some((x:any)=>x.id===slotId));
  assert.ok(!JSON.stringify(studentWeek.body).includes(emails[0]));
  const staffWeek = await request(
    "GET","/api/staff/calendar/slots?termId="+termId+"&week="+week,staff
  );
  expectStatus(staffWeek,200);
  assert.ok(staffWeek.body.slots.some((x:any)=>x.id===slotId));
  const nextWeek = await request("GET","/api/slots?week="+otherMonday,b);
  expectStatus(nextWeek,200);
  assert.ok(!nextWeek.body.slots.some((x:any)=>x.id===slotId));
  expectStatus(await request("GET","/api/slots?week="+day,b),day===week?200:400);
  expectStatus(await request("GET","/api/slots?week=2026-02-30",b),400);
  expectStatus(await request("GET",
    "/api/slots?month="+futureMonth+"&week="+week,b),400);
  expectStatus(await request("GET",
    "/api/staff/calendar/slots?termId="+termId+"&week="+day,a),403);
  console.log("PASS: weekly student/staff calendar filters, Monday validation and role privacy");

  // Prepare fictional eligibility records for both new students.
  const staffProfile=await pool.query<{id:string}>(
    "SELECT id FROM profiles WHERE email='staff.demo@example.com'"
  );
  for(const studentId of studentIds){
    await pool.query(
      "INSERT INTO enrollment_verifications "+
      "(student_id,term_id,status,verified_by,verified_at) "+
      "VALUES ($1,$2,'verified',$3,NOW())",
      [studentId,termId,staffProfile.rows[0].id]
    );
    await pool.query(
      "INSERT INTO eligibility_surveys (student_id,term_id,responses) "+
      "VALUES ($1,$2,$3::jsonb)",
      [studentId,termId,JSON.stringify({fictional:true})]
    );
  }

  const bookA=await request("POST","/api/bookings",a,{slotId});
  const bookB=await request("POST","/api/bookings",b,{slotId});
  expectStatus(bookA,201);
  expectStatus(bookB,201);
  const aBookingId=bookA.body.booking.id as string;
  const bBookingId=bookB.body.booking.id as string;
  const current=await request("GET",
    "/api/staff/calendar/slots?termId="+termId,staff);
  const currentSlot=current.body.slots.find((x:any)=>x.id===slotId);
  assert.equal(currentSlot.booked_count,2);
  assert.equal(currentSlot.remaining_capacity,0);

  // Never silently displace an existing booking by shrinking capacity,
  // changing its calendar week, or changing term policy.
  expectStatus(await request("PUT","/api/staff/calendar/slots/"+slotId,staff,{
    startsAtLocal:originalLocal,durationMinutes:20,capacity:1
  }),409);
  expectStatus(await request("PUT","/api/staff/calendar/slots/"+slotId,staff,{
    startsAtLocal:startDate(52)+"T14:00",durationMinutes:20,capacity:2
  }),409);
  expectStatus(await request("PUT","/api/staff/calendar/terms/"+termId,staff,{
    ...termChanged,maximumNoticeDays:90
  }),409);
  const moved=await request("PUT","/api/staff/calendar/slots/"+slotId,staff,{
    startsAtLocal:targetLocal,durationMinutes:20,capacity:2
  });
  expectStatus(moved,200);
  assert.equal(moved.body.affectedBookings,2);
  const aBooking=await request("GET","/api/bookings",a);
  expectStatus(aBooking,200);
  assert.ok(aBooking.body.bookings.some((x:any)=>
    x.id===aBookingId && x.starts_at===moved.body.slot.starts_at
  ));
  const noticesA=await readNotices(a);
  const noticesB=await readNotices(b);
  assert.ok(noticesA.some(n=>
    n.booking_id===aBookingId && n.category==="slot_time_changed"
  ));
  assert.ok(noticesB.some(n=>
    n.booking_id===bBookingId && n.category==="slot_time_changed"
  ));
  assert.ok(!JSON.stringify(noticesA).includes(emails[1]));
  console.log("PASS: safe occupied edits, shared availability and per-student change notices");

  // Private notice acknowledges only the signed-in account.
  const noticeId=noticesA.find(n=>n.category==="slot_time_changed")!.id;
  expectStatus(await request("PATCH",
    "/api/notifications/"+noticeId+"/read",b),404);
  expectStatus(await request("PATCH",
    "/api/notifications/"+noticeId+"/read",a),200);
  assert.ok((await readNotices(a)).some(n=>n.id===noticeId && n.read_at));

  const closed=await request("POST",
    "/api/staff/calendar/slots/"+slotId+"/close",staff);
  expectStatus(closed,200);
  assert.equal(closed.body.cancelledBookings,2);
  const afterClose=await request("GET",
    "/api/staff/calendar/slots?termId="+termId,staff);
  const closedSlot=afterClose.body.slots.find((x:any)=>x.id===slotId);
  assert.equal(closedSlot.booked_count,0);
  assert.equal(closedSlot.is_open,false);
  const aHistory=await request("GET","/api/bookings/history",a);
  assert.ok(aHistory.body.bookings.some((x:any)=>
    x.id===aBookingId && x.status==="cancelled"
  ));
  assert.ok((await readNotices(a)).some(n=>n.category==="slot_closed"));
  assert.ok((await readNotices(b)).some(n=>n.category==="slot_closed"));
  const events=await request("GET","/api/bookings/events",a);
  assert.ok(events.body.events.some((x:any)=>x.event_type==="slot_updated"));
  assert.ok(events.body.events.some((x:any)=>
    x.event_type==="cancelled" && x.event_data.reason==="staff_slot_closed"
  ));
  expectStatus(await request("POST",
    "/api/staff/calendar/slots/"+slotId+"/close",staff),409);
  console.log("PASS: staff slot closure cancels active bookings and privately notifies both");

  const reopened=await request("POST",
    "/api/staff/calendar/slots/"+slotId+"/reopen",staff);
  expectStatus(reopened,200);
  assert.equal(reopened.body.reinstatedBookings,0);
  const reopening=await request("GET",
    "/api/staff/calendar/slots?termId="+termId,staff);
  const opened=reopening.body.slots.find((x:any)=>x.id===slotId);
  assert.equal(opened.is_open,true);
  assert.equal(opened.booked_count,0);
  // Reopening never rewrites the historical dates of cancelled bookings.
  expectStatus(await request("PUT",
    "/api/staff/calendar/slots/"+slotId,staff,{
      startsAtLocal:day+"T16:00",durationMinutes:20,capacity:2
    }),409);
  expectStatus(await request("POST",
    "/api/staff/calendar/slots/"+slotId+"/reopen",staff),409);
  // Term policy may be edited when no active bookings remain.
  expectStatus(await request("PUT",
    "/api/staff/calendar/terms/"+termId,staff,{
      ...termChanged,maximumNoticeDays:90
    }),200);
  const audits=await pool.query<{total:number}>(
    "SELECT count(*)::integer AS total FROM audit_logs "+
    "WHERE target_id=$1 AND action LIKE 'calendar_%'",
    [slotId]
  );
  assert.ok(audits.rows[0].total>=3);
  console.log("PASS: reopening doesn't restore cancelled bookings; staff changes audited");
  console.log("Staff calendar management integration tests passed");
} finally {
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    // Identify only this run's fictional IDs and one dedicated term.
    const profileIds=await client.query<{id:string}>(
      "SELECT id FROM profiles WHERE email=ANY($1::text[])",[emails]
    );
    const ids=profileIds.rows.map(x=>x.id);
    const term=await client.query<{id:string}>(
      "SELECT id FROM terms WHERE code=$1",[termCode]
    );
    const tid=term.rows[0]?.id;
    if(ids.length){
      await client.query(
        "DELETE FROM student_notifications WHERE student_id=ANY($1::uuid[])",[ids]
      );
      await client.query(
        "DELETE FROM booking_events WHERE booking_id IN "+
        "(SELECT id FROM bookings WHERE student_id=ANY($1::uuid[]))",[ids]
      );
      await client.query(
        "DELETE FROM bookings WHERE student_id=ANY($1::uuid[])",[ids]
      );
    }
    if(tid){
      const slotRows=await client.query<{id:string}>(
        "SELECT id FROM appointment_slots WHERE term_id=$1",[tid]
      );
      const slotIds=slotRows.rows.map(x=>x.id);
      await client.query(
        "DELETE FROM audit_logs WHERE action LIKE 'calendar_%' "+
        "AND ((target_type='slot' AND target_id=ANY($1::uuid[])) "+
        "OR (target_type='term' AND target_id=$2))",
        [slotIds,tid]
      );
      await client.query(
        "DELETE FROM appointment_slots WHERE term_id=$1",[tid]
      );
      await client.query(
        "DELETE FROM enrollment_verifications WHERE term_id=$1",[tid]
      );
      await client.query(
        "DELETE FROM eligibility_surveys WHERE term_id=$1",[tid]
      );
      await client.query("DELETE FROM terms WHERE id=$1",[tid]);
    }
    if(ids.length){
      await client.query(
        "DELETE FROM auth_sessions WHERE profile_id=ANY($1::uuid[])",[ids]
      );
      await client.query(
        "DELETE FROM auth_credentials WHERE profile_id=ANY($1::uuid[])",[ids]
      );
      await client.query("DELETE FROM profiles WHERE id=ANY($1::uuid[])",[ids]);
    }
    await client.query("COMMIT");
    console.log("Cleaned up calendar-only fictional fixtures");
  }catch(error){
    await client.query("ROLLBACK");
    console.error("Calendar fixture cleanup failed:",error);
  }finally{
    client.release();
    await pool.end();
  }
}
