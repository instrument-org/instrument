import { APP_NAME } from "@instrument-org/shared";
import ms from "ms";
import { isPlainObject } from "radashi";
import { z } from "zod";

import {
  describeConnection,
  isConnected,
  readConnection,
} from "../apps/connection";
import { APP_FILE_NAME } from "../apps/app-file";
import { isMcpManifest } from "../apps/manifest";
import {
  bundledMacApp,
  macosRefusalCard,
  withReadableFiles,
} from "../apps/mac-app";
import { macosRefusalIn } from "../mac-apps/refusal";
import { macosAppCard } from "../permissions/macos";
import { redactorFor, requireAppCredential } from "../apps/credential-origin";
import {
  anyAppGuideHandedOver,
  appGuideHandedOver,
  recordAppGuideHandOff,
} from "../apps/guide-hand-off";
import {
  callMcpTool,
  clientRefused,
  listMcpResources,
  listMcpTools,
  mcpArgumentProblem,
  type McpServerGuidance,
  readMcpResource,
} from "../apps/mcp/client";
import { noteServerGuidance, notedServerGuidance } from "../apps/mcp/guidance";
import { withAppMcpClient } from "../apps/mcp/run";
import { SignInAgainError } from "../apps/mcp/tool-auth";
import { performSignedInRequest, SignInNeededError } from "../apps/api-oauth";
import { performAppRequest, redactCredential } from "../apps/request";
import { type AppInfo, listApps, loadApp, readAppGuide } from "../apps/store";
import { webInsteadUrl } from "../apps/site";
import { webInsteadCommand } from "../apps/web-instead";
import { folderFingerprint } from "../folder-fingerprint";
import { INSTRUCTIONS_MAX } from "../instructions-in-context";
import { baselineRecorded } from "../last-told";
import { ChatReads } from "../chat-reads";
import { getWorkspaceConfig } from "../workspace-config";
import { shellPath } from "../workspace-fs-layout";
import { APP_COMMAND, APPS_ARE_THE_CHATS } from "../shell-commands/app-command";
import {
  type CapabilityContext,
  CapabilityFailure,
  defineCapability,
  type Gate,
  type Role,
} from "./define";
import { scriptSurfaceOpen } from "./script-surface";

const REQUEST_TIMEOUT_MS = ms("2 minutes");

const METHODS = ["DELETE", "GET", "PATCH", "POST", "PUT"] as const;

export const AppField = z
  .string({
    error: `an app slug is required. See \`${APP_COMMAND.name} list\`.`,
  })
  .min(1, `an app slug is required. See \`${APP_COMMAND.name} list\`.`)
  .meta({ description: "The app's slug, as `instrument app list` names it." });

/** The apps folder as the shell spells it. */
export function appsFolder() {
  return shellPath(getWorkspaceConfig().appsDir);
}

/** The call's own signal, bounded by a timeout so a hung service cannot hold a turn. */
export function withTimeout(
  signal: AbortSignal | undefined,
  timeoutMs: number,
) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/**
 * The app a command names. With `connected`, only one whose connection
 * record is current, so a call never goes out on a manifest nobody tested.
 */
export async function requireApp(
  rawSlug: string | undefined,
  { connected, role = "chat" }: { connected: boolean; role?: Role },
): Promise<AppInfo> {
  if (!rawSlug) {
    throw new Error(
      `an app slug is required. See \`${APP_COMMAND.name} list\`.`,
    );
  }
  const loaded = await loadApp(getWorkspaceConfig().appsDir, rawSlug);
  if (loaded.isErr()) {
    throw new Error(loaded.error.message);
  }
  const app = loaded.value;
  if (connected) {
    const connection = await readConnection(app.slug);
    if (!isConnected(connection, app.manifestHash)) {
      throw new Error(
        `"${app.slug}" is ${describeConnection(connection, app.manifestHash, role)}.`,
      );
    }
  }
  return app;
}

/** Why `call`, `tools`, and `request` refuse a web app, and how it is worked instead. */
function webAppRefusal(slug: string, url: string): string {
  return `"${slug}" is a web app: the user is signed in to it in ${APP_NAME}'s browser, and no \`${APP_COMMAND.name}\` call reaches it. Work it in a tab: open ${url}, where the sign-in holds, or use a tab already open there.`;
}

/** The connected app a call names, or the refusal that says what to do instead. */
async function connectedApp(
  slug: string,
  kind: "api" | "mcp",
  role: Role,
): Promise<AppInfo | Extract<Gate, { kind: "refused" }>> {
  let app: AppInfo;
  try {
    app = await requireApp(slug, { connected: true, role });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      kind: "refused",
      message: role === "chat" ? message : `${message} ${APPS_ARE_THE_CHATS}`,
    };
  }
  const { manifest } = app;
  if (manifest.type === "web") {
    return { kind: "refused", message: webAppRefusal(app.slug, manifest.url) };
  }
  if (kind === "mcp" && !isMcpManifest(manifest)) {
    return {
      kind: "refused",
      message: `"${app.slug}" is an API app; make requests with \`${APP_COMMAND.name} request\`, after reading its guide with \`${APP_COMMAND.name} guide ${app.slug}\`.`,
    };
  }
  if (kind === "api" && manifest.type !== "api") {
    return {
      kind: "refused",
      message: `"${app.slug}" is an MCP app; use \`${APP_COMMAND.name} tools\` and \`${APP_COMMAND.name} call\`.`,
    };
  }
  return app;
}

