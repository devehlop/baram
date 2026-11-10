import { useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from '../api';
import { Button, ErrorNote, Loading, OptionCard, PageHeader, Screen, StepHeader, SummaryRows, TripCard, type IconName } from '../components';
import { BAGGAGE, car, dateTime, dayLong, minutesLabel, money, parseTime, phone as fmtPhone, seats as seatsLabel } from '../format';
import { errorText, useLoad, useNav } from '../nav';
import { Rosette, TulipBand } from '../Ornaments';
import { haptic } from '../tg';
import type { Baggage, Booking, ChildSeat, FormData, Locality, PassengerType, Side, TimeKind, Trip } from '../types';

type StepId =
  | 'who' | 'whoOther'
  | 'from' | 'fromVillage' | 'fromAddr'
  | 'to' | 'toVillage' | 'toAddr'
  | 'day' | 'time' | 'exact'
  | 'seats' | 'child'
  | 'baggage' | 'baggageNote'
  | 'comment'
  | 'results' | 'point' | 'summary' | 'fix' | 'requestDone';

/** Номер вопроса для шапки «Шаг N из 7». */
const STEP_NO: Partial<Record<StepId, number>> = {
  who: 1, whoOther: 1,
  from: 2, fromVillage: 2, fromAddr: 2,
  to: 3, toVillage: 3, toAddr: 3,
  day: 4, time: 4, exact: 4,
  seats: 5, child: 5,
  baggage: 6, baggageNote: 6,
  comment: 7,
};
const TOTAL = 7;

/** Порядок вопросов. После каждого — следующий; в режиме «Исправить» — сразу к рейсам. */
const ORDER: StepId[] = ['who', 'from', 'to', 'day', 'seats', 'baggage', 'comment', 'results'];

interface Addr {
  localityId: number;
  directionId: number;
  side: Side;
  city: string;
  village: boolean;
  address: string;
}

interface Draft {
  /** null — едет сам заказчик. */
  passenger: { name: string; phone: string; type: PassengerType } | null;
  from?: Addr;
  to?: Addr;
  /** Город или деревня, выбранные до ввода адреса. */
  pending?: Locality;
  day?: string;
  dayLabel?: string;
  timeKind?: TimeKind;
  exactMinutes?: number | null;
  seats?: number;
  childSeat?: ChildSeat;
  baggage?: Baggage;
  baggageNote?: string;
  comment?: string;
  trip?: Trip;
  pickupPoint?: string | null;
}

const TIME_OPTIONS: { kind: TimeKind; title: string; sub?: string; icon: IconName }[] = [
  { kind: 'morning', title: 'Утром', sub: 'до 12:00', icon: 'sunrise' },
  { kind: 'day', title: 'Днём', sub: 'с 12:00 до 17:00', icon: 'sun' },
  { kind: 'evening', title: 'Вечером', sub: 'после 17:00', icon: 'moon' },
  { kind: 'exact', title: 'Точное время', icon: 'clock' },
];
const TIME_SHORT: Record<TimeKind, string> = { morning: 'утро', day: 'день', evening: 'вечер', exact: '' };

const P_TYPES: { type: PassengerType; label: string }[] = [
  { type: 'adult', label: 'Взрослый' },
  { type: 'teen', label: 'Подросток 14–17' },
  { type: 'child', label: 'Ребёнок до 14' },
];

export function SearchFlow({ repeat }: { repeat?: boolean }) {
  const nav = useNav();
  const form = useLoad<FormData>('/form');
  const [step, setStep] = useState<StepId>('who');
  const [history, setHistory] = useState<StepId[]>([]);
  const [fixing, setFixing] = useState(false);
  const [draft, setDraft] = useState<Draft>({ passenger: null });
  const [started, setStarted] = useState(false);
  const [found, setFound] = useState<{ exact: Trip[]; near: Trip[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Поля ввода текущего шага.
  const [text, setText] = useState('');
  const [other, setOther] = useState({ name: '', phone: '', type: 'adult' as PassengerType });

  const data = form.data;

  // «Повторить поездку»: адреса, пассажир и багаж — из прошлой брони, спрашиваем только день и время.
  useEffect(() => {
    if (!data || started) return;
    setStarted(true);
    const b = repeat ? data.lastBooking : null;
    if (!b?.from || !b.to) return;
    const addr = (p: NonNullable<Booking['from']>): Addr | undefined => {
      const l = data.localities.find((x) => x.id === p.localityId);
      return l && { localityId: l.id, directionId: l.directionId, side: l.side, city: l.name, village: l.kind === 'village', address: p.address };
    };
    const [from, to] = [addr(b.from), addr(b.to)];
    if (!from || !to) return;
    setDraft({
      passenger: b.isSelf || !b.passengerName || !b.passengerPhone ? null : { name: b.passengerName, phone: b.passengerPhone, type: b.passengerType },
      from,
      to,
      seats: b.seats,
      childSeat: b.childSeat,
      baggage: b.baggage,
      baggageNote: b.baggageNote ?? undefined,
      comment: b.comment ?? undefined,
    });
    setFixing(true);
    setStep('day');
  }, [data, repeat, started]);

  const goto = (next: StepId) => {
    setHistory((h) => [...h, step]);
    setError(null);
    setText('');
    setStep(next);
    haptic();
  };

  const stepBack = () => {
    setError(null);
    setText('');
    const prev = history[history.length - 1];
    if (!prev) return nav.back();
    setHistory((h) => h.slice(0, -1));
    setStep(prev);
  };

  /** Вопрос отвечен: к следующему, а после «Исправить» — сразу к списку рейсов. */
  const done = (question: StepId) => {
    if (fixing) {
      setFixing(false);
      return goto('results');
    }
    goto(ORDER[ORDER.indexOf(question) + 1] ?? 'results');
  };

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  // ——— Поиск рейсов при входе на экран результатов ———
  const searchKey = step === 'results' ? JSON.stringify([draft.from?.localityId, draft.to?.localityId, draft.day, draft.timeKind, draft.exactMinutes, draft.seats, draft.childSeat]) : '';
  useEffect(() => {
    if (!searchKey || !draft.from || !draft.to) return;
    let alive = true;
    setFound(null);
    setError(null);
    api<{ exact: Trip[]; near: Trip[] }>('/search', {
      fromLocalityId: draft.from.localityId,
      toLocalityId: draft.to.localityId,
      day: draft.day,
      timeKind: draft.timeKind,
      exactMinutes: draft.exactMinutes ?? null,
      seats: draft.seats,
      needChildSeat: draft.childSeat === 'driver',
    })
      .then((res) => alive && setFound(res))
      .catch((e) => alive && setError(e instanceof ApiError ? e.code : 'network'));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKey]);

  if (!data) return form.error ? <Screen><ErrorNote>{errorText(form.error)}</ErrorNote></Screen> : <Loading />;

  // ——— Места: что доступно для «откуда» и «куда» ———
  const reachable = (l: { directionId: number; side: Side }) => {
    const f = draft.from;
    if (!f) return true;
    const starts = f.village ? [f] : data.localities.filter((x) => x.kind === 'city' && x.name === f.city);
    return starts.some((s) => s.directionId === l.directionId && s.side !== l.side);
  };

  const rideBody = () => ({
    passenger: draft.passenger,
    from: { localityId: draft.from!.localityId, address: draft.from!.address },
    to: { localityId: draft.to!.localityId, address: draft.to!.address },
    seats: draft.seats,
    childSeat: draft.childSeat,
    baggage: draft.baggage,
    baggageNote: draft.baggageNote || null,
    comment: draft.comment || null,
  });

  const submit = async (kind: 'booking' | 'request') => {
    setBusy(true);
    setError(null);
    try {
      if (kind === 'booking') {
        const res = await api<{ booking: Booking }>('/bookings', { ...rideBody(), tripId: draft.trip!.id, pickupPoint: draft.pickupPoint ?? null });
        haptic('success');
        nav.reset({ name: 'booking', id: res.booking.id });
      } else {
        await api('/requests', { ...rideBody(), day: draft.day, timeKind: draft.timeKind, exactMinutes: draft.exactMinutes ?? null });
        haptic('success');
        goto('requestDone');
      }
    } catch (e) {
      haptic('error');
      setError(e instanceof ApiError ? e.code : 'network');
    } finally {
      setBusy(false);
    }
  };

  const stepNo = STEP_NO[step];
  const frame = (question: string, body: ReactNode, note?: string) => (
    <Screen steps>
      <StepHeader step={stepNo ?? TOTAL} total={TOTAL} onBack={stepBack} onHome={() => nav.reset()} />
      <h1 className="h1">{question}</h1>
      {note && <p className="muted">{note}</p>}
      {body}
      {error && <ErrorNote>{errorText(error)}</ErrorNote>}
    </Screen>
  );

  // ——— Вопрос «Откуда» / «Куда» ———
  const placeStep = (which: 'from' | 'to') => {
    const isTo = which === 'to';
    const fits = (l: { directionId: number; side: Side }) => !isTo || reachable(l);
    const saved = data.addresses.filter(fits);
    const cities = [...new Set(data.localities.filter((l) => l.kind === 'city' && fits(l)).map((l) => l.name))];
    const hasVillages = data.localities.some((l) => l.kind === 'village' && fits(l));
    const current = draft[which];
    const pick = (a: Addr) => {
      // Если «откуда» изменили и прежнее «куда» больше не подходит — спросим «куда» заново.
      if (!isTo && draft.to && !(a.directionId === draft.to.directionId && a.side !== draft.to.side)) {
        patch({ from: a, to: undefined });
        setFixing(false);
        return goto('to');
      }
      patch({ [which]: a });
      done(which);
    };
    return frame(
      isTo ? 'Куда едете?' : 'Откуда едете?',
      <div className="stack">
        {saved.map((a) => (
          <OptionCard key={`s${a.id}`} icon="home" title={a.label} sub={`${a.city}, ${a.address}`}
            selected={current?.localityId === a.localityId && current.address === a.address}
            onClick={() => pick({ localityId: a.localityId, directionId: a.directionId, side: a.side, city: a.city, village: a.village, address: a.address })} />
        ))}
        {cities.map((name) => (
          <OptionCard key={name} icon="pin" title={name} sub="Ввести улицу и дом" onClick={() => {
            patch({ pending: data.localities.find((l) => l.kind === 'city' && l.name === name && fits(l)) });
            goto(isTo ? 'toAddr' : 'fromAddr');
          }} />
        ))}
        {hasVillages && <OptionCard icon="tree" title="Деревня или село" onClick={() => goto(isTo ? 'toVillage' : 'fromVillage')} />}
      </div>,
    );
  };

  const villageStep = (which: 'from' | 'to') => {
    const isTo = which === 'to';
    const villages = data.localities.filter((l) => l.kind === 'village' && (!isTo || reachable(l)));
    return frame(
      'Какая деревня?',
      <>
        <div className="stack">
          {villages.map((l) => (
            <OptionCard key={l.id} icon="tree" title={l.name} onClick={() => {
              patch({ pending: l });
              goto(isTo ? 'toAddr' : 'fromAddr');
            }} />
          ))}
        </div>
        <div className="notice notice--gold">Нет вашей деревни? Напишите диспетчеру — добавим.</div>
      </>,
    );
  };

  const addressStep = (which: 'from' | 'to') => {
    const l = draft.pending;
    if (!l) return placeStep(which);
    const ok = text.trim().length >= 3;
    const save = () => {
      const a: Addr = { localityId: l.id, directionId: l.directionId, side: l.side, city: l.name, village: l.kind === 'village', address: text.trim() };
      if (which === 'from' && draft.to && !(a.directionId === draft.to.directionId && a.side !== draft.to.side)) {
        patch({ from: a, to: undefined, pending: undefined });
        setFixing(false);
        return goto('to');
      }
      patch({ [which]: a, pending: undefined });
      done(which);
    };
    return frame(
      `${l.name}: улица и дом`,
      <>
        <label className="field">
          <span className="field__label">Адрес</span>
          <input className="input" autoFocus value={text} maxLength={120} placeholder="ул. Ленина, 12" onChange={(e) => setText(e.target.value)} />
        </label>
        {l.kind === 'village' && (
          <div className="notice notice--gold"><b>За деревню может быть доплата</b><br />Уточните у водителя — он заедет к дому по договорённости.</div>
        )}
        <div className="spacer" />
        <Button disabled={!ok} onClick={save}>Дальше</Button>
      </>,
    );
  };

  switch (step) {
    case 'who':
      return frame(
        'Кто едет?',
        <div className="stack">
          <OptionCard icon="user" title="Я сам" sub={nav.me.user!.name} selected={draft.passenger === null && history.length > 0}
            onClick={() => { patch({ passenger: null }); done('who'); }} />
          {data.passengers.map((p) => (
            <OptionCard key={p.id} icon="users" title={p.name} sub={fmtPhone(p.phone)} selected={draft.passenger?.phone === p.phone}
              onClick={() => { patch({ passenger: { name: p.name, phone: p.phone, type: p.type } }); done('who'); }} />
          ))}
          <OptionCard icon="plus" title="Другой человек" sub="Мама, ребёнок, друг" onClick={() => goto('whoOther')} />
        </div>,
      );

    case 'whoOther': {
      const digits = other.phone.replace(/\D/g, '');
      const ok = other.name.trim().length >= 2 && digits.length >= 10;
      return frame(
        'Кто поедет?',
        <>
          <label className="field">
            <span className="field__label">Имя</span>
            <input className="input" autoFocus value={other.name} maxLength={40} placeholder="Гульнара" onChange={(e) => setOther({ ...other, name: e.target.value })} />
          </label>
          <label className="field">
            <span className="field__label">Телефон — водитель позвонит по нему</span>
            <input className="input" type="tel" inputMode="tel" value={other.phone} maxLength={20} placeholder="8 917 123-45-67" onChange={(e) => setOther({ ...other, phone: e.target.value })} />
          </label>
          <div className="field">
            <span className="field__label">Кто это</span>
            <div className="seg">
              {P_TYPES.map((t) => (
                <button type="button" key={t.type} className="seg__item" aria-pressed={other.type === t.type} onClick={() => setOther({ ...other, type: t.type })}>{t.label}</button>
              ))}
            </div>
          </div>
          <div className="spacer" />
          <Button disabled={!ok} onClick={() => { patch({ passenger: { name: other.name.trim(), phone: other.phone, type: other.type } }); done('who'); }}>Дальше</Button>
        </>,
      );
    }

    case 'from': return placeStep('from');
    case 'to': return placeStep('to');
    case 'fromVillage': return villageStep('from');
    case 'toVillage': return villageStep('to');
    case 'fromAddr': return addressStep('from');
    case 'toAddr': return addressStep('to');

    case 'day':
      return frame(
        'Когда едете?',
        <div className="grid2">
          {data.days.map((d) => (
            <button type="button" key={d.day} className="btn btn--outline btn--card" aria-pressed={draft.day === d.day}
              onClick={() => { patch({ day: d.day, dayLabel: d.label }); goto('time'); }}>
              {d.label}
            </button>
          ))}
        </div>,
      );

    case 'time':
      return frame(
        'В какое время?',
        <div className="stack">
          {TIME_OPTIONS.map((o) => (
            <OptionCard key={o.kind} icon={o.icon} title={o.title} sub={o.sub} selected={draft.timeKind === o.kind}
              onClick={() => {
                if (o.kind === 'exact') return goto('exact');
                patch({ timeKind: o.kind, exactMinutes: null });
                done('day');
              }} />
          ))}
        </div>,
      );

    case 'exact': {
      const minutes = parseTime(text);
      return frame(
        'Во сколько?',
        <>
          <label className="field">
            <span className="field__label">Время, например 17:00</span>
            <input className="input input--big" autoFocus inputMode="numeric" value={text} maxLength={5} placeholder="17:00" onChange={(e) => setText(e.target.value)} />
          </label>
          <div className="spacer" />
          <Button disabled={minutes === null} onClick={() => { patch({ timeKind: 'exact', exactMinutes: minutes }); done('day'); }}>Дальше</Button>
        </>,
      );
    }

    case 'seats':
      return frame(
        'Сколько вас?',
        <div className="grid2" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <button type="button" key={n} className="btn btn--outline" aria-pressed={draft.seats === n} aria-label={seatsLabel(n)}
              onClick={() => { patch({ seats: n }); goto('child'); }}>
              {n}
            </button>
          ))}
        </div>,
      );

    case 'child':
      return frame(
        'Едет ребёнок до 7 лет?',
        <div className="stack">
          <OptionCard icon="check" title="Нет" selected={draft.childSeat === 'none'} onClick={() => { patch({ childSeat: 'none' }); done('seats'); }} />
          <OptionCard icon="child" title="Да, кресло своё" sub="Возьму детское кресло с собой" selected={draft.childSeat === 'own'} onClick={() => { patch({ childSeat: 'own' }); done('seats'); }} />
          <OptionCard icon="child" title="Да, нужно кресло водителя" sub="Сначала покажем водителей с креслом" selected={draft.childSeat === 'driver'} onClick={() => { patch({ childSeat: 'driver' }); done('seats'); }} />
        </div>,
        'По правилам ребёнку до 7 лет нужно детское кресло.',
      );

    case 'baggage':
      return frame(
        'Сколько багажа?',
        <div className="stack">
          <OptionCard icon="bag" title="Только сумка или рюкзак" sub="Помещается на коленях или в ногах" selected={draft.baggage === 'bag'} onClick={() => { patch({ baggage: 'bag', baggageNote: undefined }); done('baggage'); }} />
          <OptionCard icon="suitcase" title="Чемодан или большая сумка" sub="Нужно место в багажнике" selected={draft.baggage === 'suitcase'} onClick={() => { patch({ baggage: 'suitcase', baggageNote: undefined }); done('baggage'); }} />
          <OptionCard icon="boxes" title="Много багажа" sub="2 и больше крупных места, баул, коробки" selected={draft.baggage === 'many'} onClick={() => { patch({ baggage: 'many' }); goto('baggageNote'); }} />
        </div>,
      );

    case 'baggageNote':
      return frame(
        'Что везёте?',
        <>
          <label className="field">
            <span className="field__label">Коротко, чтобы водитель понял</span>
            <textarea className="input" autoFocus value={text} maxLength={200} placeholder="Три коробки с банками" onChange={(e) => setText(e.target.value)} />
          </label>
          <div className="notice notice--gold"><b>Предоплата {money(nav.me.prepay ?? 600)}</b><br />За крупный багаж — переводом водителю. Реквизиты придут после того, как он примет бронь.</div>
          <div className="spacer" />
          <Button disabled={text.trim().length < 2} onClick={() => { patch({ baggageNote: text.trim() }); done('baggage'); }}>Дальше</Button>
        </>,
      );

    case 'comment':
      return frame(
        'Комментарий водителю',
        <>
          <label className="field">
            <span className="field__label">Не обязательно</span>
            <textarea className="input" value={text} maxLength={300} placeholder="Подъезд 3, позвоните заранее" onChange={(e) => setText(e.target.value)} />
          </label>
          <div className="spacer" />
          <Button onClick={() => { patch({ comment: text.trim() || undefined }); done('comment'); }}>{text.trim() ? 'Дальше' : 'Пропустить'}</Button>
        </>,
      );

    case 'results': {
      const when = draft.timeKind === 'exact' ? minutesLabel(draft.exactMinutes ?? 0) : TIME_SHORT[draft.timeKind!];
      const sub = `${draft.dayLabel ?? ''} · ${when} · ${seatsLabel(draft.seats ?? 1)}`;
      const opts = { village: !!(draft.from?.village || draft.to?.village), needChildSeat: draft.childSeat === 'driver' };
      const pick = (trip: Trip) => {
        patch({ trip, pickupPoint: null });
        goto(trip.pickupMode !== 'door' && trip.pickupPoints.length ? 'point' : 'summary');
      };
      const dayOf = (t: Trip) => dayLong(t.departsAt);
      const sameDay = (t: Trip) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date(t.departsAt)) === draft.day;
      const exact = found?.exact ?? [];
      const near = found?.near ?? [];
      return (
        <Screen>
          <PageHeader title={`${draft.from!.city} → ${draft.to!.city}`} sub={sub} onBack={stepBack} />
          {!found && !error && <div className="loading"><Rosette size={64} /><div className="muted">Ищем рейсы…</div></div>}
          {error && <ErrorNote>{errorText(error)}</ErrorNote>}
          {exact.map((t, i) => <TripCard key={t.id} trip={t} first={i === 0} {...opts} onPick={() => pick(t)} />)}
          {found && near.length > 0 && (
            <div className="label-caps muted">{exact.length ? 'Ещё рядом по времени' : 'Точно на это время рейса нет. Ближайшие рейсы'}</div>
          )}
          {near.map((t, i) => (
            <TripCard key={t.id} trip={t} first={exact.length === 0 && i === 0} {...opts} showDay={sameDay(t) ? undefined : dayOf(t)} onPick={() => pick(t)} />
          ))}
          {found && exact.length + near.length === 0 && (
            <div className="loading">
              <Rosette size={72} />
              <p><b>Рейсов на это время пока нет</b></p>
              <p className="muted">Оставьте заявку — её увидят все водители направления.</p>
            </div>
          )}
          <div className="spacer" />
          {found && (
            <button type="button" className="btn btn--dashed" disabled={busy} onClick={() => void submit('request')}>
              {exact.length + near.length ? 'Не подошло? Оставить заявку' : 'Оставить заявку'}
            </button>
          )}
        </Screen>
      );
    }

    case 'point': {
      const trip = draft.trip!;
      return (
        <Screen steps>
          <PageHeader title="Где вам удобно сесть?" sub={`${trip.driver.name} забирает из своих точек`} onBack={stepBack} />
          <div className="stack">
            {trip.pickupPoints.map((p) => (
              <OptionCard key={p} icon="pin" title={p} onClick={() => { patch({ pickupPoint: p }); goto('summary'); }} />
            ))}
            {trip.pickupMode === 'mixed' && (
              <OptionCard icon="home" title="От моего адреса" sub={draft.from!.address} onClick={() => { patch({ pickupPoint: null }); goto('summary'); }} />
            )}
          </div>
        </Screen>
      );
    }

    case 'summary': {
      const trip = draft.trip!;
      const total = trip.price * (draft.seats ?? 1);
      const rows: [string, ReactNode][] = [
        ['Едет', draft.passenger ? `${draft.passenger.name}, ${fmtPhone(draft.passenger.phone) || draft.passenger.phone}` : `${nav.me.user!.name} (вы)`],
        ['Откуда', `${draft.from!.city}, ${draft.from!.address}`],
        ['Куда', `${draft.to!.city}, ${draft.to!.address}`],
        ['Когда', dateTime(trip.departsAt)],
        ['Мест · багаж', `${draft.seats} · ${BAGGAGE[draft.baggage!]}`],
        ['Водитель', `${trip.driver.name} · ${car(trip.driver)}`],
      ];
      if (draft.pickupPoint) rows.push(['Точка сбора', draft.pickupPoint]);
      if (draft.childSeat && draft.childSeat !== 'none') rows.push(['Ребёнок до 7 лет', draft.childSeat === 'own' ? 'кресло своё' : 'нужно кресло водителя']);
      if (draft.comment) rows.push(['Комментарий', draft.comment]);
      return (
        <Screen>
          <PageHeader title="Проверьте поездку" big onBack={stepBack} />
          <SummaryRows rows={rows} />
          <div className="green">
            <div className="green__pad">
              <div className="green__sub" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Место в рейсе × {draft.seats}</span><span>{money(trip.price)}</span>
              </div>
              <div className="total"><span style={{ fontSize: 18, fontWeight: 600 }}>Итого</span><span className="total__sum">{money(total)}</span></div>
              <div className="small green__sub">Оплата водителю: наличными или переводом</div>
            </div>
            <TulipBand height={28} background="#174A36" />
          </div>
          {draft.baggage === 'many' && (
            <div className="notice notice--gold"><b>Предоплата {money(nav.me.prepay ?? 600)} за багаж</b><br />Переводом водителю. Реквизиты придут после того, как он примет бронь.</div>
          )}
          {(draft.from!.village || draft.to!.village) && <div className="notice notice--gold">За деревню может быть доплата — уточните у водителя.</div>}
          {error && <ErrorNote>{errorText(error)}</ErrorNote>}
          <div className="spacer" />
          <div className="stack">
            <Button variant="confirm" icon="check" disabled={busy} onClick={() => void submit('booking')}>Всё верно</Button>
            <Button variant="outline" size="card" onClick={() => goto('fix')}>Исправить</Button>
          </div>
        </Screen>
      );
    }

    case 'fix': {
      const fields: [StepId, string, IconName][] = [
        ['who', 'Кто едет', 'user'], ['from', 'Откуда', 'pin'], ['to', 'Куда', 'pin'], ['day', 'Когда', 'calendar'],
        ['seats', 'Сколько мест', 'users'], ['baggage', 'Багаж', 'suitcase'], ['comment', 'Комментарий', 'help'],
      ];
      return (
        <Screen steps>
          <PageHeader title="Что исправить?" big onBack={stepBack} />
          <div className="stack">
            {fields.map(([id, label, icon]) => (
              <OptionCard key={id} icon={icon} title={label} onClick={() => { setFixing(true); goto(id); }} />
            ))}
          </div>
        </Screen>
      );
    }

    case 'requestDone':
      return (
        <Screen>
          <div className="loading">
            <Rosette size={88} />
            <h1 className="title">Заявка отправлена водителям</h1>
            <p className="muted">Как только водитель возьмёт её, мы напишем в чат. Если за полчаса никто не возьмёт — передадим диспетчеру.</p>
          </div>
          <Button onClick={() => nav.reset()}>На главную</Button>
        </Screen>
      );
  }
}
