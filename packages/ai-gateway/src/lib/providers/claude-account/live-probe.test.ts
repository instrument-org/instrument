import { stepCountIs, streamText, tool } from "ai";
import { homedir } from "node:os";
import { expect, it } from "vitest";
import { z } from "zod";

import { CLIENT_SESSION_ID_HEADER } from "../../../constants";
import { fetchClaudeAccountUsage } from "./fetch-usage";
import { createClaudeAccountLanguageModel } from "./language-model";

// Runs against the real `claude` CLI in ~/.local/bin and spends the signed-in
// account's plan, so it only runs when asked: CLAUDE_ACCOUNT_LIVE=1.
it.skipIf(process.env.CLAUDE_ACCOUNT_LIVE !== "1")(
  "runs a multi-step tool turn and a follow-up through the CLI",
  { timeout: 180_000 },
  async () => {
    const model = createClaudeAccountLanguageModel({
      configDir: undefined,
      executablePath: `${homedir()}/.local/bin/claude`,
    })("claude-haiku-4-5");
    const calls: string[] = [];
    const tools = {
      add: tool({
        description: "Add two numbers",
        execute: async ({ a, b }) => {
          calls.push(`add(${a},${b})`);
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { sum: a + b };
        },
        inputSchema: z.object({ a: z.number(), b: z.number() }),
      }),
    };
    const headers = { [CLIENT_SESSION_ID_HEADER]: "live-probe" };
    const messages: Parameters<typeof streamText>[0]["messages"] = [
      {
        content:
          "You are Pebble. Use the add tool for all arithmetic, one call at a time.",
        role: "system",
      },
      { content: "What is (2+3)+10? Use the tool twice.", role: "user" },
    ];
    const first = streamText({
      allowSystemInMessages: true,
      headers,
      messages,
      model,
      stopWhen: stepCountIs(6),
      tools,
    });
    for await (const part of first.fullStream) {
      if (part.type === "error") {
        throw part.error;
      }
    }
    const firstText = await first.text;
    const steps = await first.steps;
    console.log("TURN 1", calls, steps.length, JSON.stringify(firstText));

    messages.push(...(await first.responseMessages));
    messages.push({
      content: "What's your name, and what was the final sum?",
      role: "user",
    });
    const second = streamText({
      allowSystemInMessages: true,
      headers,
      messages,
      model,
      tools,
    });
    const secondText = await second.text;
    console.log(
      "TURN 2",
      JSON.stringify(secondText),
      JSON.stringify(await second.providerMetadata),
    );
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(secondText).toMatch(/15/);
  },
);

it.skipIf(process.env.CLAUDE_ACCOUNT_LIVE !== "1")(
  "reads the plan's usage windows",
  { timeout: 60_000 },
  async () => {
    const usage = await fetchClaudeAccountUsage({
      configDir: undefined,
      executablePath: `${homedir()}/.local/bin/claude`,
    });
    console.log("USAGE", JSON.stringify(usage));
    expect(usage.windows.length).toBeGreaterThan(0);
  },
);