async function connectedAppGate(
  slug: string,
  kind: "api" | "mcp",
  role: Role,
): Promise<Gate> {
  const app = await connectedApp(slug, kind, role);
  return "kind" in app ? app : { kind: "allowed" };
}

/** The app `run` works with, once its gate has let the call through. */
async function gatedApp(
  slug: string,
  kind: "api" | "mcp",
  role: Role,
): Promise<AppInfo> {
  const app = await connectedApp(slug, kind, role);
  if ("kind" in app) {
    throw new CapabilityFailure(app.message, "refused");
  }
  return app;
}

/**
 * What follows a tool's refusal, wherever it is reported: where the arguments
 * do not fit the tool's schema, what does not fit and the schema itself, so
 * the next call can be right without a lookup between.
 */
function refusalHint({
  argumentProblem,
  redact,
  slug,
  tool,
}: {
  argumentProblem: { problem: string; schema: unknown } | undefined;
  redact: (text: string) => string;
  slug: string;
  tool: string;
}): string {
  return argumentProblem
    ? `The arguments do not fit what ${tool} takes (${redact(argumentProblem.problem)}). It takes:\n${redact(JSON.stringify(argumentProblem.schema, null, 2))}`
    : `The tool refused the call. If the arguments were the problem, \`${APP_COMMAND.name} tool ${slug} ${tool}\` shows the JSON it takes.`;
}

/** How much of a server's instructions an app's guide carries before they are cut. */
const SERVER_INSTRUCTIONS_LIMIT = 8000;

/**
 * An MCP app's guide as the model is handed it: the body of its `APP.md`,
 * then what its server says about itself (its instructions, and that it
 * offers documents), so the guide is what the server says today and a
 * change to it hands the guide over again. Nothing where neither has words.
 */
function mcpGuide({
  app,
  guidance,
  guide,
}: {
  app: AppInfo;
  guidance: McpServerGuidance;
  guide: null | string;
}): string | undefined {
  const parts = guide?.trim() ? [guide.trim()] : [];
  if (guidance.instructions !== undefined) {
    const { instructions } = guidance;
    const shown =
      instructions.length > SERVER_INSTRUCTIONS_LIMIT
        ? `${instructions.slice(0, SERVER_INSTRUCTIONS_LIMIT)}\n[cut at ${SERVER_INSTRUCTIONS_LIMIT} characters]`
        : instructions;
    parts.push(
      `What the ${app.name} server says about using it:\n<server_instructions>\n${shown}\n</server_instructions>`,
    );
  }
  if (guidance.resources) {
    parts.push(
      `The server also offers documents: \`${APP_COMMAND.name} resources ${app.slug}\` lists them, \`${APP_COMMAND.name} read ${app.slug} <uri>\` reads one.`,
    );
  }
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

/**
 * What an MCP app's server says about itself: as the last connection noted
 * it, else from a connection made for it. Nothing where it cannot be
 * reached, which the call itself then reports.
 */
async function serverGuidance(
  app: AppInfo,
  ctx: CapabilityContext,
): Promise<McpServerGuidance | undefined> {
  const { manifest } = app;
  if (!isMcpManifest(manifest)) {
    return undefined;
  }
  const noted = notedServerGuidance(app.slug, app.manifestHash);
  if (noted) {
    return noted;
  }
  try {
    const credential = await requireAppCredential(app.slug, manifest);
    const result = await withAppMcpClient({
      credential,
      manifest,
      manifestHash: app.manifestHash,
      run: (client) =>
        Promise.resolve(noteServerGuidance(app.slug, app.manifestHash, client)),
      signal: withTimeout(ctx.signal, REQUEST_TIMEOUT_MS),
      slug: app.slug,
    });
    return result.isOk() ? result.value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * An MCP app's guide before its first call: where the model has none of
 * this app's guides yet, the call is not made and the guide comes back.
 * Any version handed over will do here, since the listing hands over a
 * changed one and a server whose words change on every connection must not
 * stop every call.
 */
async function mcpGuideGate(
  app: AppInfo,
  ctx: CapabilityContext,
): Promise<Gate> {
  const messages = await ctx.modelWindow();
  if (messages !== undefined && anyAppGuideHandedOver(messages, app.slug)) {
    return { kind: "allowed" };
  }
  const guidance = await serverGuidance(app, ctx);
  if (guidance === undefined) {
    return { kind: "allowed" };
  }
  const guide = mcpGuide({
    app,
    guidance,
    guide: await readAppGuide(app.dir),
  });
  if (guide === undefined || (await guideInWindow(app, guide, ctx))) {
    return { kind: "allowed" };
  }
  return { guides: [{ app: app.slug, guide }], kind: "read-first" };
}

/**
 * What a task is told when an app it uses needs the user again (a sign-in,
 * a go-ahead to run, a move to the web), in place of the cards and setup
 * words only the chat has; nothing for the chat, or for any other failure.
 */
function taskNeedsChat(
  slug: string,
  role: Role,
  failure: { cause?: unknown; reason?: string },
): CapabilityFailure | undefined {
  if (role === "chat") {
    return undefined;
  }
  const why =
    failure.cause instanceof SignInAgainError ||
    failure.cause instanceof SignInNeededError
      ? "needs the user to sign in again"
      : failure.reason === "unauthorized"
        ? "had its sign-in or key refused, so it needs the user again"
        : failure.reason === "unapproved"
          ? "needs the user's go-ahead before it runs on this machine"
          : clientRefused(failure.cause)
            ? `has to move to the web: its server refuses ${APP_NAME}'s sign-in client`
            : undefined;
  return why === undefined
    ? undefined
    : new CapabilityFailure(
        `"${slug}" ${why}. ${APPS_ARE_THE_CHATS}`,
        "refused",
      );
}

/** The key a call sends; in a task, a missing or moved key is the chat's to ask for. */
async function credentialFor(
  slug: string,
  manifest: AppInfo["manifest"],
  role: Role,
): Promise<null | string> {
  try {
    return await requireAppCredential(slug, manifest);
  } catch (error) {
    if (role === "chat") {
      throw error;
    }
    throw new CapabilityFailure(
      `"${slug}" needs a key from the user. ${APPS_ARE_THE_CHATS}`,
      "refused",
    );
  }
}

/** Every string in a JSON value, keys included, run through `redact`. */
function redactValue(
  value: unknown,
  redact: (text: string) => string,
): unknown {
  if (typeof value === "string") {
    return redact(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, redact));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        redact(key),
        redactValue(item, redact),
      ]),
    );
  }
  return value;
}

