import { useCallback, useEffect, useState } from "react";

interface StudentNotice {
  id:string;
  booking_id:string|null;
  category:"slot_time_changed"|"slot_closed";
  message:string;
  created_at:string;
  read_at:string|null;
}
const API="http://localhost:3001";

export default function StudentNotifications(){
  const [notices,setNotices]=useState<StudentNotice[]>([]);
  const [error,setError]=useState("");
  const [busyId,setBusyId]=useState<string|null>(null);

  const refresh=useCallback(async(signal?:AbortSignal)=>{
    const result=await fetch(API+"/api/notifications",{
      credentials:"include",cache:"no-store",signal
    });
    const data=await result.json() as {
      notifications?:StudentNotice[];error?:string;
    };
    if(!result.ok)throw new Error(data.error??"Unable to load notifications");
    if(!signal?.aborted){
      setNotices(data.notifications??[]);
      setError("");
    }
  },[]);

  useEffect(()=>{
    const controller=new AbortController();
    let running=false;
    const tick=()=>{
      if(document.hidden||running)return;
      running=true;
      void refresh(controller.signal).catch(e=>{
        if(!controller.signal.aborted)setError((e as Error).message);
      }).finally(()=>{running=false;});
    };
    tick();
    const timer=window.setInterval(tick,5000);
    window.addEventListener("focus",tick);
    document.addEventListener("visibilitychange",tick);
    return()=>{
      controller.abort();window.clearInterval(timer);
      window.removeEventListener("focus",tick);
      document.removeEventListener("visibilitychange",tick);
    };
  },[refresh]);

  async function markRead(id:string){
    setBusyId(id);
    try{
      const r=await fetch(API+"/api/notifications/"+id+"/read",{
        method:"PATCH",credentials:"include",cache:"no-store"
      });
      const data=await r.json() as {error?:string};
      if(!r.ok)throw new Error(data.error??"Unable to mark notice read");
      await refresh();
    }catch(e){setError((e as Error).message);}
    finally{setBusyId(null);}
  }

  const unread=notices.filter(n=>!n.read_at).length;
  return(
    <section className="auth-panel" aria-labelledby="student-notification-title">
      <h2 id="student-notification-title">
        Appointment schedule notices {unread>0&&<span>({unread} unread)</span>}
      </h2>
      <p className="auth-muted">
        Private in-app notices when staff change your appointment time or
        close a booked slot. These messages are visible only to your account.
      </p>
      {error&&<p role="alert" className="auth-notice">{error}</p>}
      {notices.length===0?<p>No schedule-change notices yet.</p>:(
        <ul className="auth-list">
          {notices.map(n=>(
            <li key={n.id}>
              <p><strong>{n.read_at?"Read":"Unread"} schedule notice</strong>
                {" — "}{new Date(n.created_at).toLocaleString("en-CA",{
                  timeZone:"America/Vancouver",dateStyle:"medium",timeStyle:"short"
                })}
              </p>
              <p>{n.message}</p>
              {!n.read_at&&<button type="button" disabled={busyId!==null}
                onClick={()=>void markRead(n.id)}>Mark as read</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
