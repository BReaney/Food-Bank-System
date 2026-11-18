// Navigation only. These routes do not grant access: Express continues to
// authenticate each request and enforce staff/student roles on the server.
export type AccountRole = "student" | "staff";

export interface AppPage {
  id: string;
  label: string;
  description: string;
}

export const studentPages: readonly AppPage[] = [
  {
    id: "appointments",
    label: "Book & manage appointments",
    description: "Browse the weekly calendar, reserve a slot, and manage your bookings."
  },
  {
    id: "eligibility",
    label: "Eligibility & enrollment",
    description: "Review your enrollment verification and complete the term survey."
  },
  {
    id: "household",
    label: "Dependents & pickup contacts",
    description: "Request dependents and manage approved third-party pickup contacts."
  },
  {
    id: "notifications",
    label: "Notifications",
    description: "Read private booking confirmations and staff schedule notices."
  },
  {
    id: "profile",
    label: "My profile",
    description: "Review and update your account's first and last names."
  }
];

export const staffPages: readonly AppPage[] = [
  {
    id: "calendar",
    label: "Calendar & slots",
    description: "Manage terms, weekly appointment schedules, slot capacities and closures."
  },
  {
    id: "appointments",
    label: "Appointment roster",
    description: "Review bookings, search appointment history, and record pickup outcomes."
  },
  {
    id: "enrollment",
    label: "Enrollment verification",
    description: "Search students and record independent term enrollment decisions."
  },
  {
    id: "household",
    label: "Household approvals",
    description: "Approve and review dependent registrations and third-party pickup contacts."
  },
  {
    id: "records",
    label: "Student records",
    description: "Search student profiles and inspect their eligibility and booking histories."
  },
  {
    id: "reports",
    label: "Usage reports",
    description: "Generate aggregate reports and export fictional service usage data."
  },
  {
    id: "profile",
    label: "My profile",
    description: "Review and update your account's first and last names."
  }
];

export function pagesForRole(role: AccountRole): readonly AppPage[] {
  return role === "student" ? studentPages : staffPages;
}

export function pageHash(role: AccountRole, pageId: string): string {
  return "#/" + role + "/" + pageId;
}

export function resolvePage(role: AccountRole, hash: string): AppPage {
  const pages = pagesForRole(role);
  const match = /^#\/(student|staff)\/([a-z-]+)$/.exec(hash);
  if (match && match[1] === role) {
    return pages.find(page => page.id === match[2]) ?? pages[0];
  }
  // Unknown or cross-role links go to the authenticated role's own first page.
  return pages[0];
}

export function canonicalPageHash(role: AccountRole, hash: string): string {
  return pageHash(role, resolvePage(role, hash).id);
}
