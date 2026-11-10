import type { TimeKind } from '../../db/schema.js';
import { t } from '../../i18n.js';
import { esc, fmtPhone, money } from '../../lib/format.js';
import { dayKey, fmtDateTime, fmtDayKey, fmtDayShort, fmtMinutes, fmtTime } from '../../lib/time.js';
import type { BookingView, Place } from '../../services/bookings.js';
import type { ComplaintView } from '../../services/complaints.js';
import type { DriverView } from '../../services/drivers.js';
import type { RequestView } from '../../services/requests.js';
import type { TripView } from '../../services/trips.js';

const lines = (xs: (string | null | undefined | false)[]) => xs.filter((x): x is string => !!x).join('\n');

export function placeLine(p: Place | null): string {
  if (!p) return t('place-unknown');
  return `${esc(p.city)}, ${esc(p.address)}`;
}

export function carLine(d: { car: string; carYear: number; carColor: string }): string {
  return `${esc(d.car)}, ${d.carYear}, ${esc(d.carColor.toLowerCase())}`;
}

export function pickupLine(trip: Pick<TripView, 'pickupMode' | 'pickupPoints'>): string {
  const points = trip.pickupPoints.map(esc).join(', ');
  if (trip.pickupMode === 'door') return t('trip-pickup-door');
  return t(trip.pickupMode === 'points' ? 'trip-pickup-points' : 'trip-pickup-mixed', { points });
}

export function timeLabel(day: string, kind: TimeKind, exactMinutes: number | null): string {
  const when = kind === 'exact' ? t('time-at', { time: fmtMinutes(exactMinutes ?? 0) }) : t(`time-${kind}`);
  return `${fmtDayKey(day)}, ${when}`;
}

/** Короткая подпись рейса для кнопки: «17:00 · Ильдар · 500 ₽». */
export function tripButton(trip: TripView, withDay: boolean): string {
  const time = fmtTime(trip.departsAt);
  const when = withDay ? `${fmtDayShort(dayKey(trip.departsAt))} ${time}` : time;
  return `${when} · ${trip.driver.name} · ${money(trip.price)}`;
}

export interface TripCardOptions {
  /** Показывать госномер и телефон — только после подтверждения брони. */
  full?: boolean;
  /** Пассажиру нужно кресло водителя. */
  needChildSeat?: boolean;
  /** Адрес пассажира в деревне. */
  village?: boolean;
  /** Карточка для самого водителя: без блока «водитель». */
  own?: boolean;
}

export function tripCard(trip: TripView, o: TripCardOptions = {}): string {
  const d = trip.driver;
  return lines([
    `<b>${esc(trip.route)}</b>`,
    `🕔 ${fmtDateTime(trip.departsAt)}`,
    !o.own && `👤 ${esc(d.name)}${d.badge ? ` · ${t('badge-verified')}` : ''}`,
    !o.own && `🚘 ${carLine(d)}${o.full ? ` · <b>${esc(d.plate)}</b>` : ''}`,
    !o.own && o.full && `📞 ${fmtPhone(d.phone)}`,
    `💺 ${t('trip-seats', { free: trip.seatsFree, total: trip.seatsTotal })}`,
    `🧳 ${t(`trunk-${trip.trunk}`)}`,
    `📍 ${pickupLine(trip)}`,
    trip.villages
      ? `🏡 ${t('trip-villages-yes')}${trip.villagesNote ? `: ${esc(trip.villagesNote)}` : ''}`
      : o.village
        ? `⚠️ ${t('trip-villages-no')}`
        : null,
    d.childSeat ? `👶 ${t('trip-child-seat-yes')}` : o.needChildSeat ? `⚠️ ${t('trip-child-seat-no')}` : null,
    `💰 ${t('trip-price', { price: money(trip.price) })}`,
    trip.status === 'cancelled' && `❌ ${t('trip-status-cancelled')}`,
    trip.status === 'departed' && `🚗 ${t('trip-status-departed')}`,
    trip.status === 'completed' && `🏁 ${t('trip-status-completed')}`,
  ]);
}

