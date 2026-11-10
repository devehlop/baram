/**
 * Действия = изменение в базе + уведомления участникам + обновление поста в канале.
 * Их вызывают кнопки бота, пошаговые сценарии, фоновые задачи и Mini App —
 * поэтому правила и тексты уведомлений живут в одном месте.
 */
import { t } from '../i18n.js';
import { esc, fmtPhone } from '../lib/format.js';
import { dayKey, fmtDateTime, fmtTime } from '../lib/time.js';
import {
  acceptBooking,
  adminApproveBooking,
  cancelBooking,
  confirmBooking,
  createBooking,
  createPhoneBooking,
  declineBooking,
  getBooking,
  getBookings,
  listTripBookings,
  markPrepaid,
  noShowBooking,
  pickUpBooking,
  type BookingView,
  type CancelResult,
  type NewBooking,
} from '../services/bookings.js';
import { refreshChannelPost } from '../services/channel.js';
import { createComplaint, type ComplaintView } from '../services/complaints.js';
import { activeDriversOfDirection, getDriver, setDriverStatus } from '../services/drivers.js';
import {
  closeRequest,
  createRequest,
  expireRequests,
  getRequest,
  markEscalated,
  requestsMatchingTrip,
  takeRequest,
  type NewRequest,
  type RequestView,
} from '../services/requests.js';
import { loadSettings } from '../services/settings.js';
import { cancelTrip, completeTrip, createTrip, getTrip, setTripDeparted, type TripInput, type TripView } from '../services/trips.js';
import { getUser, userStats } from '../services/users.js';
import { driverReviewKb } from './notify.js';
import { kb, notifyAdmins, notifyUser, send, sendPhotos } from './tg.js';
import { bookingForDriver, bookingForPassenger, carLine, complaintCard, driverCard, requestCard, tripCard } from './ui/cards.js';
import { showMenu } from './ui/menu.js';
import { app } from '../app.js';

async function refreshChannel(trip: Pick<TripView, 'directionId' | 'departsAt'>): Promise<void> {
  await refreshChannelPost(trip.directionId, dayKey(trip.departsAt));
}

/** Сообщение заказчику и — если это другой человек с ботом — самому пассажиру. */
async function tellRiders(b: BookingView, text: string, markup?: Parameters<typeof notifyUser>[2]): Promise<void> {
  await notifyUser(b.booker?.id, text, markup);
  if (b.passengerUserId && b.passengerUserId !== b.booker?.id) await notifyUser(b.passengerUserId, text);
}

const who = (b: BookingView) => esc(b.passengerName ?? t('passenger-unknown'));

// ——— Рейсы ———

export async function publishTrip(input: TripInput) {
  const res = await createTrip(input);
  if (!res.trip) return { problem: res.problem! };
  const trip = res.trip;
  await refreshChannel(trip);
  // Пассажирам с открытой заявкой на этот день сообщаем, что появился рейс.
  const waiting = await requestsMatchingTrip(trip);
  for (const r of waiting) {
    await notifyUser(
      r.user.id,
      `${t('req-trip-appeared')}\n\n${tripCard(trip, { village: r.from.village || r.to.village, needChildSeat: r.childSeat === 'driver' })}`,
      kb([[{ text: t('btn-ride-with'), data: `p:rqb:${r.id}:${trip.id}` }]]),
    );
  }
  return { trip, waitingRequests: waiting.length };
}

export async function cancelTripAction(tripId: number, by: { driverId: number } | 'admin'): Promise<boolean> {
  const trip = await getTrip(tripId);
  if (!trip) return false;
  const res = await cancelTrip(tripId, by);
  if (!res) return false;
  for (const b of await getBookings(res.bookingIds)) {
    await tellRiders(b, t('trip-cancelled-for-passenger', { route: esc(trip.route), when: fmtDateTime(trip.departsAt) }));
  }
  if (by === 'admin') await notifyUser(trip.driverId, t('trip-cancelled-by-admin', { when: fmtDateTime(trip.departsAt) }));
  if (res.late) {
    await notifyAdmins(
      t('adm-late-trip-cancel', {
        driver: esc(trip.driver.name),
        phone: fmtPhone(trip.driver.phone),
        route: esc(trip.route),
        when: fmtDateTime(trip.departsAt),
        n: res.bookingIds.length,
      }),
    );
  }
  await refreshChannel(trip);
  return true;
}

/** Брони, которые водитель не успел принять: при выезде и закрытии рейса им приходит отказ, а не тишина. */
async function declineLeftovers(trip: TripView, leftovers: BookingView[]): Promise<void> {
  for (const b of leftovers) await tellRiders(b, t('bk-declined', { when: fmtDateTime(trip.departsAt) }));
}

