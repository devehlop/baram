import type { Context } from 'grammy';
import type { Role } from '../../db/schema.js';
import { t } from '../../i18n.js';
import { esc } from '../../lib/format.js';
import { publicChannelLink } from '../../services/directions.js';
import { parseStartLink, sourceOf } from '../../services/links.js';
import { createUser, getUserByTg } from '../../services/users.js';
import type { MyConversation } from '../context.js';
import { sendTripLanding } from '../landing.js';
import { appKey, appOn, onMax } from '../platform.js';
import { showMenu } from '../ui/menu.js';
import { column, Wizard } from '../wizard.js';
import { runDriverForm } from './driverForm.js';

/** Имя вводит сам человек: в профиле Telegram часто ник или чужое имя. */
export function cleanName(raw: string): string | null {
  const s = raw.replace(/\s+/g, ' ').trim();
  if (s.length < 2 || s.length > 40) return null;
  if (!/^[\p{L}][\p{L}\s.'-]*$/u.test(s)) return null;
  return s.replace(/(^|[\s-])\p{Ll}/gu, (m) => m.toUpperCase());
}

/**
 * Первый запуск: согласие на обработку данных → «Вы пассажир или водитель?» → «Как вас зовут?» → телефон кнопкой.
 * Водитель сразу продолжает анкетой.
 * startPayload — метка из ссылки t.me/<бот>?start=…: записывается как источник, а пассажиру,
 * пришедшему по ссылке на рейс, после регистрации сразу показывается этот рейс.
 */
export async function registration(conv: MyConversation, ctx: Context, startPayload?: string | null): Promise<void> {
  const chatId = ctx.chat!.id;
  const from = ctx.from!;
  const w = new Wizard(conv, chatId, ctx.callbackQuery?.message?.message_id);

  // Первое сообщение: что это за сервис, где им пользоваться (чат или Mini App) и согласие на обработку данных —
  // до того, как спрашиваем имя и телефон.
  const consent = await w.ask({
    text: introText(chatId),
    rows: column([{ text: t('reg-consent-yes'), data: 'yes' }]),
    back: false,
    home: false,
  });
  if (consent.kind !== 'btn' || consent.data !== 'yes') return;

  const roleAns = await w.ask({
    text: t('reg-welcome'),
    rows: column([
      { text: t('reg-role-passenger'), data: 'passenger' },
      { text: t('reg-role-driver'), data: 'driver' },
    ]),
    back: false,
    home: false,
  });
  if (roleAns.kind !== 'btn') return;
  const role = roleAns.data as Role;

  const nameAns = await w.ask({
    text: t('reg-ask-name'),
    acceptText: true,
    back: false,
    home: false,
    hint: t('reg-name-hint'),
    validate: (x) => (cleanName(x) ? null : t('reg-name-hint')),
  });
  if (nameAns.kind !== 'text') return;
  const name = cleanName(nameAns.text)!;

  // Телефон — только кнопкой: Telegram отдаёт номер, привязанный к аккаунту, его не подделать.
  const phoneAns = await w.ask({
    text: t(onMax(chatId) ? 'reg-ask-phone-max' : 'reg-ask-phone', { name: esc(name) }),
    shareContactButton: t('reg-share-phone'),
    back: false,
    home: false,
    hint: t(onMax(chatId) ? 'reg-phone-hint-max' : 'reg-phone-hint'),
  });
  if (phoneAns.kind !== 'contact') return;

  const userName = name;
  await w.ext(async () => {
    const source = await sourceOf(startPayload);
    await createUser({ telegramId: from.id, username: from.username, name: userName, phone: phoneAns.phone, role, source });
  });

  if (role === 'driver') {
    const channel = await w.ext(() => channelNote());
    await w.say(t('reg-done-driver', { name: esc(name) }) + channel, { remove_keyboard: true });
    await runDriverForm(w, from.id);
    return;
  }
  await w.ext(async () => {
    const user = await getUserByTg(from.id);
    if (!user) return;
    const appNote = appOn(chatId) ? `\n\n${t(appKey(chatId, 'reg-done-app'))}` : '';
    await showMenu(user, t(onMax(chatId) ? 'reg-done-passenger-max' : 'reg-done-passenger', { name: esc(userName) }) + appNote + (await channelNote()));
    const link = parseStartLink(startPayload);
    if (link?.kind === 'trip') await sendTripLanding(chatId, link.tripId, user.id);
  });
}

/** Приветствие перед согласием. Про приложение говорим, только если человек может его открыть. */
export function introText(chatId: number): string {
  return [t('reg-intro'), appOn(chatId) ? t(appKey(chatId, 'reg-intro-ways')) : '', t('reg-intro-start'), t('reg-consent')]
    .filter(Boolean)
    .join('\n\n');
}

/** Строка про канал с рейсами; пустая, если у канала нет публичной ссылки. */
async function channelNote(): Promise<string> {
  const link = await publicChannelLink();
  return link ? `\n\n${t('reg-channel', { link })}` : '';
}
