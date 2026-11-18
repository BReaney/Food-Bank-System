import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import WeeklyPlanner, { WeekPicker } from "./WeeklyPlanner";
import { addCalendarDays, clockLabel, localParts, todayVancouver, weekOf } from "./calendarDates";

interface Term {
  id:string; code:string; name:string;
  starts_on:string; ends_on:string;
  minimum_notice_days:number; maximum_notice_days:number;
  cancellation_cutoff_hours:number; slot_count:number;
}
interface Slot {
  id:string; term_id:string;
  starts_at:string; ends_at:string;
  capacity:number; is_open:boolean;
  booked_count:number; remaining_capacity:number;
}
type FormTerm = {
  code:string; name:string; startsOn:string; endsOn:string;
  minimumNoticeDays:number; maximumNoticeDays:number;
  cancellationCutoffHours:number;
};
const API = "http://localhost:3001";
const EMPTY_TERM:FormTerm={
  code:"", name:"", startsOn:"", endsOn:"",
  minimumNoticeDays:7, maximumNoticeDays:60, cancellationCutoffHours:24
};
const WEEKDAYS=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

function ymd(value:string):string { return value.slice(0,10); }
function toVancouverInput(value:string):string {
  const p=new Intl.DateTimeFormat("en-CA",{
    timeZone:"America/Vancouver",year:"numeric",month:"2-digit",
    day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"
  }).formatToParts(new Date(value));
  const v=(type:string)=>p.find(x=>x.type===type)?.value??"00";
  return v("year")+"-"+v("month")+"-"+v("day")+"T"+v("hour")+":"+v("minute");
}
function dateLabel(value:string):string {
  return new Date(value).toLocaleString("en-CA",{
    timeZone:"America/Vancouver",dateStyle:"medium",timeStyle:"short"
  });
}
async function api<T>(
  path:string, method="GET", body?:unknown, signal?:AbortSignal
):Promise<T>{
  const result=await fetch(API+path,{
    credentials:"include",cache:"no-store",method,signal,
    ...(body===undefined?{}:{
      headers:{"Content-Type":"application/json"},body:JSON.stringify(body)
    })
  });
  const data=await result.json() as T & {error?:string};
  if(!result.ok) throw new Error(data.error??"Calendar request failed");
  return data;
}

