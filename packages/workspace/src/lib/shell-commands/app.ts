import { APP_NAME } from "@instrument-org/shared";
import { findSecrets } from "@instrument-org/shared/secrets";
import { APP_CATEGORIES } from "@instrument-org/shared/app-directory";
import { type ByteString, defineCommand } from "just-bash";
import ms from "ms";
import { basename } from "node:path";

import { appChanged } from "../apps/changed";
import { recordSetupTouch } from "../setup-changes";
import { appsFolder, requireApp, withTimeout } from "../capabilities/apps";
import { cliSubcommands } from "../capabilities/cli";
import { type CapabilityScope } from "../capabilities/context";
import { scriptSurfaceOpen } from "../capabilities/script-surface";
import {
  type AppCatalogEntry,
  catalogApiSignInClient,
  catalogEndpointNeedsClient,
  catalogInterfaceLacksClient,
  catalogEntryAt,
  catalogEntryForApp,
  findCatalogEntry,
  getAppCatalog,
  searchAppCatalog,
  searchAppCatalogByMeaning,
  serviceManifestFields,
} from "../apps/catalog";
import { nameAppAccount } from "../apps/connection";
import { APP_FILE_NAME } from "../apps/app-file";
import {
  APP_MANIFEST_EXAMPLE,
  type AppManifest,
  AppManifestSchema,
  type AppSlug,
  AppSlugSchema,
} from "../apps/manifest";
import {
  credentialMovedMessage,
  lookupAppCredential,
} from "../apps/credential-origin";
import { credentialOrigin } from "../apps/origin-bound";
import {
  guidePlaceholdersLeft,
  guideSkeleton,
  listApps,
  loadApp,
  readAppGuide,
  writeAppFolder,
  writeAppGuide,
} from "../apps/store";
import { checkAppIcon, writeAppIcon } from "../apps/icon";
import { mcpSignInSupport, packageExists } from "../apps/preflight";
import { catalogWayIn, parseAuth } from "../apps/way-in";
import { formatAppTestReport, runAppTest } from "../apps/test-app";
import { recordAppGuideHandOff } from "../apps/guide-hand-off";
import { getWorkspaceConfig } from "../workspace-config";
import { shellPath } from "../workspace-fs-layout";
import { APP_COMMAND } from "./app-command";
import { CALENDAR_COMMAND, CONTACTS_COMMAND } from "./mac-helper";
import { MAIL_COMMAND } from "./mail";
import { MESSAGES_COMMAND } from "./messages";
import { NOTES_COMMAND } from "./notes";
import {
  defineSubcommands,
  type Subcommand,
  type SubcommandInput,
  type SubcommandShell,
  subcommand,
} from "./subcommands";
import { NODE_COMMAND } from "./node";
import { subprocessStdin } from "./utils";

export { APP_COMMAND } from "./app-command";

/** What `app` needs from the `bash` call it runs inside: its chat, session, model and role. */
export type AppCommandContext = CapabilityScope;

const TEST_TIMEOUT_MS = ms("1 minute");

// How many matches a query gets in full before the rest fall back to one line
// each. A word like "data" matches dozens, and rendering those in full is the
// same wall of text the bare listing used to be.
const CATALOG_DETAIL_LIMIT = 10;

/** The usage's lines on scripts, where a script reaches `instrument`. */
const SCRIPTS_USAGE = `  In a script, the same calls return values, and a refusal throws. In
  ${NODE_COMMAND.name} code, the \`instrument\` global: \`await instrument.apps["<slug>"].<tool>({...})\`,
  \`await instrument.apps["<slug>"].get("<path>", { params })\` (\`post\`, \`put\`, \`patch\`,
  \`delete\` take \`{ body }\`). In Python, \`import instrument\`: \`instrument.app("<slug>").<tool>(...)\`,
  \`instrument.app("<slug>").get("<path>", params={...})\`, \`.post("<path>", body={...})\`.
  For many calls, or calls that feed each other, in one script rather than a
  turn each. Read an app's guide with \`${APP_COMMAND.name} guide <slug>\` before scripting
  it: a script's first request to an API app throws ReadGuideFirst with the
  guide instead of sending.`;

