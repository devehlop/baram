import type { Context } from 'grammy';
import { isAdminTg } from '../../app.js';
import type { Side } from '../../db/schema.js';
import { t } from '../../i18n.js';
import { esc, fmtPhone, normalizePhone } from '../../lib/format.js';
import { getBooking, setPhoneBookingData } from '../../services/bookings.js';
import { resolveComplaint, setComplaintNote } from '../../services/complaints.js';
import { addVillage, setChannel, setTravelMinutes } from '../../services/directions.js';
import { isNumericKey, isSettingKey, setSetting } from '../../services/settings.js';
import { getTrip } from '../../services/trips.js';
import { findUsers, getUser, getUserByTg, setRestriction } from '../../services/users.js';
import { fileComplaint, reviewDriver } from '../actions.js';
import type { MyConversation } from '../context.js';
import { kb, send } from '../tg.js';
import { column, Wizard, type Opt } from '../wizard.js';

/** Короткие сценарии из одного вопроса: жалоба, данные пассажира по телефону, ввод значений админом. */
export type PromptArgs =
  | { kind: 'complaint'; id?: number }
  | { kind: 'phoneData'; id: number }
  | { kind: 'adminReject'; id: number }
  | { kind: 'adminSuspend'; id: number }
  | { kind: 'adminBlock'; id: number }
  | { kind: 'adminSetting'; key: string }
  | { kind: 'adminFind' }
  | { kind: 'adminVillage'; id: number; side: Side }
  | { kind: 'adminChannel'; id: number }
  | { kind: 'adminTravel'; id: number }
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
        validate: (v) => (!isNumericKey(a.key) || nonNegativeInt(v) ? null : t('adm-number-hint')),
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
    case 'adminNote':
      return { text: t('adm-note-ask'), validate: between(2, 1000) };
    case 'adminResolve':
      return { text: t('adm-resolve-ask'), validate: between(2, 1000) };
  }
}

export async function prompt(conv: MyConversation, ctx: Context, args: PromptArgs): Promise<void> {
  const chatId = ctx.chat!.id;
  const telegramId = ctx.from!.id;
  const w = new Wizard(conv, chatId);
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
    await w.say(t('prompt-cancelled'));
    return;
  }
  const text = a.kind === 'text' ? a.text : '';
  const button = a.kind === 'btn' ? a.data : null;

  await w.ext(async () => {
    const me = await getUserByTg(telegramId);
    if (!me) return;
    const say = (msg: string, markup?: Parameters<typeof send>[2]) => send(chatId, msg, markup);

    switch (args.kind) {
      case 'complaint': {
        await fileComplaint({ fromUserId: me.id, bookingId: args.id ?? null, text });
        await say(t('complaint-sent'));
        return;
      }
      case 'phoneData': {
        const b = await getBooking(args.id);
        const trip = b && (await getTrip(b.tripId));
        if (!b || !trip || trip.driverId !== me.id) return void (await say(t('not-found')));
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
        await reviewDriver(args.id, me.id, 'reject', reason);
        await say(t('adm-driver-rejected'));
        return;
      }
      case 'adminSuspend': {
        await reviewDriver(args.id, me.id, 'suspend', text);
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
        await setSetting(args.key, text);
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
      case 'adminNote': {
        await setComplaintNote(args.id, text);
        await say(t('adm-note-saved'), kb([[{ text: t('btn-open'), data: `a:c:${args.id}` }]]));
        return;
      }
      case 'adminResolve': {
        await resolveComplaint(args.id, me.id, text);
        await say(t('adm-complaint-resolved'), kb([[{ text: t('adm-complaints'), data: 'a:cmp' }]]));
        return;
      }
    }
  });
}
