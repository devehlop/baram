import { api } from '../api';
import { Button, ErrorNote, Icon, Loading, MenuTile, PageHeader, Screen } from '../components';
import { dateTime, dayLong, minutesLabel, phone, STATUS, time } from '../format';
import { errorText, useLoad, useNav } from '../nav';
import { ChuvashBand, Logo, Rosette, TulipBand } from '../Ornaments';
import { closeToBot } from '../tg';
import type { Booking, FormData, RideRequest, TimeKind, Trip } from '../types';

/** Первый запуск: человек ещё не зарегистрирован. Имя и телефон принимает бот — номер там не подделать. */
export function Onboarding() {
  return (
    <div className="screen">
      <div className="welcome">
        <Logo size={52} wordColor="#FFFFFF" />
        <div className="welcome__hi">Сәлам! Салам!</div>
        <div className="welcome__band"><TulipBand height={72} /></div>
      </div>
      <ChuvashBand height={24} />
      <div className="screen__body">
        <h1 className="title">Попутчики Буинск ⇄ Казань</h1>
        <p>Чтобы начать, зарегистрируйтесь в чате с ботом: имя и номер телефона. Это одна минута.</p>
        <div className="spacer" />
        <Button onClick={closeToBot}>Перейти в чат с ботом</Button>
      </div>
    </div>
  );
}

const TIME_LABEL: Record<TimeKind, string> = { morning: 'утром', day: 'днём', evening: 'вечером', exact: '' };

export function requestWhen(r: RideRequest): string {
  const when = r.timeKind === 'exact' ? `в ${minutesLabel(r.exactMinutes ?? 0)}` : TIME_LABEL[r.timeKind];
  return `${dayLong(`${r.day}T09:00:00Z`)}, ${when}`;
}

export function Home() {
  const { me, go, reloadMe } = useNav();
  const form = useLoad<FormData>('/form');
  const mine = useLoad<{ upcoming: { booking: Booking; trip: Trip | null }[] }>('/bookings', 20_000);
  const last = form.data?.lastBooking;
  const next = mine.data?.upcoming[0];

  const toDriver = async () => {
    await api('/role', { role: 'driver' });
    await reloadMe();
  };

  return (
    <Screen top={<ChuvashBand height={20} inverse />}>
      <div className="hello">
        <div>
          <div className="hello__hi">Исәнмесез,</div>
          <div className="hello__name">{me.user!.name}</div>
        </div>
        <div className="logo-square" aria-hidden="true">
          <span style={{ color: '#FFFFFF', display: 'flex' }}><Icon name="arrow" size={28} stroke={2.6} /></span>
        </div>
      </div>

      {last?.from && last.to && (
        <div className="green">
          <div className="green__pad">
            <div className="label-caps green__label">Повторить поездку</div>
            <div className="green__title">{last.from.city} → {last.to.city}</div>
            <div className="green__sub">{last.from.address} → {last.to.address}</div>
            <Button variant="gold" size="card" onClick={() => go({ name: 'search', repeat: true })}>Показать рейсы</Button>
          </div>
          <TulipBand height={28} background="#174A36" />
        </div>
      )}

      <div className="tiles">
        <MenuTile primary icon="car" label="Найти поездку" onClick={() => go({ name: 'search' })} />
        <MenuTile icon="calendar" label="Мои поездки" onClick={() => go({ name: 'trips' })} />
        <MenuTile icon="phone" label="Помощь" onClick={() => go({ name: 'help' })} />
        {me.driver ? (
          <MenuTile icon="swap" label="Меню водителя" onClick={() => void toDriver()} />
        ) : (
          <MenuTile icon="user" label="Я водитель" hint="анкета — в чате" onClick={closeToBot} />
        )}
      </div>

      {next?.trip && (
        <button type="button" className="card card--row" onClick={() => go({ name: 'booking', id: next.booking.id })}>
          <Rosette size={22} color="#1E5E45" />
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', fontSize: 16, fontWeight: 700 }}>{dateTime(next.trip.departsAt)} · {next.trip.fromCity}</span>
            <span className="small muted">{next.trip.driver.name} · {next.trip.driver.car} · {STATUS[next.booking.status].toLowerCase()}</span>
          </span>
          <Icon name="chevron" />
        </button>
      )}
    </Screen>
  );
}

export function MyTrips() {
  const { go, back } = useNav();
  const { data, error } = useLoad<{
    upcoming: { booking: Booking; trip: Trip | null }[];
    past: { booking: Booking; trip: Trip | null }[];
    requests: RideRequest[];
  }>('/bookings', 20_000);
  if (!data && !error) return <Loading />;

  const item = (x: { booking: Booking; trip: Trip | null }) =>
    x.trip && (
      <button type="button" className="card card--row" key={x.booking.id} onClick={() => go({ name: 'booking', id: x.booking.id })}>
        <span style={{ flex: 1 }}>
          <span style={{ display: 'block', fontSize: 17, fontWeight: 700 }}>{x.trip.route}</span>
          <span className="small muted">
            {dayLong(x.trip.departsAt)}, {time(x.trip.departsAt)}
            {x.booking.isSelf ? '' : ` · едет ${x.booking.passengerName}`}
          </span>
          <span className="small" style={{ display: 'block', fontWeight: 600 }}>{STATUS[x.booking.status]}</span>
        </span>
        <Icon name="chevron" />
      </button>
    );

  const empty = data && data.upcoming.length + data.past.length + data.requests.length === 0;
  return (
    <Screen>
      <PageHeader title="Мои поездки" big onBack={back} />
      {error && <ErrorNote>{errorText(error)}</ErrorNote>}
      {empty && (
        <div className="loading">
          <Rosette size={72} />
          <p className="muted">Поездок пока нет</p>
        </div>
      )}
      {!!data?.upcoming.length && <div className="label-caps muted">Предстоящие</div>}
      {data?.upcoming.map(item)}
      {!!data?.requests.length && <div className="label-caps muted">Заявки ждут водителя</div>}
      {data?.requests.map((r) => (
        <div className="card" key={r.id}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{r.route}</div>
          <div className="small muted">{requestWhen(r)}</div>
        </div>
      ))}
      {!!data?.past.length && <div className="label-caps muted">Прошлые</div>}
      {data?.past.map(item)}
      <div className="spacer" />
      <Button onClick={() => go({ name: 'search' })}>Найти поездку</Button>
    </Screen>
  );
}

export function Help() {
  const { me, back } = useNav();
  return (
    <Screen>
      <PageHeader title="Помощь" big onBack={back} />
      <div className="card">
        <p><b>Как это работает</b></p>
        <p>Находите рейс и бронируете место. Водитель подтверждает — вы получаете его телефон и номер машины.</p>
        <p>Оплата — водителю: наличными или переводом. Через «Барам» деньги не проходят.</p>
        <p>Отмена больше чем за {me.lateCancelHours ?? 4} ч до выезда — свободная. Позже — «поздняя отмена», она остаётся в истории.</p>
      </div>
      <div className="notice notice--gold">
        <b>Осторожно, мошенники</b><br />
        Предоплату за крупный багаж переводите только на номер из карточки водителя. Водитель и админ не просят перевести на другой номер.
      </div>
      <div className="spacer" />
      {me.dispatcherPhone && <Button icon="phone" href={`tel:${me.dispatcherPhone}`}>Позвонить диспетчеру · {phone(me.dispatcherPhone)}</Button>}
      <Button variant="outline" onClick={closeToBot}>Пожаловаться — в чате с ботом</Button>
    </Screen>
  );
}