/** Text parsed as JSON where it is JSON, else the text itself. */
function jsonOrText(text: string): z.output<ReturnType<typeof z.json>> {
  try {
    return z.json().parse(JSON.parse(text));
  } catch {
    return text;
  }
}

/** A value as the command line prints it: a string as it is, anything else as JSON. */
function printed(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

/** The first sentence of a description, on one line, capped for a listing. */
function firstSentence(text: string): string {
  const flat = text.replaceAll(/\s+/g, " ").trim();
  const end = flat.search(/[.!?](?:\s|$)/);
  const sentence = end === -1 ? flat : flat.slice(0, end + 1);
  return sentence.length > 160 ? `${sentence.slice(0, 157)}...` : sentence;
}

/**
 * `apps.call`'s gate: the app connected, an MCP app, and for one of the
 * Mac's own apps, macOS letting Instrument in. Where macOS says no, or has
 * not been asked yet, its card goes up and the call is not made.
 */
async function callGate(slug: string, ctx: CapabilityContext): Promise<Gate> {
  const app = await connectedApp(slug, "mcp", ctx.role);
  if ("kind" in app) {
    return app;
  }
  const macApp = bundledMacApp(app.manifest);
  const card = macApp ? await macosAppCard(ctx.asker, macApp) : undefined;
  return card ? { ...card, kind: "card" } : mcpGuideGate(app, ctx);
}

export const appsCall = defineCapability({
  gate: ({ app }, ctx) => callGate(app, ctx),
  input: z.object({
    app: AppField,
    tool: z
      .string({
        error: `call takes the tool's name after the slug. See \`${APP_COMMAND.name} tools <slug>\`.`,
      })
      .min(1)
      .meta({
        description: "The tool's name, as `instrument app tools` lists it.",
      }),
    args: z.record(z.string(), z.unknown()).default({}).meta({
      description: "The tool's arguments, as the JSON object it takes.",
    }),
  }),
  name: "apps.call",
  // The structured result where the service sent one, else its text parsed
  // as JSON, else the text itself.
  output: z.json(),
  async run({ app: slug, args, tool }, ctx) {
    const app = await gatedApp(slug, "mcp", ctx.role);
    const { manifest } = app;
    if (!isMcpManifest(manifest)) {
      throw new CapabilityFailure(
        `"${app.slug}" is not an MCP app.`,
        "refused",
      );
    }
    const macApp = bundledMacApp(manifest);
    // A file a Mac app reads is read outside every sandbox, so it is held
    // to the chat's folders first and handed over by its full path.
    const sent = macApp
      ? await withReadableFiles(macApp, tool, args, ctx.readableFile).catch(
          (error: unknown) => {
            throw new CapabilityFailure(
              error instanceof Error ? error.message : String(error),
              "refused",
            );
          },
        )
      : args;
    const credential = await credentialFor(app.slug, manifest, ctx.role);
    const redact = await redactorFor(app.slug, manifest, credential);
    const signal = withTimeout(ctx.signal, REQUEST_TIMEOUT_MS);
    const result = await withAppMcpClient({
      credential,
      manifest,
      manifestHash: app.manifestHash,
      run: async (client) => {
        noteServerGuidance(app.slug, app.manifestHash, client);
        const called = await callMcpTool(client, {
          args: sent,
          name: tool,
          signal,
        });
        // macOS saying no has nothing to do with the arguments, and its card
        // is up already: no listing to check them against.
        const argumentProblem =
          called.isError && macosRefusalIn(called.meta) === undefined
            ? await mcpArgumentProblem(client, { args: sent, name: tool })
            : undefined;
        return { ...called, argumentProblem };
      },
      signal,
      slug: app.slug,
    });
    if (result.isErr()) {
      // The app, the tool and the kind of failure, never what the server
      // said: the log travels with feedback reports.
      console.warn(
        `App call failed: ${app.slug} ${tool} (${result.error.reason})`,
      );
      const forTask = taskNeedsChat(app.slug, ctx.role, result.error);
      if (forTask !== undefined) {
        throw forTask;
      }
      const web = `\`${webInsteadCommand(app.slug, webInsteadUrl(app.slug, manifest))}\`, then connect_app`;
      const next: Partial<Record<typeof result.error.reason, string>> = {
        forbidden: ` A 403 usually means the account lacks a permission, scope or plan on the service's side, which signing in again does not change; ${ctx.role === "chat" ? `tell the user what the server said. Some servers send it for a bad key too: \`${APP_COMMAND.name} test ${app.slug}\` checks the key.` : "say in your report what the server said."}`,
        unauthorized:
          manifest.auth.kind === "oauth"
            ? ` Run \`${APP_COMMAND.name} test ${app.slug}\`; if the sign-in is gone, ask for it again with connect_app, and if that sign-in fails or is refused, sign in on the web instead: ${web}.`
            : ` Run \`${APP_COMMAND.name} test ${app.slug}\`; if the sign-in is gone, ask for it again with connect_app.`,
      };
      // A sign-in the server will never take from this client, or one whose
      // message already says what to do, needs nothing more said.
      const hint =
        result.error.cause instanceof SignInAgainError
          ? ""
          : clientRefused(result.error.cause)
            ? ` The server refuses ${APP_NAME}'s sign-in client, so signing in again meets the same refusal. Sign in on the web instead: ${web}.`
            : (next[result.error.reason] ?? "");
      throw new CapabilityFailure(`${redact(result.error.message)}${hint}`);
    }
    const { argumentProblem, isError, meta, structured, text } = result.value;
    // macOS's refusal, as the app's own server names it, is its card, never
    // the tool's words.
    const card = macApp
      ? await macosRefusalCard({ app: macApp, asker: ctx.asker, isError, meta })
      : undefined;
    if (card) {
      console.warn(`App call refused: ${app.slug} ${tool} (macos-refused)`);
      throw new CapabilityFailure(card.message, "card", card.askId);
    }
    if (isError) {
      console.warn(
        `App call refused: ${app.slug} ${tool}${argumentProblem ? " (arguments do not fit its schema)" : ""}`,
      );
      throw new CapabilityFailure(
        `${redact(text)}\n${refusalHint({ argumentProblem, redact, slug: app.slug, tool })}`,
      );
    }
    return structured
      ? z.json().parse(redactValue(structured, redact))
      : jsonOrText(redact(text));
  },
  summary: "Run one tool of a connected MCP app.",
  surfaces: {
    cli: {
      help: `Arguments as a JSON object, inline or on stdin through a quoted heredoc.
--out writes the result to that file instead, as JSON where the service
answered with data, and prints only a line saying what landed: for a result
to work through with jq, node, or python rather than read whole.`,
      positional: ["app", "tool", "args"],
      stdin: "args",
      words: ["app", "call"],
    },
    script: { positional: ["app", "tool", "args"] },
  },
  text: printed,
});

