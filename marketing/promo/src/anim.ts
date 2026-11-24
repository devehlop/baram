import { Easing, interpolate } from "remotion";

const OUT = Easing.bezier(0.16, 1, 0.3, 1);

/** 0→1 за [from, from+dur] кадров; в статичном режиме (карусель) — сразу 1. */
export const progress = (frame: number, from: number, dur: number, still: boolean) =>
  still ? 1 : interpolate(frame, [from, from + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: OUT });

export const springIn = (frame: number, from: number, dur: number, still: boolean) =>
  still ? 1 : interpolate(frame, [from, from + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.spring({ damping: 12 }) });
