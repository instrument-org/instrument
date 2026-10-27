import os from "node:os";
import { describe, expect, it } from "vitest";

import { type SessionMessage } from "../schemas/session/message";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type HandOff } from "../lib/shell-commands/task-hand-off";
import { TOOL_NAMES } from "../tools/name";
import { instrumentAgent, shouldContinueAfterHandingOff } from "./instrument";

const sessionId = StoreId.newSessionId();
const createdAt = new Date("2026-01-01T00:00:00.000Z");

function assistant(
  ...parts: ((messageId: StoreId.Message) => SessionMessagePart.Type)[]
): SessionMessage.WithParts {
  const id = StoreId.newMessageId();
  return {
    id,
    metadata: {
      createdAt,
      finishReason: "stop",
      modelId: "mock-model",
      providerId: "instrument",
      sessionId,
    },
    parts: parts.map((part) => part(id)),
    role: "assistant",
  };
}

function partMetadata(messageId: StoreId.Message) {
  return { createdAt, id: StoreId.newPartId(), messageId, sessionId };
}

function user(
  ...parts: ((messageId: StoreId.Message) => SessionMessagePart.Type)[]
): SessionMessage.WithParts {
  const id = StoreId.newMessageId();
  return {
    id,
    metadata: { createdAt, sessionId },
    parts: parts.map((part) => part(id)),
    role: "user",
  };
}

const text =
  (value: string) =>
  (messageId: StoreId.Message): SessionMessagePart.Type => ({
    metadata: partMetadata(messageId),
    state: "done",
    text: value,
    type: "text",
  });

const bash =
  (command: string, output: string, handOffs?: HandOff[]) =>
  (messageId: StoreId.Message): SessionMessagePart.Type => ({
    input: { command, explanation: "Running", yieldMs: 1000 },
    metadata: { ...partMetadata(messageId), endedAt: createdAt },
    output: {
      command,
      commands: [command.split(" ")[0] ?? command],
      durationMs: 0,
      exitCode: 0,
      ...(handOffs ? { handOffs } : {}),
      omittedBytes: 0,
      output,
    },
    state: "output-available",
    toolCallId: `call-${messageId}`,
    type: "tool-bash",
  });

const askPermission =
  (state: "allowed" | "asked") =>
  (messageId: StoreId.Message): SessionMessagePart.Type => ({
    input: {
      explanation: "Asking for Desktop",
      kind: "folder",
      reason: "So I can put the copy there.",
      target: "/Users/sam/Desktop",
    },
    metadata: { ...partMetadata(messageId), endedAt: createdAt },
    output:
      state === "asked"
        ? { kind: "folder", state, target: "/Users/sam/Desktop" }
        : { state, target: "/Users/sam/Desktop" },
    state: "output-available",
    toolCallId: `call-${messageId}`,
    type: "tool-ask_permission",
  });

const taskNew = bash(
  "instrument task new --name 'Lisbon' <<'EOF'\nFind a hotel.\nEOF",
  'Created lisbon-hotel ("Lisbon"). It is running now.\n',
  [
    {
      kind: "created",
      sessionId: StoreId.SessionSchema.parse("ses_01K4M8C2B5N7R0T3V6X9Z1D4F7"),
    },
  ],
);

describe("shouldContinueAfterHandingOff", () => {
  it("ends the turn once a task was made and a line was said", async () => {
    await expect(
      shouldContinueAfterHandingOff({
        messages: [
          user(text("find me a hotel in lisbon")),
          assistant(text("Looking for one."), taskNew),
        ],
      }),
    ).resolves.toBe(false);
  });

  it("ends the turn on a permission card, with no step after it for a line", async () => {
    await expect(
      shouldContinueAfterHandingOff({
        messages: [
          user(text("put a copy on my desktop")),
          assistant(askPermission("asked")),
        ],
      }),
    ).resolves.toBe(false);
  });

  it("ends the turn on a card a bash command raised, with no step after it", async () => {
    const request = "instrument window request tab_01K4M8C2B5N7R0T3V6X9Z1D4F7";
    await expect(
      shouldContinueAfterHandingOff({
        messages: [
          user(text("add the cart to my order")),
          assistant((messageId) => {
            const part = bash(
              request,
              "Asked the user to move tab …\n",
            )(messageId);
            return part.type === "tool-bash" &&
              part.state === "output-available"
              ? { ...part, output: { ...part.output, asks: ["ask-1"] } }
              : part;
          }),
        ],
      }),
    ).resolves.toBe(false);
  });

  it("carries on when the folder asked for was already allowed", async () => {
    await expect(
      shouldContinueAfterHandingOff({
        messages: [
          user(text("put a copy on my desktop")),
          assistant(askPermission("allowed")),
        ],
      }),
    ).resolves.toBe(true);
  });

  it("gives a hand-off that said nothing one more step, for the line", async () => {
    await expect(
      shouldContinueAfterHandingOff({
        messages: [user(text("find me a hotel in lisbon")), assistant(taskNew)],
      }),
    ).resolves.toBe(true);
  });

  it("keeps the turn open when the task waits on the user's answer to a system ask", async () => {
    await expect(
      shouldContinueAfterHandingOff({
        messages: [
          user(text("put cat.md on my desktop")),
          assistant(
            text("Making it now."),
            bash(
              "instrument task new --name 'cat.md' --folder /Users/sam/Desktop <<'EOF'\nWrite cat.md.\nEOF",
              'Created cat-md ("cat.md"). macOS is asking the user whether Instrument may use "/Users/sam/Desktop", and the task starts once they answer: tell them to answer the system\'s dialog.\n',
            ),
          ),
        ],
      }),
    ).resolves.toBe(true);
  });

  it("treats a task send the same as a task new", async () => {
    await expect(
      shouldContinueAfterHandingOff({
        messages: [
          user(text("make it about a submarine")),
          assistant(
            text("Steering it."),
            bash(
              "instrument task send lisbon-hotel <<'EOF'\nA submarine.\nEOF",
              "Sent to lisbon-hotel. It is busy and will hear this at its next step.\n",
              [
                {
                  kind: "sent",
                  sessionId: StoreId.SessionSchema.parse(
                    "ses_01K4M8C2B5N7R0T3V6X9Z1D4F7",
                  ),
                },
              ],
            ),
          ),
        ],
      }),
    ).resolves.toBe(false);
  });

  it("carries on as any agent would when nothing was handed off", async () => {
    await expect(
      shouldContinueAfterHandingOff({
        messages: [
          user(text("what is in my downloads?")),
          assistant(bash("ls /Users/sam/Downloads", "a.pdf\nb.pdf\n")),
        ],
      }),
    ).resolves.toBe(true);
    await expect(
      shouldContinueAfterHandingOff({
        messages: [
          user(text("what is in my downloads?")),
          assistant(bash("ls /Users/sam/Downloads", "a.pdf\nb.pdf\n")),
          assistant(text("Two PDFs.")),
        ],
      }),
    ).resolves.toBe(false);
  });

  it("does not take printed text that reads like a hand-off for one", async () => {
    await expect(
      shouldContinueAfterHandingOff({
        messages: [
          user(text("what did the last task say?")),
          assistant(
            text("Checking."),
            bash(
              "task show lisbon-hotel",
              'Created lisbon-hotel ("Lisbon").\nSent to lisbon-hotel.\n',
            ),
          ),
        ],
      }),
    ).resolves.toBe(true);
  });

  it("only counts a hand-off that the command reported", async () => {
    await expect(
      shouldContinueAfterHandingOff({
        messages: [
          user(text("find me a hotel in lisbon")),
          assistant(
            text("On it."),
            bash("instrument task new", "task: new: a brief is required"),
          ),
        ],
      }),
    ).resolves.toBe(true);
  });
});

