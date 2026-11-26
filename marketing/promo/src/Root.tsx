import React from "react";
import { Composition, Folder, Still } from "remotion";
import { Promo, promoDuration } from "./Promo";
import { SCENES } from "./Scenes";
import "./theme";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="PromoStory" component={Promo} durationInFrames={promoDuration} fps={30} width={1080} height={1920} defaultProps={{ format: "story" as const }} />
    <Composition id="PromoFeed" component={Promo} durationInFrames={promoDuration} fps={30} width={1080} height={1350} defaultProps={{ format: "carousel" as const }} />
    <Folder name="Karusel">
      {SCENES.map((Scene, i) => (
        <Still key={i} id={`Card${i + 1}`} component={Scene} width={1080} height={1350} defaultProps={{ format: "carousel" as const, still: true }} />
      ))}
    </Folder>
  </>
);
