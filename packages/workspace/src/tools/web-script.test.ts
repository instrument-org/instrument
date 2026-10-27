import { mkdir } from "node:fs/promises";
import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLocalBashEnv } from "../lib/create-bash-env";
import { chatDir } from "../lib/record-folders";
import { ChatIdSchema } from "../schemas/chat-id";
import { StoreId } from "../schemas/store-id";
import { knowChat } from "../test/helpers/mock-chat-config";

const chatId = ChatIdSchema.parse("web-script");
let server: http.Server;
let base = "";

// Pages on loopback, so a script's fetch goes through the tool's own fetch:
// the redirect checks, the Markdown conversion and the error wording.
beforeAll(async () => {
  server = http.createServer((req, res) => {
    const page = /^\/page\/(\d+)$/.exec(req.url ?? "")?.[1];
    if (page === undefined) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("No such page.");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(
      `<html><body><h1>Page ${page}</h1><p>Body of ${page}.</p></body></html>`,
    );
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP address");
  }
  base = `http://127.0.0.1:${address.port}`;
  knowChat(chatId);
  await mkdir(chatDir(chatId), { recursive: true });
});

afterAll(() => {
  server.close();
});

async function node(code: string) {
  const bash = await createLocalBashEnv({
    chatId,
    sessionId: StoreId.newSessionId(),
  });
  return bash.exec(`node --input-type=module <<'EOF'
${code}
EOF`);
}

describe("instrument.web.fetch in a script", () => {
  it("fans out over pages and hands each back as data", async () => {
    const result = await node(
      `const pages = await Promise.all([1, 2, 3].map((n) => instrument.web.fetch("${base}/page/" + n)));
console.log(pages.map((page) => page.text.split("\\n")[0]).join(" | "));
const one = await instrument.web.fetch({ url: "${base}/page/4", maxCharacters: 7 });
console.log(one.format, one.truncated, JSON.stringify(one.text));`,
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatchInlineSnapshot(`
      "# Page 1 | # Page 2 | # Page 3
      markdown true "# Page "
      "
    `);
  });

  it("throws what the tool would have said of a failed fetch", async () => {
    const result = await node(
      `try { await instrument.web.fetch("${base}/missing"); } catch (error) { console.log(error.name, error.message); }
try { await instrument.web.fetch("file:///etc/passwd"); } catch (error) { console.log(error.message); }`,
    );
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatchInlineSnapshot(`
      "InstrumentError Request failed with status 404 Not Found. The site said: No such page.
      URL must be an http:// or https:// address.
      "
    `);
  });
});