const ToolSchema = z.object({
  description: z.string(),
  input_schema: z.json().optional(),
  /** The server's own hint, only where it set one. */
  mark: z.enum(["destructive", "read-only"]).optional(),
  name: z.string(),
});

/**
 * A tool's mark from the server's own hints, only where it set one: a tool
 * with no hints is neither, whatever the spec's default.
 */
function toolMark(
  annotations:
    | { destructiveHint?: boolean; readOnlyHint?: boolean }
    | undefined,
): { mark?: "destructive" | "read-only" } {
  if (annotations?.readOnlyHint === true) {
    return { mark: "read-only" };
  }
  return annotations?.destructiveHint === true ? { mark: "destructive" } : {};
}

export const appsTools = defineCapability({
  gate: ({ app }, ctx) => connectedAppGate(app, "mcp", ctx.role),
  input: z.object({
    app: AppField,
    tool: z.string().optional().meta({
      description: "One tool to show in full, with the JSON it takes.",
    }),
  }),
  name: "apps.tools",
  output: z.object({
    app: z.string(),
    /**
     * The app's guide, where the listing on the command line is the first
     * the model sees of it.
     */
    guide: z.string().optional(),
    tools: z.array(ToolSchema),
  }),
  async run({ app: slug, tool: only }, ctx) {
    const app = await gatedApp(slug, "mcp", ctx.role);
    const { manifest } = app;
    if (!isMcpManifest(manifest)) {
      throw new CapabilityFailure(
        `"${app.slug}" is not an MCP app.`,
        "refused",
      );
    }
    const credential = await credentialFor(app.slug, manifest, ctx.role);
    const redact = await redactorFor(app.slug, manifest, credential);
    const result = await withAppMcpClient({
      credential,
      manifest,
      manifestHash: app.manifestHash,
      run: async (client) => ({
        guidance: noteServerGuidance(app.slug, app.manifestHash, client),
        tools: await listMcpTools(client),
      }),
      signal: withTimeout(ctx.signal, REQUEST_TIMEOUT_MS),
      slug: app.slug,
    });
    if (result.isErr()) {
      throw (
        taskNeedsChat(app.slug, ctx.role, result.error) ??
        new CapabilityFailure(redact(result.error.message))
      );
    }
    const { guidance, tools } = result.value;
    if (only === undefined) {
      // The listing is where a session meets an MCP app, so on the command
      // line the guide comes first in it when the model does not have it.
      const guide =
        ctx.surface === "cli"
          ? mcpGuide({ app, guidance, guide: await readAppGuide(app.dir) })
          : undefined;
      const handOff =
        guide !== undefined && !(await guideInWindow(app, guide, ctx))
          ? guide
          : undefined;
      if (handOff !== undefined) {
        recordAppGuideHandOff({
          app: app.slug,
          guide: handOff,
          printed: redact(handOff),
        });
      }
      return {
        app: app.slug,
        ...(handOff !== undefined && { guide: redact(handOff) }),
        tools: tools.map((tool) => ({
          description: firstSentence(redact(tool.description)),
          ...toolMark(tool.annotations),
          name: tool.name,
        })),
      };
    }
    const tool = tools.find((candidate) => candidate.name === only);
    if (!tool) {
      throw new CapabilityFailure(
        `"${app.slug}" has no tool "${only}". \`${APP_COMMAND.name} tools ${app.slug}\` lists them.`,
      );
    }
    return {
      app: app.slug,
      tools: [
        {
          description: redact(tool.description).trim(),
          input_schema: z.json().parse(redactValue(tool.inputSchema, redact)),
          name: tool.name,
        },
      ],
    };
  },
  summary:
    "List a connected MCP app's tools, a line each, or show one in full with the JSON it takes.",
  surfaces: {
    cli: {
      aliases: ["tool"],
      help: "Long for a big app; pipe it through rg. With a tool's name, that tool in full.",
      positional: ["app", "tool"],
      words: ["app", "tools"],
    },
    script: { positional: ["app", "tool"] },
  },
  text({ app, guide, tools }) {
    const [one] = tools;
    if (tools.length === 1 && one?.input_schema !== undefined) {
      return `${one.name}\n${one.description}\n\ninput: ${JSON.stringify(one.input_schema, null, 2)}\n\n\`${APP_COMMAND.name} call ${app} ${one.name} '<json>'\` runs it.\n`;
    }
    // A line each: a big app lists dozens, and the schemas would make the
    // listing longer than a turn should read.
    const scripted = scriptSurfaceOpen()
      ? `, and in a script \`await instrument.apps[${JSON.stringify(app)}].<name>({...})\` (Node) or \`instrument.app(${JSON.stringify(app)}).<name>(...)\` (Python) returns it as a value`
      : "";
    const marked = tools.some((tool) => tool.mark !== undefined)
      ? " [read-only] and [destructive] are the server's own marks."
      : "";
    return `${guide === undefined ? "" : `${guide.trimEnd()}\n\n`}${tools.length} tools on ${app}. \`${APP_COMMAND.name} tool ${app} <name>\` shows one with the JSON it takes; \`${APP_COMMAND.name} call ${app} <name> '<json>'\` runs it${scripted}.${marked}\n${tools.map((tool) => `- ${tool.name}${tool.mark ? ` [${tool.mark}]` : ""}: ${tool.description}`).join("\n")}\n`;
  },
});

