import { reloadAIClient } from "./ai-client";
import { refreshOrchestrator } from "./orchestrator";

export type RefreshResult = {
  refreshed: boolean;
  durationMs: number;
  at: string;
};

let refreshPromise: Promise<RefreshResult> | null = null;

export function isRefreshInProgress(): boolean {
  return refreshPromise !== null;
}

export async function refreshApplicationRuntime(): Promise<RefreshResult> {
  if (refreshPromise) {
    return refreshPromise;
  }

  const current = (async () => {
    const startedAt = Date.now();
    await Promise.all([reloadAIClient(), refreshOrchestrator()]);
    return {
      refreshed: true,
      durationMs: Date.now() - startedAt,
      at: new Date().toISOString(),
    };
  })().finally(() => {
    refreshPromise = null;
  });

  refreshPromise = current;
  return current;
}
