import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { slide } from "@remotion/transitions/slide";
import React from "react";
import { AbsoluteFill } from "remotion";
import { SCENES } from "./Scenes";
import { C, type Format } from "./theme";

/** Длительность сцен в кадрах (30 fps): обложка и финал дольше. */
export const DUR = [96, 96, 84, 96, 96, 90, 84, 120];
export const TRANS = 14;
export const promoDuration = DUR.reduce((a, b) => a + b, 0) - TRANS * (DUR.length - 1);

export const Promo: React.FC<{ format: Format }> = ({ format }) => (
  <AbsoluteFill style={{ backgroundColor: C.bg }}>
    <TransitionSeries>
      {SCENES.map((Scene, i) => (
        <React.Fragment key={i}>
          {i > 0 && <TransitionSeries.Transition presentation={slide({ direction: "from-right" })} timing={linearTiming({ durationInFrames: TRANS })} />}
          <TransitionSeries.Sequence name={`Слайд ${i + 1}`} durationInFrames={DUR[i]!}>
            <Scene format={format} still={false} />
          </TransitionSeries.Sequence>
        </React.Fragment>
      ))}
    </TransitionSeries>
  </AbsoluteFill>
);
