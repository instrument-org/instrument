import {
  type JSONObject,
  type LanguageModelV4FunctionTool,
  type LanguageModelV4Message,
} from "@ai-sdk/provider";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { z } from "zod";

import {
  closeClaudeAccountSessions,
  createClaudeAccountLanguageModel,
} from "./language-model";
import { shippedClaudeCode } from "./shipped-claude-code";

// Asks a question beside a chat on the Claude account, as a suggested next
// message does, against the Claude Code the app ships and the signed-in
// account's plan, so it only runs when asked: CLAUDE_ACCOUNT_LIVE=1. Pick the
// model with CLAUDE_ASIDE_MODEL.
const live = process.env.CLAUDE_ACCOUNT_LIVE === "1";
const modelId = process.env.CLAUDE_ASIDE_MODEL ?? "claude-haiku-5-5";
const realHome = userInfo().homedir;
const executablePath = live ? shippedClaudeCode() : "";

const CODE_WORD = "TANGERINE-58";

const tools: LanguageModelV4FunctionTool[] = [
  {
    description: "Look up a fact by key. Returns the fact as text.",
    inputSchema: {
      properties: { key: { type: "string" } },
      required: ["key"],
      type: "object",
    },
    name: "lookup",
    type: "function",
  },
];

const said = (text: string): LanguageModelV4Message => ({
  content: [{ text, type: "text" }],
  role: "user",
});

/** The question an aside asks, never stored with the chat. */
const QUESTION: LanguageModelV4Message = {
  ...said(
    "Beside the conversation: what code word did I ask you to remember? Answer with the word only.",
  ),
  providerOptions: { instrument: { transient: true } },
};

/** Where Claude Code files the transcripts of processes run from the home folder. */
const project = join(
  realHome,
  ".claude",
  "projects",
  realpathSync(realHome).replaceAll(/[^a-zA-Z0-9]/g, "-"),
);
const records = join(realHome, ".claude", "instrument-sessions");

/** This test's transcripts: every one that holds its chat's marker. */
function transcriptsOf(marker: string) {
  return (existsSync(project) ? readdirSync(project) : [])
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => join(project, name))
    .filter((path) => readFileSync(path, "utf8").includes(marker));
}

