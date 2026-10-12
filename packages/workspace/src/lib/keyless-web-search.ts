import { APP_NAME } from "@instrument-org/shared";
import { err, ok, type Result } from "neverthrow";
import { z } from "zod";

import { type WebSearchResult } from "../schemas/web-search";

/**
 * Exa's hosted MCP server, which searches without a key or an account. It
 * limits each client IP on its own terms, so it carries a search for someone
 * with no other backend rather than standing in for ours.
 */
const KEYLESS_SEARCH_URL = "https://mcp.exa.ai/mcp";

// Matches what our own endpoint ranks per search.
const NUM_RESULTS = 6;

// A shared pool behind the free tier turns away some calls even at an agent's
// pace; measured, every one that failed went through on a retry a second later.
const RETRY_DELAY_MS = 1000;

const ResponseSchema = z.union([
  z.object({
    result: z.object({
      _meta: z.object({ "ai.exa/rateLimited": z.boolean() }).optional(),
      content: z.array(z.object({ text: z.string().optional() })),
      isError: z.boolean().optional(),
    }),
  }),
  z.object({ error: z.object({ message: z.string() }) }),
]);

type KeylessSearchFailure =
  | { kind: "failed"; message: string }
  | { kind: "rate-limited" };

export async function searchKeyless({
  appVersion,
  query,
  signal,
}: {
  appVersion: string;
  query: string;
  signal: AbortSignal;
}): Promise<Result<WebSearchResult[], string>> {
  const first = await requestKeylessSearch({ appVersion, query, signal });
  if (first.isOk() || first.error.kind !== "rate-limited") {
    return first.mapErr(failureMessage);
  }

  await delay(RETRY_DELAY_MS, signal);
  if (signal.aborted) {
    return first.mapErr(failureMessage);
  }
  const second = await requestKeylessSearch({ appVersion, query, signal });
  return second.mapErr(failureMessage);
}

function failureMessage(failure: KeylessSearchFailure) {
  return failure.kind === "rate-limited"
    ? "The free web search is busy right now."
    : failure.message;
}

async function requestKeylessSearch({
  appVersion,
  query,
  signal,
}: {
  appVersion: string;
  query: string;
  signal: AbortSignal;
}): Promise<Result<WebSearchResult[], KeylessSearchFailure>> {
  let response: Response;
  try {
    response = await fetch(KEYLESS_SEARCH_URL, {
      body: JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          arguments: { numResults: NUM_RESULTS, query },
          name: "web_search_exa",
        },
      }),
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "user-agent": `${APP_NAME}/${appVersion}`,
      },
      method: "POST",
      signal,
    });
  } catch (error) {
    return err({
      kind: "failed",
      message: `The free web search could not be reached: ${error instanceof Error ? error.message : "unknown error"}.`,
    });
  }

  if (response.status === 429) {
    return err({ kind: "rate-limited" });
  }

  const body = await response.text();
  if (!response.ok) {
    return err({
      kind: "failed",
      message: `The free web search failed with status ${response.status}.`,
    });
  }

  const parsed = ResponseSchema.safeParse(parseJsonRpcBody(body));
  if (!parsed.success) {
    return err({
      kind: "failed",
      message: "The free web search returned an unexpected response.",
    });
  }
  if ("error" in parsed.data) {
    return err({ kind: "failed", message: parsed.data.error.message });
  }

  const { _meta, content, isError } = parsed.data.result;
  // A limit the server applies inside the tool still answers 200, so the flag
  // is the only sign of it.
  if (_meta?.["ai.exa/rateLimited"]) {
    return err({ kind: "rate-limited" });
  }
  const text = content.map((part) => part.text ?? "").join("\n");
  if (isError) {
    return err({ kind: "failed", message: text });
  }

  return ok(parseResults(text));
}

/**
 * The server answers either as plain JSON or as one server-sent event, by
 * which it prefers at the time; both carry the same JSON-RPC message.
 */
function parseJsonRpcBody(body: string): unknown {
  const data = body
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .join("");
  try {
    return JSON.parse(data === "" ? body : data);
  } catch {
    return undefined;
  }
}

/**
 * The tool returns its results as text, one block per page with a `Title:`,
 * `URL:`, `Published:`, and `Author:` line followed by the matching passages,
 * blocks separated by a `---` line. A block with no URL is dropped rather than
 * failing the rest.
 */
export function parseResults(text: string): WebSearchResult[] {
  return text.split(/\n+---\n+(?=Title: )/).flatMap((block) => {
    const url = field(block, "URL");
    if (!url) {
      return [];
    }
    const passages = /^(?:Highlights:\n|Text: )([\s\S]*)$/m.exec(block)?.[1];
    return [
      {
        author: field(block, "Author"),
        publishedDate: field(block, "Published"),
        text: passages?.trim() ?? "",
        title: field(block, "Title"),
        url,
      },
    ];
  });
}

function field(block: string, name: string) {
  const value = new RegExp(`^${name}: (.*)$`, "m").exec(block)?.[1]?.trim();
  return value === undefined || value === "" || value === "N/A"
    ? undefined
    : value;
}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