const ResponseSchema = z.object({
  body: z.json().meta({
    description: "The body, parsed where the service sent JSON, else its text.",
  }),
  content_type: z.string().optional(),
  status: z.number(),
  truncated: z
    .boolean()
    .meta({ description: "Whether the body was longer than the cap and cut." }),
  url: z.string(),
});

type Response = z.output<typeof ResponseSchema>;

function statusLine(method: string, response: Response) {
  return `${method} ${response.url} -> ${response.status}${response.content_type ? ` (${response.content_type})` : ""}\n`;
}

const TRUNCATED_NOTE =
  "[Body truncated: the response was larger than the cap, so request less or paginate]\n";

/**
 * Whether the session's model has this guide: a bash call in its window
 * handed it over, or the session's start told it whole.
 */
async function guideInWindow(
  app: AppInfo,
  guide: string,
  ctx: CapabilityContext,
): Promise<boolean> {
  const messages = await ctx.modelWindow();
  if (messages === undefined) {
    return false;
  }
  return (
    appGuideHandedOver(messages, app.slug, guide) ||
    (await guideToldAtStart(app, guide, ctx))
  );
}

/**
 * Whether the session's start told the model this guide whole: the guide is
 * the app's `APP.md` body, short enough to be inlined uncut
 * (`apps/context.ts`), and the session's baseline found the app connected
 * with its folder as it is now. The baseline is read from the session's
 * history, since the model window leaves it out.
 */
