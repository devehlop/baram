import { completeTripAction, escalateRequest, expireRequestsAction } from '../bot/actions.js';
import { kb, notifyUser } from '../bot/tg.js';
import { t } from '../i18n.js';
import { esc, fmtPhone } from '../lib/format.js';
import { fmtTime } from '../lib/time.js';
import { log } from '../logger.js';
import {
  dueConfirmAsks,
  dueNoAnswer,
  duePrepayWarnings,
  getBooking,
  markAskSent,
  markNoAnswerNotified,
  markPrepayWarned,
} from '../services/bookings.js';
import { dueEscalations } from '../services/requests.js';
import { loadSettings } from '../services/settings.js';
import { staleTripIds } from '../services/trips.js';
import { getTrip } from '../services/trips.js';

/** Выполнить шаг для каждого элемента; ошибка одного не мешает остальным. */
async function each<T>(name: string, items: T[], fn: (item: T) => Promise<void>): Promise<void> {
  for (const item of items) {
    try {
      await fn(item);
    } catch (e) {
      log.error({ err: e, job: name, item }, 'Ошибка фоновой задачи');
    }
  }
}

/**
 * Один проход фоновых задач. Задачи не хранят очередь: каждый раз смотрим в базу,
 * кому пора написать. Перезапуск бота ничего не теряет, а изменение сроков в настройках
 * действует сразу.
 */
export async function runJobs(): Promise<void> {
  // «Едете сегодня в 17:00?» — за confirm_ask_hours до выезда.
  await each('confirm-ask', await dueConfirmAsks(), async (id) => {
    const b = await getBooking(id);
    const trip = b && (await getTrip(b.tripId));
    await markAskSent(id);
    if (!b || !trip) return;
    await notifyUser(
      b.booker?.id,
      t('ask-going', { time: fmtTime(trip.departsAt), route: esc(trip.route) }),
      kb([
        [{ text: t('btn-yes-going'), data: `p:yes:${b.id}` }],
        [{ text: t('btn-cancel-booking'), data: `p:x:${b.id}` }],
      ]),
    );
  });

  // Пассажир не ответил — водитель решает, ждать или звонить.
  await each('no-answer', await dueNoAnswer(), async (id) => {
    const b = await getBooking(id);
    const trip = b && (await getTrip(b.tripId));
    await markNoAnswerNotified(id);
    if (!b || !trip) return;
    await notifyUser(
      trip.driverId,
      t('drv-no-answer', { name: esc(b.passengerName ?? ''), phone: fmtPhone(b.passengerPhone) }),
      kb([[{ text: t('btn-open'), data: `d:b:${b.id}` }]]),
    );
  });

  // Предоплаты за крупный багаж нет, выезд скоро.
  const s = await loadSettings();
  await each('prepay', await duePrepayWarnings(), async (id) => {
    const b = await getBooking(id);
    const trip = b && (await getTrip(b.tripId));
    await markPrepayWarned(id);
    if (!b || !trip) return;
    await notifyUser(
      trip.driverId,
      t('drv-no-prepay', { name: esc(b.passengerName ?? ''), hours: s.prepay_deadline_hours }),
      kb([[{ text: t('btn-open'), data: `d:b:${b.id}` }]]),
    );
    await notifyUser(b.booker?.id, t('bk-prepay-reminder'), kb([[{ text: t('btn-open-booking'), data: `p:b:${b.id}` }]]));
  });

  // Заявку никто не взял — передаём админу.
  await each('escalate', await dueEscalations(), escalateRequest);

  try {
    await expireRequestsAction();
  } catch (e) {
    log.error({ err: e }, 'Ошибка закрытия просроченных заявок');
  }

  // Водитель забыл нажать «Доехали» — закрываем рейс сами.
  await each('autoclose', await staleTripIds(), async (id) => {
    await completeTripAction(id, null);
  });
}

export function startJobs(intervalMs = 30_000): () => void {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runJobs();
    } catch (e) {
      log.error({ err: e }, 'Ошибка фоновых задач');
    } finally {
      running = false;
    }
  }, intervalMs);
  return () => clearInterval(timer);
}
