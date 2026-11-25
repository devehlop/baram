import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { createApi } from '../src/api/server.js';
import { sendPhotos } from '../src/bot/tg.js';
import { maxFiles } from '../src/db/schema.js';
import { parseMaxJson } from '../src/max/client.js';
import { isMaxId, localIdOf, MAX_ID_BASE } from '../src/max/ids.js';
import { maxKeyboard } from '../src/max/outgoing.js';
import { botLink } from '../src/services/links.js';
import { getImage } from '../src/services/photos.js';
import { getUserByTg, createUser } from '../src/services/users.js';
import { submitDriverForm } from '../src/services/drivers.js';
import { ADMIN_ID, approvedDriver, postTrip, setup, type Harness } from './helpers.js';
import { withMax, type MaxHarness } from './max-helpers.js';

// Вторник, 10 ноября 2026, 09:00 по Москве.
const NOW = '2026-11-10T06:00:00Z';
/** id в MAX длиннее 2^53: в number без потерь не влезает. */
const AIGUL = '9123456789012345678';

let h: Harness;
let mx: MaxHarness;
beforeEach(async () => {
  h = await setup({ now: NOW });
  mx = withMax(h);
});
afterEach(() => h.close());

describe('MAX: разбор ответов и кнопки', () => {
  it('64-битные id не теряют точность', () => {
    const v = parseMaxJson(`{"user_id":${AIGUL},"recipient":{"chat_id":-123},"text":"user_id: 5"}`) as any;
    expect(v.user_id).toBe(AIGUL);
    expect(v.recipient.chat_id).toBe('-123');
    expect(v.text).toBe('user_id: 5');
  });

  it('id людей из MAX не пересекаются с Telegram', async () => {
    const a = await localIdOf(AIGUL);
    expect(a).toBeGreaterThanOrEqual(MAX_ID_BASE);
    expect(Number.isSafeInteger(a)).toBe(true);
    expect(await localIdOf(AIGUL)).toBe(a);
    expect(await localIdOf('42')).toBe(a + 1);
    expect(isMaxId(a)).toBe(true);
    expect(isMaxId(8_000_000_000)).toBe(false);
    expect(isMaxId('@baram_channel')).toBe(false);
  });

  it('клавиатура Telegram превращается в кнопки MAX', () => {
    const inline = maxKeyboard({
      inline_keyboard: [
        [{ text: '1', callback_data: 'w:1' }, ...Array.from({ length: 7 }, (_, i) => ({ text: String(i + 2), callback_data: `w:${i + 2}` }))],
        [{ text: 'Сайт', url: 'https://example.ru' }, { text: 'Приложение', web_app: { url: 'https://app' } }],
      ],
    })!;
    // В ряду MAX не больше 7 кнопок; кнопки Mini App пока не показываются.
    expect(inline.payload.buttons.map((r) => r.length)).toEqual([7, 1, 1]);
    expect(inline.payload.buttons[2]).toEqual([{ type: 'link', text: 'Сайт', url: 'https://example.ru' }]);

    const reply = maxKeyboard({ keyboard: [[{ text: '📱 Поделиться номером', request_contact: true }], [{ text: '🚗 Найти поездку' }]] })!;
    expect(reply.payload.buttons).toEqual([
      [{ type: 'request_contact', text: '📱 Поделиться номером' }],
      [{ type: 'callback', text: '🚗 Найти поездку', payload: 'kb!🚗 Найти поездку' }],
    ]);
    expect(maxKeyboard({ remove_keyboard: true })).toBeNull();
  });

  it('ссылки на бота ведут в тот мессенджер, где человек', async () => {
    const m = await localIdOf(AIGUL);
    expect(botLink('t_5', m)).toBe('https://max.ru/baram_max_bot?start=t_5');
    expect(botLink('t_5', 101)).toBe('https://t.me/baram_test_bot?start=t_5');
    expect(botLink('t_5')).toBe('https://t.me/baram_test_bot?start=t_5');
  });
});

describe('MAX: регистрация', () => {
  it('«Начать» → согласие → имя → телефон кнопкой → меню кнопками под сообщением', async () => {
    app.miniappUrl = 'https://baram.example.ru/app';
    const u = mx.user(AIGUL, 'Айгуль');
    await u.start();
    expect(u.last()).toContain('согласие на обработку персональных данных');
    // Mini App в MAX пока нет — про неё не говорим.
    expect(u.last()).not.toContain('В приложении «Барам»');
    await u.press('Согласен');
    await u.press('Я пассажир');
    expect(u.last()).toContain('Как вас зовут?');
    await u.text('айгуль');
    expect(u.last()).toContain('под этим сообщением');
    expect(u.rawButtons()).toEqual([{ type: 'request_contact', text: '📱 Поделиться номером' }]);

    // Номер текстом не принимается, кнопка «Поделиться номером» при этом не пропадает.
    await u.text('+79171234567');
    expect(u.last()).toContain('только кнопкой');
    expect(u.rawButtons()).toEqual([{ type: 'request_contact', text: '📱 Поделиться номером' }]);
    // Чужой контакт не подходит.
    await u.contact('+79170000000', { own: false });
    const id = await localIdOf(AIGUL);
    expect(await getUserByTg(id)).toBeUndefined();

    await u.contact('79171234567');
    expect(await getUserByTg(id)).toMatchObject({ name: 'Айгуль', phone: '+79171234567', activeRole: 'passenger' });
    expect(u.last()).toContain('кнопки под этим сообщением');
    expect(u.last()).not.toContain('есть в приложении');
    expect(u.buttons()).toEqual(['🚗 Найти поездку', '📋 Доска', '🔁 Мои поездки', '☎️ Помощь', '🚘 Я водитель']);
    // Сообщения человека бот в MAX удалить не может и не пытается.
    expect(mx.fake.calls.filter((c) => c === 'DELETE /messages').length).toBeLessThan(mx.fake.calls.filter((c) => c === 'POST /messages').length);
    app.miniappUrl = undefined;
  });

  it('/id показывает id для ADMIN_IDS, и с ним человек из MAX становится админом', async () => {
    const u = mx.user(AIGUL, 'Айгуль');
    await u.text('/id');
    const id = await localIdOf(AIGUL);
    expect(u.last()).toContain(`<code>${id}</code>`);
    app.adminIds = [id];
    await createUser({ telegramId: id, name: 'Айгуль', phone: '+79171234567', role: 'passenger' });
    await u.text('/menu');
    expect(u.buttons()).toContain('🛠 Админ');
  });
});

