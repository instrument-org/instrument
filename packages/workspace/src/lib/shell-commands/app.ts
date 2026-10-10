import { APP_NAME } from "@instrument-org/shared";
import { APP_CATEGORIES } from "@instrument-org/shared/app-directory";
import { type ByteString, defineCommand, EMPTY_BYTES } from "just-bash";
import ms from "ms";
import { isPlainObject } from "radashi";

import { MOUNT } from "../../mount-points";
import { appChanged } from "../apps/changed";
import { type ChatId } from "../../schemas/chat-id";
import {
  type AppCatalogEntry,
  catalogEndpointNeedsClient,
  findCatalogEntry,
  getAppCatalog,
  searchAppCatalog,
  searchAppCatalogByMeaning,
} from "../apps/catalog";
import {
  describeConnection,
  isConnected,
  readConnection,
} from "../apps/connection";
import {
  APP_GUIDE_FILE_NAME,
  APP_MANIFEST_EXAMPLE,
  APP_MANIFEST_FILE_NAME,
  type AppManifest,
  AppManifestSchema,
  type AppSlug,
  AppSlugSchema,
  isMcpManifest,
} from "../apps/manifest";
import {
  credentialMovedMessage,
  lookupAppCredential,
  requireAppCredential,
} from "../apps/credential-origin";
import { callMcpTool, listMcpTools } from "../apps/mcp/client";
import { withAppMcpClient } from "../apps/mcp/run";
import { credentialOrigin } from "../apps/origin-bound";
import { performAppRequest, redactCredential } from "../apps/request";
import {
  type AppInfo,
  guidePlaceholdersLeft,
  guideSkeleton,
  listApps,
  loadApp,
  readAppGuide,
  setAppAccount,
  writeAppFolder,
  writeAppGuide,
} from "../apps/store";
import { checkAppIcon, writeAppIcon } from "../apps/icon";
import { mcpSignInSupport, packageExists } from "../apps/preflight";
import { catalogWayIn, parseAuth } from "../apps/way-in";
import { formatAppTestReport, runAppTest } from "../apps/test-app";
import { chatDir } from "../record-folders";
import { getChatState, setChatState } from "../chat-record";
import { getChatSettings } from "../chat-settings";
import { truncateMiddle } from "../truncate-buffer";
import { getWorkspaceConfig } from "../workspace-config";
import { APP_COMMAND } from "./app-command";
import {
  defineSubcommands,
  type SubcommandInput,
  type SubcommandShell,
  subcommand,
} from "./subcommands";
import { JS_EXEC_COMMAND } from "./js-exec";
import { TASK_COMMAND } from "./task-command";
import { subprocessStdin } from "./utils";

export { APP_COMMAND } from "./app-command";

/** What `app` needs from the `bash` call it runs inside. */
export interface AppCommandContext {
  /** The task the call belongs to: which apps it may reach, and whose state the guide gate lives in. */
  chatId: ChatId;
}

const REQUEST_TIMEOUT_MS = ms("2 minutes");
const TEST_TIMEOUT_MS = ms("1 minute");

// How many matches a query gets in full before the rest fall back to one line
// each. A word like "data" matches dozens, and rendering those in full is the
// same wall of text the bare listing used to be.
const CATALOG_DETAIL_LIMIT = 10;

// How many of a result's top-level keys `call --out` names in its one line.
const CALL_KEYS_SHOWN = 10;

const USAGE = `Usage: ${APP_COMMAND.name} <subcommand> ...

  ${APP_COMMAND.name} catalog [words]
      The directory: services it knows, each with its endpoints (an MCP server
      to prefer, an API base) and how each is reached (a sign-in, a key). Words
      filter by name, domain, or category, the services they name first. With
      no words, the whole directory one line each; add a word for the detail.
  ${APP_COMMAND.name} new <slug> --name '<Name>' (--mcp <url> | --api <base-url> | --local <package> | --web <url>) [--sign-in <url>] [--auth oauth|bearer|basic|basic:<user>|header:<Name>|query:<param>|env:<VAR>|none] [--header '<Name>: <value>']... [--arg <arg>]... [--runtime node|python] [--mac-app <bundle-id>] [--test <path>] [--force]
      Write ${MOUNT.apps}/<slug>/${APP_MANIFEST_FILE_NAME}, and a ${APP_GUIDE_FILE_NAME} when there is
      none, from the directory's entry for the service when it has one. An
      MCP app's guide is done as written; an API app's may leave prompts to
      answer with \`${APP_COMMAND.name} guide\`. An MCP app defaults to oauth (a one-click sign-in, no key);
      an API app to bearer, and needs --test, a cheap GET that proves the key.
      A key the service documents as HTTP Basic credentials takes basic (the key
      alone) or basic:<user> (the key as the password behind a fixed username);
      the base64 happens here, so the user pastes the key exactly as the service
      gave it to them and is never asked to encode or prefix anything.
      --local names an MCP server that runs on this machine, installed from npm
      (--runtime node, the default) or PyPI (--runtime python): it defaults to
      no key, takes env:<VAR> when the server reads one from its environment,
      and the user has to allow it to run before it does. When it drives an
      app on this Mac, --mac-app takes that app's bundle identifier
      (\`osascript -e 'id of app "Drafts"'\` prints it), and the app is drawn
      with that app's icon. --web names a service worked on its own site in
      ${APP_NAME}'s browser, for one with no sign-in the card can open: the
      user signs in there (at --sign-in, when the login page is not the
      url), and a task works the site in a tab. Refuses to overwrite
      an existing manifest without --force. You can also write the two files
      yourself with your file tools.
  ${APP_COMMAND.name} test <slug>
      The red/green loop: manifest, guide, key or sign-in, a scan for secrets in
      the folder, then the service for real. A pass connects the app; a failure
      says what to fix. A manifest edited after a pass has to pass again.
  ${APP_COMMAND.name} list
      Every app in the workspace and where it stands.
  ${APP_COMMAND.name} tools <slug>
      An MCP app's tools, a line each. Long for a big app; pipe it through rg.
  ${APP_COMMAND.name} tool <slug> <name>
      One tool in full: what it does and the JSON it takes.
  ${APP_COMMAND.name} call <slug> <tool> ['<json>'] [--out <file>]
      Run one tool. Arguments as a JSON object, inline or on stdin through a
      quoted heredoc. --out writes the result to that file instead, as JSON
      where the service answered with data, and prints only a line saying
      what landed: for a result to work through with jq, js-exec, node, or
      python rather than read whole.
      In js-exec code (\`js-exec -c '<code>'\` or a script file),
      \`await tools.<slug>.<tool>({...})\` makes the same call and returns the
      result as a value (\`tools["<slug>"]\` for a slug with a hyphen),
      throwing a refusal: for many calls, or calls that feed each other, in
      one script rather than a turn each.
  ${APP_COMMAND.name} request <slug> <METHOD> <path> [--param <k>=<v>]... ['<json body>']
      One request through an API app, the path relative to its base. The first
      request in a task hands back the app's guide instead; read it, then
      repeat. The body can come on stdin.
  ${APP_COMMAND.name} guide <slug> [<<'EOF' ... EOF]
      The app's ${APP_GUIDE_FILE_NAME}. With the whole file on stdin through a
      quoted heredoc, write it instead: how an API app's prompts get answered.
  ${APP_COMMAND.name} icon <slug> <file>
      Draw the app with this icon: a square SVG, or a square PNG of at least
      128px, in place of its site's or its Mac app's. For a service whose site
      has no good one, a local app that drives no Mac app, or when the user
      asks. A task can draw one; set it from the task's folder.
  ${APP_COMMAND.name} account <slug> ['<account>'] [--clear]
      Name the account the app is signed in as, the way the user would know
      it ("jeremy@example.com", "Acme workspace"), so two apps for one service
      can be told apart; it shows wherever the app does. Once you have seen
      which account it is, from what the service answered or the page a task
      worked on, name it. The user can rename it. With no name, prints it.
  ${APP_COMMAND.name} disconnect <slug>
      Take the app's key or sign-in away. Its folder stays.

${APP_MANIFEST_EXAMPLE}
`;

