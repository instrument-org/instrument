// Sends prompts into one new chat, one turn at a time, and measures what each
// streamed turn costs the window: perf-probe-page.js counts per turn, plus the
// session's own size, so the cost of an update can be read against what the
// update carries. A clean room is the place for it:
//
//   node studio-drive.mjs boot --purpose "perf turns" --clean-room perf
//   node studio-drive.mjs run perf-chat-turns.mjs --clean-room perf --allow-reload \
//     --args '{"prompts":["Without using any tools, write 600 words on lighthouses."]}'
//
// Without `model` (a URI from gateway.models.list) it adds Workers AI from the
// two CLOUDFLARE_ lines in packages/workspace/.env, read here so the key never
// prints, and sends with `modelMatch` (glm-4.7-flash by default). `watch`
// names components to record why they rendered. `turnSeconds` (120) caps how
// long one turn is waited on.

import { readFileSync } from "node:fs";
import path from "node:path";

import { installProbe } from "./perf-screens.mjs";
import { REPO_ROOT, sleep } from "./studio-app.mjs";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const newSessionId = () =>
  `ses_0${Array.from({ length: 25 }, () => CROCKFORD[Math.floor(Math.random() * 32)]).join("")}`;

export default async (app, args = {}) => {
  if (!args.prompts?.length) {
    throw new Error(`Pass --args '{"prompts":["…"]}'.`);
  }
  const modelURI = args.model ?? (await workersAiModel(app, args));

  await installProbe(app);
  await app.waitFor("window.__studioDrive && window.__perfProbe", {
    timeout: 60_000,
  });
  await sleep(3000);

  const session = newSessionId();
  const { id: chat } = await app.rpc("workspace.chats.ensure", {
    firstWords: args.prompts[0].slice(0, 40),
    sessionId: session,
  });
  await app.goto(`/chats/${chat}`);
  await sleep(1500);

  const turns = [];
  for (const [index, prompt] of args.prompts.entries()) {
    await app.eval("window.__perfProbe.reset()");
    if (args.watch) {
      await app.eval(`window.__perfProbe.watch(${JSON.stringify(args.watch)})`);
    }
    const sentAt = Date.now();
    await app.rpc("workspace.message.create", {
      id: chat,
      modelURI,
      prompt,
      ...(index === 0 ? { newSessionId: session } : { sessionId: session }),
    });
    const finished = await waitForTurn(
      app,
      chat,
      (args.turnSeconds ?? 120) * 1000,
    );
    const snapshot = await app.eval(
      "window.__perfProbe.snapshot({components: 20, rpc: 12})",
    );
    const list = await app.rpc("workspace.message.list", {
      id: chat,
      sessionId: session,
    });
    const messages = Array.isArray(list) ? list : (list.messages ?? []);
    const live = snapshot.rpcIn.top.find(
      (entry) => entry.path === "/workspace/message/live/list",
    );
    turns.push({
      finished,
      wallMs: Date.now() - sentAt,
      messages: messages.length,
      sessionKb: Math.round(JSON.stringify(messages).length / 1024),
      // The two numbers to read first: what one transcript update carries,
      // and how much renders for it.
      liveUpdates: live?.n ?? 0,
      kbPerUpdate: live ? Math.round(live.kb / live.n) : 0,
      fibersPerCommit: Math.round(
        snapshot.fibersRendered / Math.max(snapshot.commits, 1),
      ),
      ...snapshot,
    });
  }
  // These polls show up in each turn's counts as chats/byId.
  return { chat, modelURI, turns };
};

/** Whether the chat went idle after working before `timeoutMs`. */
async function waitForTurn(app, chat, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let sawWorking = false;
  while (Date.now() < deadline) {
    await sleep(1000);
    const info = await app.rpc("workspace.chats.byId", { id: chat });
    if (info?.state === "working") {
      sawWorking = true;
    } else if (sawWorking) {
      await sleep(1500);
      return true;
    }
  }
  return false;
}

async function workersAiModel(app, args) {
  const match = new RegExp(args.modelMatch ?? "glm-4.7-flash", "i");
  const find = async () => {
    const models = await app.rpc("gateway.models.list", {});
    const all = Array.isArray(models) ? models : (models.models ?? []);
    return all.find((model) => match.test(model.uri ?? ""))?.uri;
  };
  const found = await find();
  if (found) {
    return found;
  }
  const env = Object.fromEntries(
    readFileSync(
      args.envFile ?? path.join(REPO_ROOT, "packages/workspace/.env"),
      "utf8",
    )
      .split("\n")
      .map((line) => /^(CLOUDFLARE_[A-Z_]+)=(.*)$/.exec(line.trim()))
      .filter(Boolean)
      .map(([, key, value]) => [key, value.replaceAll(/^["']|["']$/g, "")]),
  );
  await app.rpc("providerConfig.create", {
    config: {
      apiKey: env.CLOUDFLARE_WORKERS_AI_API_KEY,
      baseURL: `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/v1`,
      name: "Workers AI",
      type: "openai-compatible",
    },
    skipValidation: true,
  });
  await sleep(2000);
  const added = await find();
  if (!added) {
    throw new Error(`No model matches ${match} after adding Workers AI.`);
  }
  return added;
}
