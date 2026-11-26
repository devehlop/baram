import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cancelTripAction, completeTripAction, submitParcel } from '../src/bot/actions.js';
import { runJobs } from '../src/jobs/runner.js';
import { grantPrivilege } from '../src/services/drivers.js';
import { getParcel, type NewParcel } from '../src/services/parcels.js';
import { approvedDriver, dbId, passenger, postTrip, setClock, setup, type Harness, type TestUser } from './helpers.js';

const NOW = '2026-11-10T06:00:00Z'; // вт, 10 ноября 2026, 09:00 МСК

let h: Harness;
beforeEach(async () => {
  h = await setup({ now: NOW });
});
afterEach(() => h.close());

/** Отправитель проходит сценарий кнопками до карточки. price: число или «договоримся». */
async function fillParcel(p: TestUser, o: { price?: number; toSelf?: boolean; valuable?: boolean } = {}) {
  await p.text('📦 Посылка');
  expect(p.last()).toContain('Куда отправить посылку?');
  await p.press('Буинск → Казань');
  await p.press('Сегодня');
  await p.press('Вечером');
  await p.press('Маленькая');
  await p.text('банки с соленьями');
  expect(p.last()).toContain('деньги, банковские карты, ключи, документы или лекарства');
  await p.press(o.valuable ? 'Да, есть' : 'Нет, обычная посылка');
  await p.press('Буинск');
  await p.text('ул. Ленина, 12');
  await p.press('Казань');
  if (o.toSelf) await p.press('Получатель заберёт сам');
  else await p.text('ул. Деловая, 7');
  await p.press('Другой человек');
  await p.text('Роза');
  await p.text('89171112233');
  if (o.price === undefined) await p.press('Договоримся с водителем');
  else await p.text(String(o.price));
}

/** Посылка напрямую, без кнопок — для проверок правил. */
async function parcelFor(telegramId: number, extra: Partial<NewParcel> = {}) {
  const res = await submitParcel({
    senderId: await dbId(telegramId),
    directionId: 1,
    fromSide: 'a',
    day: '2026-11-10',
    timeKind: 'evening',
    size: 'medium',
    contents: 'коробка с книгами',
    valuable: false,
    from: { localityId: 1, address: 'ул. Ленина, 12' },
    to: { localityId: 2, address: null },
    recipient: { name: 'Роза', phone: '+79171112233' },
    price: 300,
    ...extra,
  });
  if (!res.ok) throw new Error(`Посылка не создана: ${res.reason}`);
  return res.parcel;
}

