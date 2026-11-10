import { asc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { app } from '../app.js';
import { complaints, users, type ComplaintKind, type ComplaintStatus } from '../db/schema.js';
import { now } from '../lib/time.js';

export interface ComplaintView {
  id: number;
  kind: ComplaintKind;
  status: ComplaintStatus;
  text: string;
  note: string | null;
  resolution: string | null;
  bookingId: number | null;
  from: { id: number; name: string; phone: string; telegramId: number };
  against: { id: number; name: string; phone: string; telegramId: number } | null;
  createdAt: string;
}

const against = alias(users, 'against_user');

function select() {
  return app.db
    .select({ c: complaints, f: users, a: against })
    .from(complaints)
    .innerJoin(users, eq(users.id, complaints.fromUserId))
    .leftJoin(against, eq(against.id, complaints.againstUserId));
}

type Row = Awaited<ReturnType<typeof select>>[number];

function toView({ c, f, a }: Row): ComplaintView {
  const person = (u: typeof f) => ({ id: u.id, name: u.name, phone: u.phone, telegramId: u.telegramId });
  return {
    id: c.id,
    kind: c.kind,
    status: c.status,
    text: c.text,
    note: c.note,
    resolution: c.resolution,
    bookingId: c.bookingId,
    from: person(f),
    against: a ? person(a) : null,
    createdAt: c.createdAt.toISOString(),
  };
}

export async function createComplaint(input: {
  fromUserId: number;
  againstUserId?: number | null;
  bookingId?: number | null;
  kind?: ComplaintKind;
  text: string;
}): Promise<ComplaintView> {
  const [row] = await app.db
    .insert(complaints)
    .values({
      fromUserId: input.fromUserId,
      againstUserId: input.againstUserId ?? null,
      bookingId: input.bookingId ?? null,
      kind: input.kind ?? 'complaint',
      text: input.text,
    })
    .returning({ id: complaints.id });
  return (await getComplaint(row!.id))!;
}

export async function getComplaint(id: number): Promise<ComplaintView | undefined> {
  const rows = await select().where(eq(complaints.id, id));
  return rows[0] ? toView(rows[0]) : undefined;
}

/** Открытые жалобы: срочные («сел другой человек») сверху, затем по времени. */
export async function listOpenComplaints(): Promise<ComplaintView[]> {
  const rows = await select()
    .where(inArray(complaints.status, ['new', 'in_progress']))
    .orderBy(sql`${complaints.kind} = 'wrong_person' desc`, asc(complaints.createdAt))
    .limit(20);
  return rows.map(toView);
}

export async function takeComplaint(id: number, adminId: number | null): Promise<void> {
  await app.db.update(complaints).set({ status: 'in_progress', handledBy: adminId }).where(eq(complaints.id, id));
}

export async function setComplaintNote(id: number, note: string): Promise<void> {
  await app.db.update(complaints).set({ note }).where(eq(complaints.id, id));
}

export async function resolveComplaint(id: number, adminId: number | null, resolution: string): Promise<void> {
  await app.db
    .update(complaints)
    .set({ status: 'resolved', resolution, handledBy: adminId, resolvedAt: now() })
    .where(eq(complaints.id, id));
}
