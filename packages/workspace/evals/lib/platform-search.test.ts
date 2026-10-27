import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { platformSearchClient } from "./platform-search";

describe("platformSearchClient", () => {
  let folder: string;

  beforeEach(async () => {
    folder = await fs.mkdtemp(path.join(os.tmpdir(), "platform-search-"));
    const file = path.join(folder, "account.json");
    await fs.writeFile(
      file,
      JSON.stringify({ api: "https://api.example.test", token: "t" }),
    );
    vi.stubEnv("EVAL_SEARCH_ACCOUNT", file);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await fs.rm(folder, { force: true, recursive: true });
  });

  it.each([
    {
      name: "a body that is not JSON",
      response: () => new Response("<html>Bad gateway</html>", { status: 200 }),
    },
    {
      name: "a body that fails while it is read",
      response: () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error("aborted"));
            },
          }),
          { status: 200 },
        ),
    },
  ])("answers $name as a failed request", async ({ response }) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(response())),
    );
    const result = await platformSearchClient()({
      input: { query: "anything" },
      signal: AbortSignal.timeout(5000),
    });
    expect(result).toMatchObject({ errorType: "request-failed", ok: false });
  });
});
