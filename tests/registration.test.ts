import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDriver } from '../src/services/drivers.js';
import { getUserByTg } from '../src/services/users.js';
import { ADMIN_ID, setup, type Harness } from './helpers.js';

let h: Harness;
beforeEach(async () => {
  h = await setup();
});
afterEach(() => h.close());

describe('регистрация', () => {
  it('пассажир: роль → имя → телефон кнопкой → главное меню', async () => {
    const u = h.user(101);
    await u.text('/start');
    expect(u.last()).toContain('Вы едете как пассажир или вы водитель?');
    await u.press('Я пассажир');
    expect(u.last()).toContain('Как вас зовут?');
    await u.text('айгуль');
    expect(u.last()).toContain('Айгуль');
    expect(u.menu()).toEqual(['📱 Поделиться номером']);

    // Номер текстом не принимается — только кнопкой.
    await u.text('+79171234567');
    expect(u.last()).toContain('только кнопкой');
    expect(await getUserByTg(101)).toBeUndefined();

    // Чужой контакт тоже не подходит.
    await u.contact('+79170000000', { own: false });
    expect(await getUserByTg(101)).toBeUndefined();

    await u.contact('89171234567');
    const user = await getUserByTg(101);
    expect(user).toMatchObject({ name: 'Айгуль', phone: '+79171234567', activeRole: 'passenger' });
    expect(u.menu()).toEqual(['🚗 Найти поездку', '🔁 Мои поездки', '☎️ Помощь', '🚘 Я водитель']);
  });

  it('водитель: после регистрации идёт анкета, она уходит админу', async () => {
    const d = h.user(202);
    const admin = h.user(ADMIN_ID);
    await d.text('/start');
    await d.press('Я водитель');
    await d.text('Ильдар');
    await d.contact('+79170001122');
    expect(d.last()).toContain('как в водительских правах');
    await d.text('Галиев Ильдар Ринатович');
    await d.press('Lada Largus');
    await d.text('19'); // ошибка ввода
    expect(d.last()).toContain('четырьмя цифрами');
    await d.text('2019');
    await d.press('Белый');
    await d.text('а123вс 116');
    await d.press('4');
    await d.press('Да');
    await d.photo('p1');
    expect(d.buttons()).not.toContain('Готово');
    await d.photo('p2');
    await d.press('Готово');
    await d.press('Тот же');
    await d.press('Сбербанк');
    expect(d.last()).toContain('Проверьте анкету');
    expect(d.last()).toContain('А123ВС116');

    // «Исправить» меняет одно поле и возвращает к итогу.
    await d.press('Исправить');
    await d.press('Места');
    await d.press('6');
    expect(d.last()).toContain('Мест для пассажиров: 6');

    await d.press('Отправить на проверку');
    const driver = await getDriver((await getUserByTg(202))!.id);
    expect(driver).toMatchObject({ status: 'pending', plate: 'А123ВС116', seats: 6, carPhotos: ['p1', 'p2'], payPhone: '+79170001122' });
    expect(d.last()).toContain('Анкета отправлена на проверку');
    expect(admin.all()).toContain('Новая анкета водителя');
    expect(admin.buttons()).toEqual(['✅ Одобрить', 'Отклонить', 'Запросить фото заново']);
  });

  it('«Назад» возвращает на предыдущий вопрос анкеты', async () => {
    const d = h.user(203);
    await d.text('/start');
    await d.press('Я водитель');
    await d.text('Рамиль');
    await d.contact('+79170001133');
    await d.text('Сафин Рамиль');
    await d.press('Kia Rio');
    expect(d.last()).toContain('В каком году');
    await d.press('Назад');
    expect(d.last()).toContain('Какая у вас машина?');
    await d.press('Назад');
    expect(d.last()).toContain('как в водительских правах');
  });
});