export function passengerLine(b: Pick<BookingView, 'passengerName' | 'passengerPhone' | 'passengerType'>): string {
  const type = b.passengerType === 'adult' ? '' : ` (${t(`ptype-${b.passengerType}`)})`;
  const phone = b.passengerPhone ? `, ${fmtPhone(b.passengerPhone)}` : '';
  return `${esc(b.passengerName ?? t('passenger-unknown'))}${type}${phone}`;
}

export function baggageLine(b: Pick<BookingView, 'baggage' | 'baggageNote'>): string {
  return t(`baggage-${b.baggage}`) + (b.baggageNote ? `: ${esc(b.baggageNote)}` : '');
}

export interface PassengerMarks {
  completed: number;
  noShows: number;
}

/** Бронь глазами водителя. */
export function bookingForDriver(b: BookingView, marks?: PassengerMarks): string {
  if (b.source === 'phone') {
    return lines([
      `<b>${t('phone-booking-title', { n: b.seats })}</b>`,
      b.passengerName ? passengerLine(b) : t('phone-booking-no-data'),
    ]);
  }
  const alone = b.passengerType !== 'adult' && !b.isSelf;
  return lines([
    `<b>${esc(b.passengerName ?? '')}</b> · ${t('seats-count', { n: b.seats })}`,
    marks && marks.completed === 0 && `🆕 ${t('mark-new-passenger')}`,
    marks && marks.completed >= 3 && marks.noShows === 0 && `⭐ ${t('mark-reliable-passenger')}`,
    alone && `⚠️ ${t(`mark-alone-${b.passengerType}`)}`,
    b.isSelf || !b.booker
      ? `📞 ${fmtPhone(b.passengerPhone)}`
      : `${t('booking-rides')}: ${passengerLine(b)}\n${t('booking-booked-by')}: ${esc(b.booker.name)}, ${fmtPhone(b.booker.phone)}`,
    `${t('label-from')}: ${placeLine(b.from)}${b.from?.village ? ` · ${t('village-mark')}` : ''}`,
    `${t('label-to')}: ${placeLine(b.to)}${b.to?.village ? ` · ${t('village-mark')}` : ''}`,
    b.pickupPoint && `${t('label-pickup-point')}: ${esc(b.pickupPoint)}`,
    `${t('label-baggage')}: ${baggageLine(b)}`,
    b.prepayRequired && (b.prepayReceived ? `✅ ${t('prepay-received')}` : `⏳ ${t('prepay-waiting')}`),
    b.childSeat !== 'none' && `👶 ${t(`child-seat-${b.childSeat}`)}`,
    b.comment && `💬 ${esc(b.comment)}`,
    `${t('label-status')}: ${t(`booking-status-${b.status}`)}`,
  ]);
}

/** Бронь глазами заказчика. Госномер и телефон водителя — только после того, как водитель принял. */
export function bookingForPassenger(b: BookingView, trip: TripView, prepayAmount: number): string {
  const d = trip.driver;
  const accepted = ['accepted', 'confirmed', 'picked_up', 'completed'].includes(b.status);
  return lines([
    `<b>${esc(trip.route)}</b> · ${t(`booking-status-${b.status}`)}`,
    `🕔 ${fmtDateTime(trip.departsAt)}`,
    !b.isSelf && `${t('booking-rides')}: ${passengerLine(b)}`,
    `${t('label-from')}: ${placeLine(b.from)}`,
    `${t('label-to')}: ${placeLine(b.to)}`,
    b.pickupPoint && `${t('label-pickup-point')}: ${esc(b.pickupPoint)}`,
    `${t('seats-count', { n: b.seats })} · ${baggageLine(b)}`,
    b.childSeat !== 'none' && `👶 ${t(`child-seat-${b.childSeat}`)}`,
    b.comment && `💬 ${esc(b.comment)}`,
    `💰 ${money(b.price)}`,
    '',
    `👤 ${t('label-driver')}: ${esc(d.name)}${d.badge ? ` · ${t('badge-verified')}` : ''}`,
    `🚘 ${carLine(d)}${accepted ? ` · <b>${esc(d.plate)}</b>` : ''}`,
    accepted && `📞 ${fmtPhone(d.phone)}`,
    accepted && b.prepayRequired && !b.prepayReceived && b.status !== 'completed'
      ? '\n' + prepayBlock(trip, prepayAmount)
      : null,
    b.prepayRequired && b.prepayReceived && `✅ ${t('prepay-received')}`,
    b.lateCancel && `⚠️ ${t('booking-late-cancel-mark')}`,
  ]);
}

