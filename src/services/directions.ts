import { and, asc, eq } from 'drizzle-orm';
import { app } from '../app.js';
import { directions, localities, type DirectionRow, type LocalityRow, type Side } from '../db/schema.js';

export interface LocalityView {
  id: number;
  directionId: number;
  name: string;
  kind: 'city' | 'village';
  side: Side;
}

function toView(l: LocalityRow): LocalityView {
  return { id: l.id, directionId: l.directionId, name: l.name, kind: l.kind, side: l.side };
}

export async function listDirections(): Promise<DirectionRow[]> {
  return app.db.select().from(directions).where(eq(directions.active, true)).orderBy(asc(directions.id));
}

export async function getDirection(id: number): Promise<DirectionRow | undefined> {
  const [row] = await app.db.select().from(directions).where(eq(directions.id, id));
  return row;
}

export function otherSide(side: Side): Side {
  return side === 'a' ? 'b' : 'a';
}

export function cityOf(d: Pick<DirectionRow, 'cityA' | 'cityB'>, side: Side): string {
  return side === 'a' ? d.cityA : d.cityB;
}

/** «Буинск → Казань» для стороны отправления. */
export function routeLabel(d: Pick<DirectionRow, 'cityA' | 'cityB'>, fromSide: Side): string {
  return `${cityOf(d, fromSide)} → ${cityOf(d, otherSide(fromSide))}`;
}

/** Все активные города и деревни активных направлений. */
export async function listLocalities(): Promise<LocalityView[]> {
  const rows = await app.db
    .select({ l: localities })
    .from(localities)
    .innerJoin(directions, eq(directions.id, localities.directionId))
    .where(and(eq(localities.active, true), eq(directions.active, true)))
    .orderBy(asc(localities.kind), asc(localities.name));
  return rows.map((r) => toView(r.l));
}

export async function getLocality(id: number): Promise<LocalityView | undefined> {
  const [row] = await app.db.select().from(localities).where(eq(localities.id, id));
  return row ? toView(row) : undefined;
}

export async function addVillage(directionId: number, side: Side, name: string): Promise<LocalityView> {
  const [row] = await app.db
    .insert(localities)
    .values({ directionId, side, name: name.trim(), kind: 'village' })
    .returning();
  return toView(row!);
}

/** Деревню не удаляем физически: на неё могут ссылаться брони и сохранённые адреса. */
export async function deactivateVillage(id: number): Promise<void> {
  await app.db
    .update(localities)
    .set({ active: false })
    .where(and(eq(localities.id, id), eq(localities.kind, 'village')));
}

export async function setChannel(directionId: number, channelId: string | null): Promise<void> {
  await app.db.update(directions).set({ channelId }).where(eq(directions.id, directionId));
}

export async function setTravelMinutes(directionId: number, minutes: number): Promise<void> {
  await app.db.update(directions).set({ travelMinutes: minutes }).where(eq(directions.id, directionId));
}
