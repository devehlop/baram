import { readFileSync } from 'node:fs';
import { FluentBundle, FluentResource } from '@fluent/bundle';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseAdminIds } from '../src/config.js';
import { parseNamePhone } from '../src/bot/conversations/prompt.js';
import { cleanName } from '../src/bot/conversations/registration.js';
import { shortName } from '../src/bot/ui/cards.js';
import { t } from '../src/i18n.js';
import { fmtPhone, mapsUrl, money, normalizePhone, normalizePlate, splitList } from '../src/lib/format.js';
import { dayKey, fmtDateTime, fromDayMinutes, parseTime, setZone } from '../src/lib/time.js';
import { refreshChannelPost } from '../src/services/channel.js';
import { setChannel } from '../src/services/directions.js';
import { approvedDriver, postTrip, setup, type Harness } from './helpers.js';

describe('разбор ввода', () => {
  it('время, как его набирают люди', () => {
    expect(parseTime('17:30')).toBe(17 * 60 + 30);
    expect(parseTime('17.30')).toBe(17 * 60 + 30);
    expect(parseTime('7')).toBe(7 * 60);
    expect(parseTime('0730')).toBe(7 * 60 + 30);
    expect(parseTime('17 05')).toBe(17 * 60 + 5);
    expect(parseTime('25:00')).toBeNull();
    expect(parseTime('17:60')).toBeNull();
    expect(parseTime('вечером')).toBeNull();
  });

  it('телефон приводится к +7…', () => {
    expect(normalizePhone('8 (917) 123-45-67')).toBe('+79171234567');
    expect(normalizePhone('9171234567')).toBe('+79171234567');
    expect(normalizePhone('+7 917 123 45 67')).toBe('+79171234567');
    expect(normalizePhone('12345')).toBeNull();
    expect(fmtPhone('+79171234567')).toBe('+7 917 123-45-67');
  });

  it('госномер: латиница и пробелы', () => {
    expect(normalizePlate('a123bc 116')).toBe('А123ВС116');
    expect(normalizePlate('А123ВС16')).toBe('А123ВС16');
    expect(normalizePlate('123')).toBeNull();
    expect(normalizePlate('Я123ЯЯ116')).toBeNull(); // таких букв на номерах нет
  });

  it('имя, список точек, деньги, имя получателя', () => {
    expect(cleanName('  айгуль ')).toBe('Айгуль');
    expect(cleanName('анна-мария')).toBe('Анна-Мария');
    expect(cleanName('user_123')).toBeNull();
    expect(splitList('ТЦ Мега, Горки; Автовокзал,, ', 5)).toEqual(['ТЦ Мега', 'Горки', 'Автовокзал']);
    expect(money(1500)).toBe('1 500 ₽');
    expect(shortName('Галиев Ильдар Ринатович')).toBe('Ильдар Г.');
    expect(parseNamePhone('Гульнара 8 917 123-45-67')).toEqual({ name: 'Гульнара', phone: '+79171234567' });
    expect(parseNamePhone('89171234567')).toBeNull();
    expect(parseAdminIds('123, 456;789  x')).toEqual([123, 456, 789]);
  });

  it('ссылка «Навигатор»: по координатам или по адресу', () => {
    expect(mapsUrl({ city: 'Буинск', address: 'ул. Ленина, 12' })).toContain(encodeURIComponent('Буинск, ул. Ленина, 12'));
    expect(mapsUrl({ city: 'Буинск', address: 'точка', lat: 54.97, lon: 48.29 })).toContain('pt=48.29,54.97');
  });
});

describe('время в часовом поясе Europe/Moscow', () => {
  it('день и время считаются по Москве, а не по UTC', () => {
    setZone('Europe/Moscow');
    // 22:30 UTC 10 ноября — это уже 01:30 11 ноября по Москве.
    expect(dayKey(new Date('2026-11-10T22:30:00Z'))).toBe('2026-11-11');
    expect(fromDayMinutes('2026-11-11', 17 * 60).toISOString()).toBe('2026-11-11T14:00:00.000Z');
    expect(fmtDateTime('2026-11-13T14:00:00.000Z')).toBe('пт, 13 ноября в 17:00');
  });
});

describe('тексты', () => {
  it('файл locales/ru.ftl разбирается без ошибок, склонения работают', () => {
    const bundle = new FluentBundle('ru');
    const errors = bundle.addResource(new FluentResource(readFileSync('locales/ru.ftl', 'utf8')));
    expect(errors).toEqual([]);
    expect(t('seats-count', { n: 1 })).toBe('1 место');
    expect(t('seats-count', { n: 3 })).toBe('3 места');
    expect(t('seats-count', { n: 5 })).toBe('5 мест');
    expect(t('seats-count', { n: 21 })).toBe('21 место');
    expect(t('drv-summary', { fullName: 'Я', car: 'Lada', year: '2019', color: 'Белый', plate: 'А1', seats: 4, childSeat: 'Да', photos: 2, payPhone: '+7', payBank: 'Сбер' })).toContain('2019');
  });
});

describe('канал: сводный пост «Рейсы на <день>»', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup({ now: '2026-11-10T06:00:00Z' });
  });
  afterEach(() => h.close());

  it('один пост на день: создаётся с первым рейсом и обновляется, а не дублируется', async () => {
    await setChannel(1, '-1001234567890');
    await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    await approvedDriver(h, 202, 'Рамиль', '+79170000003', { plate: 'В222ВВ116' });
    await postTrip(201, { time: '17:00' });
    const posts = () => h.tg.messages.filter((m) => m.chatId === -1001234567890);
    expect(posts().length).toBe(1);
    expect(posts()[0]!.text).toContain('Рейсы на вт, 10 ноября');
    expect(posts()[0]!.text).toContain('17:00</b> · Ильдар · Lada Largus · 3 места · 500 ₽');

    await postTrip(202, { time: '18:00', fromSide: 'b', price: 600 });
    expect(posts().length).toBe(1); // тот же пост, обновлён
    expect(posts()[0]!.text).toContain('Казань → Буинск');
    expect(posts()[0]!.text).toContain('18:00</b> · Рамиль');

    // На другой день — отдельный пост.
    await postTrip(201, { time: '09:00', dayOffset: 1 });
    expect(posts().length).toBe(2);

    // Повторное обновление без изменений не трогает Telegram.
    const before = h.tg.messages.length;
    await refreshChannelPost(1, '2026-11-10');
    expect(h.tg.messages.length).toBe(before);
  });
});
