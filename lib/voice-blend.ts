import { engineKeys, type Engine, type Patch } from './semantic';

export type VoiceBlend = { a: Engine; b: Engine; mix: number };

export function readVoiceBlend(engines: Patch['engines']): VoiceBlend {
  const [a, b] = [...engineKeys].sort((a, b) => engines[b] - engines[a]);
  return { a, b, mix: engines[b] / (engines[a] + engines[b]) };
}

export function blendEngines({ a, b, mix }: VoiceBlend): Patch['engines'] {
  const amount = Math.max(0, Math.min(1, mix));
  return Object.fromEntries(engineKeys.map(key => [key,
    (key === a ? 1 - amount : 0) + (key === b ? amount : 0),
  ])) as Patch['engines'];
}
