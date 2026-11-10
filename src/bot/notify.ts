import { t } from '../i18n.js';
import { getDriver } from '../services/drivers.js';
import { kb, notifyAdmins, send, sendPhotos } from './tg.js';
import { app } from '../app.js';
import { driverCard } from './ui/cards.js';

/** Новая анкета водителя (или повторная) — всем админам, с фото и кнопками решения. */
export async function notifyAdminsNewDriver(driverId: number): Promise<void> {
  const d = await getDriver(driverId);
  if (!d) return;
  for (const adminTg of app.adminIds) {
    await sendPhotos(adminTg, d.carPhotos);
    await send(adminTg, `${t('adm-new-driver')}\n\n${driverCard(d, { admin: true })}`, driverReviewKb(driverId));
  }
}

export function driverReviewKb(driverId: number) {
  return kb([
    [{ text: t('btn-approve'), data: `a:d:ok:${driverId}` }],
    [{ text: t('btn-reject'), data: `a:d:no:${driverId}` }],
    [{ text: t('btn-request-photos'), data: `a:d:ph:${driverId}` }],
  ]);
}

export { notifyAdmins };