export function createAppCommand(context: AppCommandContext) {
  return defineCommand(APP_COMMAND.name, (args, ctx) =>
    runApp(args, context, ctx),
  );
}

const runApp = defineSubcommands<AppCommandContext>({
  name: APP_COMMAND.name,
  subcommands: {
    account: subcommand({
      booleans: ["clear"],
      run: (input, context) => runAccount(input, context),
    }),
    call: subcommand({
      flags: ["out"],
      run: (input, context, shell) => runCall(input, context, shell),
    }),
    catalog: subcommand({
      run: ({ positional }, _, { signal }) => runCatalog(positional, signal),
    }),
    disconnect: subcommand({
      positional: 1,
      run: ({ positional }, context) => runDisconnect(positional, context),
    }),
    guide: subcommand({
      positional: 1,
      run: ({ positional }, context, { stdin }) =>
        runGuide(positional, context, stdin),
    }),
    icon: subcommand({
      positional: 2,
      run: ({ positional }, context, shell) =>
        runIcon(positional, context, shell),
    }),
    list: subcommand({ positional: 0, run: (_, context) => runList(context) }),
    new: subcommand({
      booleans: ["force"],
      flags: [
        "api",
        "arg",
        "auth",
        "header",
        "local",
        "mac-app",
        "mcp",
        "name",
        "runtime",
        "sign-in",
        "test",
        "web",
      ],
      repeatable: ["arg", "header"],
      run: (input, context) => runNew(input, context),
    }),
    request: subcommand({
      flags: ["param"],
      repeatable: ["param"],
      run: (input, context, { signal, stdin }) =>
        runRequest(input, context, stdin, signal),
    }),
    test: subcommand({
      positional: 1,
      run: ({ positional }, context, { signal }) =>
        runTest(positional, context, signal),
    }),
    // `app tools linear save_comment` is how the singular gets reached for,
    // so the two mean the same thing.
    tool: subcommand({
      positional: 2,
      run: ({ positional }, context, { signal }) =>
        runTools(positional, context, signal, positional[1]),
    }),
    tools: subcommand({
      positional: 2,
      run: ({ positional }, context, { signal }) =>
        runTools(positional, context, signal, positional[1]),
    }),
  },
  usage: USAGE,
});

/**
 * The apps a task may reach: the ones the chat handed it, by slug, or
 * every app for a task nobody scoped (the chat itself, a task a person
 * made). Undefined means every app.
 */
async function allowedSlugs(chatId: ChatId): Promise<Set<string> | undefined> {
  const settings = await getChatSettings(chatDir(chatId));
  return settings?.apps ? new Set(settings.apps) : undefined;
}

/** Mac apps the bundled helper answers for, by bundle id, with the task command that reaches each. */
const NATIVE_COMMANDS: Record<string, string> = {
  "com.apple.AddressBook": "contacts",
  "com.apple.iCal": "calendar",
  "com.apple.reminders": "calendar",
};

/** The task command that reaches a Mac app through the helper, where this build carries it. */
function nativeCommandFor(bundleId: string): string | undefined {
  return getWorkspaceConfig().macHelperBinPath === undefined
    ? undefined
    : NATIVE_COMMANDS[bundleId];
}

