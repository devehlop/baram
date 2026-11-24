import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { springIn } from "./anim";
import { C } from "./theme";

/** Один тюльпан в духе калфака: красная чашечка, золотой ромб, зелёный стебель с листьями. */
const Tulip: React.FC<{ x: number; size: number; base: number; big: boolean; grow: number }> = ({ x, size, base, big, grow }) => {
  const s = size;
  const cup = big ? C.red : C.gold;
  return (
    <g transform={`translate(${x + (base - s) / 2}, ${(base - s) * 1.6})`}>
      <g style={{ transformOrigin: `${s / 2}px ${s * 1.6}px`, scale: String(grow) }}>
        <path d={`M${s / 2} ${s * 1.6} L${s / 2} ${s * 0.75}`} stroke={C.green} strokeWidth={s * 0.08} strokeLinecap="round" />
        <path d={`M${s / 2} ${s * 1.35} C ${s * 0.15} ${s * 1.3}, ${s * 0.05} ${s * 1.05}, ${s * 0.12} ${s * 0.95} C ${s * 0.3} ${s * 1.05}, ${s * 0.45} ${s * 1.15}, ${s / 2} ${s * 1.35} Z`} fill={C.green} />
        <path d={`M${s / 2} ${s * 1.35} C ${s * 0.85} ${s * 1.3}, ${s * 0.95} ${s * 1.05}, ${s * 0.88} ${s * 0.95} C ${s * 0.7} ${s * 1.05}, ${s * 0.55} ${s * 1.15}, ${s / 2} ${s * 1.35} Z`} fill={C.green} />
        <path
          d={`M${s * 0.22} ${s * 0.3} L${s * 0.36} ${s * 0.48} L${s / 2} ${s * 0.22} L${s * 0.64} ${s * 0.48} L${s * 0.78} ${s * 0.3} C ${s * 0.82} ${s * 0.62}, ${s * 0.7} ${s * 0.82}, ${s / 2} ${s * 0.84} C ${s * 0.3} ${s * 0.82}, ${s * 0.18} ${s * 0.62}, ${s * 0.22} ${s * 0.3} Z`}
          fill={cup}
        />
        {big && <path d={`M${s / 2} ${s * 0.02} L${s * 0.6} ${s * 0.13} L${s / 2} ${s * 0.24} L${s * 0.4} ${s * 0.13} Z`} fill={C.gold} />}
      </g>
    </g>
  );
};

/** Узорная полоса по нижнему краю: тюльпаны вырастают по очереди слева направо. */
export const Ornament: React.FC<{ still: boolean; height: number; delay?: number }> = ({ still, height, delay = 0 }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const size = height / 1.7;
  const step = size * 1.05;
  const n = Math.ceil(width / step) + 1;
  return (
    <svg width={width} height={height} style={{ position: "absolute", left: 0, bottom: 0 }}>
      <rect x={0} y={height - size * 0.09} width={width} height={size * 0.09} fill={C.green} />
      <g transform={`translate(${-step / 3}, ${height - size * 1.6 - size * 0.06})`}>
        {Array.from({ length: n }, (_, i) => (
          <Tulip key={i} x={i * step} size={i % 2 === 0 ? size : size * 0.8} base={size} big={i % 2 === 0} grow={springIn(frame, delay + i * 1.5, 18, still)} />
        ))}
      </g>
    </svg>
  );
};
