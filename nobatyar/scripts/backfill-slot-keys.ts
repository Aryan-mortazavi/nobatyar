/**
 * One-off migration: move slot reservation from `(staffId, startsAt)` to the
 * releasable `slotKey`.
 *
 * Two steps, both safe to re-run:
 *
 *   1. **indexes** — SQLite cannot drop a unique constraint with `db push`
 *      alone (it needs a table rebuild), so the old index is dropped by hand.
 *      Until this runs, *every cancellation stays permanent* — the exact bug
 *      this script exists to fix.
 *   2. **rows** — every appointment that still holds a slot gets its key, so a
 *      cancellation after the upgrade cannot collide with a live booking.
 *
 *   npx tsx scripts/backfill-slot-keys.ts
 */
import { PrismaClient } from "@prisma/client";

import { holdsSlot, slotKeyOf } from "../src/lib/slot-key";

const prisma = new PrismaClient();

async function dropLegacyIndex(): Promise<void> {
  const rows: { name: string; sql: string }[] = await prisma.$queryRawUnsafe(
    "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'Appointment'",
  );

  const legacy = (rows ?? []).filter(
    (row) =>
      /staffId/i.test(row.sql ?? "") &&
      /startsAt/i.test(row.sql ?? "") &&
      /UNIQUE/i.test(row.sql ?? ""),
  );

  if (legacy.length === 0) {
    console.log("indexes   : no legacy (staffId, startsAt) unique index — nothing to drop");
    return;
  }

  for (const index of legacy) {
    // a unique *constraint* declared in the table DDL cannot be dropped with
    // DROP INDEX; SQLite needs the table rebuilt, which `prisma db push` does
    // for us. Only standalone indexes are dropped here.
    if (!index.name.startsWith("sqlite_autoindex")) {
      await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "${index.name}"`);
      console.log(`indexes   : dropped ${index.name}`);
      continue;
    }
    console.log(
      `indexes   : ${index.name} is part of the table definition — ` +
        "run `npx prisma db push --force-reset` (or recreate the table) to remove it",
    );
  }
}

async function reserveExistingSlots(): Promise<void> {
  const rows = await prisma.appointment.findMany({
    where: { slotKey: null },
    select: { id: true, staffId: true, startsAt: true, status: true },
    orderBy: { startsAt: "asc" },
  });

  if (rows.length === 0) {
    console.log("rows      : every appointment already has a slot key");
    return;
  }

  let reserved = 0;
  let leftFree = 0;
  let conflicts = 0;

  for (const row of rows) {
    if (!holdsSlot(row.status)) {
      leftFree += 1; // cancelled / no-show: the slot belongs to nobody
      continue;
    }
    try {
      await prisma.appointment.update({
        where: { id: row.id },
        data: { slotKey: slotKeyOf(row.staffId, row.startsAt) },
      });
      reserved += 1;
    } catch {
      conflicts += 1;
      console.warn(`  ! could not reserve a slot for appointment ${row.id}`);
    }
  }

  console.log(`rows      : ${reserved} reserved, ${leftFree} left free, ${conflicts} conflicted`);
  if (conflicts > 0) {
    console.log(
      "           Conflicting rows mean two active appointments share one instant. " +
        "Cancel the older one, then run this script again.",
    );
  }
}

async function main(): Promise<void> {
  await dropLegacyIndex();
  await reserveExistingSlots();
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
