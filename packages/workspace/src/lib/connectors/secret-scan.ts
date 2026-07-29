import fs from "node:fs/promises";
import path from "node:path";

import { type AbsolutePath } from "../../schemas/paths";

// Only text-ish connector files are scanned; anything larger than this is
// almost certainly not a hand-written config/guide and gets flagged instead.
const MAX_SCAN_BYTES = 512 * 1024;

interface SecretFinding {
  detail: string;
  file: string;
}

// Deliberately small, high-signal set: connector folders are tiny and these
// cover the token shapes agents actually paste by mistake. The stored
// credential itself is checked verbatim separately.
// cspell:ignore abprs AKIA bntn bxox oprsu
const SECRET_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "OpenAI-style key", pattern: /\bsk-[\w-]{16,}\b/ },
  { name: "GitHub token", pattern: /\bgh[oprsu]_[A-Za-z0-9]{20,}\b/ },
  { name: "Slack token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "AWS access key id", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Notion token", pattern: /\bntn_[A-Za-z0-9]{20,}\b/ },
  { name: "Private key block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "JWT", pattern: /\beyJ[\w-]{8,}\.eyJ[\w-]{8,}\./ },
  {
    name: "Inline credential assignment",
    pattern:
      /["'`]?(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)["'`]?\s*[:=]\s*["'`][^"'`\s]{16,}["'`]/i,
  },
];

/**
 * Scan every file in a connector folder for secret-shaped strings and for the
 * connector's actual stored credential. Connector folders must never contain
 * secrets -- credentials live only in the app's encrypted store.
 */
export async function scanConnectorFolder({
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
        detail: `File is unexpectedly large (${stat.size} bytes) and was not scanned; connector folders should only hold small config and docs.`,
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
          "Contains the connector's stored credential verbatim. Remove it -- credentials are injected at request time and must never be written to connector files.",
        file: relative,
      });
    }

    for (const name of scanTextForSecrets(text)) {
      findings.push({
        detail: `Contains a string that looks like a secret (${name}). Connector files must not contain secrets.`,
        file: relative,
      });
    }
  }

  return findings;
}

function scanTextForSecrets(text: string): string[] {
  return SECRET_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(
    ({ name }) => name,
  );
}
