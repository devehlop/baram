import { useState } from 'react';
import { api, ApiError } from '../api';
import { Avatar, Button, ErrorNote, Loading, PageHeader, Screen, StatusTimeline, SummaryRows } from '../components';
import { BAGGAGE, car, dateTime, money, phone, seats, STATUS } from '../format';
import { errorText, useLoad, useNav } from '../nav';
import { ChuvashBand } from '../Ornaments';
import { haptic } from '../tg';
import type { Booking as BookingT, Trip } from '../types';

const TIMELINE = ['Бронь подтверждена', 'Водитель выехал', 'Вы в машине', 'Доехали'];

/** На каком этапе поездка: индекс текущего шага таймлайна. */
function stage(b: BookingT, trip: Trip): number {
  if (b.status === 'completed') return 4;
  if (b.status === 'picked_up') return 2;
  if ((b.status === 'accepted' || b.status === 'confirmed') && trip.status === 'departed') return 1;
  if (b.status === 'accepted' || b.status === 'confirmed') return 0;
  return -1;
}

function headline(b: BookingT, trip: Trip): string {
  if ((b.status === 'accepted' || b.status === 'confirmed') && trip.status === 'departed') return 'Водитель выехал';
  if (b.status === 'picked_up' && !b.isSelf) return `${b.passengerName ?? 'Пассажир'} в машине`;
  return STATUS[b.status];
}

/** Экран поездки: статус, водитель, номер машины, этапы, звонок. Обновляется сам. */
export function Booking({ id }: { id: number }) {
  const { me, back, go } = useNav();
  const { data, error, reload } = useLoad<{ booking: BookingT; trip: Trip }>(`/bookings/${id}`, 15_000);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!data) return error ? <Screen><PageHeader title="Поездка" onBack={back} /><ErrorNote>{errorText(error)}</ErrorNote></Screen> : <Loading />;
  const { booking: b, trip } = data;
  const d = trip.driver;
  const st = stage(b, trip);
  const waiting = b.status === 'accepted' || b.status === 'confirmed';
  const cancellable = ['pending_admin', 'pending', 'accepted', 'confirmed'].includes(b.status);
  const hoursLeft = (new Date(trip.departsAt).getTime() - Date.now()) / 3_600_000;
  const late = waiting && hoursLeft < (me.lateCancelHours ?? 4);

  const act = async (path: string) => {
    setBusy(true);
    setActionError(null);
    try {
      await api(`/bookings/${id}/${path}`, {});
      haptic('success');
      setAsking(false);
      await reload();
    } catch (e) {
      haptic('error');
      setActionError(e instanceof ApiError ? e.code : 'network');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen top={st >= 0 ? <ChuvashBand height={20} inverse /> : undefined}>
      <PageHeader title={headline(b, trip)} sub={`${trip.route} · ${dateTime(trip.departsAt)}`} big onBack={back} />

      <div className="card">
        <div className="row">
          <Avatar name={d.name} large />
          <div>
            <div className="person__name" style={{ fontSize: 18 }}>{d.name}{d.badge ? ' · проверен' : ''}</div>
            <div className="person__sub">{car(d)}</div>
          </div>
        </div>
        {d.plate ? <div className="plate">{d.plate}</div> : <div className="small muted">Номер машины и телефон появятся, когда водитель подтвердит бронь.</div>}
      </div>

      {st >= 0 && <StatusTimeline steps={TIMELINE} current={st} />}

      {b.prepayRequired && waiting && !b.prepayReceived && d.payPhone && (
        <div className="notice notice--gold">
          <b>Предоплата за крупный багаж — {money(me.prepay ?? 600)}</b><br />
          Переведите по СБП на номер {phone(d.payPhone)} ({d.payBank}).<br />
          Переводите только на этот номер. Водитель и админ не просят перевести на другой.
        </div>
      )}
      {b.prepayRequired && b.prepayReceived && <div className="notice notice--ok">Водитель получил предоплату за багаж</div>}
      {!b.isSelf && st >= 0 && st < 4 && <div className="notice notice--ok">Вы получаете статусы поездки: «в машине» и «доехали»</div>}
      {b.lateCancel && <div className="notice notice--alert">Поздняя отмена — она осталась в истории.</div>}

      <SummaryRows
        rows={[
          ['Едет', b.isSelf ? `${b.passengerName} (вы)` : `${b.passengerName}, ${phone(b.passengerPhone)}`],
          ['Откуда', b.from ? `${b.from.city}, ${b.from.address}` : '—'],
          ['Куда', b.to ? `${b.to.city}, ${b.to.address}` : '—'],
          ...(b.pickupPoint ? ([['Точка сбора', b.pickupPoint]] as [string, string][]) : []),
          ['Мест · багаж', `${seats(b.seats)} · ${BAGGAGE[b.baggage]}`],
          ['К оплате водителю', money(b.price)],
        ]}
      />

      {actionError && <ErrorNote>{errorText(actionError)}</ErrorNote>}

      {asking ? (
        <div className="card card--attention">
          <p><b>{late ? 'Это будет поздняя отмена' : 'Отменить бронь?'}</b></p>
          <p className="small muted">
            {late
              ? `До выезда меньше ${me.lateCancelHours ?? 4} ч. Отмена останется в вашей истории: после трёх таких бронь подтверждает диспетчер.`
              : 'Сейчас отмена свободная. Водитель сразу получит сообщение.'}
          </p>
          <div className="grid2">
            <Button variant="outline" size="card" disabled={busy} onClick={() => void act('cancel')}>Да, отменить</Button>
            <Button variant="confirm" size="card" onClick={() => setAsking(false)}>Оставить</Button>
          </div>
        </div>
      ) : (
        <>
          <div className="spacer" />
          {b.status === 'accepted' && hoursLeft < 24 && trip.status === 'published' && (
            <Button variant="confirm" icon="check" disabled={busy} onClick={() => void act('confirm')}>Да, еду</Button>
          )}
          {(d.phone || me.dispatcherPhone) && (
            <div className={d.phone && me.dispatcherPhone ? 'grid2' : 'stack'}>
              {d.phone && <Button size="card" href={`tel:${d.phone}`}>Позвонить водителю</Button>}
              {me.dispatcherPhone && <Button size="card" variant="outline" href={`tel:${me.dispatcherPhone}`}>Диспетчеру</Button>}
            </div>
          )}
          {cancellable && <Button variant="outline" size="card" onClick={() => setAsking(true)}>Отменить бронь</Button>}
          {!cancellable && st !== 2 && <Button variant="outline" size="card" onClick={() => go({ name: 'search', repeat: true })}>Повторить поездку</Button>}
        </>
      )}
    </Screen>
  );
}
