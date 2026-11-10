import { and, asc, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import { app } from '../app.js';
import {
  directions,
  driverDirections,
  drivers,
  privileges,
  users,
  type DriverRow,
  type DriverStatus,
  type PrivilegeKind,
  type UserRow,
} from '../db/schema.js';
import { now } from '../lib/time.js';

export interface DriverFormInput {
  fullName: string;
  car: string;
  carYear: number;
  carColor: string;
  plate: string;
  seats: number;
  childSeat: boolean;
  carPhotos: string[];
  payPhone: string;
  payBank: string;
}

export interface DriverView {
  userId: number;
  telegramId: number;
  name: string;
  phone: string;
  fullName: string;
  car: string;
  carYear: number;
  carColor: string;
  plate: string;
  seats: number;
  childSeat: boolean;
  carPhotos: string[];
  payPhone: string;
  payBank: string;
  status: DriverStatus;
  rejectReason: string | null;
  restriction: UserRow['restriction'];
  badge: boolean;
  priority: boolean;
}

export async function getDriverRow(userId: number): Promise<DriverRow | undefined> {
  const [row] = await app.db.select().from(drivers).where(eq(drivers.userId, userId));
  return row;
}

export async function activePrivileges(driverIds: number[]): Promise<Map<number, Set<PrivilegeKind>>> {
  const out = new Map<number, Set<PrivilegeKind>>();
  if (driverIds.length === 0) return out;
  const rows = await app.db
    .select()
    .from(privileges)
    .where(and(inArray(privileges.driverId, driverIds), or(isNull(privileges.until), gt(privileges.until, now()))));
  for (const r of rows) {
    const set = out.get(r.driverId) ?? new Set<PrivilegeKind>();
    set.add(r.kind);
    out.set(r.driverId, set);
  }
  return out;
}

function toView(d: DriverRow, u: UserRow, privs: Set<PrivilegeKind> | undefined): DriverView {
  return {
    userId: u.id,
    telegramId: u.telegramId,
    name: u.name,
    phone: u.phone,
    fullName: d.fullName,
    car: d.car,
    carYear: d.carYear,
    carColor: d.carColor,
    plate: d.plate,
    seats: d.seats,
    childSeat: d.childSeat,
    carPhotos: d.carPhotos,
    payPhone: d.payPhone,
    payBank: d.payBank,
    status: d.status,
    rejectReason: d.rejectReason,
    restriction: u.restriction,
    badge: privs?.has('verified_badge') ?? false,
    priority: privs?.has('priority') ?? false,
  };
}

export async function getDriver(userId: number): Promise<DriverView | undefined> {
  const [row] = await app.db
    .select({ d: drivers, u: users })
    .from(drivers)
    .innerJoin(users, eq(users.id, drivers.userId))
    .where(eq(drivers.userId, userId));
  if (!row) return undefined;
  const privs = await activePrivileges([userId]);
  return toView(row.d, row.u, privs.get(userId));
}

/** Сохраняет анкету и отправляет её на проверку. Повторная анкета снова уходит админу. */
export async function submitDriverForm(userId: number, input: DriverFormInput): Promise<void> {
  const values = { ...input, status: 'pending' as const, rejectReason: null, updatedAt: now() };
  await app.db
    .insert(drivers)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: drivers.userId, set: values });
  // Версия 1: одно направление, водитель работает на всех активных.
  const dirs = await app.db.select({ id: directions.id }).from(directions).where(eq(directions.active, true));
  for (const d of dirs) {
    await app.db.insert(driverDirections).values({ driverId: userId, directionId: d.id }).onConflictDoNothing();
  }
}

export async function updateCarPhotos(userId: number, photos: string[]): Promise<void> {
  await app.db
    .update(drivers)
    .set({ carPhotos: photos, status: 'pending', rejectReason: null, updatedAt: now() })
    .where(eq(drivers.userId, userId));
}

export async function setDriverStatus(
  userId: number,
  status: DriverStatus,
  adminId: number | null,
  reason?: string | null,
): Promise<void> {
  await app.db
    .update(drivers)
    .set({ status, rejectReason: reason ?? null, reviewedBy: adminId, reviewedAt: now(), updatedAt: now() })
    .where(eq(drivers.userId, userId));
}

export async function listDriversByStatus(status: DriverStatus): Promise<DriverView[]> {
  const rows = await app.db
    .select({ d: drivers, u: users })
    .from(drivers)
    .innerJoin(users, eq(users.id, drivers.userId))
    .where(eq(drivers.status, status))
    .orderBy(asc(drivers.updatedAt));
  const privs = await activePrivileges(rows.map((r) => r.u.id));
  return rows.map((r) => toView(r.d, r.u, privs.get(r.u.id)));
}

export async function driverDirectionIds(driverId: number): Promise<number[]> {
  const rows = await app.db
    .select({ id: driverDirections.directionId })
    .from(driverDirections)
    .innerJoin(directions, eq(directions.id, driverDirections.directionId))
    .where(and(eq(driverDirections.driverId, driverId), eq(directions.active, true)));
  return rows.map((r) => r.id);
}

/** Одобренные и не заблокированные водители направления — им уходят заявки пассажиров. */
export async function activeDriversOfDirection(directionId: number): Promise<DriverView[]> {
  const rows = await app.db
    .select({ d: drivers, u: users })
    .from(driverDirections)
    .innerJoin(drivers, eq(drivers.userId, driverDirections.driverId))
    .innerJoin(users, eq(users.id, drivers.userId))
    .where(
      and(eq(driverDirections.directionId, directionId), eq(drivers.status, 'approved'), eq(users.restriction, 'none')),
    );
  const privs = await activePrivileges(rows.map((r) => r.u.id));
  return rows.map((r) => toView(r.d, r.u, privs.get(r.u.id)));
}

export async function grantPrivilege(
  driverId: number,
  kind: PrivilegeKind,
  until: Date | null,
  adminId: number | null,
): Promise<void> {
  await app.db
    .insert(privileges)
    .values({ driverId, kind, until, grantedBy: adminId })
    .onConflictDoUpdate({
      target: [privileges.driverId, privileges.kind],
      set: { until, grantedBy: adminId, createdAt: now() },
    });
}

export async function revokePrivilege(driverId: number, kind: PrivilegeKind): Promise<void> {
  await app.db.delete(privileges).where(and(eq(privileges.driverId, driverId), eq(privileges.kind, kind)));
}
