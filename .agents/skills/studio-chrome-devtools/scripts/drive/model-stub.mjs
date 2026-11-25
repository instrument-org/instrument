// A stand-in model for a run: an OpenAI-compatible server on loopback that
// answers each agent turn with the next scripted reply, so a check of what
// the app does with a reply needs no account, no network and no spend.
//
// A request that offers tools is an agent turn and takes the next reply in
// order; one that offers none is a side call (a chat's title, a digest) and
// gets the reply's first words, and so does the app's own ask for what to
// send next, so side calls never use up the script. A
// reply is text, or `{ tool, input }` for one tool call, or
// `{ text, tools: [{ tool, input }] }`. Once the script runs out, every turn
// is answered "Done.".

import { createServer } from "node:http";

const MODEL_ID = "studio-drive-stand-in";

function chunk(id, delta, finish = null) {
  return `data: ${JSON.stringify({
    choices: [{ delta, finish_reason: finish, index: 0 }],
    created: Math.floor(Date.now() / 1000),
    id,
    model: MODEL_ID,
    object: "chat.completion.chunk",
  })}\n\n`;
}

/** The SSE body for one reply. Exported for its test. */
export function streamOf(reply, id = "stand-in") {
  const parts = [chunk(id, { content: "", role: "assistant" })];
  const shaped =
    typeof reply === "string"
      ? { text: reply, tools: [] }
      : reply.tool
        ? { text: "", tools: [reply] }
        : { text: reply.text ?? "", tools: reply.tools ?? [] };
  // A few words at a time, as a model streams.
  for (const piece of shaped.text.match(/\S+\s*|\s+/g) ?? []) {
    parts.push(chunk(id, { content: piece }));
  }
  shaped.tools.forEach((call, index) => {
    parts.push(
      chunk(id, {
        tool_calls: [
          {
            function: {
              arguments: JSON.stringify(call.input ?? {}),
              name: call.tool,
            },
            id: `call_${index}_${Math.random().toString(36).slice(2, 8)}`,
            index,
            type: "function",
          },
        ],
      }),
    );
  });
  parts.push(chunk(id, {}, shaped.tools.length > 0 ? "tool_calls" : "stop"));
  parts.push(
    `data: ${JSON.stringify({
      choices: [],
      id,
      model: MODEL_ID,
      object: "chat.completion.chunk",
      usage: { completion_tokens: 10, prompt_tokens: 10, total_tokens: 20 },
    })}\n\n`,
  );
  parts.push("data: [DONE]\n\n");
  return parts.join("");
}

/** Starts the server. `close()` ends it; `requests` lists what it was asked. */
export async function startModelStub(replies = []) {
  const queue = [...replies];
  const requests = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (data) => {
      body += data;
    });
    request.on("end", () => {
      const url = request.url ?? "";
      if (request.method === "GET" && url.endsWith("/models")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            data: [{ created: 0, id: MODEL_ID, object: "model", owned_by: "studio-drive" }],
            object: "list",
          }),
        );
        return;
      }
      if (request.method === "POST" && url.endsWith("/chat/completions")) {
        let parsed = {};
        try {
          parsed = JSON.parse(body);
        } catch {
          // Answered all the same.
        }
        const lastText = JSON.stringify([...(parsed.messages ?? [])].reverse().find((message) => message.role === "user")?.content ?? "");
        // The app's own asks of the model (suggestions for what to send
        // next) carry the agent's tools too, and say who they are from.
        const isTurn =
          Array.isArray(parsed.tools) &&
          parsed.tools.length > 0 &&
          !lastText.includes("This message is from Instrument, not the person");
        const lastUser = [...(parsed.messages ?? [])]
          .reverse()
          .find((message) => message.role === "user");
        const reply = isTurn ? (queue.shift() ?? "Done.") : sideReply(replies);
        requests.push({
          kind: isTurn ? "turn" : "side",
          prompt:
            typeof lastUser?.content === "string"
              ? lastUser.content.slice(0, 200)
              : JSON.stringify(lastUser?.content ?? "").slice(0, 200),
          reply,
        });
        if (parsed.stream === false) {
          const text = typeof reply === "string" ? reply : (reply.text ?? "");
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              choices: [{ finish_reason: "stop", index: 0, message: { content: text, role: "assistant" } }],
              id: "stand-in",
              model: MODEL_ID,
              object: "chat.completion",
              usage: { completion_tokens: 10, prompt_tokens: 10, total_tokens: 20 },
            }),
          );
          return;
        }
        response.writeHead(200, {
          "cache-control": "no-cache",
          "content-type": "text/event-stream",
        });
        response.end(streamOf(reply));
        return;
      }
      response.writeHead(404);
      response.end();
    });
  });
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  return {
    baseURL: `http://127.0.0.1:${port}/v1`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
    modelId: MODEL_ID,
    requests,
  };
}

function sideReply(replies) {
  const first = replies.find((each) => typeof each === "string") ?? "Stand-in";
  return first.split(/\s+/).slice(0, 4).join(" ");
}
