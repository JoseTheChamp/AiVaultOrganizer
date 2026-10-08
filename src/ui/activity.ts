/** Something long the plugin is doing, shown on the dashboard and in a notice. */
export interface Activity {
  /** "Organizing". */
  title: string;
  /** "qwen3:8b is placing notes". */
  detail: string;
  /** Progress, when it can be counted. */
  done?: number;
  total?: number;
  /** When the task started (epoch ms), for the clock that shows it is still alive. */
  startedAt: number;
  /** How long the current step may still take (ms), once its pace is known. */
  remaining?: number;
  /** The user can stop it. */
  stoppable: boolean;
}

/** "qwen3:8b is placing notes, 30 of 74". */
export function progressText(activity: Pick<Activity, 'detail' | 'done' | 'total'>): string {
  return activity.total ? `${activity.detail}, ${activity.done ?? 0} of ${activity.total}` : activity.detail;
}

/** "1:42", or "1:02:05" past an hour. */
export function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  const [h, m, s] = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60];
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** "about 3 min to go"; rounded coarsely, because the pace of a model varies. */
export function remainingText(ms: number): string {
  if (ms < 45_000) return 'less than a minute to go';
  if (ms < 90_000) return 'about a minute to go';
  return `about ${Math.round(ms / 60_000)} min to go`;
}

/** Updates closer together than this were answered from a cache, and say nothing about speed. */
const INSTANT_MS = 1000;

/**
 * Guesses how long the rest of a counted step takes, from its pace so far. A local model may take a
 * minute or two per request, so without this a long run looks the same as a stuck one. Progress that
 * arrives instantly (cached answers) is left out of the pace; otherwise a run that starts with a few
 * cached requests would promise to end in seconds.
 */
export class Pace {
  private step: { key: string; from: number; base: number; last: number; lastAt: number } | null = null;
  /** Milliseconds left in step `key` at `done` of `total`, or undefined until its pace is known. */
  remaining(key: string, done: number, total: number, now: number): number | undefined {
    const step = this.step;
    if (!step || step.key !== key || done < step.last) {
      this.step = { key, from: now, base: done, last: done, lastAt: now };
      return undefined;
    }
    if (done > step.last && now - step.lastAt < INSTANT_MS) {
      step.from = now;
      step.base = done;
    }
    step.last = done;
    step.lastAt = now;
    if (done <= step.base || done >= total) return undefined;
    return ((now - step.from) / (done - step.base)) * (total - done);
  }
}