/** The catalog, as lines: what each service is and how it is reached. */
function describeCatalogEntry(entry: AppCatalogEntry): string {
  const surfaces = entry.interfaces.map((surface) => {
    // Said in words, so the endpoint is not mistaken for one to set up.
    const auth =
      surface.auth === "oauth-client"
        ? ` (not usable: its sign-in takes only a client registered with ${entry.name}, which ${APP_NAME} does not have yet)`
        : surface.auth
          ? ` (${surface.auth})`
          : "";
    return `    ${surface.format.padEnd(9)} ${surface.endpoint ?? surface.package ?? surface.name}${auth}`;
  });
  const methods =
    entry.authMethods.length === 0
      ? "none needed"
      : entry.authMethods
          .map(
            (method) =>
              `${method.label}${method.note ? `: ${method.note}` : ""}`,
          )
          .join("; ");
  const way = catalogWayIn(entry);
  const native =
    way.kind === "mac-app" ? nativeCommandFor(way.bundleId) : undefined;
  const start = `${APP_COMMAND.name} new ${entry.slug} --name '${entry.name}'`;
  const howTo =
    way.kind === "mcp"
      ? `${start} --mcp ${way.endpoint}${way.auth ? ` --auth ${way.auth}` : ""}`
      : way.kind === "local"
        ? `${start} --local ${way.package} --runtime ${way.runtime}`
        : way.kind === "api"
          ? `${start} --api ${way.endpoint} --auth ${way.auth} --test ${way.test ?? "<a cheap GET, such as /me>"}`
          : way.kind === "mac-app"
            ? `nothing to connect, and no \`${APP_COMMAND.name} new\`: when the user asks for something in ${way.name}, brief a task to do it ${native === undefined ? `with osascript on this Mac, and macOS asks the user once to let ${APP_NAME} control it` : `with the \`${native}\` command, ${APP_NAME}'s own way into ${way.name} (fast, and it reads every account added there; never osascript for it), and macOS asks the user once for access`}. ${entry.family === "apple" ? "" : `This reaches ${entry.name} only when its account is added to ${way.name}; otherwise set it up on the web with \`${start} --web ${entry.home ?? `https://${entry.domain}`}\`.`}`.trimEnd()
            : `${start} --web ${way.url}${way.signIn ? ` --sign-in '${way.signIn}'` : ""}  (on the web: no other way in works from here yet, so the user signs in on the site in ${APP_NAME}'s browser and a task works it in a tab)`;
  const keySurface =
    way.kind === "mcp" || way.kind === "api"
      ? entry.interfaces.find((surface) => surface.endpoint === way.endpoint)
      : undefined;
  const limits = entry.interfaces.find(
    (surface) => surface.format === "mac-app",
  )?.limits;
  return [
    `${entry.slug}  ${entry.name}  ${entry.domain}`,
    `  ${entry.tagline}`,
    ...surfaces,
    `  auth: ${methods}`,
    ...(entry.docsUrl ? [`  docs: ${entry.docsUrl}`] : []),
    `  set up: ${howTo}`,
    ...(keySurface?.keyPage
      ? [
          `  key: made at ${keySurface.keyPage}${keySurface.keySteps ? `: ${keySurface.keySteps}` : ""} The key card links there.`,
        ]
      : []),
    ...(way.kind === "mac-app" && limits ? [`  limits: ${limits}`] : []),
  ].join("\n");
}

/** The first sentence of a description, on one line, capped for a listing. */
function firstSentence(text: string): string {
  const flat = text.replaceAll(/\s+/g, " ").trim();
  const end = flat.search(/[.!?](?:\s|$)/);
  const sentence = end === -1 ? flat : flat.slice(0, end + 1);
  return sentence.length > 160 ? `${sentence.slice(0, 157)}...` : sentence;
}

/** JSON from an inline argument or stdin, as an object. */
function jsonFrom(
  inline: string | undefined,
  stdin: ByteString,
  what: string,
): Record<string, unknown> {
  const piped = subprocessStdin(stdin)?.toString("utf8").trim();
  const raw = (piped || inline || "").trim();
  if (!raw) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${what} must be a JSON object: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${what} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

async function markGuideRead(chatId: ChatId, slug: string) {
  const dir = chatDir(chatId);
  const state = await getChatState(dir);
  const read = state.appGuidesRead ?? [];
  if (!read.includes(slug)) {
    await setChatState(dir, { appGuidesRead: [...read, slug] });
  }
}

function ok(stdout: string) {
  return { exitCode: 0, stderr: "", stdout };
}

/** Whatever authenticates the app, taken out of anything the agent will read. */
async function redactorFor(app: AppInfo, credential: null | string) {
  const oauthTokens =
    app.manifest.type === "mcp" && app.manifest.auth.kind === "oauth"
      ? (await getWorkspaceConfig().apps.oauth?.store.getTokens(app.slug))
          ?.value
      : undefined;
  return (text: string) => {
    let out = redactCredential(text, credential);
    out = redactCredential(out, oauthTokens?.access_token ?? null);
    return redactCredential(out, oauthTokens?.refresh_token ?? null);
  };
}

/**
 * The app a subcommand names, when this task may reach it. With `connected`,
 * only one whose connection record is current, so a call never goes out on a
 * manifest nobody tested.
 */
async function requireApp(
  rawSlug: string | undefined,
  context: AppCommandContext,
  { connected }: { connected: boolean },
): Promise<AppInfo> {
  if (!rawSlug) {
    throw new Error(
      `an app slug is required. See \`${APP_COMMAND.name} list\`.`,
    );
  }
  const allowed = await allowedSlugs(context.chatId);
  if (allowed && !allowed.has(rawSlug)) {
    const yours = [...allowed].join(", ") || "none";
    throw new Error(
      `this task was not handed the app "${rawSlug}". Apps it has: ${yours}.`,
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
        `"${app.slug}" is ${describeConnection(connection, app.manifestHash)}.`,
      );
    }
  }
  return app;
}

/**
 * One MCP tool call with every check `call` makes: the task was handed the
 * app, it is connected on the manifest that passed its test, it is an MCP
 * app, and its credential is here. A failed connection throws with what to do
 * next; a refusal comes back with `isError` for the caller to report. Nothing
 * in the result is redacted yet; `redact` does that.
 */
