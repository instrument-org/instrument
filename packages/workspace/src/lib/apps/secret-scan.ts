import { findSecrets } from "@instrument-org/shared/secrets";
import fs from "node:fs/promises";
import path from "node:path";

import { type AbsolutePath } from "../../schemas/paths";

// Only text-ish app files are scanned; anything larger than this is
// almost certainly not a hand-written config/guide and gets flagged instead.
const MAX_SCAN_BYTES = 512 * 1024;

interface SecretFinding {
  detail: string;
  file: string;
}


/**
 * Scan every file in a app folder for secret-shaped strings and for the
 * app's actual stored credential. App folders must never contain
 * secrets -- credentials live only in the app's encrypted store.
 */
export async function scanAppFolder({
  credential,
  dir,
}: {
  credential: null | string;
  dir: AbsolutePath;
}): Promise<SecretFinding[]> {
  const findings: SecretFinding[] = [];

  let entries;
  try {
    entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  } catch {
    return findings;
  }

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const filePath = path.join(entry.parentPath, entry.name);
    const relative = path.relative(dir, filePath);

    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      continue;
    }
    if (stat.size > MAX_SCAN_BYTES) {
      findings.push({
        detail: `File is unexpectedly large (${stat.size} bytes) and was not scanned; app folders should only hold small config and docs.`,
        file: relative,
      });
      continue;
    }

    let text: string;
    try {
      text = await fs.readFile(filePath, "utf8");
    } catch {
      continue;
    }

    if (
      credential !== null &&
      credential.length > 0 &&
      text.includes(credential)
    ) {
      findings.push({
        detail:
          "Contains the app's stored credential verbatim. Remove it -- credentials are injected at request time and must never be written to app files.",
        file: relative,
      });
    }

    for (const name of scanTextForSecrets(text)) {
      findings.push({
        detail: `Contains a string that looks like a secret (${name}). App files must not contain secrets.`,
        file: relative,
      });
    }
  }

  return findings;
}

function scanTextForSecrets(text: string): string[] {
  return [...new Set(findSecrets(text).map(({ label }) => label))];
}
