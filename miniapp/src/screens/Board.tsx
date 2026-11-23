import { useState } from 'react';
import { Button, Chip, ErrorNote, Loading, PageHeader, Screen, TripCard } from '../components';
import { BAGGAGE, minutesLabel, seats } from '../format';
import { errorText, useLoad, useNav } from '../nav';
import { Rosette } from '../Ornaments';
import { haptic, openBot } from '../tg';
import type { BoardData, PublicRequest, TimeKind, Trip } from '../types';

type Tab = 'trips' | 'requests';

const WHEN: Record<Exclude<TimeKind, 'exact'>, string> = { morning: 'Утром', day: 'Днём', evening: 'Вечером' };
const when = (r: PublicRequest) => (r.timeKind === 'exact' ? `В ${minutesLabel(r.exactMinutes ?? 0)}` : WHEN[r.timeKind]);
const place = (city: string, village: boolean) => (village ? `${city} (деревня)` : city);

/**
 * Доска: все открытые рейсы водителей и заявки пассажиров на выбранный день и направление.
 * Заявки — без имени, телефона и адреса: их видит только водитель, который взял заявку.
 */
export function Board(props: { initialRoute?: string; initialDay?: string; initialTab?: Tab }) {
  const nav = useNav();
  const [tab, setTab] = useState<Tab>(props.initialTab ?? 'trips');
  const [route, setRoute] = useState(props.initialRoute ?? '');
  const [day, setDay] = useState(props.initialDay ?? '');
  const query = new URLSearchParams({ ...(route && { route }), ...(day && { day }) }).toString();
  // Тихо обновляем раз в 30 секунд: рейсы и заявки появляются без участия человека.
  const { data, error, reload } = useLoad<BoardData>(`/board${query ? `?${query}` : ''}`, 30_000);

  if (!data && !error) return <Loading />;
  const me = nav.me;
  const isDriver = me.driver?.status === 'approved';
  const routeKey = (r: { directionId: number; fromSide: string }) => `${r.directionId}-${r.fromSide}`;
  const current = data?.route ? routeKey(data.route) : '';
  const dayIndex = data ? data.days.findIndex((d) => d.day === data.day) : -1;
  const dayLabel = data?.days[dayIndex]?.label ?? '';

  const pick = (fn: () => void) => {
    haptic();
    fn();
  };
  const book = (trip: Trip) => nav.go({ name: 'search', trip });
  // Заявка сразу на это направление и день: остаётся спросить время и адреса.
  const requestHere = () => {
    if (!data?.route) return;
    nav.go({ name: 'search', request: { directionId: data.route.directionId, fromSide: data.route.fromSide, day: data.day, dayLabel } });
  };

  return (
    <Screen>
      <PageHeader title="Доска" sub={data?.route ? `${data.route.label} · ${dayLabel}` : undefined} onBack={nav.back} big />
      {error && <ErrorNote>{errorText(error)}</ErrorNote>}

      {data && (
        <>
          <div className="segmented" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'trips'} className="segmented__item" onClick={() => pick(() => setTab('trips'))}>
              Рейсы <span className="segmented__count">{data.trips.length}</span>
            </button>
            <button type="button" role="tab" aria-selected={tab === 'requests'} className="segmented__item" onClick={() => pick(() => setTab('requests'))}>
              Ищут попутку <span className="segmented__count">{data.requests.length}</span>
            </button>
          </div>

          {data.routes.length > 1 && (
            <div className="scroller" aria-label="Направление">
              {data.routes.map((r) => (
                <button key={routeKey(r)} type="button" className="pill" aria-pressed={routeKey(r) === current} onClick={() => pick(() => setRoute(routeKey(r)))}>
                  {r.label}
                </button>
              ))}
            </div>
          )}

          <div className="scroller" aria-label="День">
            {data.days.map((d) => (
              <button key={d.day} type="button" className="pill" aria-pressed={d.day === data.day} onClick={() => pick(() => setDay(d.day))}>
                {d.label}
              </button>
            ))}
          </div>

          {tab === 'trips' && (
            <>
              {data.trips.map((t, i) =>
                t.driverId === me.user!.id ? (
                  <button key={t.id} type="button" className="card card--row" onClick={() => nav.go({ name: 'driverTrip', id: t.id })}>
                    <span style={{ flex: 1 }}>
                      <span style={{ display: 'block', fontSize: 17, fontWeight: 700 }}>Ваш рейс · {t.route}</span>
                      <span className="small muted">свободно {seats(t.seatsFree)}</span>
                    </span>
                  </button>
                ) : (
                  <TripCard key={t.id} trip={t} first={i === 0} village={false} needChildSeat={false} onPick={() => book(t)} />
                ),
              )}
              {data.trips.length === 0 && (
                <div className="loading">
                  <Rosette size={64} />
                  <p><b>На этот день рейсов пока нет</b></p>
                  <p className="muted">Оставьте заявку — её увидят все водители направления.</p>
                </div>
              )}
              <div className="spacer" />
              {data.trips.length === 0 ? (
                <Button onClick={requestHere}>Оставить заявку</Button>
              ) : (
                <button type="button" className="btn btn--dashed" onClick={requestHere}>Не подошло? Оставить заявку</button>
              )}
            </>
          )}

          {tab === 'requests' && (
            <>
              {data.requests.map((r) => (
                <div className="card" key={r.id}>
                  <div className="trip__top">
                    <div className="trip__time" style={{ fontSize: 24 }}>{when(r)}</div>
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 700 }}>{place(r.fromCity, r.fromVillage)} → {place(r.toCity, r.toVillage)}</div>
                  <div className="chips">
                    <Chip>{seats(r.seats)}</Chip>
                    <Chip>{BAGGAGE[r.baggage]}</Chip>
                    {r.childSeat !== 'none' && <Chip kind="gold">{r.childSeat === 'driver' ? 'нужно детское кресло' : 'ребёнок, кресло своё'}</Chip>}
                  </div>
                  {isDriver && (
                    <Button size="card" variant="outline-green" onClick={() => openBot(me.botUsername, `b_r_${Math.max(0, data.routes.findIndex((x) => routeKey(x) === current))}_${data.day}`)}>
                      Взять — в чате с ботом
                    </Button>
                  )}
                </div>
              ))}
              {data.requests.length === 0 && (
                <div className="loading">
                  <Rosette size={64} />
                  <p className="muted">На этот день заявок нет</p>
                </div>
              )}
              <p className="small muted">Имена, телефоны и адреса пассажиров видит только водитель, который взял заявку.</p>
            </>
          )}

          <button type="button" className="btn btn--link" onClick={() => void reload()}>Обновить</button>
        </>
      )}
    </Screen>
  );
}
