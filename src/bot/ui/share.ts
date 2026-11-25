import { t } from '../../i18n.js';
import { fmtPhone, money } from '../../lib/format.js';
import { addDays, dayKey, fmtDayKey, fmtTime, todayKey } from '../../lib/time.js';
import type { TripView } from '../../services/trips.js';
import type { Btn } from '../tg.js';

/** «Завтра, 13 ноября · 17:30»; дальше завтрашнего дня — «пт, 14 ноября · 17:30». */
function whenLine(trip: TripView): string {
  const day = dayKey(trip.departsAt);
  const date = fmtDayKey(day);
  const label = day === todayKey() ? t('day-today') : day === addDays(todayKey(), 1) ? t('day-tomorrow') : null;
  const when = label ? `${label}, ${date.split(', ')[1] ?? date}` : date;
  return `🕔 ${when} · ${fmtTime(trip.departsAt)}`;
}

function pickupText(trip: TripView): string {
  const points = trip.pickupPoints.join(', ');
  if (trip.pickupMode === 'door' || !points) return t('share-pickup-door');
  return t(trip.pickupMode === 'points' ? 'share-pickup-points' : 'share-pickup-mixed', { points });
}

/**
 * Объявление о рейсе от лица водителя — для чатов попутчиков: коротко, с эмодзи, с телефоном или без.
 * Обычный текст без разметки. Строки идут по важности: первые четыре (маршрут, время, откуда забирает,
 * места и цена) остаются всегда, остальное при нехватке места отбрасывается с конца.
 */
export function shareLines(trip: TripView, withPhone: boolean): string[] {
  const d = trip.driver;
  return [
    t('share-title', { route: trip.route }),
    whenLine(trip),
    `📍 ${pickupText(trip)}`,
    `💺 ${t('share-seats-price', { seats: t('seats-count', { n: trip.seatsFree }), price: money(trip.price) })}`,
    withPhone && `📞 ${fmtPhone(d.phone)}`,
    `🧳 ${t(`trunk-${trip.trunk}`)}`,
    trip.villages && `🏡 ${t('share-villages')}`,
    d.childSeat && `👶 ${t('trip-child-seat-yes')}`,
  ].filter((x): x is string => typeof x === 'string' && x.length > 0);
}

/** Текст, который водитель копирует или пересылает (в том числе в WhatsApp и VK): ссылка — последней строкой. */
export function shareText(trip: TripView, link: string, withPhone = false): string {
  return [...shareLines(trip, withPhone), `${t('share-book')} ${link}`].join('\n');
}

/** Ссылку «Поделиться» длиннее ~2000 символов не открывают, а кириллица в ней — по 6 знаков на букву. */
const MAX_SHARE_URL = 1900;
/** Сколько строк с начала нельзя отбрасывать: маршрут, время, откуда забирает, места и цена. */
const KEEP = 4;

/**
 * Окно «Поделиться» Telegram: человек выбирает чат, текст и ссылка уже вставлены (ссылку Telegram
 * ставит первой строкой). Длинный текст сокращается с конца; если и тогда не влезает —
 * список точек сбора заменяется на «список в боте».
 */
export function shareUrl(trip: TripView, link: string, withPhone: boolean, max = false): string {
  // В MAX у окна «Поделиться» только текст: ссылка идёт в нём последней строкой.
  const build = (lines: string[]) =>
    max
      ? `https://max.ru/:share?text=${encodeURIComponent([...lines, `${t('share-book')} ${link}`].join('\n'))}`
      : `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent([...lines, t('share-cta')].join('\n'))}`;
  const lines = shareLines(trip, withPhone);
  const keep = KEEP + (withPhone ? 1 : 0);
  let url = build(lines);
  while (url.length > MAX_SHARE_URL && lines.length > keep) {
    lines.pop();
    url = build(lines);
  }
  if (url.length > MAX_SHARE_URL) {
    lines[2] = `📍 ${t('share-pickup-points-short')}`;
    url = build(lines);
  }
  return url;
}

/** Две кнопки окна «Поделиться»: с телефоном водителя и без. max — окно «Поделиться» MAX. */
export function shareRows(trip: TripView, link: string, max = false): Btn[][] {
  return [
    [{ text: t('btn-share-phone'), url: shareUrl(trip, link, true, max) }],
    [{ text: t('btn-share-nophone'), url: shareUrl(trip, link, false, max) }],
  ];
}

/** Поделиться можно выложенным рейсом, в котором есть свободные места. */
export function canShare(trip: Pick<TripView, 'status' | 'seatsFree'>): boolean {
  return trip.status === 'published' && trip.seatsFree > 0;
}
