import React from "react";
import { Img, staticFile, useCurrentFrame } from "remotion";
import { progress, springIn } from "./anim";
import { layoutOf, Slide } from "./Slide";
import { BOT, C, CHANNEL, FONT, type Format } from "./theme";

export type SceneProps = { format: Format; still: boolean };

/** Машинка для списка рейсов. */
const CarIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg viewBox="0 0 64 32" style={{ width: "2.6em", height: "1.3em" }}>
    <path d="M6 22 L10 12 Q12 8 18 8 L40 8 Q46 8 50 13 L56 18 Q60 19 60 23 L60 25 L4 25 L4 23 Q4 22 6 22 Z" fill={color} />
    <path d="M16 12 L24 12 L24 18 L13 18 Z M28 12 L40 12 Q43 12 46 18 L28 18 Z" fill="#F7F1DE" />
    <circle cx="16" cy="26" r="5" fill={C.ink} />
    <circle cx="48" cy="26" r="5" fill={C.ink} />
  </svg>
);

const TRIPS = [
  { time: "07:30", who: "Ильдар", seats: "3 места", price: "500 ₽", color: C.green },
  { time: "11:00", who: "Рамиль", seats: "1 место", price: "550 ₽", color: C.red },
  { time: "17:30", who: "Айдар", seats: "2 места", price: "500 ₽", color: C.gold },
  { time: "19:00", who: "Марат", seats: "4 места", price: "600 ₽", color: C.green },
];

/** Слайд 2: телефон со списком рейсов, карточки въезжают по одной. */
const PhoneTrips: React.FC<{ still: boolean; h: number }> = ({ still, h }) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        border: `${h * 0.022}px solid ${C.green}`,
        borderRadius: h * 0.07,
        backgroundColor: "#F7F1DE",
        padding: `${h * 0.07}px ${h * 0.03}px`,
        display: "flex",
        flexDirection: "column",
        gap: h * 0.025,
        fontSize: h / 30,
        fontFamily: FONT,
        position: "relative",
      }}
    >
      <div style={{ position: "absolute", top: h * 0.02, left: "38%", width: "24%", height: h * 0.012, borderRadius: 99, backgroundColor: C.green }} />
      <div style={{ fontWeight: 700, color: C.inkMuted, fontSize: "0.9em", padding: "0 0.3em" }}>Буинск → Казань · завтра</div>
      {TRIPS.map((t, i) => {
        const p = progress(frame, 18 + i * 7, 16, still);
        return (
          <div
            key={t.time}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5em",
              backgroundColor: C.white,
              border: `2px solid ${i === 2 ? C.red : "#D8CBB3"}`,
              borderRadius: "0.6em",
              padding: "0.55em 0.6em",
              opacity: p,
              translate: `${(1 - p) * 80}px 0px`,
            }}
          >
            <CarIcon color={t.color} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: "1.35em", color: C.ink, lineHeight: 1 }}>{t.time}</div>
              <div style={{ fontWeight: 500, fontSize: "0.85em", color: C.inkMuted, marginTop: "0.2em" }}>
                {t.who} · {t.seats}
              </div>
            </div>
            <div style={{ fontWeight: 800, fontSize: "1.15em", color: C.green }}>{t.price}</div>
          </div>
        );
      })}
    </div>
  );
};

/** Слайд 5: в пустые пузыри иллюстрации вписываем «Сел в машину» и «Доехали». */
const ChatOverlay: React.FC<{ still: boolean; h: number }> = ({ still, h }) => {
  const frame = useCurrentFrame();
  const bubble = (top: number, bottom: number, text: string, at: number) => {
    const p = springIn(frame, at, 16, still);
    return (
      <div
        style={{
          position: "absolute",
          left: "15%",
          width: "70%",
          top: `${top * 100}%`,
          height: `${(bottom - top) * 100}%`,
          backgroundColor: C.green,
          borderRadius: h * 0.012,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: FONT,
          fontWeight: 700,
          fontSize: h * 0.042,
          color: C.white,
        }}
      >
        <span style={{ scale: String(p), opacity: p }}>{text}</span>
      </div>
    );
  };
  return (
    <>
      {bubble(0.298, 0.437, "Сел в машину", 26)}
      {bubble(0.533, 0.672, "Доехали ✓", 44)}
    </>
  );
};

const artH = (format: Format) => layoutOf(format).artH;

