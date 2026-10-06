export interface Cost {
  /** Model calls (chat and embedding requests that reached a provider). */
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Wall time in milliseconds. */
  ms: number;
}

export const NO_COST: Cost = { calls: 0, inputTokens: 0, outputTokens: 0, ms: 0 };

export function addCost(a: Cost, b: Cost): Cost {
  return { calls: a.calls + b.calls, inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens, ms: a.ms + b.ms };
}

/** Cost normalized per 100 notes, so fixtures of different sizes compare (PLAN §8.2). */
export function per100Notes(cost: Cost, notes: number): Cost {
  const factor = notes === 0 ? 0 : 100 / notes;
  return {
    calls: round(cost.calls * factor),
    inputTokens: Math.round(cost.inputTokens * factor),
    outputTokens: Math.round(cost.outputTokens * factor),
    ms: Math.round(cost.ms * factor),
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
