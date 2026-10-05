import type { Logger } from '../core/ports';

/**
 * Console logger for the plugin. Debug and info output only appear when the user enabled debug
 * logging; warnings and errors always do. Callers must never pass note contents.
 */
export class ConsoleLogger implements Logger {
  constructor(private readonly isDebugEnabled: () => boolean) {}

  debug(message: string, data?: unknown): void {
    if (this.isDebugEnabled()) console.debug(`[AI Vault Organizer] ${message}`, data ?? '');
  }

  info(message: string, data?: unknown): void {
    this.debug(message, data);
  }

  warn(message: string, data?: unknown): void {
    console.warn(`[AI Vault Organizer] ${message}`, data ?? '');
  }

  error(message: string, data?: unknown): void {
    console.error(`[AI Vault Organizer] ${message}`, data ?? '');
  }
}
