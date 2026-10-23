import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

import { AbsolutePathSchema } from "../../schemas/paths";
import { scanAppFolder } from "./secret-scan";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "secret-scan-test-"));
});

afterEach(async () => {
  await fs.rm(dir, { force: true, recursive: true });
});

it("names each kind of secret an app's files hold, and passes placeholders", async () => {
  await fs.writeFile(
    path.join(dir, "APP.md"),
    [
      "Send `Authorization: Bearer $LINEAR_API_KEY` with every request.",
      `Example: LINEAR_API_KEY=lin_api_${"aB3dE5gH7j".repeat(4)}`,
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(dir, "config.json"),
    JSON.stringify({ maps: `AIza${"aB3dE5gH7j".repeat(3)}aB3dE`, user: "sam" }),
  );
  await fs.writeFile(
    path.join(dir, "notes.md"),
    "Call `GET /v1/items?api_key=$KEY`; the key lives in the app's store.",
  );

  const findings = await scanAppFolder({
    credential: null,
    dir: AbsolutePathSchema.parse(dir),
  });

  expect(findings.map(({ detail, file }) => `${file}: ${detail}`).toSorted())
    .toMatchInlineSnapshot(`
    [
      "APP.md: Contains a string that looks like a secret (Linear key). App files must not contain secrets.",
      "config.json: Contains a string that looks like a secret (Google API key). App files must not contain secrets.",
    ]
  `);
});
