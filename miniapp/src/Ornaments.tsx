// Барам — логотип и народные узоры (стиль «Калфак и сурпан»).
// Узоры нарисованы по мотивам: чувашский ромб с крючками, татарский тюльпан,
// общая восьмиконечная розетка. Цвета — из theme.css.
import { useId } from 'react';

const C = {
  canvas: '#F6EFE2',
  ink: '#2B1A14',
  red: '#A81E2A',
  green: '#1E5E45',
  greenDeep: '#174A36',
  leaf: '#7FB48F',
  gold: '#D9A33A',
  white: '#FFFFFF',
};

/** Логотип: красный квадрат со стрелкой «вперёд» + слово «барам». */
export function Logo({ size = 52, withWord = true, wordColor = C.ink }: { size?: number; withWord?: boolean; wordColor?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: size * 0.23 }}>
      <div
        style={{
          width: size, height: size, borderRadius: size * 0.3, background: C.red,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}
      >
        <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 24 24" fill="none" stroke={C.white}
          strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 12h15" /><path d="M13 5l7 7-7 7" />
        </svg>
      </div>
      {withWord && (
        <span style={{ fontSize: size * 0.7, fontWeight: 800, letterSpacing: '-0.035em', color: wordColor, lineHeight: 1 }}>
          барам
        </span>
      )}
    </div>
  );
}

/** Чувашская полоса: ромб с крючками. `inverse` — красная лента со светлым ромбом. */
export function ChuvashBand({ height = 24, inverse = false, background }: { height?: number; inverse?: boolean; background?: string }) {
  const id = useId().replace(/:/g, '');
  const bg = background ?? (inverse ? C.red : C.canvas);
  const line = inverse ? C.canvas : C.red;
  const s = height; // плитка s×s
  const k = s / 32;
  return (
    <svg width="100%" height={s} aria-hidden="true" style={{ display: 'block' }}>
      <defs>
        <pattern id={`chv${id}`} width={s} height={s} patternUnits="userSpaceOnUse">
          <rect width={s} height={s} fill={bg} />
          <path d={`M${16 * k} ${3 * k} L${29 * k} ${16 * k} L${16 * k} ${29 * k} L${3 * k} ${16 * k} Z`}
            fill="none" stroke={line} strokeWidth={2.5 * k} />
          <path d={`M${16 * k} ${10 * k} L${22 * k} ${16 * k} L${16 * k} ${22 * k} L${10 * k} ${16 * k} Z`} fill={C.ink} />
          {height >= 24 && (
            <>
              <rect x={14.5 * k} y={14.5 * k} width={3 * k} height={3 * k} fill={C.gold} />
              <path
                d={`M${9.5 * k} ${9.5 * k} L${6 * k} ${6 * k} L${6 * k} ${10 * k} M${22.5 * k} ${9.5 * k} L${26 * k} ${6 * k} L${26 * k} ${10 * k} M${9.5 * k} ${22.5 * k} L${6 * k} ${26 * k} L${6 * k} ${22 * k} M${22.5 * k} ${22.5 * k} L${26 * k} ${26 * k} L${26 * k} ${22 * k}`}
                fill="none" stroke={line} strokeWidth={2 * k} />
            </>
          )}
        </pattern>
      </defs>
      <rect width="100%" height={s} fill={`url(#chv${id})`} />
    </svg>
  );
}

/** Татарская полоса: тюльпаны — золото и красный на зелёном бархате. */
export function TulipBand({ height = 72, background = C.green }: { height?: number; background?: string }) {
  const id = useId().replace(/:/g, '');
  const k = height / 72;
  const w = 56 * k;
  return (
    <svg width="100%" height={height} aria-hidden="true" style={{ display: 'block' }}>
      <defs>
        <pattern id={`tul${id}`} width={w} height={height} patternUnits="userSpaceOnUse">
          <rect width={w} height={height} fill={background} />
          <g transform={`scale(${k})`}>
            <path d="M28 66 C28 56 28 48 28 40" stroke={C.leaf} strokeWidth={2.5} fill="none" />
            <path d="M28 58 C18 56 13 48 14 42 C21 44 26 50 28 58 Z" fill={C.leaf} />
            <path d="M28 58 C38 56 43 48 42 42 C35 44 30 50 28 58 Z" fill={C.leaf} />
            <path d="M28 42 C16 40 13 24 19 14 C22 23 25 27 28 30 C31 27 34 23 37 14 C43 24 40 40 28 42 Z" fill={C.gold} />
            <path d="M28 40 C23 32 24 18 28 9 C32 18 33 32 28 40 Z" fill={C.red} />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height={height} fill={`url(#tul${id})`} />
    </svg>
  );
}

/** Восьмиконечная розетка — «Надёжный водитель», подтверждённая поездка, пустые состояния. */
export function Rosette({ size = 20, color = C.red, label }: { size?: number; color?: string; label?: string }) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const };
  if (size <= 32) {
    return (
      <svg width={size} height={size} viewBox="0 0 22 22" {...a11y}>
        <rect x="5" y="5" width="12" height="12" fill={color} />
        <rect x="5" y="5" width="12" height="12" fill={color} transform="rotate(45 11 11)" />
        <circle cx="11" cy="11" r="2.5" fill={C.gold} />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 88 88" {...a11y}>
      <rect x="20" y="20" width="48" height="48" fill={color} />
      <rect x="20" y="20" width="48" height="48" fill={color} transform="rotate(45 44 44)" />
      <rect x="28" y="28" width="32" height="32" fill={C.gold} transform="rotate(45 44 44)" />
      <path d="M44 32 L56 44 L44 56 L32 44 Z" fill={C.ink} />
      <circle cx="44" cy="44" r="4" fill={C.canvas} />
    </svg>
  );
}