export async function departAction(tripId: number, driverId: number): Promise<boolean> {
  const leftovers = await listTripBookings(tripId, ['pending', 'pending_admin']);
  if (!(await setTripDeparted(tripId, driverId))) return false;
  const trip = (await getTrip(tripId))!;
  await declineLeftovers(trip, leftovers);
  for (const b of await listTripBookings(tripId, ['accepted', 'confirmed'])) {
    if (b.source === 'phone') continue;
    await tellRiders(b, t('ride-driver-departed', { driver: esc(trip.driver.name), phone: fmtPhone(trip.driver.phone) }));
  }
  await refreshChannel(trip);
  return true;
}

export async function completeTripAction(tripId: number, driverId: number | null): Promise<boolean> {
  const leftovers = await listTripBookings(tripId, ['pending', 'pending_admin']);
  const ids = await completeTrip(tripId, driverId);
  if (!ids) return false;
  const trip = (await getTrip(tripId))!;
  await declineLeftovers(trip, leftovers);
  for (const b of await getBookings(ids)) {
    if (b.source === 'phone') continue;
    await notifyUser(
      b.booker?.id,
      b.isSelf ? t('ride-arrived-self') : t('ride-arrived-other', { name: who(b) }),
      kb([
        [{ text: t('btn-repeat'), data: `p:rep:${b.id}` }, { text: t('btn-reverse'), data: `p:rev:${b.id}` }],
        [{ text: t('btn-complain'), data: `p:cmp:${b.id}` }],
      ]),
    );
    if (b.passengerUserId && b.passengerUserId !== b.booker?.id) await notifyUser(b.passengerUserId, t('ride-arrived-self'));
  }
  await refreshChannel(trip);
  return true;
}

// ——— Брони ———

async function tellDriverAboutBooking(b: BookingView, trip: TripView): Promise<void> {
  const marks = b.booker ? await userStats(b.booker.id) : undefined;
  await notifyUser(
    trip.driverId,
    `${t('drv-new-booking', { route: esc(trip.route), when: fmtDateTime(trip.departsAt) })}\n\n${bookingForDriver(b, marks)}`,
    kb([
      [{ text: t('btn-accept'), data: `d:acc:${b.id}` }],
      [{ text: t('btn-decline'), data: `d:dec:${b.id}` }],
    ]),
  );
}

export async function submitBooking(input: NewBooking) {
  const res = await createBooking(input);
  if (!res.ok) return res;
  const trip = (await getTrip(res.booking.tripId))!;
  if (res.needsAdmin) {
    await notifyAdmins(
      `${t('adm-booking-needs-approval')}\n\n${t('drv-new-booking', { route: esc(trip.route), when: fmtDateTime(trip.departsAt) })}\n${bookingForDriver(res.booking)}`,
      kb([
        [{ text: t('btn-allow'), data: `a:bk:ok:${res.booking.id}` }],
        [{ text: t('btn-reject'), data: `a:bk:no:${res.booking.id}` }],
      ]),
    );
  } else {
    await tellDriverAboutBooking(res.booking, trip);
  }
  await refreshChannel(trip);
  return res;
}

export async function adminBookingDecision(bookingId: number, allow: boolean): Promise<boolean> {
  const before = await getBooking(bookingId);
  if (!before) return false;
  const trip = (await getTrip(before.tripId))!;
  if (allow) {
    if (!(await adminApproveBooking(bookingId))) return false;
    await tellDriverAboutBooking((await getBooking(bookingId))!, trip);
    return true;
  }
  if (!(await declineBooking(bookingId))) return false;
  await tellRiders(before, t('bk-declined-by-admin'));
  await refreshChannel(trip);
  return true;
}

function passengerBookingKb(b: BookingView) {
  return kb([[{ text: t('btn-open-booking'), data: `p:b:${b.id}` }]]);
}

export async function acceptBookingAction(bookingId: number, driverId: number): Promise<boolean> {
  const before = await getBooking(bookingId);
  const trip = before && (await getTrip(before.tripId));
  if (!before || !trip || trip.driverId !== driverId) return false;
  if (!(await acceptBooking(bookingId))) return false;
  const b = (await getBooking(bookingId))!;
  const s = await loadSettings();
  await tellRiders(b, `${t('bk-accepted')}\n\n${bookingForPassenger(b, trip, s.big_baggage_prepay)}`, passengerBookingKb(b));
  return true;
}

export async function declineBookingAction(bookingId: number, driverId: number): Promise<boolean> {
  const before = await getBooking(bookingId);
  const trip = before && (await getTrip(before.tripId));
  if (!before || !trip || trip.driverId !== driverId) return false;
  if (!(await declineBooking(bookingId))) return false;
  await tellRiders(before, t('bk-declined', { when: fmtDateTime(trip.departsAt) }));
  await refreshChannel(trip);
  return true;
}