describe('посылки', () => {
  it('отправитель описывает посылку, водитель берёт её в рейс, забирает и передаёт', async () => {
    const d = await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const p = await passenger(h, 101, 'Айгуль', '+79170000002');

    await fillParcel(p, { price: 300, toSelf: true });
    const card = p.last();
    expect(card).toContain('Посылка водителям');
    expect(card).toContain('Маленькая');
    expect(card).toContain('банки с соленьями');
    expect(card).toContain('получатель заберёт у водителя');
    expect(card).toContain('Роза');
    expect(card).toContain('300 ₽, предложил отправитель');
    expect(card).toContain('Нельзя отправлять');
    await p.press('Отправить водителям');
    expect(p.last()).toContain('Посылка отправлена водителям');

    // Водителю — уведомление без телефонов: только что, откуда, куда и цена.
    const note = d.all();
    expect(note).toContain('Посылка</b> по вашему направлению');
    expect(note).toContain('банки с соленьями');
    expect(note).not.toContain('+7 917 111');
    expect(note).not.toContain('+7 917 000-00-02');

    // Рейса на этот день нет — сначала выложить.
    await d.press('Беру за 300 ₽');
    expect(d.last()).toContain('сначала выложите рейс');
    const trip = await postTrip(201, { time: '17:00' });
    await d.press('Обновить');
    await d.press('В рейс 17:00');
    expect(d.last()).toContain('Посылка ваша');
    expect(d.last()).toContain('+7 917 111-22-33');

    // Отправитель видит водителя, машину и номер.
    expect(p.last()).toContain('Водитель взял вашу посылку');
    expect(p.last()).toContain('Ильдар');
    expect(p.last()).toContain('А123ВС116');

    // В рейсе водителя — посылка под пассажирами.
    await d.pressData(`d:t:${trip.id}`);
    expect(d.last()).toContain('Посылок в рейсе: 1');
    await d.press('Маленькая');
    await d.press('Забрал посылку');
    expect(p.last()).toContain('Посылка у водителя');
    await d.press('Передал получателю');
    expect(p.last()).toContain('Посылка доставлена');
    const parcelId = Number(/p:pc:(\d+)/.exec(JSON.stringify(h.tg.of(101).at(-1)!.inline))![1]);
    expect((await getParcel(parcelId))!.status).toBe('delivered');
  });

  it('«договоримся»: водитель видит «цену обсудим»; отправитель отменяет — водителю приходит сообщение', async () => {
    const d = await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const p = await passenger(h, 101, 'Айгуль', '+79170000002');
    await postTrip(201, { time: '17:00' });

    await fillParcel(p);
    expect(p.last()).toContain('цену обсудите с водителем');
    await p.press('Отправить водителям');

    await d.press('Беру, цену обсудим');
    await d.press('В рейс 17:00');
    expect(p.last()).toContain('Цену обсудите с ним по телефону');

    await p.press('Открыть посылку');
    await p.press('Отменить посылку');
    expect(p.last()).toContain('Водитель уже взял посылку');
    await p.press('Да, отменить');
    expect(p.last()).toContain('Посылка отменена');
    expect(d.last()).toContain('Айгуль отменил посылку');
  });

  it('в «Заявках» водителя посылки видны рядом с заявками пассажиров, а в «Моих поездках» — у отправителя', async () => {
    const d = await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const p = await passenger(h, 101, 'Айгуль', '+79170000002');
    await parcelFor(101);

    await d.text('🔔 Заявки');
    expect(d.last()).toContain('Посылки');
    expect(d.last()).toContain('коробка с книгами');
    expect(d.buttons().some((b) => b.startsWith('📦 Беру 1'))).toBe(true);

    await p.text('🔁 Мои поездки');
    expect(p.buttons().some((b) => b.includes('ждёт водителя'))).toBe(true);
  });

  it('водитель отказался или отменил рейс — посылка снова открыта, отправитель знает', async () => {
    const d = await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const p = await passenger(h, 101, 'Айгуль', '+79170000002');
    const trip = await postTrip(201, { time: '17:00' });
    const parcel = await parcelFor(101);

    await d.pressData(`pc:t:${parcel.id}:${trip.id}`);
    await d.pressData(`d:pc:${parcel.id}`);
    await d.press('Не смогу отвезти');
    await d.press('Да, отказаться');
    expect((await getParcel(parcel.id))!.status).toBe('open');
    expect(p.last()).toContain('не сможет отвезти посылку');

    await d.pressData(`pc:t:${parcel.id}:${trip.id}`);
    expect((await getParcel(parcel.id))!.status).toBe('taken');
    await cancelTripAction(trip.id, { driverId: await dbId(201) });
    expect((await getParcel(parcel.id))!.status).toBe('open');
    expect(p.last()).toContain('Рейс вт, 10 ноября в 17:00 отменён');
    expect(p.last()).not.toContain('Водитель отменил');
  });

  it('рейс отменён, а посылка уже у водителя: она в «Моих рейсах», водитель отмечает «Вернул отправителю»', async () => {
    const d = await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const p = await passenger(h, 101, 'Айгуль', '+79170000002');
    const trip = await postTrip(201, { time: '17:00' });
    const parcel = await parcelFor(101);
    await d.pressData(`pc:t:${parcel.id}:${trip.id}`);
    await d.pressData(`d:pcp:${parcel.id}`);

    await cancelTripAction(trip.id, 'admin');
    expect(p.last()).toContain('Рейс отменён, а посылка уже у водителя');
    expect(p.last()).toContain('+7 917 000-00-01');
    expect(d.all()).toContain('Рейс отменён, а посылка уже у вас');

    // Рейса в списке больше нет, а посылка — есть.
    await d.text('📋 Мои рейсы');
    expect(d.last()).toContain('Посылок у вас из отменённых рейсов: 1');
    await d.press('📥');
    await d.press('Вернул отправителю');
    expect((await getParcel(parcel.id))!.status).toBe('returned');
    expect(p.last()).toContain('вернул посылку вам');
    await d.text('📋 Мои рейсы');
    expect(d.last()).not.toContain('Посылок у вас');
    await p.text('🔁 Мои поездки');
    expect(p.buttons().join(' ')).not.toContain('📦 вт');
  });

  it('рейс закрыт без «Забрал», а время посылки прошло — одно сообщение «время прошло»', async () => {
    const d = await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const p = await passenger(h, 101, 'Айгуль', '+79170000002');
    const trip = await postTrip(201, { time: '17:00' });
    const parcel = await parcelFor(101);
    await d.pressData(`pc:t:${parcel.id}:${trip.id}`);
    setClock('2026-11-10T21:30:00Z'); // 00:30 МСК — вечер прошёл
    await completeTripAction(trip.id, await dbId(201));
    expect((await getParcel(parcel.id))!.status).toBe('expired');
    expect(p.all()).toContain('Время вашей посылки прошло');
    expect(p.all()).not.toContain('снова видна другим водителям');
  });

  it('«Заявки» укладываются в лимит Telegram, даже когда посылок много', async () => {
    const d = await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    for (const [i, id] of [111, 112, 113, 114].entries()) {
      await passenger(h, id, `Отправитель${i}`, `+7917000010${i}`);
      for (let k = 0; k < 3; k++) await parcelFor(id, { contents: `${'очень подробное описание посылки '.repeat(6)}№${k}` });
    }
    await d.text('🔔 Заявки');
    expect(d.last().length).toBeLessThan(4096);
    expect(d.last()).toContain('…и ещё');
    // Кнопок «Беру» ровно столько, сколько карточек показано.
    const shown = (d.last().match(/^\d+\. /gm) ?? []).length;
    expect(d.buttons().filter((b) => b.startsWith('📦 Беру')).length).toBe(shown);
  });

  it('«Доехали»: забранная посылка считается доставленной', async () => {
    const d = await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const p = await passenger(h, 101, 'Айгуль', '+79170000002');
    const trip = await postTrip(201, { time: '17:00' });
    const parcel = await parcelFor(101);
    await d.pressData(`pc:t:${parcel.id}:${trip.id}`);
    await d.pressData(`d:pcp:${parcel.id}`);
    await completeTripAction(trip.id, await dbId(201));
    expect((await getParcel(parcel.id))!.status).toBe('delivered');
    expect(p.last()).toContain('Посылка доставлена');
  });

  it('деньги, ключи, документы, лекарства — видят и берут только водители со значком «Проверен»', async () => {
    const plain = await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const verified = await approvedDriver(h, 202, 'Рамиль', '+79170000003', { plate: 'В222ВВ116' });
    await grantPrivilege(await dbId(202), 'verified_badge', null, null);
    const p = await passenger(h, 101, 'Айгуль', '+79170000002');
    const plainTrip = await postTrip(201, { time: '17:00' });
    await postTrip(202, { time: '18:00' });

    await fillParcel(p, { price: 500, valuable: true });
    expect(p.last()).toContain('только для проверенных водителей');
    expect(p.last()).not.toContain('деньги и банковские карты');
    await p.press('Отправить водителям');

    // Обычному водителю посылка не приходит и не видна в «Заявках».
    expect(plain.all()).not.toContain('банки с соленьями');
    await plain.text('🔔 Заявки');
    expect(plain.last()).not.toContain('банки с соленьями');
    // И по старой кнопке взять её нельзя.
    const id = Number(/p:pcx:(\d+)/.exec(JSON.stringify(h.tg.of(101).at(-1)!.inline))![1]);
    await plain.pressData(`pc:take:${id}`);
    await plain.pressData(`pc:t:${id}:${plainTrip.id}`);
    expect((await getParcel(id))!.status).toBe('open');

    // Проверенный видит и берёт.
    expect(verified.last()).toContain('🔒');
    await verified.press('Беру за 500 ₽');
    await verified.press('В рейс 18:00');
    expect((await getParcel(id))!.driverId).toBe(await dbId(202));
    expect(p.last()).toContain('Рамиль');
  });

  it('чужой водитель не видит телефонов чужой посылки и не может её отметить', async () => {
    const d = await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const other = await approvedDriver(h, 202, 'Рамиль', '+79170000003', { plate: 'В222ВВ116' });
    await passenger(h, 101, 'Айгуль', '+79170000002');
    const trip = await postTrip(201, { time: '17:00' });
    const parcel = await parcelFor(101);
    await d.pressData(`pc:t:${parcel.id}:${trip.id}`);

    await other.pressData(`d:pc:${parcel.id}`);
    expect(other.fresh()).not.toContain('+7 917 111-22-33');
    await other.pressData(`d:pcp:${parcel.id}`);
    expect((await getParcel(parcel.id))!.status).toBe('taken');
    // Взять уже занятую посылку тоже нельзя.
    const otherTrip = await postTrip(202, { time: '18:00' });
    await other.pressData(`pc:t:${parcel.id}:${otherTrip.id}`);
    expect((await getParcel(parcel.id))!.driverId).toBe(await dbId(201));
  });

  it('не больше трёх открытых посылок у человека; время прошло — посылка закрывается', async () => {
    await approvedDriver(h, 201, 'Ильдар', '+79170000001');
    const p = await passenger(h, 101, 'Айгуль', '+79170000002');
    const first = await parcelFor(101);
    await parcelFor(101);
    await parcelFor(101);
    const res = await submitParcel({ ...(await baseOf(101)), price: null });
    expect(res.ok).toBe(false);

    setClock('2026-11-10T21:30:00Z'); // 00:30 МСК следующего дня — вечер прошёл
    await runJobs();
    expect((await getParcel(first.id))!.status).toBe('expired');
    expect(p.last()).toContain('Время вашей посылки прошло');
  });
});

async function baseOf(telegramId: number): Promise<NewParcel> {
  return {
    senderId: await dbId(telegramId),
    directionId: 1,
    fromSide: 'a',
    day: '2026-11-10',
    timeKind: 'any',
    size: 'small',
    contents: 'конверт',
    valuable: false,
    from: { localityId: 1, address: null },
    to: { localityId: 2, address: null },
    recipient: { name: 'Роза', phone: '+79171112233' },
    price: null,
  };
}
