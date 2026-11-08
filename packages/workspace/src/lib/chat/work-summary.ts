import {
  CLIENT_SESSION_ID_HEADER,
  fetchAISDKModel,
  providerOptionsForModel,
} from "@instrument-org/ai-gateway";
import { APP_NAME } from "@instrument-org/shared";
import { generateText } from "ai";
import { group, unique } from "radashi";

import { getWorkspaceServerURL } from "../../logic/server/url";
import { publisher } from "../../rpc/publisher";
import { type ChatId } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";
import { activityTelemetry, connectionFor } from "../activity/record";
import { ChatReads } from "../chat-reads";
import { ChatWrites } from "../chat-writes";
import {
  isStepPart,
  transcriptMessage,
} from "../transcript/transcript-message";
import { type ActivityRow, type Turn, turnsOf } from "../transcript/turns-of";
import { withoutInlineThinking } from "../without-inline-thinking";
import { getWorkspaceConfig } from "../workspace-config";

const WORK_SUMMARY_INSTRUCTION = `This message is from ${APP_NAME}, not the person, and they will not see it. Don't reply to them or use any tool.

Write the one line that stands in for the work of this turn. The person reads it above the reply, and it opens onto the steps.

- Say what was done, plainly, in the past tense, opening with a verb: "Read the page and two posts on X, and made the Notion database".
- About 12 words at most, one line, sentence case, no closing period.
- Name the apps and sites worked in, and what was made or changed.
- Leave out setup: finding tabs, loading guides or skills, checking tools, listing options, installing anything, verifying or tidying up.
- Only what the work shows happened. If something failed or wasn't confirmed, don't say it was done. Don't state findings or answers; the reply has those.

Reply with only the line: no quotes, no label, no explanation.`;

/** Room for a low-effort model's thinking and the line after it. */
const SUMMARY_MAX_OUTPUT_TOKENS = 1024;
/** The longest line kept: past this it is not one a row shows. */
const SUMMARY_MAX_CHARS = 120;
/** How much of the person's message and of the reply the call reads. */
const WORDS_READ = 300;
const EXPLANATION_READ = 70;
/** The explanations read per activity, and across the turn. */
const EXPLANATIONS_PER_ACTIVITY = 3;
const EXPLANATIONS_PER_TURN = 24;
/** How many of each kind of fact are named. */
const FACTS_NAMED = 6;
const TOOLS_NAMED_PER_APP = 5;

const baseName = (path: string) => path.split(/[/\\]/).pop() ?? path;

function clip(text: string, length: number): string {
  const flat = text.replaceAll(/\s+/g, " ").trim();
  return flat.length <= length
    ? flat
    : `${flat.slice(0, length - 1).trimEnd()}…`;
}

/**
 * Whether a finished turn wants a line: it folds, and has work the line it
 * has, if any, doesn't cover yet. A turn a wake carried on gets another.
 */
export function needsSummary(turn: Turn): boolean {
  if (
    turn.inherited ||
    !turn.rows.some(
      (row) => row.kind === "activity" && turn.foldedRowIds.has(row.id),
    )
  ) {
    return false;
  }
  const last = turn.replies.findLastIndex((reply) =>
    reply.parts.some((part) => part.type === "data-workSummary"),
  );
  return (
    last === -1 ||
    turn.replies.slice(last + 1).some((reply) => reply.parts.some(isStepPart))
  );
}

/** What the turn's steps said they were doing, an activity at a time. */
function stepLines(activities: readonly ActivityRow[]): string[] {
  const lines = ["Steps, in order:"];
  let left = EXPLANATIONS_PER_TURN;
  for (const row of activities) {
    if (row.title) {
      lines.push(`- ${row.title}`);
    }
    const said = unique(
      row.steps.flatMap((step) => step.explanation?.trim() || []),
    );
    const shown =
      said.length <= EXPLANATIONS_PER_ACTIVITY
        ? said
        : [...said.slice(0, EXPLANATIONS_PER_ACTIVITY - 1), ...said.slice(-1)];
    for (const explanation of shown.slice(0, Math.max(left, 0))) {
      left -= 1;
      lines.push(
        `${row.title ? "  " : ""}- ${clip(explanation, EXPLANATION_READ)}`,
      );
    }
  }
  return lines;
}

/** What the record says the turn did, whatever its steps said. */
function factLines(turn: Turn, taskTitles: readonly string[]): string[] {
  const activities = turn.rows.filter(
    (row): row is ActivityRow => row.kind === "activity",
  );
  const steps = activities
    .flatMap((row) => row.steps)
    .filter((step) => step.tool !== "reasoning");
  const tools = Object.entries(
    group(steps, (step) => step.tool.replace(/^tool-/, "")),
  )
    .map(([tool, calls]) => ({ calls: calls?.length ?? 0, tool }))
    .toSorted((a, b) => b.calls - a.calls);
  const appRows = steps.flatMap((step) => step.facts?.apps ?? []);
  const apps = Object.entries(group(appRows, (row) => row.app)).map(
    ([app, rows]) => {
      const calls = (rows ?? [])
        .slice(0, TOOLS_NAMED_PER_APP)
        .map((row) => `${row.tool} ${row.calls.toString()}`);
      return `${app} (${calls.join(", ")})`;
    },
  );
  const files = unique(
    steps.flatMap((step) => [
      ...(step.shows?.kind === "file" ? [step.shows.path] : []),
      ...(step.facts?.files ?? []).flatMap((file) =>
        file.change === "read" ? [] : [file.path],
      ),
    ]),
  ).map(baseName);
  const failed = steps.filter((step) => step.status === "failed").length;
  const named = (label: string, items: readonly string[], separator = ", ") =>
    items.length > 0
      ? [`${label}: ${items.slice(0, FACTS_NAMED).join(separator)}`]
      : [];
  return [
    ...named(
      "Tools",
      tools.map(({ calls, tool }) => `${tool} ${calls.toString()}`),
    ),
    ...named("Apps called", apps, "; "),
    ...named("Sites worked in", turn.sites),
    ...named("Files written or edited", files),
    ...named("Tasks started", taskTitles),
    ...(failed > 0 ? [`Calls that failed: ${failed.toString()}`] : []),
  ];
}

