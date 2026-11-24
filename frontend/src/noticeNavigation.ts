// User-triggered failures should be brought into view without making
// background refresh errors repeatedly steal focus or scroll position.
export function revealActionError(
  target: Pick<HTMLElement, "focus" | "scrollIntoView">,
  prefersReducedMotion: boolean
): void {
  // Avoid a double jump when moving keyboard focus to the message.
  target.focus({ preventScroll: true });
  target.scrollIntoView({
    behavior: prefersReducedMotion ? "auto" : "smooth",
    block: "start"
  });
}