async function guideToldAtStart(
  app: AppInfo,
  guide: string,
  { chatId, sessionId }: CapabilityContext,
): Promise<boolean> {
  const history = await ChatReads.history({ chatId, sessionId });
  if (history.isErr()) {
    return false;
  }
  const told = baselineRecorded(history.value, sessionId, "apps")?.value[
    app.slug
  ];
  if (!told?.connected) {
    return false;
  }
  const body = (await readAppGuide(app.dir))?.trim();
  return (
    body !== undefined &&
    body === guide.trim() &&
    body.length <= INSTRUCTIONS_MAX &&
    told.fingerprint === (await folderFingerprint(app.dir))
  );
}

/**
 * Every other connected API app whose guide the model does not have, for a
 * script stopped on one app's guide: a script that uses several reads them
 * all at the first stop rather than one per rerun.
 */
async function otherGuidesToRead(
  slug: string,
  ctx: CapabilityContext,
): Promise<{ app: string; guide: string }[]> {
  const config = getWorkspaceConfig();
  const [{ apps }, connections] = await Promise.all([
    listApps(config.appsDir),
    config.apps.connections.list(),
  ]);
  const others = apps.filter(
    (app) =>
      app.slug !== slug &&
      app.manifest.type === "api" &&
      isConnected(connections[app.slug], app.manifestHash),
  );
  const guides = await Promise.all(
    others.map(async (app) => {
      const guide = await readAppGuide(app.dir);
      return guide === null || (await guideInWindow(app, guide, ctx))
        ? []
        : [{ app: app.slug, guide }];
    }),
  );
  return guides.flat();
}

export const appsRequest = defineCapability({
  async gate({ app: slug }, ctx: CapabilityContext): Promise<Gate> {
    const app = await connectedApp(slug, "api", ctx.role);
    if ("kind" in app) {
      return app;
    }
    // The guide is the app's only documentation, so it enters the context
    // before the first real request the session makes.
    const guide = await readAppGuide(app.dir);
    if (guide === null) {
      return {
        kind: "refused",
        message: `"${app.slug}" has no guide. Write one under the front matter in ${appsFolder()}/${app.name}/${APP_FILE_NAME}: the endpoints and conventions a request needs.`,
      };
    }
    if (await guideInWindow(app, guide, ctx)) {
      return { kind: "allowed" };
    }
    return {
      guides: [
        { app: app.slug, guide },
        ...(ctx.surface === "script"
          ? await otherGuidesToRead(app.slug, ctx)
          : []),
      ],
      kind: "read-first",
    };
  },
  input: z.object({
    app: AppField,
    method: z
      .string({
        error:
          "request takes a method after the slug: GET, POST, PUT, PATCH, or DELETE.",
      })
      .toUpperCase()
      .pipe(
        z.enum(METHODS, {
          error:
            "request takes a method after the slug: GET, POST, PUT, PATCH, or DELETE.",
        }),
      ),
    path: z
      .string({
        error:
          "request takes a path after the method, relative to the base URL.",
      })
      .min(
        1,
        "request takes a path after the method, relative to the base URL.",
      )
      .meta({ description: "The path, relative to the app's base URL." }),
    params: z
      .record(z.string(), z.string())
      .default({})
      .meta({ description: "Query parameters." }),
    body: z
      .json()
      .optional()
      .meta({ description: "The body: JSON, or text sent as it is." }),
  }),
  name: "apps.request",
  output: ResponseSchema,
  render(response, { method }) {
    const note = response.truncated ? TRUNCATED_NOTE : "";
    // The body alone is stdout, whole, so it pipes into jq or rg; the status
    // line and any truncation note are ours and go to stderr. What the model
    // reads of a long one is the bash tool's to cut.
    return {
      stderr: `${statusLine(method, response)}${note}`,
      stdout: `${responseText(response)}\n`,
    };
  },
  async run({ app: slug, body, method, params, path }, ctx) {
    const app = await gatedApp(slug, "api", ctx.role);
    if (app.manifest.type !== "api") {
      throw new CapabilityFailure(
        `"${app.slug}" is not an API app.`,
        "refused",
      );
    }
    const request = {
      body: body === undefined ? undefined : bodyText(body),
      manifest: app.manifest,
      method,
      params,
      path,
      signal: withTimeout(ctx.signal, REQUEST_TIMEOUT_MS),
    };
    // A signed-in API sends its access token, and the token it sent is what
    // is kept out of what the agent reads.
    let credential: null | string;
    let result: Awaited<ReturnType<typeof performAppRequest>>;
    if (app.manifest.auth.kind === "oauth") {
      ({ result, token: credential } = await performSignedInRequest({
        ...request,
        slug: app.slug,
      }).catch((error: unknown) => {
        throw taskNeedsChat(app.slug, ctx.role, { cause: error }) ?? error;
      }));
    } else {
      credential = await credentialFor(app.slug, app.manifest, ctx.role);
      result = await performAppRequest({ ...request, credential });
    }
    if (result.isErr()) {
      throw new CapabilityFailure(
        redactCredential(result.error.message, credential),
      );
    }
    const response = result.value;
    const text = redactCredential(response.bodyText, credential);
    const output: Response = {
      body: response.contentType.includes("json") ? jsonOrText(text) : text,
      ...(response.contentType ? { content_type: response.contentType } : {}),
      status: response.status,
      truncated: response.truncated,
      url: redactCredential(response.url, credential),
    };
    if (response.status >= 400) {
      throw new CapabilityFailure(
        `${statusLine(method, output)}${text}\n${output.truncated ? TRUNCATED_NOTE : ""}`,
      );
    }
    return output;
  },
  summary:
    "Make one request through a connected API app, the path relative to its base.",
  surfaces: {
    cli: {
      flagNames: { params: "param" },
      help: `The first request in a task sends nothing: it prints the app's guide on
stderr and exits 3; read it, then repeat. The response body alone is stdout,
whole, for jq. The body can come on stdin.`,
      positional: ["app", "method", "path", "body"],
      stdin: "body",
      words: ["app", "request"],
    },
    script: { positional: ["app", "method", "path"] },
  },
  text: responseText,
});

