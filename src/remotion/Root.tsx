import React from "react";
import { Composition } from "remotion";
import { StoryVideo } from "./StoryVideo";
import { VIDEO, type StoryProps } from "./types";

const defaults: StoryProps = { frames: [], audioUrl: null, cards: [], showCards: true, durationInFrames: 90 };

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Story"
    component={StoryVideo}
    width={VIDEO.width}
    height={VIDEO.height}
    fps={VIDEO.fps}
    durationInFrames={defaults.durationInFrames}
    defaultProps={defaults}
    calculateMetadata={({ props }) => ({ durationInFrames: Math.max(1, props.durationInFrames) })}
  />
);
