import { findSecrets } from "@instrument-org/shared/secrets";
import { stringify as stringifyYaml } from "yaml";

interface SecretFinding {
  detail: string;
  /** Which part of the app holds it: its setup or its guide. */
  file: "guide" | "setup";
}

/**
 * Scan an app's setup and guide for secret-shaped strings and for the app's
 * actual stored credential. Neither may ever hold a secret: credentials live
 * only in the app's encrypted store, and every later chat reads the guide.
 */
export function scanAppRecord({
  credential,
  guide,
  setup,
}: {
  credential: null | string;
  guide: string;
  setup: Record<string, unknown>;
}): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const parts = [
    ["setup", stringifyYaml(setup, { lineWidth: 0 })],
    ["guide", guide],
  ] as const;
  for (const [file, text] of parts) {
    if (
      credential !== null &&
      credential.length > 0 &&
      text.includes(credential)
    ) {
      findings.push({
        detail:
          "Contains the app's stored credential verbatim. Remove it -- credentials are injected at request time and must never be written into an app.",
        file,
      });
    }
    for (const name of new Set(findSecrets(text).map(({ label }) => label))) {
      findings.push({
        detail: `Contains a string that looks like a secret (${name}). An app's setup and guide must not contain secrets.`,
        file,
      });
    }
  }
  return findings;
}
