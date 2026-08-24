/**
 * Canned RPC responses, keyed by dotted procedure path.
 *
 * Only what a screen actually reads needs an entry. Anything missing resolves
 * to `undefined` (or an idle stream, under a streaming segment) and is logged, so
 * growing this file is driven by `window.__rpcCalls.report()` rather than by
 * reading the routers.
 *
 * A value may be a function, which receives the procedure input.
 *
 * Shapes are pinned to the contracts the routers declare -- `satisfies` on the
 * exported types, and the real parser for branded ids and model URIs -- so a
 * fixture that drifts fails here instead of rendering something subtly wrong
 * three components deep.
 */
import { AIGatewayModel, AIGatewayModelURI } from "@instrument-org/ai-gateway";
import { AIProviderConfigIdSchema } from "@instrument-org/shared";
import {
  type Project,
  ProjectIdSchema,
  type Task,
  TaskIdSchema,
} from "@instrument-org/workspace/client";

// Mutable: the setters below write here, the way the real ones write to the
// preferences store. Nothing persists across a reload.
const preferences: Record<string, unknown> = {
  agentCompletionNotifications: "unfocused",
  // On by default: the debug routes are the densest collection of statically
  // rendered components in the app, and there is no in-browser path to the
  // native menu that would otherwise toggle this.
  developerMode: true,
  enableUsageMetrics: false,
  lastUpdateCheck: undefined,
  preferApiKeyOverAccount: false,
  releaseChannel: undefined,
  theme: "system",
};

/**
 * Write procedures, keyed the same way as {@link FIXTURES}.
 *
 * The UI never trusts a mutation's return value: it writes, then reads the
 * change back off a live stream that the main process re-publishes. So each
 * entry mutates state and returns the `[path, value]` pairs to re-yield, which
 * is what makes a theme toggle actually repaint instead of silently no-op.
 *
 * The value is spread into a new object because `setQueryData` bails on an
 * identical reference, and React would never re-render.
 */
export const MUTATIONS: Record<string, (input: never) => [string, unknown][]> =
  {};

function preferenceSetter<TInput>(apply: (input: TInput) => void) {
  return (input: TInput): [string, unknown][] => {
    apply(input);
    return [["preferences.live.get", { ...preferences }]];
  };
}

Object.assign(MUTATIONS, {
  "preferences.setAgentCompletionNotifications": preferenceSetter(
    (i: { mode: string }) =>
      (preferences.agentCompletionNotifications = i.mode),
  ),
  "preferences.setDeveloperMode": preferenceSetter(
    (i: { enabled: boolean }) => (preferences.developerMode = i.enabled),
  ),
  "preferences.setEnableUsageMetrics": preferenceSetter(
    (i: { enabled: boolean }) => (preferences.enableUsageMetrics = i.enabled),
  ),
  "preferences.setPreferApiKeyOverAccount": preferenceSetter(
    (i: { prefer: boolean }) =>
      (preferences.preferApiKeyOverAccount = i.prefer),
  ),
  "preferences.setReleaseChannel": preferenceSetter(
    (i: { channel?: string }) => (preferences.releaseChannel = i.channel),
  ),
  "preferences.setTheme": preferenceSetter(
    (i: { theme: string }) => (preferences.theme = i.theme),
  ),
} satisfies Record<string, (input: never) => [string, unknown][]>);

function model(
  author: string,
  canonicalId: string,
  name: string,
  tags: string[],
) {
  const params = {
    provider: "anthropic" as const,
    providerConfigId: AIProviderConfigIdSchema.parse("web-fixture"),
  };
  return AIGatewayModel.Schema.parse({
    author,
    canonicalId,
    features: ["inputText", "inputImage", "inputFile", "outputText", "tools"],
    name,
    params,
    providerId: `${author}/${canonicalId}`,
    providerName: "Anthropic",
    tags,
    uri: AIGatewayModelURI.fromModel({
      author,
      canonicalId: AIGatewayModel.CanonicalIdSchema.parse(canonicalId),
      params,
    }),
  });
}

const models = [
  model("anthropic", "claude-opus-5", "Claude Opus 5", [
    "recommended",
    "coding",
  ]),
  model("anthropic", "claude-sonnet-5", "Claude Sonnet 5", ["default"]),
  model("anthropic", "claude-haiku-4-5", "Claude Haiku 4.5", ["new"]),
];

const projects = [
  {
    createdAt: new Date("2026-06-02T10:00:00Z"),
    description: "Marketing site and docs",
    folders: [{ access: "read-write", path: "/workspace/acme-web" }],
    id: ProjectIdSchema.parse("prj_N1FZH5VKD9779DKV5HZF1NB3XS"),
    instructions: "",
    name: "Acme Web",
  },
  {
    createdAt: new Date("2026-07-14T09:30:00Z"),
    description: "iOS and Android clients",
    folders: [{ access: "read-only", path: "/workspace/acme-mobile" }],
    id: ProjectIdSchema.parse("prj_Q3H1K7XNFB99BFNX7K1H3QD5ZV"),
    instructions: "",
    name: "Mobile App",
  },
] satisfies Project[];