/** Отмена пассажиром. Возвращает null, если отменить уже нельзя или бронь чужая. */
export async function cancelByPassenger(bookingId: number, userId: number): Promise<CancelResult | null> {
  const before = await getBooking(bookingId);
  if (!before || before.booker?.id !== userId) return null;
  const trip = (await getTrip(before.tripId))!;
  const res = await cancelBooking(bookingId, 'passenger');
  if (!res) return null;
  await notifyUser(
    trip.driverId,
    t(res.late ? 'drv-booking-cancelled-late' : 'drv-booking-cancelled', {
      name: who(before),
      n: before.seats,
      when: fmtDateTime(trip.departsAt),
    }),
  );
  await refreshChannel(trip);
  return res;
}

export async function cancelByDriver(bookingId: number, driverId: number): Promise<boolean> {
  const before = await getBooking(bookingId);
  const trip = before && (await getTrip(before.tripId));
  if (!before || !trip || trip.driverId !== driverId) return false;
  if (!(await cancelBooking(bookingId, 'driver'))) return false;
  if (before.source !== 'phone') await tellRiders(before, t('bk-cancelled-by-driver', { when: fmtDateTime(trip.departsAt) }));
  await refreshChannel(trip);
  return true;
}

export async function confirmRideAction(bookingId: number, userId: number): Promise<boolean> {
  const b = await getBooking(bookingId);
  if (!b || b.booker?.id !== userId) return false;
  if (!(await confirmBooking(bookingId))) return false;
  const trip = (await getTrip(b.tripId))!;
  await notifyUser(trip.driverId, t('drv-passenger-confirmed', { name: who(b), when: fmtTime(trip.departsAt) }));
  return true;
}

async function ownedBooking(bookingId: number, driverId: number) {
  const b = await getBooking(bookingId);
  const trip = b && (await getTrip(b.tripId));
  return b && trip && trip.driverId === driverId ? { b, trip } : null;
}

export async function etaAction(bookingId: number, driverId: number, minutes: number): Promise<boolean> {
  const x = await ownedBooking(bookingId, driverId);
  if (!x || !['accepted', 'confirmed'].includes(x.b.status)) return false;
  await tellRiders(x.b, t('ride-eta', { n: minutes }));
  return true;
}

export async function pickUpAction(bookingId: number, driverId: number): Promise<boolean> {
  const x = await ownedBooking(bookingId, driverId);
  if (!x || !(await pickUpBooking(bookingId))) return false;
  const { b, trip } = x;
  // «Сел в машину» — заказчику, если едет другой человек: это главное для родителей.
  if (b.booker && !b.isSelf) {
    await notifyUser(
      b.booker.id,
      t('ride-picked-up-other', {
        name: who(b),
        car: carLine(trip.driver),
        plate: esc(trip.driver.plate),
        driver: esc(trip.driver.name),
      }),
    );
  }
  return true;
}

export async function noShowAction(bookingId: number, driverId: number): Promise<boolean> {
  const x = await ownedBooking(bookingId, driverId);
  if (!x) return false;
  const res = await noShowBooking(bookingId);
  if (!res) return false;
  if (x.b.booker) {
    const warn = res.violations >= res.limit ? `\n\n${t('violations-restricted')}` : '';
    await notifyUser(x.b.booker.id, t('ride-no-show', { when: fmtDateTime(x.trip.departsAt) }) + warn);
  }
  return true;
}

export async function prepaidAction(bookingId: number, driverId: number): Promise<boolean> {
  const x = await ownedBooking(bookingId, driverId);
  if (!x || !(await markPrepaid(bookingId))) return false;
  await tellRiders(x.b, t('bk-prepay-received'));
  return true;
}

export async function phoneBookingAction(tripId: number, driverId: number, seats: number): Promise<number | null> {
  const id = await createPhoneBooking(tripId, driverId, seats);
  if (id === null) return null;
  const trip = await getTrip(tripId);
  if (trip) await refreshChannel(trip);
  return id;
}

// ——— Заявки ———

function requestKb(r: RequestView) {
  return kb([
    [{ text: t('btn-take-request'), data: `r:take:${r.id}` }],
    [{ text: t('btn-skip'), data: 'r:skip' }],
  ]);
}

export async function submitRequest(input: NewRequest): Promise<RequestView> {
  const r = await createRequest(input);
  const drivers = await activeDriversOfDirection(r.directionId);
  for (const d of drivers) {
    if (d.userId === r.user.id) continue;
    await send(d.telegramId, `${t('req-new-for-driver')}\n\n${requestCard(r)}`, requestKb(r));
  }
  return r;
}

