import ms from "ms";

/**
 * Why a Claude account's Claude Code last said it could not run fast, by
 * provider connection. Asked before a message, it answers that Fast is on
 * whatever the account allows, so only a finished turn says. What one said
 * lapses after a while, since the account's settings can change elsewhere
 * and nothing asks again while Fast is held to be off.
 */
const LAPSES_MS = ms("30 minutes");
const reasons = new Map<string, { at: number; reason: string }>();
const listeners = new Set<() => void>();

export function noteReportedFastMode(
  providerConfigId: string,
  disabledReason: string | undefined,
) {
  const held = fastModeDisabledReason(providerConfigId);
  if (disabledReason === undefined) {
    reasons.delete(providerConfigId);
  } else {
    reasons.set(providerConfigId, { at: Date.now(), reason: disabledReason });
  }
  if (held !== disabledReason) {
    for (const listener of listeners) {
      listener();
    }
  }
}

export function fastModeDisabledReason(providerConfigId: string) {
  const held = reasons.get(providerConfigId);
  return held && Date.now() - held.at < LAPSES_MS ? held.reason : undefined;
}

/** Calls `listener` whenever a connection's reason changes. */
export function onReportedFastMode(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