async function callAppTool({
  args,
  context,
  signal,
  slug,
  tool,
}: {
  /** The tool's arguments, read once the app is known to take a call. */
  args: () => Record<string, unknown>;
  context: AppCommandContext;
  signal: AbortSignal | undefined;
  slug: string | undefined;
  tool: string | undefined;
}) {
  const app = await requireApp(slug, context, { connected: true });
  const manifest = app.manifest;
  if (manifest.type === "web") {
    throw new Error(webAppRefusal(app.slug, manifest.url));
  }
  if (!isMcpManifest(manifest)) {
    throw new Error(
      `"${app.slug}" is an API app; make requests with \`${APP_COMMAND.name} request\`.`,
    );
  }
  if (!tool) {
    throw new Error(
      `call takes the tool's name after the slug. See \`${APP_COMMAND.name} tools ${app.slug}\`.`,
    );
  }
  const params = args();
  const credential = await requireAppCredential(app.slug, manifest);
  const redact = await redactorFor(app, credential);
  const result = await withAppMcpClient({
    credential,
    manifest,
    manifestHash: app.manifestHash,
    run: (client) => callMcpTool(client, { args: params, name: tool }),
    signal: withTimeout(signal, REQUEST_TIMEOUT_MS),
    slug: app.slug,
  });
  if (result.isErr()) {
    throw new Error(
      `${redact(result.error.message)}${result.error.reason === "unauthorized" ? ` Run \`${APP_COMMAND.name} test ${app.slug}\`; if the sign-in is gone, ask for it again with connect_app.` : ""}`,
    );
  }
  return { ...result.value, app, redact, tool };
}

/** What follows a tool's refusal, wherever it is reported. */
function refusalHint(slug: string, tool: string): string {
  return `The tool refused the call. If the arguments were the problem, \`${APP_COMMAND.name} tool ${slug} ${tool}\` shows the JSON it takes.`;
}

async function runCall(
  input: SubcommandInput,
  context: AppCommandContext,
  shell: SubcommandShell,
) {
  const { signal, stdin } = shell;
  const [slug, rawTool, inline] = input.positional;
  const out = input.value("out");
  const { app, isError, redact, structured, text, tool } = await callAppTool({
    args: () => jsonFrom(inline, stdin, "The tool's arguments"),
    context,
    signal,
    slug,
    tool: rawTool,
  });
  // A refusal is printed either way: it is short, and the agent has to read
  // it to fix the call, so there is nothing for a file to hold.
  if (out !== undefined && !isError) {
    const body = redact(
      structured ? JSON.stringify(structured, null, 2) : text,
    );
    try {
      await shell.fs.writeFile(
        shell.fs.resolvePath(shell.cwd, out),
        `${body}\n`,
      );
    } catch (error) {
      throw new Error(
        `cannot write ${out}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return ok(
      `Wrote ${out}: ${describeCallResult(body, structured !== undefined)}, ${Buffer.byteLength(body)} bytes.\n`,
    );
  }
  return isError
    ? {
        exitCode: 1,
        stderr: `${redact(text)}\n${refusalHint(app.slug, tool)}\n`,
        stdout: "",
      }
    : ok(`${redact(text)}\n`);
}

/**
 * The `tools` global a `js-exec` script gets: `tools.<slug>.<tool>(args)`
 * makes the call `call` would, through the same checks, and hands the script
 * a value rather than text to read: the structured result where the service
 * sent one, else its text parsed as JSON, else the text itself. A refusal or
 * a failed connection throws inside the script with the words `call` prints.
 * The string returned is that value as JSON, which is what just-bash parses.
 */
export async function invokeAppTool(
  context: AppCommandContext,
  path: string,
  argsJson: string,
  signal?: AbortSignal,
): Promise<string> {
  // A slug has no dots, so everything past the first is the tool's name.
  const dot = path.indexOf(".");
  const slug = dot === -1 ? path : path.slice(0, dot);
  const tool = dot === -1 ? undefined : path.slice(dot + 1);
  try {
    const result = await callAppTool({
      args: () => jsonFrom(argsJson, EMPTY_BYTES, "The tool's argument"),
      context,
      signal,
      slug,
      tool: tool || undefined,
    });
    const { redact, structured, text } = result;
    if (result.isError) {
      throw new Error(
        `${redact(text)}\n${refusalHint(result.app.slug, result.tool)}`,
      );
    }
    if (structured) {
      return JSON.stringify(redactValue(structured, redact));
    }
    const redacted = redact(text);
    try {
      JSON.parse(redacted);
      return redacted;
    } catch {
      return JSON.stringify(redacted);
    }
  } catch (error) {
    throw new Error(
      `tools.${path}: ${error instanceof Error ? error.message : String(error)}`,
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

/**
 * What `call --out` wrote, in a few words of our own: enough to aim jq at it
 * without opening it. Key names are the service's, so they are quoted and cut
 * short rather than passed through.
 */
function describeCallResult(body: string, structured: boolean): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return `text, ${body.split("\n").length} lines`;
  }
  const kind = structured ? "the tool's structured result" : "JSON text";
  if (Array.isArray(parsed)) {
    return `${kind}, an array of ${parsed.length}`;
  }
  if (!isPlainObject(parsed)) {
    return kind;
  }
  const keys = Object.keys(parsed);
  const shown = keys
    .slice(0, CALL_KEYS_SHOWN)
    .map((key) => JSON.stringify(key.slice(0, 40)));
  const more =
    keys.length > CALL_KEYS_SHOWN
      ? ` and ${keys.length - CALL_KEYS_SHOWN} more`
      : "";
  return `${kind}, an object with keys ${shown.join(", ")}${more}`;
}

async function runCatalog(args: string[], signal: AbortSignal | undefined) {
  const query = args.join(" ").trim();
  const entries = searchAppCatalog(query);
  if (entries.length === 0) {
    // The words name nothing listed, but they may still say what it is for.
    const meant = await searchAppCatalogByMeaning(query, {
      configs: getWorkspaceConfig().getAIProviderConfigs(),
      signal,
    });
    if (meant.length > 0) {
      return ok(
        `Nothing in the directory is called "${query}". By what it is for, these may be what is meant, most likely first; ask the user which before setting one up unless one plainly fits.\n\n${meant.map(describeCatalogEntry).join("\n\n")}\n`,
      );
    }
    return ok(
      `Nothing in the directory matches "${query}". Set it up by hand. For a service you do not know, look up what this command can actually take, not a manifest shape of your own: the service's MCP endpoint if it has one, otherwise its API base URL, one cheap GET that proves a key, and which of oauth, bearer, basic, basic:<user>, header:<Name>, query:<param>, or none the key rides in -- those words, not a scheme of its own. Then \`${APP_COMMAND.name} new\`, or write ${APP_MANIFEST_FILE_NAME} and ${APP_GUIDE_FILE_NAME} yourself.\n`,
    );
  }
  // Every entry in full runs past what a command's output keeps, and what gets
  // dropped is the middle: the directory went in whole and came back missing
  // the alphabet from "consensus" to "slack". So a listing nobody narrowed is
  // one line each, which fits, and a word brings back the detail.
  if (query === "") {
    const groups = APP_CATEGORIES.flatMap(({ id, label }) => {
      const inCategory = entries.filter((entry) => entry.category === id);
      return inCategory.length === 0
        ? []
        : [`${label}\n${inCategory.map(summarizeCatalogEntry).join("\n")}`];
    });
    return ok(
      `${entries.length} services, by category, most used first. \`${APP_COMMAND.name} catalog <words>\` for what one is, how it is reached, and the line that sets it up.\n\n${groups.join("\n\n")}\n`,
    );
  }
  const detailed = entries
    .slice(0, CATALOG_DETAIL_LIMIT)
    .map(describeCatalogEntry)
    .join("\n\n");
  const rest = entries.slice(CATALOG_DETAIL_LIMIT);
  const more =
    rest.length === 0
      ? ""
      : `\n\n${rest.length} more match "${query}":\n${rest.map(summarizeCatalogEntry).join("\n")}`;
  return ok(`${detailed}${more}\n`);
}

async function runDisconnect(args: string[], context: AppCommandContext) {
  if (await allowedSlugs(context.chatId)) {
    throw new Error(
      "only the conversation disconnects apps; a task uses them.",
    );
  }
  const app = await requireApp(args[0], context, { connected: false });
  await getWorkspaceConfig().apps.disconnect(app.slug);
  return ok(
    `Disconnected ${app.slug}. Its folder at ${MOUNT.apps}/${app.slug}/ stays; connect_app asks the user again.\n`,
  );
}

async function runGuide(
  args: string[],
  context: AppCommandContext,
  stdin: ByteString,
) {
  const app = await requireApp(args[0], context, { connected: false });
  const written = subprocessStdin(stdin)?.toString("utf8").trim();
  if (written) {
    if (await allowedSlugs(context.chatId)) {
      throw new Error("only the conversation sets apps up; a task uses them.");
    }
    await writeAppGuide(app.dir, written);
    const left = guidePlaceholdersLeft(app.manifest, written);
    return ok(
      left.length > 0
        ? `Wrote ${MOUNT.apps}/${app.slug}/${APP_GUIDE_FILE_NAME}, but these prompts are still in it: ${left.map((prompt) => `"${prompt}"`).join(" ")} Replace each with its answer and write it again.\n`
        : `Wrote ${MOUNT.apps}/${app.slug}/${APP_GUIDE_FILE_NAME}. Run \`${APP_COMMAND.name} test ${app.slug}\`, or ask with connect_app.\n`,
    );
  }
  const guide = await readAppGuide(app.dir);
  if (guide === null) {
    throw new Error(
      `"${app.slug}" has no ${APP_GUIDE_FILE_NAME}. Write one at ${MOUNT.apps}/${app.slug}/${APP_GUIDE_FILE_NAME}.`,
    );
  }
  await markGuideRead(context.chatId, app.slug);
  return ok(`${guide.trimEnd()}\n`);
}

async function runIcon(
  args: string[],
  context: AppCommandContext,
  ctx: SubcommandShell,
) {
  if (await allowedSlugs(context.chatId)) {
    throw new Error("only the conversation sets apps up; a task uses them.");
  }
  const app = await requireApp(args[0], context, { connected: false });
  const source = args[1];
  if (!source) {
    throw new Error(
      `icon takes the app and a file: ${APP_COMMAND.name} icon ${app.slug} <path to a .svg or .png>.`,
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = await ctx.fs.readFileBuffer(ctx.fs.resolvePath(ctx.cwd, source));
  } catch {
    throw new Error(`cannot read ${source}.`);
  }
  const checked = checkAppIcon(bytes);
  if ("error" in checked) {
    throw new Error(`${source} cannot be ${app.slug}'s icon: ${checked.error}`);
  }
  await writeAppIcon(app.dir, bytes, checked.fileName);
  await appChanged(app.slug);
  return ok(
    `${app.slug} is drawn with ${MOUNT.apps}/${app.slug}/${checked.fileName} now, everywhere it appears.\n`,
  );
}

async function runAccount(input: SubcommandInput, context: AppCommandContext) {
  const [slug, ...words] = input.positional;
  const app = await requireApp(slug, context, { connected: false });
  const named = words.join(" ").trim();
  if (input.has("clear")) {
    await setAppAccount(getWorkspaceConfig().appsDir, app.slug, undefined);
    await appChanged(app.slug);
    return ok(`${app.slug} no longer names an account.\n`);
  }
  if (named === "") {
    return ok(
      app.manifest.account
        ? `${app.slug} is signed in as ${app.manifest.account}.\n`
        : `${app.slug} names no account yet. Name it with \`${APP_COMMAND.name} account ${app.slug} '<account>'\` once you have seen which one it is.\n`,
    );
  }
  const manifest = await setAppAccount(
    getWorkspaceConfig().appsDir,
    app.slug,
    named,
  );
  await appChanged(app.slug);
  return ok(
    `${app.slug} is ${manifest.name} (${named}) wherever it appears now.\n`,
  );
}

async function runList(context: AppCommandContext) {
  const config = getWorkspaceConfig();
  const [{ apps, invalid }, connections, allowed] = await Promise.all([
    listApps(config.appsDir),
    config.apps.connections.list(),
    allowedSlugs(context.chatId),
  ]);
  const visible = apps.filter((app) => !allowed || allowed.has(app.slug));
  if (visible.length === 0 && invalid.length === 0) {
    return ok(
      allowed
        ? "This task was handed no apps.\n"
        : `No apps yet. \`${APP_COMMAND.name} catalog <name>\` to look one up, \`${APP_COMMAND.name} new\` to write its folder.\n`,
    );
  }
  const lines = visible.map(
    (app) =>
      `${app.slug}  ${app.manifest.name}${app.manifest.account ? ` (${app.manifest.account})` : ""}  ${app.manifest.type}  ${describeConnection(connections[app.slug], app.manifestHash)}`,
  );
  for (const entry of invalid) {
    if (!allowed || allowed.has(entry.slug)) {
      lines.push(`${entry.slug}  broken manifest: ${entry.message}`);
    }
  }
  return ok(`${lines.join("\n")}\n`);
}

async function runNew(input: SubcommandInput, context: AppCommandContext) {
  const force = input.has("force");
  const rawSlug = input.positional[0];
  const slugResult = AppSlugSchema.safeParse(rawSlug ?? "");
  if (!slugResult.success) {
    throw new Error(
      `new takes a slug first: lowercase letters, digits, and hyphens, like "notion".`,
    );
  }
  const slug = slugResult.data;
  const allowed = await allowedSlugs(context.chatId);
  if (allowed) {
    throw new Error("only the conversation sets apps up; a task uses them.");
  }
  const name = input.value("name")?.trim();
  if (!name) {
    throw new Error("new needs --name '<Name>', the service's own name.");
  }
  const mcp = input.value("mcp");
  const api = input.value("api");
  const local = input.value("local");
  const web = input.value("web");
  if (
    [mcp, api, local, web].filter(Boolean).length === 0 &&
    input.value("mac-app") !== undefined
  ) {
    throw new Error(
      `a Mac app a task drives with osascript needs no app folder and no \`${APP_COMMAND.name} new\`: brief a task to do what the user asked in it.`,
    );
  }
  if ([mcp, api, local, web].filter(Boolean).length !== 1) {
    throw new Error(
      "new takes exactly one of --mcp <url>, --api <base-url>, --local <package>, or --web <url>.",
    );
  }
  // A web app the directory knows starts its sign-in where the directory
  // says, so the card opens the sign-in and not a signed-out home page.
  const signIn =
    input.value("sign-in")?.trim() ??
    (input.value("web") === undefined
      ? undefined
      : findCatalogEntry(slug, undefined)?.signIn);
  if (signIn && !web) {
    throw new Error(
      "--sign-in goes with --web: only a web app signs in on a page of its own.",
    );
  }
  if (web && input.value("auth") !== undefined) {
    throw new Error(
      "a web app takes no --auth: the user signs in on the site itself.",
    );
  }
  const auth = web
    ? undefined
    : parseAuth(input.value("auth"), local ? "mcp-local" : mcp ? "mcp" : "api");
  const headers = Object.fromEntries(
    input.all("header").map((header) => {
      const [key, ...valueParts] = header.split(":");
      const value = valueParts.join(":").trim();
      if (!key?.trim() || !value) {
        throw new Error(`--header takes '<Name>: <value>' (got "${header}").`);
      }
      return [key.trim(), value];
    }),
  );
  const test = input.value("test");
  const serverArgs = input.all("arg");
  const runtime = input.value("runtime")?.trim() ?? "node";
  if (local && runtime !== "node" && runtime !== "python") {
    throw new Error(
      `--runtime takes node (an npm package) or python (a PyPI one), and defaults to node (got "${runtime}").`,
    );
  }
  const macApp = input.value("mac-app")?.trim();
  if (macApp && !local) {
    throw new Error(
      "--mac-app goes with --local: only a server that runs on this machine drives a Mac app.",
    );
  }
  const candidate: unknown = web
    ? { name, ...(signIn ? { signIn } : {}), type: "web", url: web }
    : local
      ? {
          ...(serverArgs.length > 0 ? { args: serverArgs } : {}),
          auth,
          ...(macApp ? { macApp } : {}),
          name,
          package: local,
          runtime,
          type: "mcp-local",
        }
      : mcp
        ? { auth, name, type: "mcp", url: mcp }
        : {
            auth,
            baseUrl: api,
            ...(Object.keys(headers).length > 0 ? { headers } : {}),
            name,
            test: { path: test ?? "" },
            type: "api",
          };
  if (api && !test) {
    throw new Error(
      "an API app needs --test <path>: a cheap GET, relative to the base URL, that proves the key (a /me or /users/me is usual).",
    );
  }
  const parsed = AppManifestSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(
      `the manifest would be invalid: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
    );
  }
  const manifest: AppManifest = parsed.data;
  const appsDir = getWorkspaceConfig().appsDir;
  const existing = await loadApp(appsDir, slug);
  if (existing.isOk() && !force) {
    throw new Error(
      `${MOUNT.apps}/${slug}/${APP_MANIFEST_FILE_NAME} already exists. Edit it with your file tools, or pass --force to replace it.`,
    );
  }
  await refuseWhatCannotConnect(slug, name, manifest);
  const guide = guideSkeleton(
    manifest,
    findCatalogEntry(
      slug,
      manifest.type === "mcp"
        ? manifest.url
        : manifest.type === "api"
          ? manifest.baseUrl
          : undefined,
    ),
  );
  // A guide written for another way in describes tools this one does not have.
  const reachChanged =
    existing.isOk() && existing.value.manifest.type !== manifest.type;
  await writeAppFolder({
    appsDir,
    guide,
    manifest,
    replacesGuide: reachChanged,
    slug,
  });
  const prompts = guidePlaceholdersLeft(manifest, guide);
  // A key already in the store outlives the manifest that asked for it, so
  // rewriting one to try another auth placement costs the user nothing: the
  // test reuses what they already pasted. Asking again for a key we hold is
  // how one wrong placement turns into four trips to the card. The key is
  // bound to the origin it was saved for, so only a manifest that still sends
  // requests there reuses it; one pointed elsewhere asks the user again.
  const stored =
    manifest.type === "web" ||
    manifest.auth.kind === "none" ||
    manifest.auth.kind === "oauth"
      ? undefined
      : await lookupAppCredential(slug, manifest);
  const next =
    manifest.type === "web"
      ? `Ask the user to sign in with connect_app: the card opens ${manifest.signIn ?? manifest.url} in ${APP_NAME}'s browser, and the app connects when they say they are signed in.`
      : manifest.auth.kind === "none"
        ? `Run \`${APP_COMMAND.name} test ${slug}\`.`
        : manifest.auth.kind === "oauth"
          ? `Ask the user to sign in with connect_app; the app connects on its own when they do.`
          : stored?.kind === "ok"
            ? `A key for this app is already stored for ${credentialOrigin(manifest)}: run \`${APP_COMMAND.name} test ${slug}\` to try it against this manifest, without asking the user again. Ask for it with connect_app only once every placement has been refused.`
            : stored?.kind === "moved"
              ? credentialMovedMessage({ noun: "key", ...stored })
              : `Ask the user for the key with connect_app, then \`${APP_COMMAND.name} test ${slug}\` after the note.`;
  return ok(
    `Wrote ${MOUNT.apps}/${slug}/${APP_MANIFEST_FILE_NAME}${existing.isOk() && !reachChanged ? "" : ` and its ${APP_GUIDE_FILE_NAME}`}.${!existing.isOk() && prompts.length > 0 ? ` The guide has ${prompts.length} prompts to answer before it connects: read it with \`${APP_COMMAND.name} guide ${slug}\`, then write the whole file back with \`${APP_COMMAND.name} guide ${slug} <<'EOF'\`, a few lines each from what you know about the service.` : ""} ${next}\n`,
  );
}

/**
 * Refuses a set-up that is known not to connect, before any card is shown:
 * a hosted MCP server whose sign-in takes only clients its vendor issued
 * ahead of time (the directory's word for one it lists, the server's own
 * metadata for one it does not), and a local server whose package its
 * registry has never heard of.
 */
async function refuseWhatCannotConnect(
  slug: AppSlug,
  name: string,
  manifest: AppManifest,
) {
  // A service the directory lists has its hosted servers on record, so a
  // server for it at any other host is one the agent made up.
  const listed = getAppCatalog().find((candidate) => candidate.slug === slug);
  if (listed && manifest.type === "mcp") {
    const hosts = listed.interfaces.flatMap((surface) =>
      surface.format === "mcp" &&
      surface.endpoint &&
      URL.canParse(surface.endpoint)
        ? [new URL(surface.endpoint).host]
        : [],
    );
    if (
      URL.canParse(manifest.url) &&
      !hosts.includes(new URL(manifest.url).host)
    ) {
      throw new Error(
        hosts.length === 0
          ? `the directory lists no hosted MCP server for ${listed.name}, so ${manifest.url} is not one. Set it up the way \`${APP_COMMAND.name} catalog ${listed.slug}\` says.`
          : `${manifest.url} is not ${listed.name}'s MCP server; the directory has ${hosts.join(", ")}. Set it up the way \`${APP_COMMAND.name} catalog ${listed.slug}\` says.`,
      );
    }
  }
  if (manifest.type === "mcp" && manifest.auth.kind === "oauth") {
    const entry = findCatalogEntry(slug, manifest.url);
    const site = entry ? (entry.home ?? `https://${entry.domain}`) : undefined;
    const instead = `Set it up on the web instead: \`${APP_COMMAND.name} new ${slug} --name '${name}' --web ${site ?? "<the service's site>"}\`${entry ? `, or the way \`${APP_COMMAND.name} catalog ${entry.slug}\` says` : ""}.`;
    const endpointListed = getAppCatalog().some((candidate) =>
      candidate.interfaces.some(
        (surface) =>
          surface.endpoint?.replace(/\/+$/, "") ===
          manifest.url.replace(/\/+$/, ""),
      ),
    );
    if (
      catalogEndpointNeedsClient(manifest.url) ||
      (!endpointListed &&
        (await mcpSignInSupport(manifest.url)) === "needs-client")
    ) {
      throw new Error(
        `${manifest.url} signs in only with a client registered with its vendor ahead of time, which ${APP_NAME} does not have yet, so the sign-in card would fail. ${instead}`,
      );
    }
  }
  if (
    manifest.type === "mcp-local" &&
    (await packageExists(manifest.package, manifest.runtime)) === "missing"
  ) {
    throw new Error(
      `${manifest.package} is not on ${manifest.runtime === "node" ? "npm" : "PyPI"}: there is no such package to install. Use the set-up line \`${APP_COMMAND.name} catalog\` gives for the service, and never a package name you have not seen in it or in the service's own docs.`,
    );
  }
}

