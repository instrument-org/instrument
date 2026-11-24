import { expect, it } from "vitest";

import { scanAppRecord } from "./secret-scan";

it("names each kind of secret an app's setup and guide hold, and passes placeholders", () => {
  const findings = scanAppRecord({
    keys: [],
    guide: [
      "Send `Authorization: Bearer $LINEAR_API_KEY` with every request.",
      `Example: LINEAR_API_KEY=lin_api_${"aB3dE5gH7j".repeat(4)}`,
      "Call `GET /v1/items?api_key=$KEY`; the key lives in the app's store.",
    ].join("\n"),
    setup: {
      headers: { "X-Maps": `AIza${"aB3dE5gH7j".repeat(3)}aB3dE` },
      type: "api",
    },
  });

  expect(findings.map(({ detail, file }) => `${file}: ${detail}`).toSorted())
    .toMatchInlineSnapshot(`
    [
      "guide: Contains a string that looks like a secret (Linear key). An app's setup and guide must not contain secrets.",
      "setup: Contains a string that looks like a secret (Google API key). An app's setup and guide must not contain secrets.",
    ]
  `);
});

it("finds the stored credential written into the guide", () => {
  expect(
    scanAppRecord({
      keys: ["s3cr3t-value"],
      guide: "Use s3cr3t-value as the key.",
      setup: { type: "api" },
    }).map(({ file }) => file),
  ).toEqual(["guide"]);
});
