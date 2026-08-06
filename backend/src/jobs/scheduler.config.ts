export type SchedulerConfig = {
  enabled: boolean;
  autoExecute: boolean;
  /** Stale running claim age before takeover (ms). */
  staleRunningMs: number;
};

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

export function loadSchedulerConfig(): SchedulerConfig {
  return {
    // Off by default so local `start:dev` does not burn OpenAI/NSE unexpectedly.
    enabled: envBool('SCHEDULER_ENABLED', false),
    autoExecute: envBool('SCHEDULER_AUTO_EXECUTE', false),
    staleRunningMs: Number(process.env.SCHEDULER_STALE_RUNNING_MS ?? 30 * 60 * 1000),
  };
}
