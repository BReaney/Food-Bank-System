# Milestones 8–9: Dependents and third-party pickup authorization

These features are for the local fictional-data UVSS Food Bank prototype only.
**Do not enter real dependents, children, contact details or sensitive records.**

## RSD coverage

- REQ-10: students request dependents, staff confirm/deny; only confirmed
  dependents may be removed by the student. Third-party contacts can be
  added, edited, or removed by their owner.
- REQ-11: students must explicitly accept a displayed disclosure for each
  creation/edit of a third-party contact. The exact displayed text, version
  and consent timestamp are saved; staff can review them.
- REQ-12: required fields and explicit consent are validated on the server
  (and by React form controls).
- REQ-13: pending/confirmed/denied are visible to the submitting student.
- REQ-17: confirmed dependents and third-party contacts are selectable
  during booking; existing upcoming bookings can change designated pickup
  before the cancellation cutoff.
- Security: students only see their own records and cannot spoof
  another student ID; staff-only endpoints expose records after role
  authorization and log all staff status changes in household_events
  and audit_logs. Booking ownership is additionally enforced by
  composite PostgreSQL foreign keys.

## Minimal data and consent choices

RSD does not specify a list of required personally identifiable fields.
The demo stores only dependent full name and relationship, or contact full
name, a phone/email method and value. No DOB, address, government ID,
student ID, documents or health information are requested.

All new contacts start **pending** until staff approval. This is not
self-certification. Staff must verify fictional evidence outside the app.
The demonstration disclosure (demo-pickup-v1) is deliberately NOT legally
approved UVSS wording. Review policy and data minimization before any
real deployment. Consent text and timestamp are saved on each edit.

### Revocation and current bookings

Changing a contact resets its status to pending and requires new consent.
Student changes to the person assigned to an appointment use the SAME
term-specific notice window as cancellation and rescheduling (24 hours
by default): strictly **more than** the configured notice period must
remain before the appointment starts. This rule covers both direct
booking pickup changes and indirect changes that affect a booking.

If a dependent or contact is assigned to any active booking **inside**
its change cutoff, the student cannot remove the dependent or edit/remove
that contact: the API returns HTTP 422 without changing the record or
booking. Editing unrelated, unused contacts or registering new dependents
is still permitted. For urgent changes, contact staff.

Outside the cutoff, editing/removing an assigned contact or removing an
assigned confirmed dependent atomically switches affected bookings back
to **student pickup**, without cancelling the reservation, and creates
a pickup_updated event. Staff withdrawals are an authorized safety
override: removing staff approval immediately clears assignments for
future **and in-progress** bookings (until their scheduled end), even
inside the student's change cutoff. No unapproved pickup remains assigned
to an active appointment in progress.

Both student and staff views refresh within about five seconds, or on
tab focus. Events preserve the reason without exposing contact phone/email
details.

**Policy clarification still needed:** the RSD permits naming a confirmed
dependent during booking but does not clarify age or pickup eligibility.
The demo models this as an approved designated person; UVSS must decide
whether certain dependents (for example, minors) can physically collect
a hamper before real use.

## Database migration (manual local setup)

1. Fetch the branch, with no uncommitted changes:

       git fetch origin
       git switch --track origin/feature/dependents-third-party-pickup

2. Open pgAdmin and connect to **foodbank_dev as foodbank_app**.
3. Run **database/migrations/004_household_pickups.sql** once.
4. Do not re-run older migrations or recreate the database.
5. Start backend and frontend separately with npm run dev.
   Run npm ci first in each directory if dependencies are missing.

The CI workflow automatically applies migration 004 to its disposable
PostgreSQL instance, before running existing and new integration tests.

## Manual browser test

Use separate browser profiles for two fictional students and staff.

1. Student A: register a dependent with a fictional name and relationship.
   Status should show pending. Attempting removal must be disallowed.
2. Staff: in **Staff dependent and pickup verification** select Dependent
   requests. Confirm the request; separately create and deny another.
3. Student A: see confirmed and denied. Remove the confirmed dependent
   (no physical record is deleted; the removed_at timestamp is retained).
4. Student A: create a third-party contact with fictional phone/email.
   Leave any required field or the consent checkbox empty: submission
   must be rejected. Complete everything, consent, submit: pending.
5. Staff: switch to Third-party pickup contacts. Inspect consent text and
   timestamp and confirm the contact.
6. Student A: use the **Who will collect the hamper?** picker when booking.
   Confirmed dependents and approved contacts are listed. A booking
   shows the chosen person's name only on A's own screen and staff's
   appointment roster.
7. Student B: capacity changes as before but no names/contact details
   or other students' records. Attempting to access staff API returns 403.
8. Student A: edit a confirmed contact. The new consent checkbox must
   be accepted. Approval resets to pending and a future appointment
   using that contact reverts to student pickup, with a private event.
9. Staff: re-confirm the contact; A can select them again in an existing
   booking before the normal appointment cutoff. Staff denial resets
   future and in-progress designations to student pickup again.
9a. For a fictional booking less than 24 hours away, a student must
    receive HTTP 422 on direct pickup changes, contact edit/removal,
    dependent removal, cancellation and rescheduling. The existing
    designation and approvals must remain unchanged. Staff may still
    revoke an assigned pickup contact immediately.
10. Staff: check the authorized booking roster's pickup details; no other
    student should see the stored name, email or phone.

## New endpoints

Student only:
- GET /api/household/consent
- GET, POST /api/household/dependents
- DELETE /api/household/dependents/:id (confirmed only)
- GET, POST /api/household/contacts
- PUT, DELETE /api/household/contacts/:id
- PATCH /api/bookings/:bookingId/pickup
- Existing POST /api/bookings accepts optional pickupKind and pickupId;
  default pickupKind=self.

Staff only:
- GET /api/staff/household/dependents
- GET /api/staff/household/contacts
- PUT /api/staff/household/dependents/:id/status
- PUT /api/staff/household/contacts/:id/status

Staff list query supports status=all/pending/confirmed/denied, search,
limit (1–100) and offset. Booking list additionally displays the
designated approved pickup person and consent timestamp for staff.

## Automated smoke tests

With local Express running:

       cd backend
       npm run test:household

The test uses two random fictional student accounts, a dedicated term,
a fictional contact and dependent requests, and a future appointment.
It verifies privacy, staff permission checks, required fields, consent
recording, confirmation/denial, cross-account picker rejection,
booking designation, consent renewal, pickup revocation and audit
records. It cleans up test-owned fixtures. The CI pipeline runs the
same test with a disposable database.

## Not production-complete

- Consent disclosure requires formal UVSS approval, policy, retention
  rules and security/privacy review.
- No real identity evidence is collected or automatically checked.
- Email/SMS alerts are not implemented; in-app activity is recorded.
- Full staff scheduling, reports and consent retention/deletion policy
  remain separate milestones.
- No concurrent-booking stress tests are included; this was deferred.
