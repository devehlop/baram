import type { ReactNode } from 'react';
import { ChuvashBand, Rosette } from './Ornaments';
import { arrival, car, money, seats, time, TRUNK } from './format';
import type { Trip } from './types';

// ——— Иконки: линейные, stroke 2, скруглённые концы (DESIGN.md §2.4) ———

const ICONS = {
  arrow: <><path d="M4 12h15" /><path d="M13 5l7 7-7 7" /></>,
  back: <path d="M15 5l-7 7 7 7" />,
  chevron: <path d="M9 5l7 7-7 7" />,
  check: <path d="M5 12l5 5 9-10" />,
  car: <><path d="M3 15l2-6h14l2 6v4H3z" /><circle cx="7.5" cy="16.5" r="1" /><circle cx="16.5" cy="16.5" r="1" /></>,
  calendar: <><rect x="4" y="5" width="16" height="16" rx="3" /><path d="M4 10h16M9 3v4M15 3v4" /></>,
  phone: <path d="M5 4h4l2 5-3 2a11 11 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />,
  user: <><circle cx="12" cy="7" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.5 3-6 6.5-6s6.5 2.5 6.5 6" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.5c2.2.8 3.5 2.8 3.5 5.5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10 21h4" /></>,
  home: <><path d="M4 11l8-7 8 7" /><path d="M6 10v10h12V10" /></>,
  pin: <><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>,
  tree: <><path d="M12 3l5 7h-3l4 6H6l4-6H7z" /><path d="M12 16v5" /></>,
  bag: <><path d="M6 8h12l1 12H5z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></>,
  suitcase: <><rect x="4" y="7" width="16" height="13" rx="2" /><path d="M9 7V4h6v3M9 11v5M15 11v5" /></>,
  boxes: <><path d="M3 9l9-4 9 4v8l-9 4-9-4z" /><path d="M3 9l9 4 9-4M12 13v8" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5" /></>,
  sunrise: <><path d="M4 18h16M7 18a5 5 0 0 1 10 0" /><path d="M12 5v4M5.5 10.5l1.5 1.5M18.5 10.5L17 12" /></>,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  child: <><circle cx="12" cy="6" r="3" /><path d="M7 21v-6l-2-3 3-2h8l3 2-2 3v6" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01" /></>,
  swap: <><path d="M7 7h12l-3-3M17 17H5l3 3" /></>,
  close: <path d="M6 6l12 12M18 6L6 18" />,
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 24, stroke = 2 }: { name: IconName; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      {ICONS[name]}
    </svg>
  );
}

// ——— Кнопки ———

type Variant = 'primary' | 'confirm' | 'gold' | 'outline' | 'outline-green';

export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  variant?: Variant;
  size?: 'main' | 'card' | 'small';
  icon?: IconName;
  disabled?: boolean;
  href?: string;
}) {
  const { variant = 'primary', size = 'main' } = props;
  const cls = `btn btn--${variant}${size === 'main' ? '' : ` btn--${size}`}`;
  const inner = (
    <>
      {props.icon && <Icon name={props.icon} size={22} stroke={2.6} />}
      {props.children}
    </>
  );
  // Звонок и навигатор — обычные ссылки: их открывает сам телефон.
  if (props.href) return <a className={cls} href={props.href} target={props.href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">{inner}</a>;
  return <button type="button" className={cls} onClick={props.onClick} disabled={props.disabled}>{inner}</button>;
}

export function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="back" aria-label="Назад" onClick={onClick}>
      <Icon name="back" stroke={2.4} />
    </button>
  );
}

// ——— Каркас экрана ———

export function Screen({ children, top, steps }: { children: ReactNode; top?: ReactNode; steps?: boolean }) {
  return (
    <div className="screen">
      {top}
      <div className={`screen__body${steps ? ' screen__body--steps' : ''}`}>{children}</div>
    </div>
  );
}

/** Шапка шага анкеты: «Назад» · «Шаг N из M» · «В начало» и полоса прогресса. */
export function StepHeader(props: { step: number; total: number; onBack: () => void; onHome: () => void }) {
  return (
    <>
      <div className="step-head">
        <BackButton onClick={props.onBack} />
        <div className="step-head__count">Шаг {props.step} из {props.total}</div>
        <button type="button" className="step-head__home" onClick={props.onHome}>В начало</button>
      </div>
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={props.total} aria-valuenow={props.step}>
        <div className="progress__fill" style={{ width: `${Math.round((props.step / props.total) * 100)}%` }} />
      </div>
    </>
  );
}

export function PageHeader(props: { title: string; sub?: string; onBack: () => void; big?: boolean }) {
  return (
    <div className="page-head">
      <BackButton onClick={props.onBack} />
      <div>
        <div className={props.big ? 'title' : 'page-head__title'}>{props.title}</div>
        {props.sub && <div className="page-head__sub">{props.sub}</div>}
      </div>
    </div>
  );
}

