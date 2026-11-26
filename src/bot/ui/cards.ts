import type { ParcelTimeKind } from '../../db/schema.js';
import { t } from '../../i18n.js';
import { esc, fmtPhone, fmtStars, money } from '../../lib/format.js';
import { dayKey, fmtDateTime, fmtDayKey, fmtDayShort, fmtMinutes, fmtTime } from '../../lib/time.js';
import type { BookingView, Place } from '../../services/bookings.js';
import type { ComplaintView } from '../../services/complaints.js';
import type { DriverView } from '../../services/drivers.js';
import type { ParcelPlace, ParcelView } from '../../services/parcels.js';
import type { RatingSummary } from '../../services/ratings.js';
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

export function timeLabel(day: string, kind: ParcelTimeKind, exactMinutes: number | null): string {
  const when = kind === 'exact' ? t('time-at', { time: fmtMinutes(exactMinutes ?? 0) }) : t(`time-${kind}`);
  return `${fmtDayKey(day)}, ${when}`;
}

/** «★ 4,8 · 12 оценок». */
export function ratingLine(r: RatingSummary): string {
  return t('rating-line', { avg: fmtStars(r.avg), n: r.count });
}

/** Для админа и самого человека: рейтинг даже при малом числе оценок. */
export function ratingOrNone(r: RatingSummary): string {
  return r.count > 0 ? ratingLine(r) : t('rating-none');
}

/** Короткая подпись рейса для кнопки: «17:00 · Ильдар ★4,8 · 500 ₽». */
export function tripButton(trip: TripView, withDay: boolean): string {
  const time = fmtTime(trip.departsAt);
  const when = withDay ? `${fmtDayShort(dayKey(trip.departsAt))} ${time}` : time;
  const stars = trip.driver.rating ? ` ★${fmtStars(trip.driver.rating.avg)}` : '';
  return `${when} · ${trip.driver.name}${stars} · ${money(trip.price)}`;
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
    !o.own && `👤 ${esc(d.name)}${d.badge ? ` · ${t('badge-verified')}` : ''}${d.rating ? ` · ${ratingLine(d.rating)}` : ''}`,
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
  /** Оценки от водителей; показываются, если их не меньше порога. */
  rating?: RatingSummary | null;
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
    marks?.rating && `${t('label-passenger-rating')}: ${ratingLine(marks.rating)}`,
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
    `👤 ${t('label-driver')}: ${esc(d.name)}${d.badge ? ` · ${t('badge-verified')}` : ''}${d.rating ? ` · ${ratingLine(d.rating)}` : ''}`,
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

/** Откуда или куда для посылки: адреса нет — значит, передают из рук в руки у водителя. */
export function parcelPlaceLine(p: ParcelPlace, which: 'from' | 'to'): string {
  const where = p.address ? esc(p.address) : t(which === 'from' ? 'parcel-from-self' : 'parcel-to-self');
  return `${esc(p.city)}, ${where}${p.village ? ` · ${t('village-mark')}` : ''}`;
}

export function parcelPriceLine(p: Pick<ParcelView, 'price'>): string {
  return p.price === null ? t('parcel-price-deal') : t('parcel-price-offer', { price: money(p.price) });
}

/**
 * Посылка. Водителю до «Беру» — без телефонов: только что, откуда, куда и цена.
 * contacts — телефоны отправителя и получателя (водителю после «Беру», отправителю — всегда).
 */
export function parcelCard(p: ParcelView, o: { contacts?: boolean; status?: boolean } = {}): string {
  return lines([
    `<b>📦 ${esc(p.route)}</b>`,
    `🕔 ${timeLabel(p.day, p.timeKind, p.exactMinutes)}`,
    `${t(`parcel-size-${p.size}`)}`,
    `💬 ${esc(p.contents)}`,
    p.valuable && `🔒 ${t('parcel-valuable-line')}`,
    `${t('label-from')}: ${parcelPlaceLine(p.from, 'from')}`,
    `${t('label-to')}: ${parcelPlaceLine(p.to, 'to')}`,
    `💰 ${parcelPriceLine(p)}`,
    o.contacts
      ? `${t('parcel-sender')}: ${esc(p.sender.name)}, ${fmtPhone(p.sender.phone)}`
      : `${t('parcel-sender')}: ${esc(p.sender.name)}`,
    o.contacts && `${t('parcel-recipient')}: ${esc(p.recipientName)}, ${fmtPhone(p.recipientPhone)}`,
    o.status && `${t('label-status')}: ${t(`parcel-status-${p.status}`)}`,
  ]);
}

/** Посылка глазами отправителя: после «Беру» — водитель, машина, номер и телефон. */
export function parcelForSender(p: ParcelView, trip?: TripView): string {
  const d = trip?.driver;
  return lines([
    parcelCard(p, { contacts: true, status: true }),
    d && `\n🚗 ${fmtDateTime(trip!.departsAt)}`,
    d && `👤 ${t('label-driver')}: ${esc(d.name)}${d.badge ? ` · ${t('badge-verified')}` : ''}${d.rating ? ` · ${ratingLine(d.rating)}` : ''}`,
    d && `🚘 ${carLine(d)} · <b>${esc(d.plate)}</b>`,
    d && `📞 ${fmtPhone(d.phone)}`,
  ]);
}

export function driverCard(d: DriverView, o: { admin?: boolean; rating?: RatingSummary } = {}): string {
  return lines([
    `<b>${esc(d.fullName)}</b>`,
    o.admin && `${t('label-in-bot')}: ${esc(d.name)}, ${fmtPhone(d.phone)}`,
    o.rating && `${t('label-rating')}: ${ratingOrNone(o.rating)}`,
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

/**
 * Пять звёзд в ряд, как в Яндекс Такси: нажатая звезда — оценка (третья = 3 ★).
 * prefix — начало callback_data, например `p:rt:12`.
 */
export function starsRow(prefix: string): { text: string; data: string }[] {
  return [1, 2, 3, 4, 5].map((n) => ({ text: '⭐', data: `${prefix}:${n}` }));
}

/** 4 → «★★★★☆». */
export function starsText(stars: number): string {
  return '★'.repeat(stars) + '☆'.repeat(5 - stars);
}