/**
 * What the call reads of a turn: the message that asked, its steps, what the
 * record says it did, and how the reply opens, the facts keeping the line to
 * what happened and the reply keeping it to what mattered.
 */
export function summaryInput(
  turn: Turn,
  taskTitles: readonly string[] = [],
): string {
  const asked = turn.opener?.text?.text ?? turn.opener?.fromChat?.text;
  const activities = turn.rows.filter(
    (row): row is ActivityRow => row.kind === "activity",
  );
  const reply = turn.rows.findLast((row) => row.kind === "text");
  return [
    ...(asked ? [`The person's message: ${clip(asked, WORDS_READ)}`] : []),
    [...stepLines(activities), "", ...factLines(turn, taskTitles)].join("\n"),
    ...(reply
      ? [`Start of the final reply: ${clip(reply.part.text, WORDS_READ)}`]
      : []),
  ].join("\n\n");
}

/** The line a model's answer comes to, or none when it is not one a row shows. */
export function summaryFrom(answer: string): string | undefined {
  const line = withoutInlineThinking(answer)
    .trim()
    .split("\n")[0]
    ?.trim()
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "")
    .replace(/\.$/, "")
    .trim();
  return line && line.length <= SUMMARY_MAX_CHARS ? line : undefined;
}

async function summarize({
  chatId,
  sessionId,
}: {
  chatId: ChatId;
  sessionId: StoreId.Session;
}): Promise<void> {
  const transcript = await ChatReads.transcript({ chatId, sessionId });
  if (transcript.isErr()) {
    return;
  }
  const turn = turnsOf(
    transcript.value.flatMap((message) => transcriptMessage(message) ?? []),
    { isRunning: false, sessionId },
  ).at(-1);
  const reply = turn?.replies.at(-1);
  const model = reply?.metadata.aiGatewayModel;
  if (!turn || !reply || !model || !needsSummary(turn)) {
    return;
  }
  const taskTitles = await Promise.all(
    turn.rows.flatMap((row) =>
      // A send's card stands for work sent to a task the turn did not start.
      row.kind === "task" && row.from === undefined
        ? [
            ChatReads.session({ chatId, sessionId: row.sessionId }).match(
              (session) => session.title,
              () => "A task",
            ),
          ]
        : [],
    ),
  );
  const workspaceConfig = getWorkspaceConfig();
  const aiSDKModel = await fetchAISDKModel({
    captureException: workspaceConfig.captureException,
    configs: workspaceConfig.getAIProviderConfigs(),
    modelCache: workspaceConfig.modelCache,
    modelRoutes: workspaceConfig.modelRoutes,
    modelURI: model.uri,
    workspaceServerURL: getWorkspaceServerURL(),
  });
  if (!aiSDKModel.ok) {
    return;
  }
  const result = await generateText({
    abortSignal: AbortSignal.timeout(30_000),
    headers: { [CLIENT_SESSION_ID_HEADER]: sessionId },
    instructions: WORK_SUMMARY_INSTRUCTION,
    maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
    model: aiSDKModel.value,
    prompt: summaryInput(turn, taskTitles),
    providerOptions: providerOptionsForModel(aiSDKModel.value, {
      effort: "low",
      reasoning: model.reasoning,
    }),
    telemetry: activityTelemetry({
      chatId,
      connection: connectionFor(
        workspaceConfig.getAIProviderConfigs(),
        model.params.providerConfigId,
      ),
      purpose: "work-summary",
      sessionId,
    }),
  });
  const words = summaryFrom(result.text);
  if (words === undefined) {
    return;
  }
  const saved = await ChatWrites.savePart(
    {
      data: { words },
      metadata: {
        createdAt: new Date(),
        id: StoreId.newPartId(),
        messageId: reply.id,
        sessionId,
      },
      type: "data-workSummary",
    },
    chatId,
  );
  if (saved.isErr()) {
    throw saved.error;
  }
}

/**
 * Writes the line a finished turn's work folds into, each time a chat or a
 * task finishes a turn, on the model the turn's reply ran on. Without one the
 * Worked row says how long the work took, so a call that fails costs the
 * person nothing. One session's call never holds another's.
 */
export function startWorkSummaries(): void {
  publisher.subscribe("session.done", ({ id, notice, sessionId }) => {
    if (notice) {
      return;
    }
    void summarize({ chatId: id, sessionId }).catch((error: unknown) => {
      getWorkspaceConfig().captureException(error, { area: "work-summary" });
    });
  });
}