export function OptionCard(props: { title: string; sub?: string; icon: IconName; selected?: boolean; onClick: () => void }) {
  return (
    <button type="button" className="option" aria-pressed={!!props.selected} onClick={props.onClick}>
      <span className="option__icon"><Icon name={props.icon} size={26} /></span>
      <span className="option__text">
        <span className="option__title">{props.title}</span>
        {props.sub && <span className="option__sub">{props.sub}</span>}
      </span>
    </button>
  );
}

export function MenuTile(props: { label: string; hint?: string; icon: IconName; primary?: boolean; count?: number; onClick: () => void }) {
  return (
    <button type="button" className={`tile${props.primary ? ' tile--primary' : ''}`} onClick={props.onClick}>
      <span className="tile__icon">
        <Icon name={props.icon} size={34} />
        {!!props.count && <span className="badge-count" aria-label={`Новых: ${props.count}`}>{props.count}</span>}
      </span>
      <span>
        <span className="tile__label">{props.label}</span>
        {props.hint && <><br /><span className="tile__hint">{props.hint}</span></>}
      </span>
    </button>
  );
}

export function Chip({ children, kind }: { children: ReactNode; kind?: 'gold' | 'teen' | 'ok' }) {
  return <span className={`chip${kind ? ` chip--${kind}` : ''}`}>{children}</span>;
}

export function SummaryRows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <div className="rows">
      {rows.map(([label, value]) => (
        <div className="rows__row" key={label}>
          <span className="rows__label">{label}</span>
          <span className="rows__value">{value}</span>
        </div>
      ))}
    </div>
  );
}

/** Этапы поездки: пройденные — зелёные с галочкой, текущий — золотой, будущие — контуром. */
export function StatusTimeline({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="timeline">
      {steps.map((label, i) => (
        <div key={label} className={`timeline__item${i < current ? ' timeline__item--done' : i === current ? ' timeline__item--now' : ''}`}>
          <span className="timeline__dot">{i < current && <Icon name="check" size={14} stroke={3.5} />}</span>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

export function Avatar({ name, gold, large }: { name: string; gold?: boolean; large?: boolean }) {
  return <div className={`avatar${gold ? ' avatar--gold' : ''}${large ? ' avatar--lg' : ''}`} aria-hidden="true">{name.trim().charAt(0).toUpperCase()}</div>;
}

/** Карточка рейса в списке. Первая — с красной кнопкой и узорной полосой снизу. */
export function TripCard(props: { trip: Trip; first: boolean; village: boolean; needChildSeat: boolean; showDay?: string; onPick: () => void }) {
  const { trip, first } = props;
  const d = trip.driver;
  return (
    <div className="card card--flush">
      <div className="card__pad">
        {d.badge && (
          <div className="trip__badge">
            <Rosette size={20} />
            <span>Проверенный водитель</span>
          </div>
        )}
        {props.showDay && <div className="small muted">{props.showDay}</div>}
        <div className="trip__top">
          <div className="trip__time">{time(trip.departsAt)}</div>
          <div className="trip__arrive">→ ~{arrival(trip)}</div>
          <div className="trip__price">{money(trip.price)}</div>
        </div>
        <div className="row">
          <Avatar name={d.name} />
          <div>
            <div className="person__name">{d.name}</div>
            <div className="person__sub">{car(d)}</div>
          </div>
        </div>
        <div className="trip__meta">
          <div>{[seats(trip.seatsFree), TRUNK[trip.trunk], d.childSeat ? 'детское кресло' : null].filter(Boolean).join(' · ')}</div>
          {trip.pickupMode !== 'door' && trip.pickupPoints.length > 0 && <div>Сбор: {trip.pickupPoints.join(', ')}</div>}
        </div>
        {(trip.villages || (!trip.villages && props.village) || (!d.childSeat && props.needChildSeat)) && (
          <div className="chips">
            {trip.villages && <Chip kind="gold">Деревни — доплата по договорённости</Chip>}
            {!trip.villages && props.village && <Chip kind="teen">В деревни не заезжает</Chip>}
            {!d.childSeat && props.needChildSeat && <Chip kind="teen">Нет детского кресла</Chip>}
          </div>
        )}
        <Button size="card" variant={first ? 'primary' : 'outline-green'} onClick={props.onPick}>Еду с ним</Button>
      </div>
      {first && <ChuvashBand height={14} background="#FFFFFF" />}
    </div>
  );
}

export function Loading({ text = 'Загружаем…' }: { text?: string }) {
  return (
    <div className="screen">
      <div className="loading">
        <Rosette size={64} />
        <div className="muted">{text}</div>
      </div>
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <div className="notice notice--alert" role="alert">{children}</div>;
}