describe('MAX и Telegram вместе', () => {
  it('пассажир из MAX бронирует рейс водителя из Telegram; уведомления идут в оба мессенджера', async () => {
    const d = await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    await postTrip(201, { time: '17:00' });
    const id = await localIdOf(AIGUL);
    await createUser({ telegramId: id, name: 'Айгуль', phone: '+79170000002', role: 'passenger' });
    const p = mx.user(AIGUL, 'Айгуль');

    await p.text('/menu');
    await p.press('🚗 Найти поездку');
    expect(p.last()).toContain('Куда едете?');
    await p.press('Буинск → Казань');
    await p.press('Сегодня');
    expect(p.last()).toContain('1 рейс на этот день');
    await p.press('17:00 · Ильдар');
    await p.press('Буинск');
    await p.text('ул. Ленина, 12');
    expect(p.last()).toContain('Куда вас отвезти?');
    await p.press('Казань');
    await p.text('ул. Деловая, 7');
    expect(p.last()).toContain('Проверьте и бронируйте');
    await p.press('Забронировать');
    expect(p.last()).toContain('Заявка на бронь отправлена водителю');
    // Окно поиска одно: прошлые шаги бот за собой убрал, осталось меню и итог.
    expect(mx.fake.of(AIGUL).length).toBeLessThanOrEqual(2);

    expect(d.last()).toContain('Новая бронь');
    expect(d.last()).toContain('Айгуль');
    await d.press('Принять');
    expect(p.fresh()).toContain('Водитель подтвердил бронь');
    expect(p.all()).toContain('А123ВС116');
    expect(mx.fake.of(AIGUL).every((m) => m.format === 'html' || m.images.length)).toBe(true);
  });

  it('старая кнопка отвечает подсказкой', async () => {
    const id = await localIdOf(AIGUL);
    await createUser({ telegramId: id, name: 'Айгуль', phone: '+79170000002', role: 'passenger' });
    const p = mx.user(AIGUL, 'Айгуль');
    await p.text('/menu');
    mx.fake.messages[0]!.buttons = [[{ type: 'callback', text: 'Старая', payload: 'zzz:old' }]];
    await p.press('Старая');
    expect(mx.fake.answers.at(-1)?.notification).toContain('/menu');
  });

  it('фото машины из MAX сохраняются у нас и доходят до админа в Telegram; фото из Telegram — до человека в MAX', async () => {
    const id = await localIdOf(AIGUL);
    const u = await createUser({ telegramId: id, name: 'Айгуль', phone: '+79170000002', role: 'driver' });
    // Фото пришло в MAX: бот запоминает временную ссылку на файл.
    const p = mx.user(AIGUL, 'Айгуль');
    await p.photo('tok-car');
    await submitDriverForm(u.id, {
      fullName: 'Галиева Айгуль Ринатовна',
      car: 'Lada Vesta',
      carYear: 2020,
      carColor: 'Серый',
      plate: 'А777АА116',
      seats: 4,
      childSeat: false,
      carPhotos: ['max:tok-car'],
      payPhone: '+79170000002',
      payBank: 'Сбербанк',
    });
    const [row] = await h.db.select().from(maxFiles);
    expect(row?.token).toBe('tok-car');
    expect(new TextDecoder().decode((await getImage('max:tok-car'))!.bytes)).toBe('img:/tok-car.jpg');

    await sendPhotos(ADMIN_ID, ['max:tok-car', 'car1']);
    expect(h.tg.uploadsTg).toEqual([1]);

    await sendPhotos(id, ['car1', 'max:tok-car']);
    const last = mx.fake.of(AIGUL).at(-1)!;
    expect(last.images).toEqual([expect.stringMatching(/^up-/), 'tok-car']);
  });
});

describe('MAX: вебхук', () => {
  it('принимает обновления только с секретом', async () => {
    const got: unknown[] = [];
    const api = createApi({ botToken: '1:TEST', maxWebhook: { secret: 'secret-1', push: async (u) => void got.push(u) } });
    const body = `{"update_type":"bot_started","timestamp":1,"chat_id":1,"user":{"user_id":${AIGUL}}}`;
    const bad = await api.request('/max/webhook', { method: 'POST', body, headers: { 'x-max-bot-api-secret': 'nope' } });
    expect(bad.status).toBe(403);
    const ok = await api.request('/max/webhook', { method: 'POST', body, headers: { 'x-max-bot-api-secret': 'secret-1' } });
    expect(ok.status).toBe(200);
    expect((got[0] as any).user.user_id).toBe(AIGUL);
  });
});