const tasks = [
  {
    createdAt: new Date("2026-07-28T14:12:00Z"),
    id: TaskIdSchema.parse("task-redesign-pricing-page"),
    projectId: ProjectIdSchema.parse("prj_N1FZH5VKD9779DKV5HZF1NB3XS"),
    title: "Redesign the pricing page",
    updatedAt: new Date("2026-07-30T16:40:00Z"),
  },
  {
    createdAt: new Date("2026-07-29T11:05:00Z"),
    id: TaskIdSchema.parse("task-fix-mobile-nav-overflow"),
    pinnedAt: new Date("2026-07-29T11:30:00Z"),
    projectId: ProjectIdSchema.parse("prj_N1FZH5VKD9779DKV5HZF1NB3XS"),
    title: "Fix the mobile nav overflow",
    updatedAt: new Date("2026-07-30T09:15:00Z"),
  },
  {
    createdAt: new Date("2026-07-30T08:00:00Z"),
    id: TaskIdSchema.parse("task-offline-sync-queue"),
    projectId: ProjectIdSchema.parse("prj_Q3H1K7XNFB99BFNX7K1H3QD5ZV"),
    title: "Add offline support to the sync queue",
    updatedAt: new Date("2026-07-31T10:20:00Z"),
  },
] satisfies Task[];

// More than a menu can show at once, on purpose: the composer's list of skills
// is one of the few things here that has to be scrolled to be read, and a
// fixture of three never shows that.
const skills = [
  ["brand-voice", "Rewrite copy in the house voice, with the words we avoid"],
  ["changelog", "Turn a range of commits into release notes people can read"],
  ["competitor-scan", "Collect how other products word a screen like this one"],
  ["design-review", "Check a screen against the type, spacing and color rules"],
  ["invoice", "Pull the amounts and dates out of a bill and total them"],
  [
    "meeting-notes",
    "Write up a transcript as decisions, owners and next steps",
  ],
  ["pricing-model", "Build a sheet that prices a plan against its costs"],
  ["research-brief", "Gather sources on a question and say what they agree on"],
  ["screenshot-diff", "Say what moved between two captures of the same screen"],
  ["seo-audit", "Read a page the way a crawler does and list what it misses"],
  ["slide-deck", "Draft a deck from an outline, one idea per slide"],
  ["sql-explain", "Say in prose what a query returns and what it costs"],
].map(([name = "", description = ""], index) => {
  // Two sources, so the label on the right of a row has something to tell
  // apart and its tooltip has two answers.
  const source = index % 3 === 0 ? "claude" : "workspace";
  return {
    aliases: [],
    description,
    // The stable ID a mention stores, which is the source and the name: a
    // token in the prompt is resolved back to a skill through it, so an ID of
    // any other shape leaves the chip permanently unresolved.
    id: `${source}:${name}`,
    name,
    path: `/workspace/.skills/${name}`,
    qualifiedName: `${source}:${name}`,
    source,
    title: name,
    userInvocable: true,
  };
});

const byId = (input: unknown) =>
  tasks.find((t) => t.id === (input as { id: string }).id) ?? null;

export const FIXTURES: Record<string, unknown> = {
  // No command at rest; the browser keymap pushes into this stream.
  "appCommands.events.command": undefined,
  "auth.live.hasToken": true,
  // The browser panel's `<webview>` pool has nothing to reconcile against in a
  // real browser, so it stays empty rather than mounting guests that cannot exist.
  "browser.events.restoreHostFocus": undefined,
  "browser.live.targets": [],
  "debug.getAppEnvironment": { isPackaged: false },
  // Skills on, so the composer's menu carries the group a typed slash reaches.
  "features.getAll": { skills: true },
  "features.live.getAll": { skills: true },
  "gateway.models.list": { errors: [], models },
  "gateway.models.live.list": { errors: [], models },
  // Snapshots, not the mutable object: handing out the same reference the
  // setters mutate would defeat structural sharing, and a theme change would
  // land in the cache without ever re-rendering.
  "preferences.get": () => ({ ...preferences }),
  "preferences.getAppVersion": { version: "0.0.0-web" },
  // React Query rejects an undefined result, so absence is modeled as null.
  "preferences.getRecentUpdate": null,
  "preferences.live.defaultModelURI": models[1]?.uri,
  "preferences.live.get": () => ({ ...preferences }),
  "updates.live.status": { status: "idle" },
  "user.live.me": null,
  "user.live.subscriptionStatus": null,
  "utils.events.windowFocusChanged": undefined,
  "utils.live.serverExceptions": undefined,
  // A page is neither, so the custom controls show the maximize glyph and the
  // Linux window border draws.
  "utils.live.windowState": { fullScreen: false, maximized: false },
  // A browser cannot raise the native folder panel, so picking one always
  // lands on the same folder. Enough for the composer's folder tray, which is
  // what a page here is for.
  "utils.showFolderPicker": { path: "/Users/sam/Documents/Legal Docs" },
  "utils.syncZoom": undefined,
  "workspace.pin.live.listTaskIds": [tasks[1]?.id],
  "workspace.project.live.list": projects,
  // The task route's `beforeLoad` calls `sessions.at(-1)` unguarded, so this
  // has to be an array. Empty means the task opens with no session rather than
  // pulling a whole transcript fixture in behind it.
  "workspace.session.list": [],
  "workspace.skill.events.changed": undefined,
  "workspace.skill.list": skills,
  "workspace.task.byId": byId,
  "workspace.task.list": { tasks, total: tasks.length },
  "workspace.task.live.activity": [],
  "workspace.task.live.byId": byId,
  "workspace.task.live.list": { tasks, total: tasks.length },
};
