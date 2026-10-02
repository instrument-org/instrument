import { type LogWarningsFunction, type Warning } from "ai";

/**
 * Route the AI SDK's provider warnings through `console.warn`, once each.
 *
 * Its default logger prints every warning of every call as a process warning.
 * A request replays the whole conversation, so a warning about one part of an
 * old message comes back on every turn after it, and some warnings quote the
 * part they are about: a skipped reasoning part brings the model's reasoning
 * text into the log with it. Here each kind of warning is logged the first
 * time a provider raises it, by its name alone.
 */
export function installAISDKWarningLogger() {
  const seen = new Set<string>();

  const logWarnings: LogWarningsFunction = ({ model, provider, warnings }) => {
    for (const warning of warnings) {
      const summary = summarizeWarning(warning);
      const key = `${provider ?? ""}\0${summary}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const source = [provider, model].filter(Boolean).join(" / ");
      console.warn(`AI SDK warning${source ? ` (${source})` : ""}: ${summary}`);
    }
  };

  globalThis.AI_SDK_LOG_WARNINGS = logWarnings;
}

function summarizeWarning(warning: Warning): string {
  switch (warning.type) {
    case "compatibility":
    case "unsupported": {
      return `${warning.type} ${warning.feature}`;
    }
    case "deprecated": {
      return `deprecated ${warning.setting}`;
    }
    case "other": {
      // Free text whose tail, after the first colon, is the payload it quotes.
      return warning.message.split(":")[0] ?? warning.message;
    }
  }
}