/** The command's usage, with the subcommands the registry generates in it. */
function appUsage(generated: string[]) {
  return `Usage: ${APP_COMMAND.name} <subcommand> ...

  ${APP_COMMAND.name} catalog [words]
      The directory: services it knows, each with its endpoints (an MCP server
      to prefer, an API base) and how each is reached (a sign-in, a key). Words
      filter by name, domain, or category, the services they name first. With
      no words, the whole directory one line each; add a word for the detail.
  ${APP_COMMAND.name} new <slug> --name '<Name>' (--mcp <url> | --api <base-url> | --local <package> | --web <url>) [--sign-in <url>] [--auth oauth|bearer|basic|basic:<user>|header:<Name>|query:<param>|env:<VAR>|none] [--header '<Name>: <value>']... [--arg <arg>]... [--runtime node|python] [--mac-app <bundle-id>] [--test <path>] [--service <directory-slug>] [--force]
      Write the app's ${APP_FILE_NAME} in the apps folder, from the directory's entry
      for the service when it has one: the setup as front matter over the
      guide. <slug> is the \`id\` in it, which every ${APP_COMMAND.name} subcommand names the
      app by; --name names its folder, which is what the user sees and is
      theirs to rename. An
      MCP app's guide is done as written; an API app's may leave prompts to
      answer with \`${APP_COMMAND.name} guide\`. An MCP app defaults to oauth (a one-click sign-in, no key);
      an API app to bearer, and needs --test, a cheap GET that proves the key
      (the directory's own, for a service it has, when left out).
      A key the service documents as HTTP Basic credentials takes basic (the key
      alone) or basic:<user> (the key as the password behind a fixed username);
      the base64 happens here, so the user pastes the key exactly as the service
      gave it to them and is never asked to encode or prefix anything.
      --local names an MCP server that runs on this machine, installed from npm
      (--runtime node, the default) or PyPI (--runtime python): it defaults to
      no key, takes env:<VAR> when the server reads one from its environment,
      and the user has to allow it to run before it does. When it drives an
      app on this Mac, --mac-app takes that app's bundle identifier
      (\`plutil -extract CFBundleIdentifier raw /Applications/Drafts.app/Contents/Info.plist\`
      prints it), and the app is drawn
      with that app's icon. --service names the directory's entry the app is
      for, when its slug and address leave that open (one API serving several
      services). --web names a service worked on its own site in
      ${APP_NAME}'s browser, for one with no sign-in the card can open: the
      user signs in there (at --sign-in, when the login page is not the
      url), and a task works the site in a tab. It is also where an app
      goes when its own sign-in fails or is refused: \`${APP_COMMAND.name} new <slug>
      --web <url> --force\` moves it there, keeping its name. Refuses to
      overwrite an app that is already there without --force. You can also write the
      file yourself with your file tools.
  ${APP_COMMAND.name} test <slug>
      The red/green loop: manifest, guide, key or sign-in, a scan for secrets in
      the folder, then the service for real. A pass connects the app; a failure
      says what to fix. A manifest edited after a pass has to pass again.
  These take --json, for the whole result as JSON, and --out <file>, to write it there:
${generated.join("\n")}
${scriptSurfaceOpen() ? `${SCRIPTS_USAGE}\n` : ""}  ${APP_COMMAND.name} guide <slug> [<<'EOF' ... EOF]
      The app's guide, the body of its ${APP_FILE_NAME}. With the whole guide on stdin
      through a quoted heredoc, write it instead, leaving the setup above it
      alone: how an API app's prompts get answered.
  ${APP_COMMAND.name} icon <slug> <file>
      Draw the app with this icon: a square SVG, or a square PNG of at least
      128px, in place of its site's or its Mac app's. For a service whose site
      has no good one, a local app that drives no Mac app, or when the user
      asks. A task can draw one; set it from the chat's folder.
  ${APP_COMMAND.name} account <slug> ['<account>'] [--clear]
      Name the account the app is signed in as, the way the user would know
      it ("jeremy@example.com", "Acme workspace"), so two apps for one service
      can be told apart; it shows wherever the app does. Name it when it is
      plain (the service answered it, the page shows it, or the user said
      it); don't hunt for it. A web app whose site serves several accounts
      (Gmail) moves to that account's address. The user can rename it. With
      no name, prints it.
  ${APP_COMMAND.name} disconnect <slug>
      Take the app's key or sign-in away. Its folder stays.

${APP_MANIFEST_EXAMPLE}
`;
}

export function createAppCommand(context: AppCommandContext) {
  const generated = cliSubcommands("app");
  const runApp = defineSubcommands<AppCommandContext>({
    name: APP_COMMAND.name,
    subcommands: { ...generated.subcommands, ...SETUP_SUBCOMMANDS },
    usage: appUsage(generated.usage),
  });
  return defineCommand(APP_COMMAND.name, (args, ctx) =>
    runApp(args, context, ctx),
  );
}