/** A body as the service would read it: text as it is, JSON as JSON. */
function bodyText(body: unknown): string {
  return typeof body === "string" ? body : JSON.stringify(body);
}

/** A response body as the service sent it, so a JSON string keeps its quotes for jq. */
function responseText({ body, content_type }: Response): string {
  return typeof body === "string" && content_type?.includes("json")
    ? JSON.stringify(body)
    : bodyText(body);
}

export const appsResources = defineCapability({
  gate: ({ app }, ctx) => connectedAppGate(app, "mcp", ctx.role),
  input: z.object({ app: AppField }),
  name: "apps.resources",
  output: z.object({
    app: z.string(),
    documents: z.array(
      z.object({
        description: z.string().optional(),
        mime_type: z.string().optional(),
        name: z.string(),
        uri: z.string(),
      }),
    ),
    /** Addresses the server fills in, each `{name}` with a value. */
    templates: z.array(
      z.object({
        description: z.string().optional(),
        name: z.string(),
        uri_template: z.string(),
      }),
    ),
    truncated: z.boolean(),
  }),
  async run({ app: slug }, ctx) {
    const app = await gatedApp(slug, "mcp", ctx.role);
    const { manifest } = app;
    if (!isMcpManifest(manifest)) {
      throw new CapabilityFailure(
        `"${app.slug}" is not an MCP app.`,
        "refused",
      );
    }
    const credential = await requireAppCredential(app.slug, manifest);
    const redact = await redactorFor(app.slug, manifest, credential);
    const result = await withAppMcpClient({
      credential,
      manifest,
      manifestHash: app.manifestHash,
      run: async (client) =>
        noteServerGuidance(app.slug, app.manifestHash, client).resources
          ? await listMcpResources(client)
          : undefined,
      signal: withTimeout(ctx.signal, REQUEST_TIMEOUT_MS),
      slug: app.slug,
    });
    if (result.isErr()) {
      throw new CapabilityFailure(redact(result.error.message));
    }
    const listing = result.value;
    const text = (value: string | undefined) =>
      value === undefined ? {} : { description: firstSentence(redact(value)) };
    return {
      app: app.slug,
      documents: (listing?.resources ?? []).map((entry) => ({
        ...text(entry.description),
        ...(entry.mimeType && { mime_type: entry.mimeType }),
        name: redact(entry.name),
        uri: redact(entry.uri),
      })),
      templates: (listing?.templates ?? []).map((entry) => ({
        ...text(entry.description),
        name: redact(entry.name),
        uri_template: redact(entry.uriTemplate),
      })),
      truncated: listing?.truncated ?? false,
    };
  },
  summary: "List the documents a connected MCP app's server offers.",
  surfaces: {
    cli: {
      help: "A line each, then the addresses the server fills in.",
      positional: ["app"],
      words: ["app", "resources"],
    },
    script: { positional: ["app"] },
  },
  text({ app, documents, templates, truncated }) {
    if (documents.length === 0 && templates.length === 0) {
      return `${app}'s server offers no documents.\n`;
    }
    const line = (entry: {
      description?: string;
      mime_type?: string;
      name: string;
    }) =>
      `(${[entry.name, entry.mime_type].filter(Boolean).join(", ")})${entry.description ? `: ${entry.description}` : ""}`;
    return `${[
      `${documents.length} ${documents.length === 1 ? "document" : "documents"} on ${app}. \`${APP_COMMAND.name} read ${app} <uri>\` reads one.`,
      ...documents.map((entry) => `- ${entry.uri} ${line(entry)}`),
      ...(truncated ? ["[More pages than were listed]"] : []),
      ...(templates.length > 0
        ? [
            "\nAddresses to fill in (each {name} with a value), then read:",
            ...templates.map(
              (entry) => `- ${entry.uri_template} ${line(entry)}`,
            ),
          ]
        : []),
    ].join("\n")}\n`;
  },
});

export const appsRead = defineCapability({
  gate: ({ app }, ctx) => connectedAppGate(app, "mcp", ctx.role),
  input: z.object({
    app: AppField,
    uri: z
      .string({
        error: `read takes a document's address after the slug. See \`${APP_COMMAND.name} resources <slug>\`.`,
      })
      .min(1)
      .meta({
        description:
          "The document's address, as `instrument app resources` lists it.",
      }),
  }),
  name: "apps.read",
  // Each text part as the server sent it, and each binary part named by its
  // type and size.
  output: z.string(),
  async run({ app: slug, uri }, ctx) {
    const app = await gatedApp(slug, "mcp", ctx.role);
    const { manifest } = app;
    if (!isMcpManifest(manifest)) {
      throw new CapabilityFailure(
        `"${app.slug}" is not an MCP app.`,
        "refused",
      );
    }
    const credential = await requireAppCredential(app.slug, manifest);
    const redact = await redactorFor(app.slug, manifest, credential);
    const result = await withAppMcpClient({
      credential,
      manifest,
      manifestHash: app.manifestHash,
      run: (client) => {
        noteServerGuidance(app.slug, app.manifestHash, client);
        return readMcpResource(client, uri);
      },
      signal: withTimeout(ctx.signal, REQUEST_TIMEOUT_MS),
      slug: app.slug,
    });
    if (result.isErr()) {
      throw new CapabilityFailure(redact(result.error.message));
    }
    return result.value
      .map((part) =>
        "text" in part
          ? redact(part.text)
          : `[${part.mimeType ?? "binary"}, ${part.bytes.byteLength} bytes]`,
      )
      .join("\n\n");
  },
  summary: "Read one document a connected MCP app's server offers.",
  surfaces: {
    cli: {
      help: "--out writes it to that file instead.",
      positional: ["app", "uri"],
      words: ["app", "read"],
    },
    script: { positional: ["app", "uri"] },
  },
  text: (contents) => `${contents.trimEnd()}\n`,
});

