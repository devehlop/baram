import React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { progress } from "./anim";
import { Ornament } from "./Ornament";
import { C, FONT, type Format } from "./theme";

export const TOTAL = 8;

/** Размеры макета для сторис (1080×1920) и карусели (1080×1350). */
export const layoutOf = (format: Format) =>
  format === "story"
    ? { logoTop: 120, logoW: 360, artTop: 330, artH: 800, artW: 880, textTop: 1200, title: 88, body: 46, dotsBottom: 250, orn: 160, pad: 90 }
    : { logoTop: 60, logoW: 250, artTop: 170, artH: 560, artW: 820, textTop: 790, title: 74, body: 40, dotsBottom: 150, orn: 110, pad: 80 };

export type SlideProps = {
  index: number;
  format: Format;
  still: boolean;
  title: string;
  body?: React.ReactNode;
  art?: string;
  /** Своя иллюстрация вместо картинки (рисуется кодом). */
  artNode?: React.ReactNode;
  /** Поверх картинки, в её системе координат (0..1). */
  artOverlay?: React.ReactNode;
  artAspect?: number;
  hideLogo?: boolean;
  /** Сдвиг иллюстрации вниз, px (обложка). */
  artShiftY?: number;
  textShiftY?: number;
  hideDots?: boolean;
  children?: React.ReactNode;
};

export const Slide: React.FC<SlideProps> = ({ index, format, still, title, body, art, artNode, artOverlay, artAspect, hideLogo, artShiftY = 0, textShiftY = 0, hideDots, children }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const L = layoutOf(format);
  const aIn = progress(frame, 4, 22, still);
  const tIn = progress(frame, 12, 18, still);
  const bIn = progress(frame, 20, 18, still);
  const float = still ? 0 : Math.sin(frame / 22) * 6;

  // Картинка вписывается в рамку artW×artH по пропорции.
  const aspect = artAspect ?? 1;
  let w = L.artW;
  let h = w / aspect;
  if (h > L.artH) {
    h = L.artH;
    w = h * aspect;
  }

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, fontFamily: FONT, color: C.ink }}>
      {!hideLogo && (
        <Img
          src={staticFile("img/logo.png")}
          style={{ position: "absolute", top: L.logoTop, left: (width - L.logoW) / 2, width: L.logoW, opacity: progress(frame, 0, 14, still) }}
        />
      )}
      {format === "carousel" && (
        <div style={{ position: "absolute", top: L.logoTop + 8, right: L.pad, fontSize: 34, fontWeight: 700, color: C.inkMuted }}>
          {index} / {TOTAL}
        </div>
      )}

      <div
        style={{
          position: "absolute",
          top: L.artTop + (L.artH - h) / 2 + artShiftY,
          left: (width - w) / 2,
          width: w,
          height: h,
          opacity: aIn,
          scale: String(0.88 + 0.12 * aIn),
          translate: `0px ${(1 - aIn) * 60 + float}px`,
        }}
      >
        {artNode ?? (art && <Img src={staticFile(art)} style={{ width: "100%", height: "100%" }} />)}
        {artOverlay}
      </div>

      <div style={{ position: "absolute", top: L.textTop + textShiftY, left: L.pad, right: L.pad, textAlign: "center" }}>
        {title && <div
          style={{
            fontSize: L.title,
            fontWeight: 800,
            lineHeight: 1.08,
            letterSpacing: "-0.02em",
            color: C.greenDeep,
            opacity: tIn,
            translate: `0px ${(1 - tIn) * 40}px`,
          }}
        >
          {title}
        </div>}
        {body && (
          <div style={{ marginTop: 28, fontSize: L.body, fontWeight: 500, lineHeight: 1.3, color: C.inkMuted, opacity: bIn, translate: `0px ${(1 - bIn) * 30}px` }}>
            {body}
          </div>
        )}
        {children}
      </div>

      {!hideDots && <div style={{ position: "absolute", bottom: L.dotsBottom, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 14 }}>
        {Array.from({ length: TOTAL }, (_, i) => (
          <div key={i} style={{ width: i + 1 === index ? 40 : 14, height: 14, borderRadius: 7, backgroundColor: i + 1 === index ? C.red : "#CDBF9C" }} />
        ))}
      </div>}

      <Ornament still={still} height={L.orn} delay={6} />
    </AbsoluteFill>
  );
};
