import { type ActionInput } from "@instrument-org/workspace/electron";
import path from "node:path";
import { z } from "zod";

/**
 * The calls a window makes for the person that the action log keeps, by
 * route, each turned into what they did once the call succeeded: the file
 * actions taken in Files and the editors, and the settings changed. A file
 * opened, here or in another app, is the history's (`history-store.ts`). Only
 * these: every other call is the app reading, or something the person's
 * typing or scrolling drives. A route's input arrives as the window sent it,
 * so each is read through a schema of the fields it needs, and a call that
 * does not read is nothing.
 */

type Mapper = (input: unknown, output: unknown) => ActionInput[];

function mapper<I extends z.ZodType, O extends z.ZodType>(
  input: I,
  output: O,
  map: (input: z.output<I>, output: z.output<O>) => ActionInput[],
): Mapper {
  return (rawInput, rawOutput) => {
    const read = input.safeParse(rawInput);
    const answer = output.safeParse(rawOutput);
    return read.success && answer.success ? map(read.data, answer.data) : [];
  };
}

const OnePath = z.object({ path: z.string() });

/** What a copy or a move into a folder did, one action for each folder the things came from. */
function placing(kind: "copy" | "move"): Mapper {
  return mapper(
    z.object({ folder: z.string() }),
    z.object({ placed: z.array(z.object({ from: z.string() })) }),
    (input, output) => {
      const byFolder = new Map<string, string[]>();
      for (const { from } of output.placed) {
        const folder = path.dirname(from);
        byFolder.set(folder, [
          ...(byFolder.get(folder) ?? []),
          path.basename(from),
        ]);
      }
      return [...byFolder].map(([from, names]) => ({
        from,
        kind,
        names,
        to: input.folder,
      }));
    },
  );
}

/** A setting the person changed, by its label in Settings, and what it became in words. */
function setting<I extends z.ZodType>(
  name: string,
  input: I,
  value: (input: z.output<I>) => string,
): Mapper {
  return mapper(input, z.unknown(), (read) => [
    { kind: "setting", name, value: value(read) },
  ]);
}

const Enabled = z.object({ enabled: z.boolean() });
const onOff = (on: boolean) => (on ? "On" : "Off");

const THEMES: Record<string, string> = {
  dark: "Dark",
  light: "Light",
  system: "System",
};

const NOTIFICATION_MODES: Record<string, string> = {
  always: "Always",
  never: "Never",
  unfocused: "Only when not focused",
};

const RELEASE_CHANNELS: Record<string, string> = {
  alpha: "Alpha",
  beta: "Beta",
  latest: "Stable",
};

const ROUTES: Record<string, Mapper> = {
  "dictation.setSounds": setting(
    "Dictation sounds",
    z.object({ on: z.boolean() }),
    ({ on }) => onOff(on),
  ),
  "files.copyInto": placing("copy"),
  // Named the way the file manager names a copy, beside the original.
  "files.duplicate": mapper(OnePath, OnePath, (input, output) => [
    {
      from: path.dirname(input.path),
      kind: "copy",
      names: [path.basename(input.path)],
      to: path.dirname(output.path),
    },
  ]),
  "files.moveInto": placing("move"),
  "files.newFolder": mapper(z.unknown(), OnePath, (_input, output) => [
    { kind: "new-folder", path: output.path },
  ]),
  "files.rename": mapper(OnePath, OnePath, (input, output) =>
    input.path === output.path
      ? []
      : [{ from: input.path, kind: "rename", to: output.path }],
  ),
  "files.trash": mapper(OnePath, z.unknown(), (input) => [
    { kind: "trash", paths: [input.path] },
  ]),
  // A save the file on disk turned away, since something else wrote it
  // first, wrote nothing.
  "files.write": mapper(OnePath, z.object({ ok: z.literal(true) }), (input) => [
    { kind: "edit", path: input.path },
  ]),
  "preferences.setAgentCompletionNotifications": setting(
    "Notify when tasks finish",
    z.object({ mode: z.string() }),
    ({ mode }) => NOTIFICATION_MODES[mode] ?? mode,
  ),
  "preferences.setBlockAds": setting("Block ads", Enabled, ({ enabled }) =>
    onOff(enabled),
  ),
  // The model by its name alone: the rest of its address names the
  // provider's setup on this computer.
  "preferences.setDefaultModelURI": setting(
    "Default model",
    z.object({ modelURI: z.string() }),
    ({ modelURI }) => modelURI.split("?")[0] ?? modelURI,
  ),
  "preferences.setDeveloperMode": setting(
    "Developer mode",
    Enabled,
    ({ enabled }) => onOff(enabled),
  ),
  "preferences.setReleaseChannel": setting(
    "Release channel",
    z.object({ channel: z.string().optional() }),
    ({ channel }) =>
      channel === undefined
        ? "Default"
        : (RELEASE_CHANNELS[channel] ?? channel),
  ),
  "preferences.setRunProgramsWithoutSandbox": setting(
    "Run programs without a sandbox",
    Enabled,
    ({ enabled }) => onOff(enabled),
  ),
  "preferences.setShareActionsWithChats": setting(
    "Share what you do in the app with chats",
    Enabled,
    ({ enabled }) => onOff(enabled),
  ),
  "preferences.setSuggestNextMessage": setting(
    "Suggest a next message",
    Enabled,
    ({ enabled }) => onOff(enabled),
  ),
  "preferences.setTheme": setting(
    "Theme",
    z.object({ theme: z.string() }),
    ({ theme }) => THEMES[theme] ?? theme,
  ),
  "problems.setOfferFeedback": setting(
    "Ask for feedback",
    Enabled,
    ({ enabled }) => onOff(enabled),
  ),
  "problems.setSendAutomatically": setting(
    "Send error reports automatically",
    Enabled,
    ({ enabled }) => onOff(enabled),
  ),
};

/** What a successful call to `route` says the person did: nothing for most calls, one action or a few for these. */
export function actionsOfCall(
  route: readonly string[],
  input: unknown,
  output: unknown,
): ActionInput[] {
  return ROUTES[route.join(".")]?.(input, output) ?? [];
}
