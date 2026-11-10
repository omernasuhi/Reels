import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "reels-studio" });

export type Events = {
  "project/script.requested": { projectId: string; userId: string; chargeRef: string; instruction?: string };
  "project/script.approved": { projectId: string; userId: string };
  "character/generate.requested": { characterId: string; projectId: string; userId: string; chargeRef: string; fix?: string };
  "project/production.requested": { projectId: string; userId: string; chargeRef: string; pilot?: boolean; resume?: boolean; freshAudio?: boolean };
  "frame/generate.requested": {
    frameId: string;
    projectId: string;
    userId: string;
    mode: "initial" | "retry" | "regen";
    chargeRef?: string;
    fix?: string;
  };
  "project/render.requested": { projectId: string; userId: string; chargeRef: string };
};

export function send<K extends keyof Events>(name: K, data: Events[K] | Events[K][]) {
  const list = Array.isArray(data) ? data : [data];
  return inngest.send(list.map((d) => ({ name, data: d })));
}
