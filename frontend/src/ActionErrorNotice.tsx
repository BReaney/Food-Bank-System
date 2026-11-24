import { useEffect, useRef } from "react";
import { revealActionError } from "./noticeNavigation";

interface ActionErrorNoticeProps {
  message: string;
}

// Mount only for errors from explicit user actions. The effect focuses and
// scrolls to each newly shown alert; background polling errors should not
// trigger this behavior or interrupt the user.
export default function ActionErrorNotice({ message }: ActionErrorNoticeProps) {
  const noticeRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (!noticeRef.current) return;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    revealActionError(noticeRef.current, reducedMotion);
  }, [message]);

  return (
    <p ref={noticeRef} role="alert" tabIndex={-1}
      className="auth-notice auth-notice-error">
      <strong>Unable to complete the action.</strong> {message}
    </p>
  );
}