async function runRequest(
  input: SubcommandInput,
  context: AppCommandContext,
  stdin: ByteString,
  signal: AbortSignal | undefined,
) {
  const [slug, rawMethod, requestPath, inlineBody] = input.positional;
  const app = await requireApp(slug, context, { connected: true });
  if (app.manifest.type === "web") {
    throw new Error(webAppRefusal(app.slug, app.manifest.url));
  }
  if (app.manifest.type !== "api") {
    throw new Error(
      `"${app.slug}" is an MCP app; use \`${APP_COMMAND.name} tools\` and \`${APP_COMMAND.name} call\`.`,
    );
  }
  const method = (rawMethod ?? "").toUpperCase();
  if (!["DELETE", "GET", "PATCH", "POST", "PUT"].includes(method)) {
    throw new Error(
      "request takes a method after the slug: GET, POST, PUT, PATCH, or DELETE.",
    );
  }
  if (!requestPath) {
    throw new Error(
      "request takes a path after the method, relative to the base URL.",
    );
  }
  // The guide is the app's only documentation, so it enters the context
  // before the first real request in this task.
  const state = await getChatState(chatDir(context.chatId));
  if (!(state.appGuidesRead ?? []).includes(app.slug)) {
    const guide = await readAppGuide(app.dir);
    if (guide === null) {
      throw new Error(
        `"${app.slug}" has no ${APP_GUIDE_FILE_NAME}. Write one at ${MOUNT.apps}/${app.slug}/${APP_GUIDE_FILE_NAME}: the endpoints and conventions a request needs.`,
      );
    }
    await markGuideRead(context.chatId, app.slug);
    return ok(
      `Before the first request to "${app.slug}", its guide. Read it, then repeat the request.\n\n${guide.trimEnd()}\n`,
    );
  }
  const params = Object.fromEntries(
    input.all("param").map((param) => {
      const index = param.indexOf("=");
      if (index <= 0) {
        throw new Error(`--param takes <key>=<value> (got "${param}").`);
      }
      return [param.slice(0, index), param.slice(index + 1)];
    }),
  );
  const piped = subprocessStdin(stdin)?.toString("utf8").trim();
  const body = piped || inlineBody?.trim() || undefined;
  const credential = await requireAppCredential(app.slug, app.manifest);
  const result = await performAppRequest({
    body,
    credential,
    manifest: app.manifest,
    method,
    params,
    path: requestPath,
    signal: withTimeout(signal, REQUEST_TIMEOUT_MS),
  });
  if (result.isErr()) {
    throw new Error(redactCredential(result.error.message, credential));
  }
  const response = result.value;
  const bodyText = redactCredential(response.bodyText, credential);
  const { content, omittedLines, truncated } = truncateMiddle(bodyText);
  const note =
    truncated || response.truncated
      ? `[Body truncated${truncated ? `: ${omittedLines} lines omitted from the middle` : ""}${response.truncated ? "; the response was larger than the cap, so request less or paginate" : ""}]\n`
      : "";
  const statusLine = `${method} ${redactCredential(response.url, credential)} -> ${response.status}${response.contentType ? ` (${response.contentType})` : ""}\n`;
  const shown = `${truncated ? content : bodyText}\n`;
  // The body alone is stdout, so it pipes into jq or rg as the service sent
  // it; the status line and any truncation note are ours and go to stderr.
  return response.status >= 400
    ? { exitCode: 1, stderr: `${statusLine}${shown}${note}`, stdout: "" }
    : { exitCode: 0, stderr: `${statusLine}${note}`, stdout: shown };
}

