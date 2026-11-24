import type { Context, InlineKeyboard } from 'grammy';
import { isAdminTg } from '../../app.js';
import type { Side } from '../../db/schema.js';
import { t } from '../../i18n.js';
import { esc, fmtPhone, money, normalizePhone } from '../../lib/format.js';
import { getBooking, setPhoneBookingData } from '../../services/bookings.js';
import { resolveComplaint, setComplaintNote } from '../../services/complaints.js';
import { addVillage, setChannel, setDirectionPrice, setTravelMinutes } from '../../services/directions.js';
import { DECIMAL_SETTINGS, isNumericKey, isSettingKey, setSetting } from '../../services/settings.js';
import { getTrip } from '../../services/trips.js';
import { setRatingComment } from '../../services/ratings.js';
import { findUsers, getUser, getUserByTg, setRestriction } from '../../services/users.js';
import { fileComplaint, reportBadRating, reviewDriver } from '../actions.js';
import type { MyConversation } from '../context.js';
import { kb, send } from '../tg.js';
import { starsText } from '../ui/cards.js';
import { column, Wizard, type Opt } from '../wizard.js';

/** Короткие сценарии из одного вопроса: жалоба, данные пассажира по телефону, ввод значений админом. */
export type PromptArgs =
  | { kind: 'complaint'; id?: number }
  | { kind: 'rateComment'; id: number; stars: number }
  | { kind: 'phoneData'; id: number }
  | { kind: 'adminReject'; id: number }
  | { kind: 'adminSuspend'; id: number }
  | { kind: 'adminBlock'; id: number }
  | { kind: 'adminSetting'; key: string }
  | { kind: 'adminFind' }
  | { kind: 'adminVillage'; id: number; side: Side }
  | { kind: 'adminChannel'; id: number }
  | { kind: 'adminTravel'; id: number }
  | { kind: 'adminPrice'; id: number; route?: string }
  | { kind: 'adminNote'; id: number }
  | { kind: 'adminResolve'; id: number };

const REJECT_REASONS = ['reject-reason-mismatch', 'reject-reason-photo', 'reject-reason-other-car'];

/** «Гульнара 8 917 123-45-67» → имя и телефон. */
export function parseNamePhone(text: string): { name: string; phone: string } | null {
  const m = /^(.*?)[\s,;:]*(\+?[\d\s()-]{10,20})$/.exec(text.trim());
  if (!m) return null;
  const phone = normalizePhone(m[2]!);
  const name = m[1]!.trim();
  return phone && name.length >= 2 ? { name, phone } : null;
}

const nonNegativeInt = (v: string) => /^\d{1,6}$/.test(v);
/** «800», «800 ₽», «1 000» → 800 / 1000; вне 100–10 000 — null. */
export const parsePrice = (v: string): number | null => {
  if (!/^\s*\d[\d\s]*(₽|р|руб\.?|рублей)?\s*$/i.test(v)) return null;
  const n = Number(v.replace(/\D/g, ''));
  return n >= 100 && n <= 10_000 ? n : null;
};
const validPrice = (v: string) => parsePrice(v) !== null;
const between = (min: number, max: number) => (v: string) =>
  v.length >= min && v.length <= max ? null : t('hint-text-length', { min, max });

interface Question {
  text: string;
  rows?: Opt[][];
  validate?: (v: string) => string | null;
  contact?: boolean;
}

