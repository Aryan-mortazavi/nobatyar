/**
 * The slot-reservation rule, in one pure place.
 *
 * ## Why this exists
 *
 * Double-booking protection needs a database-level guarantee, and a plain
 * unique index on `(staffId, startsAt)` is a *trap*: cancelling an appointment
 * leaves the row behind (the history matters), so the index would keep that
 * instant reserved for ever. One cancellation and nobody could ever book that
 * time again.
 *
 * The fix is to reserve through a nullable key:
 *
 *   * on write  → `slotKey = "<staffId>:<epochMs>"`
 *   * on cancel → `slotKey = NULL`
 *
 * NULLs are exempt from unique indexes in both SQLite and PostgreSQL, so
 * "freeing" a slot is just writing NULL. `holdsSlot()` states the rule that
 * decides which of the two happens.
 *
 * Kept free of imports so both the booking code and the migration script can
 * use it, and so the rule can be unit tested without a database.
 */

/** The value that reserves an instant for one specialist. */
export function slotKeyOf(staffId: string, startsAt: Date | number): string {
  const ms = startsAt instanceof Date ? startsAt.getTime() : startsAt;
  return `${staffId}:${ms}`;
}

/**
 * Does an appointment in this status keep holding its slot?
 *
 * PENDING/CONFIRMED obviously do; COMPLETED consumed the time and stays on the
 * record; CANCELLED and NO_SHOW release it.
 */
export function holdsSlot(status: string): boolean {
  return status === "PENDING" || status === "CONFIRMED" || status === "COMPLETED";
}