export async function takeRequestAction(requestId: number, driverId: number, tripId: number) {
  const res = await takeRequest(requestId, driverId, tripId);
  if (!res.ok) return res;
  const trip = (await getTrip(tripId))!;
  const s = await loadSettings();
  await tellRiders(
    res.booking,
    `${t('req-taken')}\n\n${bookingForPassenger(res.booking, trip, s.big_baggage_prepay)}`,
    passengerBookingKb(res.booking),
  );
  await refreshChannel(trip);
  return res;
}

export async function escalateRequest(r: RequestView): Promise<void> {
  await markEscalated(r.id);
  await notifyAdmins(
    `${t('adm-request-escalated')}\n\n${requestCard(r, { showPhone: true })}`,
    kb([[{ text: t('btn-open'), data: `a:rq:${r.id}` }]]),
  );
  await notifyUser(r.user.id, t('req-escalated-for-passenger'));
}

export async function offerRequest(requestId: number, driverId: number): Promise<boolean> {
  const r = await getRequest(requestId);
  const driver = await getUser(driverId);
  if (!r || r.status !== 'open' || !driver) return false;
  await send(driver.telegramId, `${t('req-offer-from-admin')}\n\n${requestCard(r)}`, requestKb(r));
  return true;
}

export async function closeRequestByAdmin(requestId: number): Promise<boolean> {
  const r = await getRequest(requestId);
  if (!r || !(await closeRequest(requestId, 'closed'))) return false;
  await notifyUser(r.user.id, t('req-closed-no-driver'));
  return true;
}

export async function expireRequestsAction(): Promise<void> {
  for (const r of await expireRequests()) {
    await notifyUser(r.user.id, t('req-expired'));
  }
}

// ——— Жалобы ———

export async function fileComplaint(input: {
  fromUserId: number;
  bookingId?: number | null;
  text: string;
  kind?: 'complaint' | 'wrong_person';
}): Promise<ComplaintView> {
  let against: number | null = null;
  if (input.bookingId) {
    const b = await getBooking(input.bookingId);
    const trip = b && (await getTrip(b.tripId));
    if (b && trip) against = trip.driverId === input.fromUserId ? (b.booker?.id ?? null) : trip.driverId;
  }
  const c = await createComplaint({ ...input, againstUserId: against });
  await notifyAdmins(
    `${c.kind === 'wrong_person' ? '🚨 ' : ''}${complaintCard(c)}`,
    kb([[{ text: t('btn-open'), data: `a:c:${c.id}` }]]),
  );
  return c;
}

/** Водитель сообщает, что в машину сел не тот человек: срочный сигнал заказчику и админу. */
export async function wrongPersonAction(bookingId: number, driverId: number): Promise<boolean> {
  const x = await ownedBooking(bookingId, driverId);
  if (!x) return false;
  await fileComplaint({
    fromUserId: driverId,
    bookingId,
    kind: 'wrong_person',
    text: t('complaint-wrong-person-text', { name: x.b.passengerName ?? t('passenger-unknown') }),
  });
  await notifyUser(x.b.booker?.id, t('ride-wrong-person', { name: who(x.b), when: fmtDateTime(x.trip.departsAt) }));
  return true;
}

// ——— Проверка водителей ———

export async function reviewDriver(
  driverId: number,
  adminId: number | null,
  decision: 'approve' | 'reject' | 'photos' | 'suspend',
  reason?: string,
): Promise<boolean> {
  const d = await getDriver(driverId);
  const user = await getUser(driverId);
  if (!d || !user) return false;
  const status = { approve: 'approved', reject: 'rejected', photos: 'photos_requested', suspend: 'suspended' } as const;
  await setDriverStatus(driverId, status[decision], adminId, reason);
  if (decision === 'approve') {
    await showMenu((await getUser(driverId))!, t('drv-approved'));
  } else if (decision === 'reject') {
    await send(
      user.telegramId,
      t('drv-rejected', { reason: esc(reason ?? '') }),
      kb([[{ text: t('btn-fill-again'), data: 'd:form' }]]),
    );
  } else if (decision === 'photos') {
    await send(user.telegramId, t('drv-photos-requested'), kb([[{ text: t('btn-send-photos'), data: 'd:photos' }]]));
  } else {
    await send(user.telegramId, t('drv-suspended', { reason: esc(reason ?? '') }));
  }
  return true;
}

/** Карточка анкеты для админа с фото. */
export async function showDriverForReview(adminTg: number, driverId: number): Promise<void> {
  const d = await getDriver(driverId);
  if (!d) return;
  await sendPhotos(adminTg, d.carPhotos);
  await send(adminTg, driverCard(d, { admin: true }), d.status === 'pending' ? driverReviewKb(driverId) : undefined);
}

export function adminTgIds(): number[] {
  return app.adminIds;
}