/** Реквизиты берутся только из проверенной анкеты водителя. */
export function prepayBlock(trip: TripView, amount: number): string {
  const d = trip.driver;
  return t('prepay-block', {
    amount: money(amount),
    phone: fmtPhone(d.payPhone),
    bank: esc(d.payBank),
    receiver: esc(shortName(d.fullName)),
  });
}

/** «Галиев Ильдар Ринатович» → «Ильдар Г.» — как в банковском переводе. */
export function shortName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return fullName;
  return `${parts[1]} ${parts[0]!.charAt(0)}.`;
}

export function requestCard(r: RequestView, o: { showPhone?: boolean } = {}): string {
  return lines([
    `<b>${esc(r.route)}</b>`,
    `🕔 ${timeLabel(r.day, r.timeKind, r.exactMinutes)}`,
    `👤 ${esc(r.passengerName)}${r.passengerType === 'adult' ? '' : ` (${t(`ptype-${r.passengerType}`)})`} · ${t('seats-count', { n: r.seats })}`,
    o.showPhone && `📞 ${fmtPhone(r.passengerPhone)} · ${t('booking-booked-by')}: ${esc(r.user.name)}, ${fmtPhone(r.user.phone)}`,
    `${t('label-from')}: ${placeLine(r.from)}${r.from.village ? ` · ${t('village-mark')}` : ''}`,
    `${t('label-to')}: ${placeLine(r.to)}${r.to.village ? ` · ${t('village-mark')}` : ''}`,
    `${t('label-baggage')}: ${baggageLine(r)}`,
    r.childSeat !== 'none' && `👶 ${t(`child-seat-${r.childSeat}`)}`,
    r.comment && `💬 ${esc(r.comment)}`,
  ]);
}

export function driverCard(d: DriverView, o: { admin?: boolean } = {}): string {
  return lines([
    `<b>${esc(d.fullName)}</b>`,
    o.admin && `${t('label-in-bot')}: ${esc(d.name)}, ${fmtPhone(d.phone)}`,
    `🚘 ${carLine(d)} · <b>${esc(d.plate)}</b>`,
    `💺 ${t('driver-seats', { n: d.seats })}`,
    `👶 ${t(d.childSeat ? 'driver-child-seat-yes' : 'driver-child-seat-no')}`,
    `💳 ${t('driver-pay', { phone: fmtPhone(d.payPhone), bank: esc(d.payBank) })}`,
    `${t('label-status')}: ${t(`driver-status-${d.status}`)}`,
    d.rejectReason && `${t('label-reason')}: ${esc(d.rejectReason)}`,
    (d.badge || d.priority) &&
      `${t('label-privileges')}: ${[d.badge && t('badge-verified'), d.priority && t('priv-priority')].filter(Boolean).join(', ')}`,
  ]);
}

export function complaintCard(c: ComplaintView): string {
  const person = (p: { name: string; phone: string }) => `${esc(p.name)}, ${fmtPhone(p.phone)}`;
  return lines([
    `<b>${t(`complaint-kind-${c.kind}`)} №${c.id}</b> · ${t(`complaint-status-${c.status}`)}`,
    `${t('complaint-from')}: ${person(c.from)}`,
    c.against && `${t('complaint-against')}: ${person(c.against)}`,
    c.bookingId !== null && `${t('complaint-booking')}: №${c.bookingId}`,
    `💬 ${esc(c.text)}`,
    c.note && `📝 ${esc(c.note)}`,
    c.resolution && `✅ ${esc(c.resolution)}`,
  ]);
}
