import type { Context } from 'grammy';
import type { Role } from '../../db/schema.js';
import { t } from '../../i18n.js';
import { esc } from '../../lib/format.js';
import { createUser, getUserByTg } from '../../services/users.js';
import type { MyConversation } from '../context.js';
import { sendTripLink, takeTripLink } from '../handlers/tripLink.js';
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
 * Первый запуск: «Вы пассажир или водитель?» → «Как вас зовут?» → телефон кнопкой.
 * Водитель сразу продолжает анкетой.
 */
export async function registration(conv: MyConversation, ctx: Context): Promise<void> {
  const chatId = ctx.chat!.id;
  const from = ctx.from!;
  const w = new Wizard(conv, chatId);

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
    text: t('reg-ask-phone', { name: esc(name) }),
    shareContactButton: t('reg-share-phone'),
    back: false,
    home: false,
    hint: t('reg-phone-hint'),
  });
  if (phoneAns.kind !== 'contact') return;

  const userName = name;
  await w.ext(async () => {
    await createUser({ telegramId: from.id, username: from.username, name: userName, phone: phoneAns.phone, role });
  });

  if (role === 'driver') {
    await w.say(t('reg-done-driver', { name: esc(name) }), { remove_keyboard: true });
    await runDriverForm(w, from.id);
    return;
  }
  await w.ext(async () => {
    const user = await getUserByTg(from.id);
    if (!user) return;
    await showMenu(user, t('reg-done-passenger', { name: esc(userName) }));
    // Пришёл по ссылке на рейс — показываем этот рейс сразу после регистрации.
    const tripId = takeTripLink(from.id);
    if (tripId) await sendTripLink(chatId, user, tripId);
  });
}
