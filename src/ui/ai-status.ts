import type { AiStatus } from '../core/ai/factory';

export interface StatusView {
  /** Next to the status light: "Online", "Offline". */
  label: string;
  tone: 'ok' | 'warn' | 'error' | 'off';
  /** Why AI cannot be used now and what to do, or null when it can. */
  problem: string | null;
}

/** How the language model's status reads on the dashboard and in the "Use AI?" dialog. */
export function statusView(status: AiStatus): StatusView {
  switch (status.state) {
    case 'off':
      return { label: 'Off', tone: 'off', problem: 'No language model is set up.' };
    case 'online':
      return { label: 'Online', tone: 'ok', problem: null };
    case 'missing-model':
      return { label: 'Model not installed', tone: 'warn', problem: `"${status.model}" is not available on the server. Install it, or choose another model in Set up AI.` };
    case 'blocked':
      return { label: 'Blocked', tone: 'error', problem: `${status.message} Change it in Set up AI.` };
    case 'offline':
      return { label: 'Offline', tone: 'error', problem: `The model does not answer (${status.message.replace(/\.$/, '')}). Start its app, or check Set up AI.` };
  }
}
