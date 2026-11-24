import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

export const C = {
  bg: "#EDE4C6",
  ink: "#2B1A14",
  inkMuted: "#5E4A3F",
  green: "#3F6650",
  greenDeep: "#2F5240",
  red: "#A81E2A",
  gold: "#D9A33A",
  white: "#FFFFFF",
};

export const FONT = "Onest";

const CYR = "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116";
const LAT =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD,U+21C4,U+2192";

for (const w of ["400", "500", "700", "800"]) {
  loadFont({ family: FONT, url: staticFile(`fonts/onest-cyrillic-${w}-normal.woff2`), weight: w, unicodeRange: CYR });
  loadFont({ family: FONT, url: staticFile(`fonts/onest-latin-${w}-normal.woff2`), weight: w, unicodeRange: LAT });
}

export type Format = "story" | "carousel";

export const BOT = "@baramambot";
export const CHANNEL = "@baram_buinsk";