function question(a: PromptArgs): Question {
  switch (a.kind) {
    case 'complaint':
      return { text: t('complaint-ask'), validate: between(5, 1000) };
    case 'rateComment':
      return {
        text: t('rate-comment-ask', { stars: starsText(a.stars) }),
        rows: [[{ text: t('btn-skip'), data: 'skip' }]],
        validate: between(2, 1000),
      };
    case 'phoneData':
      return {
        text: t('phone-data-ask'),
        contact: true,
        validate: (v) => (parseNamePhone(v) ? null : t('phone-data-hint')),
      };
    case 'adminReject':
      return {
        text: t('adm-reject-ask'),
        rows: column(REJECT_REASONS.map((k, i) => ({ text: t(k), data: `r${i}` }))),
        validate: between(3, 300),
      };
    case 'adminSuspend':
    case 'adminBlock':
      return { text: t('adm-reason-ask'), validate: between(3, 300) };
    case 'adminSetting':
      return {
        text: t('adm-setting-ask', { name: t(`setting-${a.key}`) }),
        validate: (v) =>
          !isNumericKey(a.key) || nonNegativeInt(v) || (DECIMAL_SETTINGS.has(a.key) && /^\d{1,2}[.,]\d{1,2}$/.test(v))
            ? null
            : t('adm-number-hint'),
      };
    case 'adminFind':
      return { text: t('adm-find-ask'), validate: between(2, 60) };
    case 'adminVillage':
      return { text: t('adm-village-ask'), validate: between(2, 60) };
    case 'adminChannel':
      return {
        text: t('adm-channel-ask'),
        rows: [[{ text: t('adm-channel-off'), data: 'off' }]],
        validate: (v) => (/^(@[A-Za-z][A-Za-z0-9_]{3,}|-100\d{5,})$/.test(v) ? null : t('adm-channel-hint')),
      };
    case 'adminTravel':
      return { text: t('adm-travel-ask'), validate: (v) => (nonNegativeInt(v) && Number(v) >= 10 ? null : t('adm-number-hint')) };
    case 'adminPrice':
      return { text: t('adm-price-ask', { route: a.route ?? '' }), validate: (v) => (validPrice(v) ? null : t('adm-price-hint')) };
    case 'adminNote':
      return { text: t('adm-note-ask'), validate: between(2, 1000) };
    case 'adminResolve':
      return { text: t('adm-resolve-ask'), validate: between(2, 1000) };
  }
}