async function runTest(
  args: string[],
  context: AppCommandContext,
  signal: AbortSignal | undefined,
) {
  const app = await requireApp(args[0], context, { connected: false });
  const report = await runAppTest({
    appsDir: getWorkspaceConfig().appsDir,
    signal: withTimeout(signal, TEST_TIMEOUT_MS),
    slug: app.slug,
  });
  const text = `${formatAppTestReport(report)}\n`;
  return report.passed ? ok(text) : { exitCode: 1, stderr: text, stdout: "" };
}

async function runTools(
  args: string[],
  context: AppCommandContext,
  signal: AbortSignal | undefined,
  only?: string,
) {
  const app = await requireApp(args[0], context, { connected: true });
  const manifest = app.manifest;
  if (manifest.type === "web") {
    throw new Error(webAppRefusal(app.slug, manifest.url));
  }
  if (!isMcpManifest(manifest)) {
    throw new Error(
      `"${app.slug}" is an API app and has no tools; read its guide with \`${APP_COMMAND.name} guide ${app.slug}\` and make requests.`,
    );
  }
  const credential = await requireAppCredential(app.slug, manifest);
  const redact = await redactorFor(app, credential);
  const result = await withAppMcpClient({
    credential,
    manifest,
    manifestHash: app.manifestHash,
    run: (client) => listMcpTools(client),
    signal: withTimeout(signal, REQUEST_TIMEOUT_MS),
    slug: app.slug,
  });
  if (result.isErr()) {
    throw new Error(redact(result.error.message));
  }
  if (only !== undefined) {
    const tool = result.value.find((candidate) => candidate.name === only);
    if (!tool) {
      throw new Error(
        `"${app.slug}" has no tool "${only}". \`${APP_COMMAND.name} tools ${app.slug}\` lists them.`,
      );
    }
    return ok(
      `${tool.name}\n${redact(tool.description).trim()}\n\ninput: ${redact(JSON.stringify(tool.inputSchema, null, 2))}\n\n\`${APP_COMMAND.name} call ${app.slug} ${tool.name} '<json>'\` runs it.\n`,
    );
  }
  // A line each: a big app lists dozens, and the schemas would make the
  // listing longer than a turn should read. `app tool` has the whole of one.
  const lines = result.value.map(
    (tool) => `- ${tool.name}: ${firstSentence(redact(tool.description))}`,
  );
  return ok(
    `${result.value.length} tools on ${app.slug}. \`${APP_COMMAND.name} tool ${app.slug} <name>\` shows one with the JSON it takes; \`${APP_COMMAND.name} call ${app.slug} <name> '<json>'\` runs it, and in ${JS_EXEC_COMMAND.name} code (\`${JS_EXEC_COMMAND.name} -c '<code>'\`) \`await ${toolsAccessor(app.slug)}.<name>({...})\` returns it as a value.\n${lines.join("\n")}\n`,
  );
}

