import type { Context } from 'grammy';
import { t } from '../../i18n.js';
import { esc, fmtPhone, normalizePhone, normalizePlate } from '../../lib/format.js';
import { getDriver, submitDriverForm, updateCarPhotos, type DriverFormInput } from '../../services/drivers.js';
import { getUserByTg, setActiveRole } from '../../services/users.js';
import type { MyConversation } from '../context.js';
import { notifyAdminsNewDriver } from '../notify.js';
import { showMenu } from '../ui/menu.js';
import { column, grid, runSteps, Wizard, type Outcome, type Step } from '../wizard.js';

type FormState = Partial<DriverFormInput> & { ownPhone: string };

const CARS = ['Lada Largus', 'Lada Granta', 'Lada Vesta', 'Hyundai Solaris', 'Kia Rio', 'Volkswagen Polo', 'Renault Logan'];
const COLORS = ['color-white', 'color-black', 'color-gray', 'color-silver', 'color-blue', 'color-red'];
const BANKS = ['Сбербанк', 'Т-Банк', 'Альфа-Банк', 'ВТБ', 'Ак Барс Банк'];
const MIN_PHOTOS = 2;
const MAX_PHOTOS = 4;

const lengthBetween = (min: number, max: number) => (v: string) =>
  v.length >= min && v.length <= max ? null : t('hint-text-length', { min, max });

function nav(a: { kind: string }): Outcome | null {
  return a.kind === 'back' ? 'back' : a.kind === 'home' ? 'home' : null;
}

/** Сбор 2–4 фото машины. Возвращает список file_id или 'back' / 'home'. */
export async function collectPhotos(w: Wizard): Promise<string[] | 'back' | 'home'> {
  const photos: string[] = [];
  let text = t('drv-ask-photos');
  for (;;) {
    const enough = photos.length >= MIN_PHOTOS;
    const a = await w.ask({
      text,
      rows: enough ? [[{ text: t('btn-photos-done'), data: 'done' }]] : [],
      acceptPhoto: true,
      hint: t('drv-photos-hint'),
    });
    if (a.kind === 'back' || a.kind === 'home') return a.kind;
    if (a.kind === 'btn' && a.data === 'done') return photos;
    if (a.kind === 'photo') {
      photos.push(a.fileId);
      if (photos.length >= MAX_PHOTOS) return photos;
      text = t(photos.length >= MIN_PHOTOS ? 'drv-photos-more' : 'drv-photos-next', { n: photos.length, max: MAX_PHOTOS });
    }
  }
}

