/** Confidence bands shown in the review: high is what "accept all above" usually takes. */
export type ConfidenceLevel = 'high' | 'medium' | 'low';

export function confidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence >= 0.8) return 'high';
  if (confidence >= 0.5) return 'medium';
  return 'low';
}

/** "87 %": whole percent, with the space Obsidian's own UI uses before the sign. */
export function percent(value: number): string {
  return `${Math.round(value * 100)} %`;
}