export async function prompt(conv: MyConversation, ctx: Context, args: PromptArgs): Promise<void> {
  const chatId = ctx.chat!.id;
  const telegramId = ctx.from!.id;
  const w = new Wizard(conv, chatId, ctx.callbackQuery?.message?.message_id);
  if (args.kind.startsWith('admin') && !isAdminTg(telegramId)) return;

  const q = question(args);
  const a = await w.ask({
    text: q.text,
    rows: q.rows,
    acceptText: true,
    acceptContact: q.contact,
    validate: q.validate,
    back: false,
  });
  if (a.kind === 'home' || a.kind === 'back') {
    // Плохая оценка уже сохранена — админ узнает о ней и без комментария.
    if (args.kind === 'rateComment') await w.ext(() => reportBadRating(args.id));
    await w.say(t('prompt-cancelled'));
    return;
  }
  const text = a.kind === 'text' ? a.text : '';
  const button = a.kind === 'btn' ? a.data : null;

  // Ответ показывается в том же окне, где был вопрос.
  const out = await w.ext(async (): Promise<{ text: string; markup?: InlineKeyboard } | null> => {
    const me = await getUserByTg(telegramId);
    // Админ может быть не зарегистрирован как пассажир: тогда действие записывается без автора.
    const adminId = me?.id ?? null;
    let result: { text: string; markup?: InlineKeyboard } | null = null;
    const say = async (msg: string, markup?: InlineKeyboard) => {
      result = { text: msg, markup };
    };
    await run();
    return result;

    async function run(): Promise<void> {
      switch (args.kind) {
        case 'complaint': {
          if (!me) return;
          await fileComplaint({ fromUserId: me.id, bookingId: args.id ?? null, text });
          await say(t('complaint-sent'));
          return;
        }
        case 'rateComment': {
          if (me && text) await setRatingComment(args.id, 'driver', me.id, text);
          await reportBadRating(args.id);
          await say(
            t('rate-thanks-bad'),
            kb([[{ text: t('btn-open-booking'), data: `p:b:${args.id}` }]]),
          );
          return;
        }
        case 'phoneData': {
          const b = await getBooking(args.id);
          const trip = b && (await getTrip(b.tripId));
          if (!me || !b || !trip || trip.driverId !== me.id) return void (await say(t('not-found')));
          const data = a.kind === 'contact' ? { name: a.name || t('passenger-unknown'), phone: a.phone } : parseNamePhone(text);
          if (!data) return void (await say(t('phone-data-hint')));
          await setPhoneBookingData(args.id, data.name, data.phone);
          await say(
            t('phone-data-saved', { name: esc(data.name), phone: fmtPhone(data.phone) }),
            kb([[{ text: t('btn-to-trip'), data: `d:t:${trip.id}` }]]),
          );
          return;
        }
        case 'adminReject': {
          const reason = button ? t(REJECT_REASONS[Number(button.slice(1))]!) : text;
          await reviewDriver(args.id, adminId, 'reject', reason);
          await say(t('adm-driver-rejected'));
          return;
        }
        case 'adminSuspend': {
          await reviewDriver(args.id, adminId, 'suspend', text);
          await say(t('adm-driver-suspended'), kb([[{ text: t('btn-open'), data: `a:u:${args.id}` }]]));
          return;
        }
        case 'adminBlock': {
          const target = await getUser(args.id);
          if (!target) return void (await say(t('not-found')));
          await setRestriction(args.id, 'blocked', text);
          await send(target.telegramId, t('blocked-message'), { remove_keyboard: true });
          await say(t('adm-user-blocked'), kb([[{ text: t('btn-open'), data: `a:u:${args.id}` }]]));
          return;
        }
        case 'adminSetting': {
          if (!isSettingKey(args.key)) return;
          await setSetting(args.key, DECIMAL_SETTINGS.has(args.key) ? text.replace(',', '.') : text);
          await say(t('adm-setting-saved', { name: t(`setting-${args.key}`), value: esc(text) }), kb([[{ text: t('adm-settings'), data: 'a:set' }]]));
          return;
        }
        case 'adminFind': {
          const found = await findUsers(text);
          await say(
            found.length ? t('adm-find-results') : t('adm-find-none'),
            kb([
              ...found.map((u) => [{ text: `${u.name} · ${fmtPhone(u.phone)}`, data: `a:u:${u.id}` }]),
              [{ text: t('adm-menu-back'), data: 'a:menu' }],
            ]),
          );
          return;
        }
        case 'adminVillage': {
          await addVillage(args.id, args.side, text);
          await say(t('adm-village-added', { name: esc(text) }), kb([[{ text: t('adm-villages'), data: 'a:vil' }]]));
          return;
        }
        case 'adminChannel': {
          await setChannel(args.id, button === 'off' ? null : text);
          await say(t(button === 'off' ? 'adm-channel-disabled' : 'adm-channel-saved'), kb([[{ text: t('adm-settings'), data: 'a:set' }]]));
          return;
        }
        case 'adminTravel': {
          await setTravelMinutes(args.id, Number(text));
          await say(t('done'), kb([[{ text: t('adm-settings'), data: 'a:set' }]]));
          return;
        }
        case 'adminPrice': {
          const price = parsePrice(text)!;
          await setDirectionPrice(args.id, price);
          await say(t('adm-price-saved', { route: esc(args.route ?? ''), price: money(price) }), kb([[{ text: t('adm-settings'), data: 'a:set' }]]));
          return;
        }
        case 'adminNote': {
          await setComplaintNote(args.id, text);
          await say(t('adm-note-saved'), kb([[{ text: t('btn-open'), data: `a:c:${args.id}` }]]));
          return;
        }
        case 'adminResolve': {
          await resolveComplaint(args.id, adminId, text);
          await say(t('adm-complaint-resolved'), kb([[{ text: t('adm-complaints'), data: 'a:cmp' }]]));
          return;
        }
      }
    }
  });
  if (out) await w.finish(out.text, out.markup);
}
