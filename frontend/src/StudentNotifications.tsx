import { useEffect, useState } from "react";

type NoticeCategory =
  | "slot_time_changed" | "slot_closed"
  | "booking_confirmed" | "booking_cancelled" | "booking_rescheduled";

interface StudentNotice {
  id: string;
  booking_id: string | null;
  category: NoticeCategory;
  message: string;
  created_at: string;
  read_at: string | null;
}
interface PageInfo {
  limit: number;
  offset: number;
  total: number;
  hasNext: boolean;
  hasPrevious: boolean;
}
const API = "http://localhost:3001";
const PAGE_SIZE = 25;
const REFRESH_MS = 5000;

const categoryLabels: Record<NoticeCategory, string> = {
  slot_time_changed: "Staff schedule change",
  slot_closed: "Staff slot closure",
  booking_confirmed: "Booking confirmed",
  booking_cancelled: "Booking cancelled",
  booking_rescheduled: "Booking rescheduled"
};

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Vancouver"
  }).format(new Date(value));
}

export default function StudentNotifications() {
  const [notices, setNotices] = useState<StudentNotice[]>([]);
  const [pagination, setPagination] = useState<PageInfo | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    setLoading(true);
    setError("");
    setNotices([]);
    setPagination(null);

    const refresh = () => {
      if (document.hidden || running || controller.signal.aborted) return;
      running = true;
      void (async () => {
        try {
          const params = new URLSearchParams({
            limit: String(PAGE_SIZE), offset: String(offset)
          });
          const response = await fetch(API + "/api/notifications?" + params.toString(), {
            credentials: "include", cache: "no-store", signal: controller.signal
          });
          const data = await response.json() as {
            notifications?: StudentNotice[];
            pagination?: PageInfo;
            unreadCount?: number;
            error?: string;
          };
          if (!response.ok) throw new Error(data.error ?? "Unable to load notifications");
          if (controller.signal.aborted) return;
          if (data.pagination && data.pagination.total > 0 &&
              offset >= data.pagination.total) {
            setOffset(Math.floor((data.pagination.total - 1) / PAGE_SIZE) * PAGE_SIZE);
            return;
          }
          setNotices(data.notifications ?? []);
          setPagination(data.pagination ?? null);
          setUnreadCount(data.unreadCount ?? 0);
          setError("");
        } catch (e) {
          if (!controller.signal.aborted) setError((e as Error).message);
        } finally {
          running = false;
          if (!controller.signal.aborted) setLoading(false);
        }
      })();
    };

    refresh();
    const timer = window.setInterval(refresh, REFRESH_MS);
    const onChange = () => setRevision(value => value + 1);
    window.addEventListener("student-notifications-changed", onChange);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("student-notifications-changed", onChange);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [offset, revision]);

  async function acknowledge(path: string, id: string) {
    setBusyId(id);
    setError("");
    try {
      const response = await fetch(API + path, {
        method: "PATCH", credentials: "include", cache: "no-store"
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Unable to mark notification read");
      setRevision(value => value + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="auth-panel" aria-labelledby="student-notification-title">
      <h2 id="student-notification-title">
        Appointment notifications {unreadCount > 0 && <span>({unreadCount} unread)</span>}
      </h2>
      <p className="auth-muted">
        Private confirmations for bookings, cancellations and rescheduling,
        plus notices when staff move or close your scheduled appointment.
        Messages are saved to your account, not sent as email or SMS.
      </p>

      <div className="auth-actions">
        <button type="button" disabled={busyId !== null || unreadCount === 0}
          onClick={() => void acknowledge("/api/notifications/read-all", "all")}>
          {busyId === "all" ? "Marking all..." : "Mark all as read"}
        </button>
      </div>

      {error && <p role="alert" className="auth-notice">{error}</p>}
      {loading && <p role="status">Loading appointment notifications...</p>}
      {!loading && !error && pagination && (
        <>
          {pagination.total === 0 ? (
            <p role="status">No appointment notifications yet.</p>
          ) : (
            <>
              <p className="auth-muted" role="status">
                Showing {pagination.offset + 1}–{pagination.offset + notices.length} of {pagination.total} notifications.
              </p>
              <ul className="auth-list">
                {notices.map(notice => (
                  <li key={notice.id}>
                    <p>
                      <strong>
                        {categoryLabels[notice.category] ?? "Appointment notice"}
                        {notice.read_at ? "" : " — Unread"}
                      </strong>
                      {" — "}{formatTime(notice.created_at)}
                    </p>
                    <p>{notice.message}</p>
                    {!notice.read_at && (
                      <button type="button" disabled={busyId !== null}
                        onClick={() => void acknowledge("/api/notifications/" + notice.id + "/read", notice.id)}>
                        {busyId === notice.id ? "Marking..." : "Mark as read"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <nav className="staff-pagination" aria-label="Appointment notification pages">
                <button type="button" disabled={!pagination.hasPrevious || busyId !== null}
                  onClick={() => setOffset(value => Math.max(0, value - PAGE_SIZE))}>
                  Newer notices
                </button>
                <span>
                  Page {Math.floor(pagination.offset / PAGE_SIZE) + 1}
                  {" of "}{Math.max(1, Math.ceil(pagination.total / PAGE_SIZE))}
                </span>
                <button type="button" disabled={!pagination.hasNext || busyId !== null}
                  onClick={() => setOffset(value => value + PAGE_SIZE)}>
                  Older notices
                </button>
              </nav>
            </>
          )}
        </>
      )}
    </section>
  );
}
