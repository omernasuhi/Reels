import React, { useEffect, useState } from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  continueRender,
  delayRender,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { toneDataUrl, TONE_SECONDS } from "./tone";
import type { StoryCard, StoryFrame, StoryProps } from "./types";

// Tarayıcı önizlemesi (@remotion/player) ve sunucu render'ı bu dosyayı kullanır.

const FONT = "StoryPoppins";

function useCardFont() {
  const [handle] = useState(() => delayRender("font"));
  useEffect(() => {
    const faces = ["fonts/poppins-latin-700-normal.woff2", "fonts/poppins-latin-ext-700-normal.woff2"].map(
      (file) => new FontFace(FONT, `url(${staticFile(file)}) format("woff2")`, { weight: "700" }),
    );
    Promise.all(faces.map((f) => f.load()))
      .then((loaded) => loaded.forEach((f) => document.fonts.add(f)))
      .catch(() => undefined)
      .finally(() => continueRender(handle));
  }, [handle]);
}

// Ken Burns: sırayla yakınlaş, uzaklaş, sola kay, sağa kay.
function KenBurns({ frame, index, frames }: { frame: StoryFrame; index: number; frames: number }) {
  const f = useCurrentFrame();
  const p = interpolate(f, [0, Math.max(1, frames)], [0, 1], { extrapolateRight: "clamp" });
  const mode = index % 4;
  let scale = 1.12;
  let x = 0;
  if (mode === 0) scale = 1 + 0.12 * p;
  else if (mode === 1) scale = 1.12 - 0.12 * p;
  else if (mode === 2) x = 4 - 8 * p;
  else x = -4 + 8 * p;

  return (
    <AbsoluteFill style={{ backgroundColor: "#111", overflow: "hidden" }}>
      {frame.url ? (
        <Img
          src={frame.url}
          alt={frame.alt ?? ""}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${scale}) translateX(${x}%)`,
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
}

function Flash() {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = interpolate(f, [0, 0.35 * fps], [0.95, 0], { extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ backgroundColor: "#fff", opacity }} />;
}

function CardView({ card }: { card: StoryCard }) {
  const f = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const total = Math.max(2, Math.round(card.duration * fps));
  const fadeIn = Math.min(0.15 * fps, total / 2);
  const fadeOut = Math.min(0.2 * fps, total / 2);
  const opacity = Math.min(
    interpolate(f, [0, fadeIn], [0, 1], { extrapolateRight: "clamp" }),
    interpolate(f, [total - fadeOut, total], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
  );
  const size = (card.size * width) / 1080;
  const stroke = Math.max(4, size * 0.16);
  return (
    <AbsoluteFill style={{ opacity }}>
      <div
        style={{
          position: "absolute",
          left: "6%",
          right: "6%",
          top: `${card.y * 100}%`,
          transform: "translateY(-50%)",
          textAlign: "center",
          fontFamily: `${FONT}, Poppins, sans-serif`,
          fontWeight: 700,
          fontSize: size,
          lineHeight: 1.08,
          color: "#fff",
          WebkitTextStroke: `${stroke}px #000`,
          paintOrder: "stroke fill",
          textShadow: `0 ${size * 0.09}px 0 #d0021b`,
          letterSpacing: "0.01em",
        }}
      >
        {card.text.toLocaleUpperCase("tr-TR")}
      </div>
    </AbsoluteFill>
  );
}

export const StoryVideo: React.FC<StoryProps> = ({ frames, audioUrl, cards, showCards }) => {
  const { fps, durationInFrames } = useVideoConfig();
  useCardFont();
  const at = (seconds: number) => Math.round(seconds * fps);
  const toneFrames = Math.round(TONE_SECONDS * fps);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {frames.map((frame, i) => {
        const from = at(frame.start);
        // Son kare videonun sonuna kadar kalır (kuyruk).
        const length = i === frames.length - 1 ? durationInFrames - from : at(frame.start + frame.duration) - from;
        if (length <= 0) return null;
        return (
          <Sequence key={i} from={from} durationInFrames={length}>
            <KenBurns frame={frame} index={i} frames={length} />
            {frame.kind === "final" ? <Flash /> : null}
          </Sequence>
        );
      })}

      {audioUrl ? <Audio src={audioUrl} /> : null}

      {frames.map((frame, i) =>
        frame.kind === "opening" || frame.kind === "problem" ? (
          <Sequence key={`tone-${i}`} from={at(frame.start)} durationInFrames={toneFrames}>
            <Audio src={toneDataUrl()} />
          </Sequence>
        ) : null,
      )}

      {showCards
        ? cards.map((card, i) => (
            <Sequence key={`card-${i}`} from={at(card.start)} durationInFrames={Math.max(2, at(card.duration))}>
              <CardView card={card} />
            </Sequence>
          ))
        : null}
    </AbsoluteFill>
  );
};