export default function StaffCalendar(){
  const [terms,setTerms]=useState<Term[]>([]);
  const [termId,setTermId]=useState("");
  // Tag each response with the term/week it belongs to. Even before a
  // new request starts, old slots must not render under a new selection.
  const [loadedSchedule,setLoadedSchedule]=useState<{
    termId:string; week:string; slots:Slot[]; hasMore:boolean;
  }|null>(null);
  const [week,setWeek]=useState(() =>
    weekOf(addCalendarDays(todayVancouver(),7))
  );
  const [selectedSlotId,setSelectedSlotId]=useState<string|null>(null);
  const [termForm,setTermForm]=useState<FormTerm>({...EMPTY_TERM});
  const [editingTermId,setEditingTermId]=useState<string|null>(null);
  const [editingSlotId,setEditingSlotId]=useState<string|null>(null);
  const [slotLocal,setSlotLocal]=useState("");
  const [duration,setDuration]=useState(20);
  const [capacity,setCapacity]=useState(4);
  const [fromDate,setFromDate]=useState("");
  const [toDate,setToDate]=useState("");
  const [startTime,setStartTime]=useState("09:00");
  const [endTime,setEndTime]=useState("12:00");
  const [repeatMinutes,setRepeatMinutes]=useState(20);
  const [repeatCapacity,setRepeatCapacity]=useState(4);
  const [weekdays,setWeekdays]=useState<number[]>([]);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const [refreshVersion,setRefreshVersion]=useState(0);

  const refresh=useCallback(async(signal:AbortSignal)=>{
    const [t,s]=await Promise.all([
      api<{terms:Term[]}>("/api/staff/calendar/terms","GET",undefined,signal),
      termId
        ? api<{slots:Slot[];hasMore:boolean}>(
            "/api/staff/calendar/slots?termId="+encodeURIComponent(termId)+
            "&week="+encodeURIComponent(week),"GET",undefined,signal)
        : Promise.resolve({slots:[],hasMore:false})
    ]);
    // A term/week switch unmounts the old effect, aborting its request.
    // An obsolete response must never overwrite the current calendar.
    if(signal.aborted)return;
    setTerms(t.terms);
    setLoadedSchedule({termId,week,slots:s.slots,hasMore:s.hasMore});
    setTermId(current=>current||t.terms[0]?.id||"");
    setError("");
  },[termId,week]);

  useEffect(()=>{
    const controller=new AbortController();
    let running=false;
    const tick=()=>{
      if(document.hidden||running||controller.signal.aborted)return;
      running=true;
      void refresh(controller.signal).catch(e=>{
        if(!controller.signal.aborted)setError((e as Error).message);
      }).finally(()=>{
        running=false;
        if(!controller.signal.aborted)setLoading(false);
      });
    };
    tick();
    const interval=window.setInterval(tick,5000);
    window.addEventListener("focus",tick);
    document.addEventListener("visibilitychange",tick);
    return()=>{
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus",tick);
      document.removeEventListener("visibilitychange",tick);
    };
  },[refresh,refreshVersion]);

  const currentSchedule = loadedSchedule?.termId===termId &&
    loadedSchedule.week===week ? loadedSchedule : null;
  const slots = currentSchedule?.slots ?? [];
  const hasMore = currentSchedule?.hasMore ?? false;
  const selectedTerm=terms.find(t=>t.id===termId);
  async function act(path:string,method:string,body?:unknown,success="Calendar updated"){
    setBusy(true);setError("");setMessage("");
    try{
      const result=await api<Record<string,unknown>>(path,method,body);
      setMessage(success);
      setRefreshVersion(x=>x+1);
      return result;
    }catch(e){
      setError((e as Error).message);
      return null;
    }finally{
      setBusy(false);
    }
  }

  async function saveTerm(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    const result=await act(
      editingTermId?"/api/staff/calendar/terms/"+editingTermId:"/api/staff/calendar/terms",
      editingTermId?"PUT":"POST",
      termForm,editingTermId?"Term updated":"Term created"
    );
    if(result){
      const created=result.term as Term;
      setTermId(created.id);
      setWeek(weekOf(created.starts_on));
      setSelectedSlotId(null);
      setEditingTermId(null);
      setTermForm({...EMPTY_TERM});
      setFromDate(created.starts_on);
      setToDate(created.ends_on);
    }
  }
  function editTerm(term:Term){
    setEditingTermId(term.id);
    setTermForm({
      code:term.code,name:term.name,
      startsOn:ymd(term.starts_on),endsOn:ymd(term.ends_on),
      minimumNoticeDays:term.minimum_notice_days,
      maximumNoticeDays:term.maximum_notice_days,
      cancellationCutoffHours:term.cancellation_cutoff_hours
    });
  }
  async function saveSlot(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(!termId){setError("Create or select a term first");return;}
    const result=await act(
      editingSlotId?"/api/staff/calendar/slots/"+editingSlotId:
        "/api/staff/calendar/slots",
      editingSlotId?"PUT":"POST",
      {
        ...(editingSlotId?{}:{termId}),
        startsAtLocal:slotLocal,durationMinutes:duration,capacity
      },
      editingSlotId?"Slot saved; affected students notified":"Slot created"
    );
    if(result){
      setWeek(weekOf(slotLocal.slice(0,10)));
      setSelectedSlotId(null);
      setEditingSlotId(null);setSlotLocal("");
    }
  }
  function editSlot(s:Slot){
    setEditingSlotId(s.id);
    setSlotLocal(toVancouverInput(s.starts_at));
    setDuration(Math.round(
      (new Date(s.ends_at).getTime()-new Date(s.starts_at).getTime())/60000
    ));
    setCapacity(s.capacity);
  }
  async function generate(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(!termId){setError("Choose a term");return;}
    if(!weekdays.length){setError("Select at least one weekday");return;}
    if(!window.confirm(
      "Generate all slots in this date range? Overlaps will reject the entire operation."
    ))return;
    const result=await act(
      "/api/staff/calendar/terms/"+termId+"/generate","POST",
      {fromDate,toDate,weekdays,startTime,endTime,
       durationMinutes:repeatMinutes,capacity:repeatCapacity},
      "Recurring weekly slots created"
    );
    if(result && typeof result.createdSlots==="number"){
      setWeek(weekOf(fromDate));
      setSelectedSlotId(null);
      setMessage(result.createdSlots+" appointment slots created");
    }
  }
  async function changeOpen(slot:Slot){
    const confirmText=slot.is_open
      ?"Closing this slot will cancel EVERY active booking in it. " +
       "Students will get private in-app notices. Continue?"
      :"Reopen this slot? Previously cancelled bookings will NOT return automatically.";
    if(!window.confirm(confirmText))return;
    const result=await act(
      "/api/staff/calendar/slots/"+slot.id+"/"+(slot.is_open?"close":"reopen"),
      "POST",undefined,slot.is_open?"Slot closed":"Slot reopened"
    );
    if(result&&typeof result.cancelledBookings==="number"){
      setMessage("Slot closed; "+result.cancelledBookings+" active booking(s) cancelled and notified");
    }
  }

  return (
    <section className="auth-panel" aria-labelledby="staff-calendar-title">
      <h2 id="staff-calendar-title">Staff calendar management</h2>
      <p className="auth-muted">
        Restricted staff controls. All times are interpreted in Vancouver's time zone,
        including daylight-saving changes. Calendar updates appear in students' slot
        lists automatically; occupied-slot moves and closures generate private notices.
      </p>
      {error&&<p role="alert" className="auth-notice">{error}</p>}
      {message&&<p role="status" className="auth-notice">{message}</p>}
      {loading&&<p role="status">Loading calendar...</p>}

      <h3>1. Create or edit a term</h3>
      <form className="auth-fields" onSubmit={e=>void saveTerm(e)}>
        <label>Term code
          <input required minLength={2} maxLength={24}
            placeholder="FALL2027" pattern="[A-Z0-9][A-Z0-9-]+"
            value={termForm.code}
            onChange={e=>setTermForm(x=>({...x,code:e.target.value}))}/>
        </label>
        <label>Term name
          <input required minLength={3} maxLength={100}
            placeholder="Fall 2027" value={termForm.name}
            onChange={e=>setTermForm(x=>({...x,name:e.target.value}))}/>
        </label>
        <div className="calendar-form-grid">
          <label>Start date<input required type="date" value={termForm.startsOn}
            onChange={e=>setTermForm(x=>({...x,startsOn:e.target.value}))}/></label>
          <label>End date<input required type="date" value={termForm.endsOn}
            onChange={e=>setTermForm(x=>({...x,endsOn:e.target.value}))}/></label>
          <label>Minimum advance notice (days)
            <input required type="number" min={7} max={180}
              value={termForm.minimumNoticeDays}
              onChange={e=>setTermForm(x=>({...x,minimumNoticeDays:Number(e.target.value)}))}/>
          </label>
          <label>Maximum advance notice (days)
            <input required type="number" min={7} max={365}
              value={termForm.maximumNoticeDays}
              onChange={e=>setTermForm(x=>({...x,maximumNoticeDays:Number(e.target.value)}))}/>
          </label>
          <label>Cancellation cutoff (hours)
            <input required type="number" min={0} max={168}
              value={termForm.cancellationCutoffHours}
              onChange={e=>setTermForm(x=>({...x,cancellationCutoffHours:Number(e.target.value)}))}/>
          </label>
        </div>
        <div className="auth-actions">
          <button type="submit" disabled={busy}>
            {editingTermId?"Save term changes":"Create term"}
          </button>
          {editingTermId&&<button type="button" disabled={busy} onClick={()=>{
            setEditingTermId(null);setTermForm({...EMPTY_TERM});
          }}>Cancel editing</button>}
        </div>
        <p className="auth-muted">
          A term's booking rules and dates cannot be changed while active bookings
          exist. No changes are permitted if dates would exclude configured slots.
        </p>
      </form>

      <div className="auth-fields">
        <label>
          Term to manage
          <select value={termId} onChange={e=>{
            const term=terms.find(t=>t.id===e.target.value);
            setTermId(e.target.value);
            setFromDate(term?.starts_on??"");
            setToDate(term?.ends_on??"");
            setEditingSlotId(null);
            setSlotLocal("");
            setEditingTermId(null);
            setTermForm({...EMPTY_TERM});
            setSelectedSlotId(null);
            if (term) setWeek(weekOf(term.starts_on));
            setMessage("");setError("");
          }}>
            <option value="">Select term</option>
            {terms.map(term=><option key={term.id} value={term.id}>
              {term.name} ({term.code}) — {term.slot_count} slots
            </option>)}
          </select>
        </label>
        {selectedTerm&&<div className="auth-actions">
          <button type="button" disabled={busy}
            onClick={()=>editTerm(selectedTerm)}>Edit selected term</button>
        </div>}
      </div>

      {termId&&<>
        <h3>2. Create or edit one appointment slot</h3>
        <form className="auth-fields" id="staff-slot-editor" onSubmit={e=>void saveSlot(e)}>
          <div className="calendar-form-grid">
            <label>Appointment start — Vancouver local time
              <input type="datetime-local" required value={slotLocal}
                onChange={e=>setSlotLocal(e.target.value)}/>
            </label>
            <label>Duration (minutes)
              <input required type="number" min={5} max={120} step={5}
                value={duration} onChange={e=>setDuration(Number(e.target.value))}/>
            </label>
            <label>Capacity
              <input required type="number" min={1} max={100}
                value={capacity} onChange={e=>setCapacity(Number(e.target.value))}/>
            </label>
          </div>
          <div className="auth-actions">
            <button type="submit" disabled={busy}>
              {editingSlotId?"Save slot changes":"Create slot"}
            </button>
            {editingSlotId&&<button type="button" disabled={busy}
              onClick={()=>{setEditingSlotId(null);setSlotLocal("");}}>
              Cancel editing
            </button>}
          </div>
          <p className="auth-muted">
            Overlapping open slots are rejected. You cannot reduce capacity
            below existing reservations. Occupied slots can only move within
            the same week and before the appointment change cutoff.
          </p>
        </form>

        <h3>3. Generate repeating weekly slots</h3>
        <form className="auth-fields" onSubmit={e=>void generate(e)}>
          <div className="calendar-form-grid">
            <label>First day<input type="date" required value={fromDate}
              onChange={e=>setFromDate(e.target.value)}/></label>
            <label>Last day<input type="date" required value={toDate}
              onChange={e=>setToDate(e.target.value)}/></label>
            <label>Daily start time
              <input type="time" required value={startTime}
                onChange={e=>setStartTime(e.target.value)}/></label>
            <label>Daily end time
              <input type="time" required value={endTime}
                onChange={e=>setEndTime(e.target.value)}/></label>
            <label>Each slot duration (minutes)
              <input type="number" required min={5} max={120} step={5}
                value={repeatMinutes}
                onChange={e=>setRepeatMinutes(Number(e.target.value))}/></label>
            <label>Each slot capacity
              <input type="number" required min={1} max={100}
                value={repeatCapacity}
                onChange={e=>setRepeatCapacity(Number(e.target.value))}/></label>
          </div>
          <fieldset className="calendar-weekdays">
            <legend>Available weekdays</legend>
            {WEEKDAYS.map((day,index)=>(
              <label key={day}>
                <input type="checkbox" checked={weekdays.includes(index)}
                  onChange={e=>setWeekdays(current=>
                    e.target.checked
                      ? [...current,index].sort()
                      : current.filter(x=>x!==index)
                  )}/>
                {day}
              </label>
            ))}
          </fieldset>
          <button type="submit" disabled={busy}>Generate weekly slots</button>
          <p className="auth-muted">
            Creates 1–600 fixed-duration slots at once. Existing overlaps,
            invalid dates or repeated times cause the entire operation to
            fail without adding any slots.
          </p>
        </form>

        <h3>4. Weekly appointment planner</h3>
        <p className="auth-muted">
          Choose a week to inspect the available days, appointment times,
          current capacity, or closed slots. Select an appointment card for
          staff-only editing controls.
        </p>
        <WeekPicker week={week} onChange={next => {
          setWeek(next);
          setSelectedSlotId(null);
          setEditingSlotId(null);
          setSlotLocal("");
        }} />
        {hasMore && <p role="alert">
          This week has more than 500 appointment slots; only the first 500
          are displayed. Contact the developer if this limit is reached.
        </p>}
        <WeeklyPlanner
          week={week}
          slots={slots}
          ariaLabel="Staff weekly appointment schedule"
          renderSlot={slot => {
            const status = !slot.is_open ? "closed"
              : slot.remaining_capacity <= 0 ? "full" : "open";
            return (
              <button className="weekly-slot-button" type="button"
                data-status={status}
                aria-pressed={selectedSlotId === slot.id}
                aria-label={dateLabel(slot.starts_at) + ", " +
                  slot.booked_count + " booked of " + slot.capacity +
                  (slot.is_open ? ", open" : ", closed")}
                onClick={() => setSelectedSlotId(slot.id)}>
                <span><strong>{clockLabel(localParts(slot.starts_at).minutes)}</strong></span>
                <span>{slot.is_open
                  ? slot.booked_count + "/" + slot.capacity + " booked" : "Closed"}</span>
              </button>
            );
          }}
        />
        {(() => {
          const slot = slots.find(item => item.id === selectedSlotId);
          if (!slot) return null;
          return (
            <div className="weekly-slot-details">
              <h3>Selected staff appointment</h3>
              <p><strong>{dateLabel(slot.starts_at)}</strong></p>
              <p>Duration: {Math.round(
                (new Date(slot.ends_at).getTime() -
                  new Date(slot.starts_at).getTime()) / 60000
              )} minutes</p>
              <p>Capacity: {slot.capacity}, booked: {slot.booked_count},
                remaining: {slot.remaining_capacity}</p>
              <p>Status: <strong>{slot.is_open ? "Open" : "Closed"}</strong></p>
              <div className="auth-actions">
                <button type="button" disabled={busy} onClick={() => {
                  editSlot(slot);
                  document.getElementById("staff-slot-editor")?.scrollIntoView({
                    behavior: "smooth", block: "start"
                  });
                }}>Edit this slot</button>
                <button type="button" disabled={busy}
                  onClick={() => void changeOpen(slot)}>
                  {slot.is_open ? "Close slot (cancel bookings)" : "Reopen slot"}
                </button>
                <button type="button" onClick={() => setSelectedSlotId(null)}>
                  Clear selection
                </button>
              </div>
            </div>
          );
        })()}
      </>}
    </section>
  );
}