export const S1: React.FC<SceneProps> = ({ format, still }) => {
  const frame = useCurrentFrame();
  const L = layoutOf(format);
  const lIn = springIn(frame, 0, 22, still);
  const story = format === "story";
  return (
    <Slide index={1} format={format} still={still} hideLogo title="" art="img/s1-towns.png" artAspect={3.368} artShiftY={story ? 280 : 120} textShiftY={story ? 20 : 0}>
      <div style={{ position: "absolute", top: (story ? 430 : 150) - L.textTop - (story ? 20 : 0), left: 0, right: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <Img src={staticFile("img/logo.png")} style={{ width: story ? 820 : 700, scale: String(0.7 + 0.3 * lIn), opacity: lIn }} />
        <div style={{ marginTop: story ? 40 : 28, fontSize: story ? 58 : 50, fontWeight: 700, color: C.greenDeep, opacity: progress(frame, 14, 16, still) }}>
          Попутчики Буинск ⇄ Казань
        </div>
      </div>
      <div style={{ fontSize: L.body, fontWeight: 500, color: C.inkMuted, opacity: progress(frame, 26, 16, still) }}>
        Все рейсы на день — в одном <span style={{ whiteSpace: "nowrap" }}>Telegram-боте</span>
      </div>
      {(
        <div style={{ marginTop: story ? 44 : 34, opacity: progress(frame, 34, 16, still), display: "inline-block", padding: "16px 36px", borderRadius: 99, backgroundColor: C.red, color: C.white, fontSize: 38, fontWeight: 700 }}>
          Как это работает →
        </div>
      )}
    </Slide>
  );
};

export const S2: React.FC<SceneProps> = ({ format, still }) => (
  <Slide
    index={2}
    format={format}
    still={still}
    title="Все рейсы — в одном месте"
    body="Время, водитель, свободные места и цена. Не нужно листать чаты"
    artAspect={0.74}
    artNode={<PhoneTrips still={still} h={artH(format)} />}
  />
);

export const S3: React.FC<SceneProps> = ({ format, still }) => (
  <Slide index={3} format={format} still={still} title="Бронь в 3 нажатия" body="Откуда, куда, сколько мест — водитель подтверждает в боте" art="img/s3-tap.png" artAspect={0.795} />
);

export const S4: React.FC<SceneProps> = ({ format, still }) => (
  <Slide
    index={4}
    format={format}
    still={still}
    title="Водители проверены"
    body="Каждую анкету и машину проверяем вручную. Номер машины и телефон водителя — сразу после подтверждения"
    art="img/s4-shield.png"
    artAspect={1.564}
  />
);

export const S5: React.FC<SceneProps> = ({ format, still }) => (
  <Slide
    index={5}
    format={format}
    still={still}
    title="Спокойно за родных"
    body="Оформите поездку маме или ребёнку — вам придёт «Сел в машину» и «Доехали»"
    art="img/s5-chat.png"
    artAspect={0.557}
    artOverlay={<ChatOverlay still={still} h={artH(format)} />}
  />
);

export const S6: React.FC<SceneProps> = ({ format, still }) => (
  <Slide index={6} format={format} still={still} title="Платите водителю" body="Напрямую, наличными или переводом. Бот денег не берёт и не присылает ссылок на оплату" art="img/s6-pay.png" artAspect={1.589} />
);

export const S7: React.FC<SceneProps> = ({ format, still }) => (
  <Slide index={7} format={format} still={still} title="Нет подходящего рейса?" body="Оставьте заявку — её увидят все водители направления" art="img/s7-bell.png" artAspect={0.7} />
);

export const S8: React.FC<SceneProps> = ({ format, still }) => {
  const frame = useCurrentFrame();
  const L = layoutOf(format);
  const pIn = springIn(frame, 24, 18, still);
  const pulse = still ? 1 : 1 + Math.max(0, Math.sin((frame - 50) / 8)) * 0.03 * (frame > 50 ? 1 : 0);
  return (
    <Slide index={8} format={format} still={still} title="Едем!" art="img/s8-road.png" artAspect={2.011} artShiftY={format === "story" ? 0 : -60} textShiftY={format === "story" ? 0 : -150} hideDots>
      <div style={{ marginTop: 22, fontSize: L.body, fontWeight: 500, color: C.inkMuted, opacity: progress(frame, 18, 14, still) }}>Найдите в Telegram</div>
      <div
        style={{
          marginTop: 18,
          display: "inline-block",
          padding: format === "story" ? "22px 56px" : "18px 46px",
          borderRadius: 99,
          backgroundColor: C.red,
          color: C.white,
          fontSize: format === "story" ? 72 : 60,
          fontWeight: 800,
          scale: String(pIn * pulse),
        }}
      >
        {BOT}
      </div>
      <div style={{ marginTop: 26, fontSize: L.body * 0.85, fontWeight: 500, color: C.inkMuted, lineHeight: 1.35, opacity: progress(frame, 36, 16, still) }}>
        Водитель? Нажмите «Я водитель»
        <br />
        Рейсы на день — в канале <b style={{ color: C.greenDeep }}>{CHANNEL}</b>
      </div>
    </Slide>
  );
};

export const SCENES = [S1, S2, S3, S4, S5, S6, S7, S8];
