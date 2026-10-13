// A `studio-drive run` sequence that sends one prompt and reports the turn as
// one line per step, so a check of what the agent did costs a few hundred
// tokens rather than a full `message.list`.
//
//   node studio-drive.mjs run chat-turn.mjs --quiet --args '{"prompt":"…"}'
//   node studio-drive.mjs run chat-turn.mjs --quiet --args '{"chat":"<id>","session":"ses_…","prompt":"…"}'
//
// Without `chat` it starts a new chat and opens it. `model` is a model URI
// (`gateway.models.list`); without one it takes Instrument's Auto.
// It returns when the chat has gone idle or one of its own cards is waiting,
// whichever comes first, with `waitingOn` listing the cards. `answer`
// ("allowed", "always" or "declined") answers the chat's open cards first, as
// the card's buttons would. `wait: false` returns as soon as the prompt is
// sent, for a turn that starts a long task. Several chats can be driven at
// once: everything is read per chat over RPC, nothing from the visible page.

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TEXT_LIMIT = 600;
const FIELD_LIMIT = 400;

const newSessionId = () =>
  `ses_0${Array.from({ length: 25 }, () => CROCKFORD[Math.floor(Math.random() * 32)]).join("")}`;

export default async (app, args) => {
  if (!args.prompt && !args.chat) {
    throw new Error(
      'Pass --args \'{"prompt":"…"}\', with chat and session to follow up.',
    );
  }
  if (args.chat && args.answer) {
    for (const ask of await openAsks(app, args.chat)) {
      await app.rpc("workspace.permissions.answer", {
        askId: ask.id,
        decision: args.answer,
        id: args.chat,
      });
    }
  }
  let { chat, session } = args;
  const modelURI = args.model ?? (await firstModel(app));
  if (!chat) {
    session = newSessionId();
    ({ id: chat } = await app.rpc("workspace.chats.ensure", {
      firstWords: args.prompt.slice(0, 40),
      sessionId: session,
    }));
    await app.rpc("workspace.message.create", {
      id: chat,
      modelURI,
      newSessionId: session,
      prompt: args.prompt,
    });
    await app.goto(`/chats/${chat}`);
  } else {
    // Also without a prompt, which reads the chat's latest turn as it stands.
    session ??= (await app.rpc("workspace.chats.session", { id: chat }))
      .sessionId;
  }
  if (args.chat && args.prompt) {
    await app.rpc("workspace.message.create", {
      id: chat,
      modelURI,
      prompt: args.prompt,
      sessionId: session,
    });
  }

  if (args.wait === false) return { chat, session, sent: true };
  const waited = await waitForTurn(app, chat, args.timeoutMs ?? 240_000);
  const list = await app.rpc("workspace.message.list", {
    id: chat,
    sessionId: session,
  });
  const messages = Array.isArray(list) ? list : (list.messages ?? []);
  const fromIndex = args.allMessages ? 0 : lastUserIndex(messages);
  return {
    chat,
    session,
    ...waited,
    steps: messages.slice(fromIndex).flatMap(stepsOf),
  };
};

async function firstModel(app) {
  const models = await app.rpc("gateway.models.list", {});
  const all = Array.isArray(models) ? models : (models.models ?? []);
  // Instrument's own Auto is what a new chat gets, so it is the default here.
  const first =
    all.find((model) => model.uri?.startsWith("instrument/auto")) ?? all[0];
  if (!first?.uri) {
    throw new Error(
      "No model to send with. Pass model, a URI from gateway.models.list.",
    );
  }
  return first.uri;
}

/** The chat's open cards, oldest first, as its cards draw them. */
const openAsks = (app, chat) =>
  app.rpc("workspace.permissions.asks", { id: chat });

/**
 * Idle has to hold for two seconds once the chat has been seen working, and
 * eight when it never was, since a chat reads idle before its turn starts. A
 * card ends the wait at once: the turn is parked until someone answers it.
 */
async function waitForTurn(app, chat, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let sawBusy = false;
  let idleSince = 0;
  while (Date.now() < deadline) {
    const info = await app.rpc("workspace.chats.byId", { id: chat });
    const asks = await openAsks(app, chat);
    if (asks.length > 0) {
      return {
        sawBusy,
        waitingOn: asks.map(({ id, kind, target }) => ({ id, kind, target })),
      };
    }
    if (info?.state === "working") {
      sawBusy = true;
      idleSince = 0;
    } else {
      idleSince ||= Date.now();
      if (Date.now() - idleSince > (sawBusy ? 2000 : 8000)) return { sawBusy };
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return { sawBusy, timedOut: true };
}

// Parts that make a user-role message the harness's rather than the person's:
// a task finishing, an app changing, the chat writing to a task. The same test
// as isTypedByUser in packages/workspace/src/lib/typed-by-user.ts.
const HARNESS_PARTS = new Set([
  "data-taskEvent",
  "data-appEvent",
  "data-fromChat",
]);

const typedByUser = (message) =>
  message.role === "user" &&
  !(message.parts ?? []).some((part) => HARNESS_PARTS.has(part.type));

function lastUserIndex(messages) {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (typedByUser(messages[index])) return index;
  }
  return 0;
}

function stepsOf(message) {
  // The session's own context (the system prompt, the computer's details) is
  // stored as messages too; it is the same every turn.
  if (message.role !== "user" && message.role !== "assistant") return [];
  return (message.parts ?? []).flatMap((part) => {
    if (HARNESS_PARTS.has(part.type)) {
      return [
        { [part.type.slice(5)]: clip(JSON.stringify(part.data), FIELD_LIMIT) },
      ];
    }
    if (part.type === "text") {
      // A harness note's text repeats what its data part already says.
      if (!typedByUser(message) && message.role === "user") return [];
      return [{ [message.role]: clip(part.text, TEXT_LIMIT) }];
    }
    if (!part.type?.startsWith("tool-")) return [];
    const input = part.input ?? {};
    const output = part.output ?? {};
    return [
      {
        tool: part.type.slice(5),
        state: part.state,
        in: clip(
          input.command ??
            input.filePath ??
            input.path ??
            JSON.stringify(input),
          FIELD_LIMIT,
        ),
        ...(part.errorText
          ? { error: clip(part.errorText, FIELD_LIMIT) }
          : {
              out: clip(
                typeof output === "string"
                  ? output
                  : (output.output ??
                      output.error ??
                      output.message ??
                      JSON.stringify(output)),
                FIELD_LIMIT,
              ),
            }),
        ...(output.exitCode !== undefined && { exit: output.exitCode }),
      },
    ];
  });
}

function clip(value, limit) {
  const text = String(value ?? "");
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