/** How a `js-exec` script names an app on its `tools` global. */
function toolsAccessor(slug: string): string {
  return slug.includes("-") ? `tools["${slug}"]` : `tools.${slug}`;
}

/**
 * One entry on one line, for a listing too long to render in full. The way in
 * is on it because it is what decides whether a service is worth reaching for
 * at all.
 */
function summarizeCatalogEntry(entry: AppCatalogEntry): string {
  const way = catalogWayIn(entry);
  const label =
    way.kind === "mcp"
      ? way.auth === "none"
        ? "mcp:open"
        : way.auth
          ? "mcp:key"
          : "mcp"
      : way.kind === "local"
        ? "mcp:local"
        : way.kind === "api"
          ? "api:key"
          : way.kind === "mac-app"
            ? "mac-app"
            : "web";
  return `  ${entry.slug.padEnd(17)} ${label.padEnd(9)} ${entry.tagline}`;
}

/** Why `call`, `tools`, and `request` refuse a web app, and how it is worked instead. */
function webAppRefusal(slug: string, url: string): string {
  return `"${slug}" is a web app: the user is signed in to it in ${APP_NAME}'s browser, and no \`${APP_COMMAND.name}\` call reaches it. Work it in a tab: brief a task with ${url}, or hand it a tab already open there with \`${TASK_COMMAND.name} new --tab <id>\`.`;
}

/** The call's own signal, bounded by a timeout so a hung service cannot hold a turn. */
function withTimeout(signal: AbortSignal | undefined, timeoutMs: number) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