/** The words that set an app up, written by hand until they join the registry. */
const SETUP_SUBCOMMANDS = {
  account: subcommand({
    booleans: ["clear"],
    run: (input) => runAccount(input),
  }),
  catalog: subcommand({
    run: ({ positional }, _, { signal }) => runCatalog(positional, signal),
  }),
  disconnect: subcommand({
    positional: 1,
    run: ({ positional }) => runDisconnect(positional),
  }),
  guide: subcommand({
    positional: 1,
    run: ({ positional }, _context, { stdin }) => runGuide(positional, stdin),
  }),
  icon: subcommand({
    positional: 2,
    run: ({ positional }, _context, shell) => runIcon(positional, shell),
  }),
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
      "service",
      "sign-in",
      "test",
      "web",
    ],
    repeatable: ["arg", "header"],
    run: (input) => runNew(input),
  }),
  test: subcommand({
    positional: 1,
    run: ({ positional }, _context, { signal }) => runTest(positional, signal),
  }),
} satisfies Record<string, Subcommand<AppCommandContext>>;

/** Mac apps the bundled helper answers for, by bundle id, with the task command that reaches each. */
const HELPER_COMMANDS: Record<string, string> = {
  "com.apple.AddressBook": CONTACTS_COMMAND.name,
  "com.apple.iCal": CALENDAR_COMMAND.name,
  "com.apple.reminders": CALENDAR_COMMAND.name,
};

/** Mac apps the app's own scripts drive, by bundle id, with the task command that reaches each. */
const SCRIPTED_COMMANDS: Record<string, string> = {
  "com.apple.MobileSMS": MESSAGES_COMMAND.name,
  "com.apple.Notes": NOTES_COMMAND.name,
  "com.apple.mail": MAIL_COMMAND.name,
};

/** The task command that reaches a Mac app, where this build has one: a script's on macOS, the helper's where the build carries it. */
function nativeCommandFor(bundleId: string): string | undefined {
  const scripted =
    process.platform === "darwin" ? SCRIPTED_COMMANDS[bundleId] : undefined;
  return (
    scripted ??
    (getWorkspaceConfig().macHelperBinPath === undefined
      ? undefined
      : HELPER_COMMANDS[bundleId])
  );
}