describe("instrumentAgent", () => {
  const prompt = instrumentAgent.systemPrompt();

  it("writes the same system prompt on every computer", () => {
    // A synced chat keeps the prompt it started with, so one naming this
    // computer's folders or platform would be wrong everywhere else.
    expect(prompt).not.toContain(os.homedir());
    const platform = process.platform;
    try {
      for (const other of ["darwin", "linux", "win32"] as const) {
        Object.defineProperty(process, "platform", { value: other });
        expect(instrumentAgent.systemPrompt()).toBe(prompt);
      }
    } finally {
      Object.defineProperty(process, "platform", { value: platform });
    }
  });

  it("does the work with every tool, the chat's and a worker's alike", () => {
    expect(
      Object.values(instrumentAgent.agentTools)
        .map((tool) => tool.name)
        .toSorted(),
    ).toEqual(
      [
        TOOL_NAMES.askPermission,
        TOOL_NAMES.bash,
        TOOL_NAMES.choose,
        TOOL_NAMES.connectApp,
        TOOL_NAMES.editFile,
        TOOL_NAMES.generateImage,
        TOOL_NAMES.loadSkill,
        TOOL_NAMES.offerFeedback,
        TOOL_NAMES.readFile,
        TOOL_NAMES.webFetch,
        TOOL_NAMES.webSearch,
        TOOL_NAMES.writeFile,
      ].toSorted(),
    );
  });

  it("starts a task as a fork of itself, in the same folder", () => {
    expect(prompt).toContain(
      "A task is you, continuing in the background with this conversation in hand",
    );
    expect(prompt).toContain(
      "instrument task new --name '<title>' [--tab <id>]",
    );
    expect(prompt).toContain(
      "this same folder, and the same folders and apps at the same paths",
    );
  });

  it("names its folders by the variables the shell sets", () => {
    for (const named of [
      "Every command starts in your work folder, `$INSTRUMENT_WORK`",
      "`$INSTRUMENT_OUTPUT`",
      "Throwaway files go in `$TMPDIR`",
      "`$INSTRUMENT_SKILL_DIR` is its folder",
    ]) {
      expect(prompt).toContain(named);
    }
    // A sent file is read where the person keeps it, so the prompt must not
    // send the agent to a folder of copies that no longer holds one.
    for (const gone of [
      "package root",
      "virtualenv",
      "`work/",
      "`skills/`",
      "INSTRUMENT_ATTACHMENTS",
    ]) {
      expect(prompt).not.toContain(gone);
    }
  });

  it("names no flag or mount the task command does not have", () => {
    for (const gone of [
      "--fresh",
      "--folder",
      "--file",
      "--app",
      "/tasks",
      "brief",
      "folder self",
    ]) {
      expect(prompt).not.toContain(gone);
    }
  });

  it("keeps the rules the chat and the worker each had", () => {
    for (const kept of [
      "One line, then act, in the same reply",
      "instrument memory save <name> <<'EOF'",
      "the save and the start go in one command, the save first",
      "name scratch files and folders after the job",
      "Nothing of theirs is deleted or overwritten unless they said so",
      "a finished file goes straight in it by its own name, and a folder the user names is made inside it",
      "IMPORTANT: Never fabricate a URL.",
      "links it the first time",
      "Every call carries an `activity`",
      "```files fence",
      "```message fence",
    ]) {
      expect(prompt).toContain(kept);
    }
  });
});
