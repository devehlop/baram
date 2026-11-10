import { and, asc, eq } from 'drizzle-orm';
import { app } from '../app.js';
import { localities, savedAddresses, savedPassengers, type PassengerType } from '../db/schema.js';

export interface SavedAddressView {
  id: number;
  label: string;
  localityId: number;
  city: string;
  village: boolean;
  directionId: number;
  side: 'a' | 'b';
  address: string;
  lat: number | null;
  lon: number | null;
}

export interface SavedPassengerView {
  id: number;
  name: string;
  phone: string;
  type: PassengerType;
}

const MAX_SAVED = 8;

export async function listAddresses(userId: number): Promise<SavedAddressView[]> {
  const rows = await app.db
    .select({ a: savedAddresses, l: localities })
    .from(savedAddresses)
    .innerJoin(localities, eq(localities.id, savedAddresses.localityId))
    .where(and(eq(savedAddresses.userId, userId), eq(localities.active, true)))
    .orderBy(asc(savedAddresses.id));
  return rows.map(({ a, l }) => ({
    id: a.id,
    label: a.label,
    localityId: l.id,
    city: l.name,
    village: l.kind === 'village',
    directionId: l.directionId,
    side: l.side,
    address: a.address,
    lat: a.lat,
    lon: a.lon,
  }));
}

export async function hasAddress(userId: number, localityId: number, address: string): Promise<boolean> {
  const [row] = await app.db
    .select({ id: savedAddresses.id })
    .from(savedAddresses)
    .where(
      and(eq(savedAddresses.userId, userId), eq(savedAddresses.localityId, localityId), eq(savedAddresses.address, address)),
    );
  return !!row;
}

export async function saveAddress(input: {
  userId: number;
  label: string;
  localityId: number;
  address: string;
  lat?: number | null;
  lon?: number | null;
}): Promise<boolean> {
  if (await hasAddress(input.userId, input.localityId, input.address)) return false;
  const existing = await app.db
    .select({ id: savedAddresses.id })
    .from(savedAddresses)
    .where(eq(savedAddresses.userId, input.userId));
  if (existing.length >= MAX_SAVED) return false;
  await app.db.insert(savedAddresses).values({
    userId: input.userId,
    label: input.label,
    localityId: input.localityId,
    address: input.address,
    lat: input.lat ?? null,
    lon: input.lon ?? null,
  });
  return true;
}

export async function deleteAddress(userId: number, id: number): Promise<void> {
  await app.db.delete(savedAddresses).where(and(eq(savedAddresses.id, id), eq(savedAddresses.userId, userId)));
}

export async function listPassengers(userId: number): Promise<SavedPassengerView[]> {
  const rows = await app.db
    .select()
    .from(savedPassengers)
    .where(eq(savedPassengers.userId, userId))
    .orderBy(asc(savedPassengers.id));
  return rows.map((p) => ({ id: p.id, name: p.name, phone: p.phone, type: p.type }));
}

/** Запоминает человека, за которого оформляли поездку. Повтор по телефону обновляет запись. */
export async function savePassenger(userId: number, p: { name: string; phone: string; type: PassengerType }): Promise<void> {
  const [same] = await app.db
    .select()
    .from(savedPassengers)
    .where(and(eq(savedPassengers.userId, userId), eq(savedPassengers.phone, p.phone)));
  if (same) {
    await app.db.update(savedPassengers).set({ name: p.name, type: p.type }).where(eq(savedPassengers.id, same.id));
    return;
  }
  const all = await listPassengers(userId);
  if (all.length >= MAX_SAVED) return;
  await app.db.insert(savedPassengers).values({ userId, ...p });
}

export async function deletePassenger(userId: number, id: number): Promise<void> {
  await app.db.delete(savedPassengers).where(and(eq(savedPassengers.id, id), eq(savedPassengers.userId, userId)));
}