export const appsList = defineCapability({
  input: z.object({}),
  name: "apps.list",
  output: z.object({
    apps: z.array(
      z.object({
        account: z.string().optional(),
        connected: z.boolean(),
        name: z.string(),
        slug: z.string(),
        status: z.string(),
        type: z.string(),
      }),
    ),
    invalid: z.array(z.object({ message: z.string(), slug: z.string() })),
  }),
  async run() {
    const config = getWorkspaceConfig();
    const [{ apps, invalid }, connections] = await Promise.all([
      listApps(config.appsDir),
      config.apps.connections.list(),
    ]);
    return {
      apps: apps.map((app) => ({
        ...(app.manifest.account ? { account: app.manifest.account } : {}),
        connected: isConnected(connections[app.slug], app.manifestHash),
        name: app.name,
        slug: app.slug,
        status: describeConnection(connections[app.slug], app.manifestHash),
        type: app.manifest.type,
      })),
      invalid: invalid.map(({ message, slug }) => ({ message, slug })),
    };
  },
  summary: "Every app in the workspace and where it stands.",
  surfaces: {
    cli: { help: "", words: ["app", "list"] },
    script: {},
  },
  text({ apps, invalid }) {
    if (apps.length === 0 && invalid.length === 0) {
      return `No apps yet. \`${APP_COMMAND.name} catalog <name>\` to look one up, \`${APP_COMMAND.name} new\` to write its folder.\n`;
    }
    return `${[
      ...apps.map(
        (app) =>
          `${app.slug}  ${app.name}${app.account ? ` (${app.account})` : ""}  ${app.type}  ${app.status}`,
      ),
      ...invalid.map(
        (entry) => `${entry.slug}  broken manifest: ${entry.message}`,
      ),
    ].join("\n")}\n`;
  },
});
