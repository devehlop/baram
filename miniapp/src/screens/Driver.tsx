import { useState } from 'react';
import { api, ApiError } from '../api';
import { Avatar, Button, Chip, ErrorNote, Icon, Loading, MenuTile, PageHeader, Screen } from '../components';
import { BAGGAGE, dateTime, mapsUrl, money, parseTime, phone, seats, time } from '../format';
import { errorText, useLoad, useNav } from '../nav';
import { Rosette, TulipBand } from '../Ornaments';
import { closeToBot, haptic } from '../tg';
import type { Booking, DriverHome, PickupMode, Trip, Trunk } from '../types';

const DRIVER_STATUS: Record<string, string> = {
  pending: 'Анкета на проверке. Как только админ её одобрит, можно будет выкладывать рейсы.',
  rejected: 'Анкета отклонена. Исправьте её в чате с ботом: «Мои данные».',
  photos_requested: 'Админ попросил прислать фото машины заново — это в чате с ботом.',
  suspended: 'Работа водителем приостановлена админом. Свяжитесь с диспетчером.',
};

const TRIP_ERRORS: Record<string, string> = {
  not_approved: 'Выкладывать рейсы можно после одобрения анкеты.',
  past: 'Это время уже прошло. Выберите время позже.',
  horizon: 'Так далеко вперёд рейс выложить нельзя.',
  limit: 'В этот день у вас уже максимум рейсов в эту сторону.',
  duplicate: 'У вас уже есть рейс в эту сторону почти в это же время.',
  overlap: 'Рейс пересекается с другим вашим рейсом: не хватает времени на дорогу.',
  price: 'Цена вне допустимых границ.',
  seats: 'Мест больше, чем в анкете машины.',
};