const steps: Step<FormState>[] = [
  {
    id: 'fullName',
    run: async (w, s) => {
      const ok = (v: string) => v.split(' ').length >= 2 && v.length <= 80 && /^[\p{L}\s.'-]+$/u.test(v);
      const a = await w.ask({
        text: t('drv-ask-fullname'),
        acceptText: true,
        hint: t('drv-fullname-hint'),
        validate: (v) => (ok(v) ? null : t('drv-fullname-hint')),
      });
      if (a.kind !== 'text') return nav(a) ?? 'back';
      s.fullName = a.text;
      return 'next';
    },
  },
  {
    id: 'car',
    run: async (w, s) => {
      const a = await w.ask({
        text: t('drv-ask-car'),
        rows: grid(CARS.map((c, i) => ({ text: c, data: `c${i}` })), 2),
        acceptText: true,
        validate: lengthBetween(3, 40),
      });
      if (a.kind === 'btn') s.car = CARS[Number(a.data.slice(1))];
      else if (a.kind === 'text') s.car = a.text;
      else return nav(a) ?? 'back';
      return 'next';
    },
  },
  {
    id: 'year',
    run: async (w, s) => {
      const ok = (v: string) => /^\d{4}$/.test(v) && Number(v) >= 1980 && Number(v) <= new Date().getFullYear() + 1;
      const a = await w.ask({
        text: t('drv-ask-year'),
        acceptText: true,
        hint: t('drv-year-hint'),
        validate: (v) => (ok(v) ? null : t('drv-year-hint')),
      });
      if (a.kind !== 'text') return nav(a) ?? 'back';
      s.carYear = Number(a.text);
      return 'next';
    },
  },
  {
    id: 'color',
    run: async (w, s) => {
      const a = await w.ask({
        text: t('drv-ask-color'),
        rows: grid(COLORS.map((c, i) => ({ text: t(c), data: `k${i}` })), 2),
        acceptText: true,
        validate: lengthBetween(3, 30),
      });
      if (a.kind === 'btn') s.carColor = t(COLORS[Number(a.data.slice(1))]!);
      else if (a.kind === 'text') s.carColor = a.text;
      else return nav(a) ?? 'back';
      return 'next';
    },
  },
  {
    id: 'plate',
    run: async (w, s) => {
      const a = await w.ask({
        text: t('drv-ask-plate'),
        acceptText: true,
        hint: t('drv-plate-hint'),
        validate: (v) => (normalizePlate(v) ? null : t('drv-plate-hint')),
      });
      if (a.kind !== 'text') return nav(a) ?? 'back';
      s.plate = normalizePlate(a.text)!;
      return 'next';
    },
  },
  {
    id: 'seats',
    run: async (w, s) => {
      const a = await w.ask({
        text: t('drv-ask-seats'),
        rows: grid([1, 2, 3, 4, 5, 6].map((n) => ({ text: String(n), data: String(n) })), 3),
      });
      if (a.kind !== 'btn') return nav(a) ?? 'back';
      s.seats = Number(a.data);
      return 'next';
    },
  },
  {
    id: 'childSeat',
    run: async (w, s) => {
      const a = await w.ask({
        text: t('drv-ask-child-seat'),
        rows: column([
          { text: t('btn-yes'), data: 'y' },
          { text: t('btn-no'), data: 'n' },
        ]),
      });
      if (a.kind !== 'btn') return nav(a) ?? 'back';
      s.childSeat = a.data === 'y';
      return 'next';
    },
  },
  {
    id: 'photos',
    run: async (w, s) => {
      const res = await collectPhotos(w);
      if (res === 'back' || res === 'home') return res;
      s.carPhotos = res;
      return 'next';
    },
  },
  {
    id: 'payPhone',
    run: async (w, s) => {
      const a = await w.ask({
        text: t('drv-ask-pay-phone'),
        rows: [[{ text: t('drv-pay-same', { phone: fmtPhone(s.ownPhone) }), data: 'same' }]],
        acceptText: true,
        hint: t('drv-pay-phone-hint'),
        validate: (v) => (normalizePhone(v) ? null : t('drv-pay-phone-hint')),
      });
      if (a.kind === 'btn') s.payPhone = s.ownPhone;
      else if (a.kind === 'text') s.payPhone = normalizePhone(a.text)!;
      else return nav(a) ?? 'back';
      return 'next';
    },
  },
  {
    id: 'payBank',
    run: async (w, s) => {
      const a = await w.ask({
        text: t('drv-ask-bank'),
        rows: grid(BANKS.map((b, i) => ({ text: b, data: `b${i}` })), 2),
        acceptText: true,
        validate: lengthBetween(2, 40),
      });
      if (a.kind === 'btn') s.payBank = BANKS[Number(a.data.slice(1))];
      else if (a.kind === 'text') s.payBank = a.text;
      else return nav(a) ?? 'back';
      return 'next';
    },
  },
  {
    id: 'summary',
    run: async (w, s) => {
      const a = await w.ask({
        text: t('drv-summary', {
          fullName: esc(s.fullName),
          car: esc(s.car),
          year: String(s.carYear),
          color: esc(s.carColor),
          plate: esc(s.plate),
          seats: s.seats,
          childSeat: t(s.childSeat ? 'btn-yes' : 'btn-no'),
          photos: s.carPhotos?.length ?? 0,
          payPhone: fmtPhone(s.payPhone),
          payBank: esc(s.payBank),
        }),
        rows: column([
          { text: t('btn-send-for-review'), data: 'ok' },
          { text: t('btn-fix'), data: 'fix' },
        ]),
      });
      if (a.kind !== 'btn') return nav(a) ?? 'back';
      if (a.data === 'ok') return 'next';
      const fix = await w.ask({
        text: t('ask-what-to-fix'),
        rows: grid(
          steps.filter((x) => x.id !== 'summary').map((x) => ({ text: t(`drv-field-${x.id}`), data: x.id })),
          2,
        ),
        home: false,
      });
      if (fix.kind !== 'btn') return { goto: 'summary' };
      return { goto: fix.data, returnTo: 'summary' };
    },
  },
];

/** Анкета водителя: 10 коротких вопросов, итог, отправка на проверку админу. */
export async function runDriverForm(w: Wizard, telegramId: number): Promise<void> {
  const user = await w.ext(() => getUserByTg(telegramId));
  if (!user) return;
  const state: FormState = { ownPhone: user.phone };
  const res = await runSteps(w, steps, state);
  if (res === 'home') {
    await w.ext(async () => {
      const u = await getUserByTg(telegramId);
      if (u) await showMenu(u, t('drv-form-cancelled'));
    });
    return;
  }
  await w.ext(async () => {
    const { ownPhone: _own, ...form } = state;
    await submitDriverForm(user.id, form as DriverFormInput);
    await setActiveRole(user.id, 'driver');
    const u = await getUserByTg(telegramId);
    if (u) await showMenu(u, t('drv-form-sent'));
    await notifyAdminsNewDriver(user.id);
  });
}

export async function driverForm(conv: MyConversation, ctx: Context): Promise<void> {
  await runDriverForm(new Wizard(conv, ctx.chat!.id), ctx.from!.id);
}

/** Админ попросил прислать фото заново. */
export async function driverPhotos(conv: MyConversation, ctx: Context): Promise<void> {
  const w = new Wizard(conv, ctx.chat!.id);
  const telegramId = ctx.from!.id;
  const photos = await collectPhotos(w);
  await w.ext(async () => {
    const user = await getUserByTg(telegramId);
    if (!user) return;
    if (photos === 'back' || photos === 'home') {
      await showMenu(user);
      return;
    }
    if (!(await getDriver(user.id))) return;
    await updateCarPhotos(user.id, photos);
    await showMenu(user, t('drv-photos-sent'));
    await notifyAdminsNewDriver(user.id);
  });
}