/** The catalog, as lines: what each service is and how it is reached. */
function describeCatalogEntry(entry: AppCatalogEntry): string {
  const surfaces = entry.interfaces.map((surface) => {
    // Said in words, so the endpoint is not mistaken for one to set up.
    const auth = catalogInterfaceLacksClient(surface)
      ? ` (not usable: its sign-in takes only a client registered with ${entry.name}, which ${APP_NAME} does not have yet)`
      : surface.auth
        ? // A sign-in with Instrument's own client is a sign-in like any other.
          ` (${surface.auth === "oauth-client" ? "oauth" : surface.auth})`
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
            ? native === undefined
              ? entry.family === "apple"
                ? `none: ${APP_NAME} has no way into ${way.name} in this build, so tell the user that rather than looking for another way in.`
                : `${start} --web ${entry.home ?? `https://${entry.domain}`}  (${APP_NAME} has no way into ${way.name} in this build, so ${entry.name} is worked on its site)`
              : `nothing to connect, and no \`${APP_COMMAND.name} new\`: when the user asks for something in ${way.name}, do it with the \`${native}\` command, ${APP_NAME}'s own way into ${way.name}, which reads every account added there. The first time a chat uses ${way.name} the person is asked to allow it. ${entry.family === "apple" ? "" : `This reaches ${entry.name} only when its account is added to ${way.name}; otherwise set it up on the web with \`${start} --web ${entry.home ?? `https://${entry.domain}`}\`.`}`.trimEnd()
            : `${start} --web ${way.url}  (on the web: no other way in works from here yet, so the user signs in on the site in ${APP_NAME}'s browser and it is worked in a tab)`;
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
    ...(entry.addAccount
      ? [
          `  another account: on the web, \`${APP_COMMAND.name} new ${entry.slug}-2 --name '${entry.name}' --web ${entry.home ?? `https://${entry.domain}`}\` beside the one already here; its card opens ${entry.name}'s page for adding an account.`,
        ]
      : []),
    ...(keySurface?.keyPage
      ? [
          `  key: made at ${keySurface.keyPage}${keySurface.keySteps ? `: ${keySurface.keySteps}` : ""} The key card links there.`,
        ]
      : []),
    ...(way.kind === "mac-app" && limits ? [`  limits: ${limits}`] : []),
  ].join("\n");
}

function ok(stdout: string) {
  return { exitCode: 0, stderr: "", stdout };
}

async function runCatalog(args: string[], signal: AbortSignal | undefined) {
  const query = args.join(" ").trim();
  const entries = searchAppCatalog(query);
  if (entries.length === 0) {
    // The words name nothing listed, but they may still say what it is for.
    const meant = await searchAppCatalogByMeaning(query, {
      configs: getWorkspaceConfig().getAIProviderConfigs(),
      signal,
      activity: { purpose: "app-search", surface: "agent" },
    });
    if (meant.length > 0) {
      return ok(
        `Nothing in the directory is called "${query}". By what it is for, these may be what is meant, most likely first; ask the user which before setting one up unless one plainly fits.\n\n${meant.map(describeCatalogEntry).join("\n\n")}\n`,
      );
    }
    return ok(
      `Nothing in the directory matches "${query}". Set it up by hand. For a service you do not know, look up what this command can actually take, not a manifest shape of your own: the service's MCP endpoint if it has one, otherwise its API base URL, one cheap GET that proves a key, and which of oauth, bearer, basic, basic:<user>, header:<Name>, query:<param>, or none the key rides in -- those words, not a scheme of its own. Then \`${APP_COMMAND.name} new\`, or write the app's ${APP_FILE_NAME} yourself.\n`,
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

async function runDisconnect(args: string[]) {
  const app = await requireApp(args[0], { connected: false });
  await getWorkspaceConfig().apps.disconnect(app.slug);
  return ok(
    `Disconnected ${app.slug}. Its folder at ${appsFolder()}/${app.name}/ stays; connect_app asks the user again.\n`,
  );
}

async function runGuide(args: string[], stdin: ByteString) {
  const app = await requireApp(args[0], { connected: false });
  const written = subprocessStdin(stdin)?.toString("utf8").trim();
  if (written) {
    // Every later chat reads the guide, so a key written into it would be
    // in front of every one of them; refused here rather than found later by
    // `test`.
    const secrets = [
      ...new Set(findSecrets(written).map(({ label }) => label)),
    ];
    if (secrets.length > 0) {
      throw new Error(
        `guide: not written, it has a secret in it (${secrets.join(", ")}). A guide never keeps a key, token or password: write how the service works without it. The app's key is kept apart from its folder and added to each request.`,
      );
    }
    writeAppGuide(app.dir, written);
    const stored = await readAppGuide(app.dir);
    if (stored !== null) {
      recordAppGuideHandOff({ app: app.slug, guide: stored });
    }
    const left = guidePlaceholdersLeft(app.manifest, written);
    return ok(
      left.length > 0
        ? `Wrote the guide in ${appsFolder()}/${app.name}/${APP_FILE_NAME}, but these prompts are still in it: ${left.map((prompt) => `"${prompt}"`).join(" ")} Replace each with its answer and write it again.\n`
        : `Wrote the guide in ${appsFolder()}/${app.name}/${APP_FILE_NAME}. Run \`${APP_COMMAND.name} test ${app.slug}\`, or ask with connect_app.\n`,
    );
  }
  const guide = await readAppGuide(app.dir);
  if (guide === null) {
    throw new Error(
      `"${app.slug}" has no guide. Write one under the front matter in ${appsFolder()}/${app.name}/${APP_FILE_NAME}.`,
    );
  }
  const printed = `${guide.trimEnd()}\n`;
  recordAppGuideHandOff({ app: app.slug, guide, printed });
  return ok(printed);
}

async function runIcon(args: string[], ctx: SubcommandShell) {
  const app = await requireApp(args[0], { connected: false });
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
    `${app.slug} is drawn with ${appsFolder()}/${app.name}/${checked.fileName} now, everywhere it appears.\n`,
  );
}

async function runAccount(input: SubcommandInput) {
  const [slug, ...words] = input.positional;
  const app = await requireApp(slug, { connected: false });
  const named = words.join(" ").trim();
  if (input.has("clear")) {
    await nameAppAccount(getWorkspaceConfig().appsDir, app.slug, undefined);
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
  const manifest = await nameAppAccount(
    getWorkspaceConfig().appsDir,
    app.slug,
    named,
  );
  await appChanged(app.slug);
  const moved =
    manifest.type === "web" &&
    app.manifest.type === "web" &&
    manifest.url !== app.manifest.url
      ? ` It opens at ${manifest.url}, that account's own address.`
      : "";
  return ok(
    `${app.slug} is ${app.name} (${named}) wherever it appears now.${moved}\n`,
  );
}

/**
 * The directory's entry an app being written is for: the one `--service`
 * names, else the one its slug names, with a second account's `-2` left off
 * when that entry has the endpoint, else the one entry with the endpoint, or
 * the site a web app is on. An endpoint several entries share (Microsoft
 * Graph is Outlook, OneDrive and Teams) never picks one of them, since each
 * signs in for its own scopes: the agent is asked to name the service.
 */
function newAppEntry({
  endpoint,
  service,
  slug,
  web,
}: {
  endpoint: string | undefined;
  service: string | undefined;
  slug: string;
  web: string | undefined;
}): AppCatalogEntry | undefined {
  const catalog = getAppCatalog();
  if (service !== undefined) {
    const named = catalog.find((candidate) => candidate.slug === service);
    if (named === undefined) {
      throw new Error(
        `--service takes a directory slug, and "${service}" is not one. \`${APP_COMMAND.name} catalog <words>\` finds it.`,
      );
    }
    return named;
  }
  const bySlug = catalog.find((candidate) => candidate.slug === slug);
  if (bySlug) {
    return bySlug;
  }
  const normalized = endpoint?.replace(/\/+$/, "");
  const reaches = (candidate: AppCatalogEntry) =>
    candidate.interfaces.some(
      (surface) => surface.endpoint?.replace(/\/+$/, "") === normalized,
    );
  const base = slug.replace(/-\d+$/, "");
  const byBase =
    base === slug || normalized === undefined
      ? undefined
      : catalog.find(
          (candidate) => candidate.slug === base && reaches(candidate),
        );
  if (byBase) {
    return byBase;
  }
  if (normalized !== undefined) {
    const sharing = catalog.filter(reaches);
    if (sharing.length > 1) {
      throw new Error(
        `${normalized} serves several of the directory's services (${sharing.map((candidate) => candidate.slug).join(", ")}), and the slug "${slug}" names none of them. Pass --service with the one this app is for.`,
      );
    }
    if (sharing[0]) {
      return sharing[0];
    }
  }
  return web === undefined ? undefined : catalogEntryAt(web);
}

async function runNew(input: SubcommandInput) {
  const force = input.has("force");
  const rawSlug = input.positional[0];
  const slugResult = AppSlugSchema.safeParse(rawSlug ?? "");
  if (!slugResult.success) {
    throw new Error(
      `new takes a slug first: lowercase letters, digits, and hyphens, like "notion".`,
    );
  }
  const slug = slugResult.data;
  const appsDir = getWorkspaceConfig().appsDir;
  const existing = await loadApp(appsDir, slug);
  // An app written over keeps its name unless another is given.
  const givenName =
    input.value("name")?.trim() ||
    (existing.isOk() && force ? existing.value.name : undefined);
  if (!givenName) {
    throw new Error("new needs --name '<Name>', the service's own name.");
  }
  const mcp = input.value("mcp");
  const api = input.value("api");
  const local = input.value("local");
  const web = input.value("web");
  // The service it reaches, by slug, endpoint, or the site a web app is on,
  // and the apps already here for it: a second account of a service is
  // another app of that service, under the service's name.
  const entry = newAppEntry({
    endpoint: mcp ?? api,
    service: input.value("service")?.trim(),
    slug,
    web,
  });
  const siblings =
    entry === undefined
      ? []
      : (await listApps(appsDir)).apps.filter(
          (app) =>
            app.slug !== slug &&
            catalogEntryForApp(app.slug, app.manifest)?.slug === entry.slug,
        );
  const name = siblings.length > 0 && entry ? entry.name : givenName;
  if (
    [mcp, api, local, web].filter(Boolean).length === 0 &&
    input.value("mac-app") !== undefined
  ) {
    throw new Error(
      `a Mac app needs no app folder and no \`${APP_COMMAND.name} new\`: \`${APP_COMMAND.name} catalog <name>\` says which command reaches it, when one does.`,
    );
  }
  if ([mcp, api, local, web].filter(Boolean).length !== 1) {
    throw new Error(
      "new takes exactly one of --mcp <url>, --api <base-url>, --local <package>, or --web <url>.",
    );
  }
  // A web app the directory knows starts its sign-in where the directory
  // says, so the card opens the sign-in and not a signed-out home page.
  const fromDirectory =
    entry === undefined
      ? undefined
      : serviceManifestFields(entry, {
          anotherAccount: siblings.length > 0,
          web: web !== undefined,
        });
  const signIn = input.value("sign-in")?.trim() ?? fromDirectory?.signIn;
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
  // The directory's own check for the service, where the app is at the
  // address the directory has for it, the one its set-up line gives.
  const directoryTest =
    api !== undefined &&
    entry?.interfaces.some(
      (surface) =>
        surface.endpoint?.replace(/\/+$/, "") === api.replace(/\/+$/, ""),
    )
      ? entry.apiGuide?.test
      : undefined;
  const test = input.value("test") ?? directoryTest;
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
  const service = fromDirectory ? { service: fromDirectory.service } : {};
  const candidate: unknown = web
    ? { ...service, ...(signIn ? { signIn } : {}), type: "web", url: web }
    : local
      ? {
          ...(serverArgs.length > 0 ? { args: serverArgs } : {}),
          auth,
          ...(macApp ? { macApp } : {}),
          package: local,
          runtime,
          ...service,
          type: "mcp-local",
        }
      : mcp
        ? { auth, ...service, type: "mcp", url: mcp }
        : {
            auth,
            ...(Object.keys(headers).length > 0 ? { headers } : {}),
            ...service,
            test: { path: test ?? "" },
            type: "api",
            url: api,
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
  if (existing.isOk() && !force) {
    throw new Error(
      `${appsFolder()}/${existing.value.name}/${APP_FILE_NAME} is already "${slug}". Edit it with your file tools, or pass --force to replace it.`,
    );
  }
  await refuseWhatCannotConnect(slug, name, manifest);
  const guide = guideSkeleton(manifest, entry);
  // A guide written for another way in describes tools this one does not have.
  const reachChanged =
    existing.isOk() && existing.value.manifest.type !== manifest.type;
  const dir = await writeAppFolder({
    appsDir,
    guide,
    manifest,
    name,
    replacesGuide: reachChanged,
    slug,
  });
  recordSetupTouch({
    existedBefore: existing.isOk(),
    kind: "app",
    name: basename(dir),
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
  const another =
    siblings.length > 0
      ? ` It is another ${name} account beside ${siblings.map((app) => (app.manifest.account ? `${app.slug} (${app.manifest.account})` : app.slug)).join(", ")}, so it keeps the name ${name}${givenName === name ? "" : ` rather than "${givenName}"`}: its account is what tells them apart, named when the user has signed in.`
      : "";
  return ok(
    `Wrote ${shellPath(dir)}/${APP_FILE_NAME}, the setup over ${existing.isOk() && !reachChanged ? "the guide that was there" : "its guide"}.${another}${!existing.isOk() && prompts.length > 0 ? ` The guide has ${prompts.length} prompts to answer before it connects: read it with \`${APP_COMMAND.name} guide ${slug}\`, then write the whole guide back with \`${APP_COMMAND.name} guide ${slug} <<'EOF'\`, a few lines each from what you know about the service.` : ""} ${next}\n`,
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
  if (
    manifest.type === "api" &&
    manifest.auth.kind === "oauth" &&
    catalogApiSignInClient(slug, manifest) === undefined
  ) {
    throw new Error(
      `${APP_NAME} signs in to an API only with a client the directory has for its service, and it has none for ${manifest.url}${manifest.service ? ` as ${manifest.service}` : ""}, so the sign-in card would fail. Set it up the way \`${APP_COMMAND.name} catalog\` says for the service.`,
    );
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

async function runTest(args: string[], signal: AbortSignal | undefined) {
  const app = await requireApp(args[0], { connected: false });
  const report = await runAppTest({
    appsDir: getWorkspaceConfig().appsDir,
    signal: withTimeout(signal, TEST_TIMEOUT_MS),
    slug: app.slug,
  });
  const text = `${formatAppTestReport(report)}\n`;
  return report.passed ? ok(text) : { exitCode: 1, stderr: text, stdout: "" };
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
          ? way.auth === "oauth"
            ? "api"
            : "api:key"
          : way.kind === "mac-app"
            ? "mac-app"
            : "web";
  return `  ${entry.slug.padEnd(17)} ${label.padEnd(9)} ${entry.tagline}`;
}