function useAction(reload: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (path: string, body: unknown = {}) => {
    setBusy(true);
    setError(null);
    try {
      await api(path, body);
      haptic('success');
      await reload();
      return true;
    } catch (e) {
      haptic('error');
      setError(e instanceof ApiError ? e.code : 'network');
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function bookingLine(b: Booking): string {
  return [b.pickupPoint ?? b.from?.address, BAGGAGE[b.baggage], b.from?.village || b.to?.village ? 'деревня' : ''].filter(Boolean).join(' · ');
}

/** Главная водителя: новые брони, ближайший рейс, плитки. */
export function DriverHomeScreen() {
  const { me, go, reloadMe } = useNav();
  const { data, error, reload } = useLoad<DriverHome>('/driver/home', 20_000);
  const action = useAction(reload);
  if (!data) return error ? <Screen><ErrorNote>{errorText(error)}</ErrorNote></Screen> : <Loading />;
  const nearest = data.trips[0];
  const approved = data.driver.status === 'approved';

  const toPassenger = async () => {
    await api('/role', { role: 'passenger' });
    await reloadMe();
  };

  return (
    <Screen>
      <div className="row" style={{ paddingTop: 8 }}>
        <Avatar name={data.driver.name} large />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.15 }}>{data.driver.name}</div>
          <div className="row small muted" style={{ gap: 8 }}>
            {data.driver.badge && <Chip kind="ok">✓ Проверен</Chip>}
            <span>{me.driver?.car}</span>
          </div>
        </div>
      </div>

      {!approved && (
        <div className="notice notice--gold">
          {DRIVER_STATUS[data.driver.status] ?? ''}
          {data.driver.rejectReason ? ` Причина: ${data.driver.rejectReason}` : ''}
        </div>
      )}
      {action.error && <ErrorNote>{errorText(action.error)}</ErrorNote>}

      {data.pending.map(({ booking: b, trip }) => (
        <div className="card card--attention" key={b.id}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="label-caps" style={{ color: 'var(--c-gold-soft-ink)' }}>Новая бронь</div>
            <div className="small muted">{time(trip.departsAt)} · {trip.route}</div>
          </div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{b.passengerName} · {seats(b.seats)}</div>
          <div className="muted">{bookingLine(b)}</div>
          {b.passengerType !== 'adult' && !b.isSelf && <Chip kind="teen">{b.passengerType === 'teen' ? 'Подросток 14–17' : 'Ребёнок до 14'}, едет один</Chip>}
          <div className="grid2">
            <Button variant="confirm" size="card" disabled={action.busy} onClick={() => void action.run(`/driver/bookings/${b.id}/accept`)}>Принять</Button>
            <Button variant="outline" size="card" disabled={action.busy} onClick={() => void action.run(`/driver/bookings/${b.id}/decline`)}>Отказать</Button>
          </div>
        </div>
      ))}

      {nearest && (
        <button type="button" className="green green--row" onClick={() => go({ name: 'driverTrip', id: nearest.id })}>
          <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="small green__sub">{dateTime(nearest.departsAt)}</span>
            <span style={{ fontSize: 19, fontWeight: 600 }}>{nearest.route}</span>
            <span className="small green__label" style={{ fontWeight: 600 }}>
              занято {nearest.seatsTotal - nearest.seatsFree} из {nearest.seatsTotal} мест
            </span>
          </span>
          <Icon name="chevron" />
        </button>
      )}

      <div className="tiles">
        <MenuTile primary icon="plus" label="Выложить рейс" hint={data.last ? 'или повторить' : undefined}
          onClick={() => go({ name: 'postTrip', repeat: !!data.last })} />
        <MenuTile icon="list" label="Мои рейсы" onClick={() => go({ name: 'driverTrips' })} />
        <MenuTile icon="bell" label="Заявки" hint="в чате с ботом" count={data.openRequests} onClick={closeToBot} />
        <MenuTile icon="swap" label="Я пассажир" onClick={() => void toPassenger()} />
      </div>
    </Screen>
  );
}

export function DriverTripsScreen() {
  const { go, back } = useNav();
  const { data, error } = useLoad<DriverHome>('/driver/home', 20_000);
  if (!data) return error ? <Screen><ErrorNote>{errorText(error)}</ErrorNote></Screen> : <Loading />;
  return (
    <Screen>
      <PageHeader title="Мои рейсы" big onBack={back} />
      {data.trips.length === 0 && (
        <div className="loading">
          <Rosette size={72} />
          <p className="muted">Рейсов пока нет</p>
        </div>
      )}
      {data.trips.map((t) => (
        <button type="button" className="card card--row" key={t.id} onClick={() => go({ name: 'driverTrip', id: t.id })}>
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', fontSize: 17, fontWeight: 600 }}>{t.route}</span>
            <span className="small muted">{dateTime(t.departsAt)} · занято {t.seatsTotal - t.seatsFree} из {t.seatsTotal}</span>
            {t.status === 'departed' && <span className="small" style={{ display: 'block', fontWeight: 600 }}>В пути</span>}
          </span>
          <Icon name="chevron" />
        </button>
      ))}
      <div className="spacer" />
      <Button onClick={() => go({ name: 'postTrip', repeat: !!data.last })}>Выложить рейс</Button>
    </Screen>
  );
}

/** Рейс водителя: остановки по порядку объезда, «В навигатор», «Позвонить», статусы поездки. */
export function DriverTripScreen({ id }: { id: number }) {
  const { back } = useNav();
  const { data, error, reload } = useLoad<{ trip: Trip; bookings: Booking[] }>(`/driver/trips/${id}`, 15_000);
  const action = useAction(reload);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  if (done) {
    return (
      <Screen>
        <div className="loading">
          <Rosette size={88} />
          <h1 className="title">{done}</h1>
        </div>
        <Button onClick={back}>Готово</Button>
      </Screen>
    );
  }
  if (!data) return error ? <Screen><PageHeader title="Рейс" onBack={back} /><ErrorNote>{errorText(error)}</ErrorNote></Screen> : <Loading />;
  const { trip, bookings } = data;
  const published = trip.status === 'published';
  const firstWaiting = bookings.find((b) => b.status === 'accepted' || b.status === 'confirmed');

  return (
    <Screen>
      <PageHeader title={trip.route} sub={`${dateTime(trip.departsAt)} · порядок объезда`} onBack={back} />
      {action.error && <ErrorNote>{errorText(action.error)}</ErrorNote>}
      {bookings.length === 0 && <div className="card"><p className="muted">Пока никто не забронировал. Свободно {seats(trip.seatsFree)}.</p></div>}

      <div className="stack">
        {bookings.map((b, i) => {
          const waiting = b.status === 'accepted' || b.status === 'confirmed';
          const name = b.source === 'phone' && !b.passengerName ? 'По телефону' : (b.passengerName ?? 'Пассажир');
          const where = b.pickupPoint ?? b.from?.address;
          return (
            <div className={`stop${b.id === firstWaiting?.id ? ' stop--next' : ''}`} key={b.id}>
              <div className="stop__num">{b.status === 'picked_up' ? <Icon name="check" size={18} stroke={3} /> : i + 1}</div>
              <div className="stop__body">
                <div className="stop__title">{name}{where ? ` · ${where}` : ''} · {seats(b.seats)}</div>
                {b.passengerType !== 'adult' && !b.isSelf && (
                  <span style={{ alignSelf: 'flex-start' }}><Chip kind="teen">{b.passengerType === 'teen' ? 'Подросток 14–17' : 'Ребёнок до 14'}, едет один</Chip></span>
                )}
                {b.source !== 'phone' && (
                  <div className="small muted">
                    {[!b.isSelf && b.booker ? `Оформил: ${b.booker.name}` : '', BAGGAGE[b.baggage], b.baggageNote, b.comment ? `«${b.comment}»` : '']
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                )}
                {b.status === 'pending' && <div className="small" style={{ fontWeight: 600 }}>Ждёт вашего ответа</div>}
                {b.prepayRequired && !b.prepayReceived && waiting && <div className="small" style={{ fontWeight: 600 }}>Ждём предоплату за багаж</div>}
                <div className="stop__actions">
                  {b.status === 'pending' && (
                    <>
                      <Button size="small" variant="confirm" disabled={action.busy} onClick={() => void action.run(`/driver/bookings/${b.id}/accept`)}>Принять</Button>
                      <Button size="small" variant="outline" disabled={action.busy} onClick={() => void action.run(`/driver/bookings/${b.id}/decline`)}>Отказать</Button>
                    </>
                  )}
                  {waiting && b.from && <Button size="small" variant="confirm" href={mapsUrl(b.from)}>В навигатор</Button>}
                  {b.status === 'picked_up' && b.to && <Button size="small" variant="confirm" href={mapsUrl(b.to)}>В навигатор</Button>}
                  {(waiting || b.status === 'picked_up') && b.passengerPhone && (
                    <Button size="small" variant="outline" href={`tel:${b.passengerPhone}`}>Позвонить · {phone(b.passengerPhone)}</Button>
                  )}
                </div>
                {waiting && b.source !== 'phone' && (
                  <div className="stop__actions">
                    {[5, 10, 15, 30].map((m) => (
                      <Button key={m} size="small" variant="outline" disabled={action.busy} onClick={() => void action.run(`/driver/bookings/${b.id}/eta`, { minutes: m })}>
                        Буду через {m}
                      </Button>
                    ))}
                  </div>
                )}
                {waiting && b.source !== 'phone' && (
                  <div className="stop__actions">
                    <Button size="small" variant="primary" disabled={action.busy} onClick={() => void action.run(`/driver/bookings/${b.id}/pickup`)}>Забрал</Button>
                    {b.prepayRequired && !b.prepayReceived && (
                      <Button size="small" variant="outline" disabled={action.busy} onClick={() => void action.run(`/driver/bookings/${b.id}/prepaid`)}>Предоплата получена</Button>
                    )}
                    <Button size="small" variant="outline" disabled={action.busy} onClick={() => void action.run(`/driver/bookings/${b.id}/noshow`)}>Не пришёл</Button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="spacer" />
      {confirmCancel ? (
        <div className="card card--attention">
          <p><b>Отменить рейс?</b></p>
          <p className="small muted">Все пассажиры получат сообщение об отмене.</p>
          <div className="grid2">
            <Button variant="outline" size="card" disabled={action.busy}
              onClick={async () => { if (await action.run(`/driver/trips/${id}/cancel`)) setDone('Рейс отменён'); }}>Да, отменить</Button>
            <Button variant="confirm" size="card" onClick={() => setConfirmCancel(false)}>Оставить</Button>
          </div>
        </div>
      ) : (
        <div className="stack">
          {published && <Button disabled={action.busy} onClick={() => void action.run(`/driver/trips/${id}/depart`)}>Выехал</Button>}
          {trip.status === 'departed' && (
            <Button variant="confirm" icon="check" disabled={action.busy}
              onClick={async () => { if (await action.run(`/driver/trips/${id}/complete`)) setDone('Рейс завершён. Спасибо за поездку!'); }}>Доехали</Button>
          )}
          {published && <Button variant="outline" size="card" onClick={() => setConfirmCancel(true)}>Отменить рейс</Button>}
        </div>
      )}
    </Screen>
  );
}

const PICKUP: { mode: PickupMode; label: string }[] = [
  { mode: 'door', label: 'От дома до дома' },
  { mode: 'points', label: 'Из своих точек' },
  { mode: 'mixed', label: 'Смешанно' },
];
const TRUNKS: { trunk: Trunk; label: string }[] = [
  { trunk: 'free', label: 'Свободен' },
  { trunk: 'half', label: 'Наполовину' },
  { trunk: 'full', label: 'Почти занят' },
];

/** Выложить рейс одним экраном. С «Повторить прошлый» всё уже заполнено — остаётся выбрать день. */
export function PostTripScreen({ repeat }: { repeat?: boolean }) {
  const { back, reset } = useNav();
  const { data, error } = useLoad<DriverHome>('/driver/home');
  const last = repeat ? data?.last : null;
  const [f, setF] = useState<{
    route: number; day: string; time: string; pickupMode: PickupMode; points: string; villages: boolean; villagesNote: string;
    seats: number; trunk: Trunk; price: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [posted, setPosted] = useState<{ trip: Trip; waitingRequests: number } | null>(null);

  if (!data) return error ? <Screen><ErrorNote>{errorText(error)}</ErrorNote></Screen> : <Loading />;
  if (data.driver.status !== 'approved') {
    return (
      <Screen>
        <PageHeader title="Выложить рейс" big onBack={back} />
        <div className="notice notice--gold">{DRIVER_STATUS[data.driver.status]}</div>
      </Screen>
    );
  }

  // Начальные значения: из прошлого рейса или пустая форма.
  const form = f ?? {
    route: Math.max(0, data.routes.findIndex((r) => last && r.directionId === last.directionId && r.fromSide === last.fromSide)),
    day: data.days[0]?.day ?? '',
    time: last ? time(last.departsAt) : '',
    pickupMode: last?.pickupMode ?? 'door',
    points: last?.pickupPoints.join(', ') ?? '',
    villages: last?.villages ?? false,
    villagesNote: last?.villagesNote ?? '',
    seats: Math.min(last?.seatsTotal ?? Math.min(3, data.driver.seats), data.driver.seats),
    trunk: last?.trunk ?? 'free',
    price: last ? String(last.price) : '',
  };
  const set = (p: Partial<typeof form>) => { setF({ ...form, ...p }); setProblem(null); };

  if (posted) {
    return (
      <Screen>
        <div className="green">
          <div className="green__pad">
            <div className="label-caps green__label">Рейс выложен</div>
            <div className="green__title">{posted.trip.route}</div>
            <div className="green__sub">{dateTime(posted.trip.departsAt)} · {seats(posted.trip.seatsTotal)} · {money(posted.trip.price)}</div>
          </div>
          <TulipBand height={28} background="#174A36" />
        </div>
        <p className="muted">Пассажиры уже видят рейс в поиске. Новые брони придут сюда и в чат.</p>
        {posted.waitingRequests > 0 && <div className="notice notice--gold">На этот день есть заявки пассажиров: {posted.waitingRequests}. Они в чате с ботом — «Заявки».</div>}
        <div className="spacer" />
        <Button onClick={() => reset()}>Готово</Button>
      </Screen>
    );
  }

  const minutes = parseTime(form.time);
  const price = Number(form.price.replace(/\D/g, ''));
  const route = data.routes[form.route];
  const pointsOk = form.pickupMode === 'door' || form.points.trim().length > 0;
  const ready = !!route && minutes !== null && price >= data.priceMin && price <= data.priceMax && pointsOk;

  const publish = async () => {
    if (!route || minutes === null) return;
    setBusy(true);
    try {
      const res = await api<{ trip: Trip; waitingRequests: number }>('/driver/trips', {
        directionId: route.directionId, fromSide: route.fromSide, day: form.day, minutes,
        pickupMode: form.pickupMode, pickupPoints: form.points, villages: form.villages, villagesNote: form.villagesNote || null,
        seats: form.seats, trunk: form.trunk, price,
      });
      haptic('success');
      setPosted(res);
    } catch (e) {
      haptic('error');
      const code = e instanceof ApiError ? e.code : 'network';
      setProblem(TRIP_ERRORS[code] ?? errorText(code));
    } finally {
      setBusy(false);
    }
  };

  const seg = <T extends string | number | boolean>(items: { value: T; label: string }[], value: T, onPick: (v: T) => void) => (
    <div className="seg">
      {items.map((it) => (
        <button type="button" className="seg__item" key={String(it.value)} aria-pressed={it.value === value} onClick={() => onPick(it.value)}>{it.label}</button>
      ))}
    </div>
  );

  return (
    <Screen>
      <PageHeader title={last ? 'Повторить рейс' : 'Выложить рейс'} big onBack={back} />
      <div className="field"><span className="field__label">Куда едете</span>
        {seg(data.routes.map((r, i) => ({ value: i, label: r.label })), form.route, (v) => set({ route: v }))}</div>
      <div className="field"><span className="field__label">День</span>
        {seg(data.days.map((d) => ({ value: d.day, label: d.label })), form.day, (v) => set({ day: v }))}</div>
      <label className="field"><span className="field__label">Время выезда, например 17:00</span>
        <input className="input" inputMode="numeric" maxLength={5} placeholder="17:00" value={form.time} onChange={(e) => set({ time: e.target.value })} /></label>
      <div className="field"><span className="field__label">Как забираете</span>
        {seg(PICKUP.map((p) => ({ value: p.mode, label: p.label })), form.pickupMode, (v) => set({ pickupMode: v }))}</div>
      {form.pickupMode !== 'door' && (
        <label className="field"><span className="field__label">Точки сбора через запятую, до пяти</span>
          <input className="input" maxLength={300} placeholder="ТЦ Мега, Горки, Автовокзал" value={form.points} onChange={(e) => set({ points: e.target.value })} /></label>
      )}
      <div className="field"><span className="field__label">Заезжаете в деревни (доплата по договорённости)</span>
        {seg([{ value: true, label: 'Да' }, { value: false, label: 'Нет' }], form.villages, (v) => set({ villages: v }))}</div>
      {form.villages && (
        <label className="field"><span className="field__label">В какие — не обязательно</span>
          <input className="input" maxLength={120} value={form.villagesNote} onChange={(e) => set({ villagesNote: e.target.value })} /></label>
      )}
      <div className="field"><span className="field__label">Свободных мест</span>
        {seg(Array.from({ length: data.driver.seats }, (_, i) => ({ value: i + 1, label: String(i + 1) })), form.seats, (v) => set({ seats: v }))}</div>
      <div className="field"><span className="field__label">Багажник</span>
        {seg(TRUNKS.map((t) => ({ value: t.trunk, label: t.label })), form.trunk, (v) => set({ trunk: v }))}</div>
      <label className="field"><span className="field__label">Цена за место, ₽ (от {data.priceMin} до {data.priceMax})</span>
        <input className="input" inputMode="numeric" maxLength={5} placeholder="500" value={form.price} onChange={(e) => set({ price: e.target.value })} /></label>
      {problem && <ErrorNote>{problem}</ErrorNote>}
      <div className="spacer" />
      <Button disabled={!ready || busy} onClick={() => void publish()}>Выложить</Button>
    </Screen>
  );
}
