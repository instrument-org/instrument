/**
 * Print the ChatGPT account access token Studio holds for a signed-in account,
 * so a script or an eval can run against the plan the way the app does:
 *
 *   APP_CHATGPT_ACCOUNT_TOKEN=$(pnpm --silent script:chatgpt-account-token) pnpm eval run ...
 *
 * With several accounts signed in, `--email <address>` picks one; without it,
 * the first one signed in answers.
 *
 * A packaged build keeps the store encrypted with Electron's safeStorage, which
 * on macOS is Chromium's OSCrypt: an AES-128-CBC key derived from the app's
 * "Safe Storage" Keychain password. A dev build (`--dev`) keeps it as plain
 * JSON. macOS only.
 *
 * This only reads. The token lasts about an hour and the app renews it when it
 * next uses the plan or shows its settings card; renewing it here would rotate
 * the refresh token out from under the app and sign it out, so an expired
 * token is reported rather than renewed.
 */
import { APP_NAME } from "@instrument-org/shared";
import { execFileSync } from "node:child_process";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";

const { values } = parseArgs({
  options: {
    dev: { default: false, type: "boolean" },
    email: { type: "string" },
  },
});

const StoreSchema = z.object({
  registrations: z.record(
    z.string(),
    z.object({
      accessToken: z.string().optional(),
      addedAt: z.number(),
      email: z.string().optional(),
      expiresAt: z.number().optional(),
    }),
  ),
});

const userData = path.join(
  homedir(),
  "Library",
  "Application Support",
  values.dev ? `${APP_NAME} (Dev)` : APP_NAME,
);

// The default workspace's settings hold the plan; the userData root held it
// before workspaces, and an install not yet migrated still does.
const storeDir = [
  path.join(userData, "workspace", ".instrument", "settings"),
  userData,
].find((dir) =>
  existsSync(
    path.join(
      dir,
      values.dev ? "chatgpt-account.json" : "chatgpt-account.json.enc",
    ),
  ),
);
if (!storeDir) {
  throw new Error(`No ChatGPT account under ${userData}`);
}

const store = StoreSchema.parse(
  JSON.parse(
    values.dev
      ? readFileSync(path.join(storeDir, "chatgpt-account.json"), "utf8")
      : decryptSafeStorage(
          readFileSync(path.join(storeDir, "chatgpt-account.json.enc"), "utf8"),
        ),
  ),
);

const account = Object.values(store.registrations)
  .toSorted((a, b) => a.addedAt - b.addedAt)
  .find(
    (candidate) =>
      candidate.accessToken &&
      (values.email === undefined || candidate.email === values.email),
  );
if (!account?.accessToken) {
  throw new Error(
    `No ChatGPT account${values.email ? ` ${values.email}` : ""} is signed in to ${path.basename(userData)}`,
  );
}

const minutesLeft = Math.floor(
  ((account.expiresAt ?? 0) - Date.now()) / 60_000,
);
if (minutesLeft <= 0) {
  throw new Error(
    "The ChatGPT token has expired. Send a message on the plan in the app, or open its ChatGPT card in Settings, which renews it, and run this again.",
  );
}

process.stderr.write(
  `ChatGPT account token for ${account.email ?? "the account"} valid for ${minutesLeft} more minutes\n`,
);
process.stdout.write(account.accessToken);

function decryptSafeStorage(base64: string): string {
  const password = execFileSync(
    "security",
    ["find-generic-password", "-s", `${APP_NAME} Safe Storage`, "-w"],
    { encoding: "utf8" },
  ).trim();
  const key = pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
  const encrypted = Buffer.from(base64, "base64");
  // Chromium prefixes the ciphertext with its scheme version.
  if (encrypted.subarray(0, 3).toString() !== "v10") {
    throw new Error("Unrecognized safeStorage format");
  }
  const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, " "));
  return Buffer.concat([
    decipher.update(encrypted.subarray(3)),
    decipher.final(),
  ]).toString("utf8");
}