it.skipIf(!live)(
  "an aside reads its chat's transcript, and the chat keeps one process and one transcript",
  { timeout: 600_000 },
  async () => {
    const chatKey = `aside-${randomUUID()}`;
    const logs: string[] = [];
    const capture = (line: unknown) => {
      logs.push(String(line));
    };
    vi.spyOn(console, "info").mockImplementation(capture);
    vi.spyOn(console, "warn").mockImplementation(capture);
    const providers = {
      closeClaudeAccountSessions,
      createClaudeAccountLanguageModel,
    };
    const modelFrom = (from: typeof providers) =>
      from.createClaudeAccountLanguageModel({
        configDir: undefined,
        executablePath,
        providerConfigId: "claude-account",
      })(modelId);
    let model = modelFrom(providers);
    const system: LanguageModelV4Message = {
      content: `You are a terse test assistant. Conversation ${chatKey}.`,
      role: "system",
    };

    async function ask(
      prompt: LanguageModelV4Message[],
      claudeAccount: JSONObject,
    ) {
      const logStart = logs.length;
      const { stream } = await model.doStream({
        prompt,
        providerOptions: { "claude-account": claudeAccount },
        tools,
      });
      const assistant: Extract<LanguageModelV4Message, { role: "assistant" }> =
        { content: [], role: "assistant" };
      const reasoning = new Map<string, string>();
      const result = {
        cacheRead: 0,
        cacheWrite: 0,
        error: undefined as string | undefined,
        finish: "",
        noCache: 0,
        text: "",
      };
      for await (const part of stream) {
        switch (part.type) {
          case "error": {
            result.error = String(part.error);
            break;
          }
          case "text-delta": {
            result.text += part.delta;
            break;
          }
          case "reasoning-start": {
            reasoning.set(part.id, "");
            break;
          }
          case "reasoning-delta": {
            reasoning.set(part.id, (reasoning.get(part.id) ?? "") + part.delta);
            break;
          }
          case "reasoning-end": {
            assistant.content.push({
              providerOptions: part.providerMetadata,
              text: reasoning.get(part.id) ?? "",
              type: "reasoning",
            });
            break;
          }
          case "finish": {
            result.finish = part.finishReason.unified;
            result.cacheRead = part.usage.inputTokens.cacheRead ?? 0;
            result.cacheWrite = part.usage.inputTokens.cacheWrite ?? 0;
            result.noCache = part.usage.inputTokens.noCache ?? 0;
            break;
          }
          default: {
            break;
          }
        }
      }
      if (result.text) {
        assistant.content.push({ text: result.text, type: "text" });
      }
      return {
        ...result,
        assistant,
        path: logs
          .slice(logStart)
          .filter((line) => line.includes("[claude-account]")),
      };
    }

    try {
      const first = said(`Remember the code word ${CODE_WORD}. Reply OK.`);
      const one = await ask([system, first], { sessionId: chatKey });
      const second = said("Reply with the word BLUE and nothing else.");
      const two = await ask([system, first, one.assistant, second], {
        sessionId: chatKey,
      });
      const history = [system, first, one.assistant, second, two.assistant];
      const transcripts = transcriptsOf(chatKey);
      const sizes = transcripts.map((path) => statSync(path).size);

      const aside = await ask([...history, QUESTION], {
        aside: true,
        sessionId: chatKey,
      });
      const asideLow = await ask([...history, QUESTION], {
        aside: true,
        effort: "low",
        sessionId: chatKey,
      });
      // The asides wrote no transcript, and left the chat's as it was.
      const afterAsides = transcriptsOf(chatKey);
      const sizesAfter = transcripts.map((path) => statSync(path).size);
      const third = said(
        "What code word did I ask you to remember? Word only.",
      );
      // At another effort, which the chat's process takes in place.
      const three = await ask([...history, third], {
        effort: "low",
        sessionId: chatKey,
      });
      // After a launch, with no process yet: the record the last step left.
      await providers.closeClaudeAccountSessions();
      vi.resetModules();
      const launched = await import("./language-model");
      providers.closeClaudeAccountSessions =
        launched.closeClaudeAccountSessions;
      model = modelFrom(launched);
      const afterLaunch = await ask(
        [...history, third, three.assistant, QUESTION],
        { aside: true, sessionId: chatKey },
      );
      // With no process after the launch, the next turn resumes the
      // transcript in a new one, and the one it resumed from is removed.
      const fourth = said("Reply with the word GREEN and nothing else.");
      const four = await ask([...history, third, three.assistant, fourth], {
        effort: "low",
        sessionId: chatKey,
      });
      await vi.waitFor(
        () => {
          expect(transcriptsOf(chatKey)).toHaveLength(1);
        },
        { timeout: 10_000 },
      );
      const afterResume = transcriptsOf(chatKey);
      const nothing = await ask([system, QUESTION], {
        aside: true,
        sessionId: `aside-none-${randomUUID()}`,
      });

      console.log(
        JSON.stringify(
          { afterLaunch, aside, asideLow, four, nothing, one, three, two },
          (key, value: unknown) => (key === "assistant" ? undefined : value),
          2,
        ),
      );
      expect(aside.error).toBeUndefined();
      expect(aside.text).toContain(CODE_WORD);
      expect(aside.cacheRead).toBeGreaterThan(0);
      expect(asideLow.text).toContain(CODE_WORD);
      expect(afterAsides).toEqual(transcripts);
      expect(sizesAfter).toEqual(sizes);
      // The chat's own process answered its next turn where it was.
      expect(three.text).toContain(CODE_WORD);
      expect(three.path.join("\n")).not.toMatch(/resumed|cold start/);
      expect(three.cacheRead).toBeGreaterThan(0);
      expect(afterLaunch.text).toContain(CODE_WORD);
      expect(afterLaunch.cacheRead).toBeGreaterThan(0);
      expect(four.text).toContain("GREEN");
      expect(four.path.join("\n")).toMatch(/resumed/);
      expect(afterResume).not.toEqual(transcripts);
      expect(nothing).toMatchObject({ finish: "other", text: "" });
    } finally {
      await providers.closeClaudeAccountSessions();
      const ours = transcriptsOf(chatKey);
      const ids = new Set(
        ours.map((path) => path.slice(path.lastIndexOf("/") + 1, -6)),
      );
      for (const name of existsSync(records) ? readdirSync(records) : []) {
        let json: unknown;
        try {
          json = JSON.parse(readFileSync(join(records, name), "utf8"));
        } catch {
          continue;
        }
        const record = z
          .object({ claudeSessionId: z.string() })
          .safeParse(json);
        if (record.success && ids.has(record.data.claudeSessionId)) {
          rmSync(join(records, name), { force: true });
        }
      }
      for (const path of ours) {
        rmSync(path, { force: true });
        rmSync(path.slice(0, -6), { force: true, recursive: true });
      }
    }
  },
);
