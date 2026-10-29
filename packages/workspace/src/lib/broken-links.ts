import {
  filePathOfInstrumentLink,
  instrumentLinkOf,
  isInstrumentAddress,
} from "@instrument-org/shared";
import fs from "node:fs/promises";
import path from "node:path";

import { ChatIdSchema, type ChatId } from "../schemas/chat-id";
import { getAppCatalog } from "./apps/catalog";
import { listApps } from "./apps/store";
import { chatFilePathFromHref, isChatFileHref } from "./chat-file-href";
import { memoryDir, readMemory } from "./memory/store";
import { linkTargetsIn } from "./link-targets";
import { filesNamedIn } from "./parse-files-block";
import { resolveChat } from "./record-folders";
import { resolveWorkspaceFilePaths } from "./resolve-workspace-file-path";
import { SKILL_NAMES } from "./skill-names";
import { findSkill } from "./skills";
import { getWorkspaceConfig } from "./workspace-config";

/** A link in a reply that opens nothing, as the reply wrote it, and why. */
interface BrokenLink {
  link: string;
  reason: string;
}

/**
 * Every link in a reply that would open nothing: a files fence line or a
 * file link naming no file or folder the chat can reach, an app address the
 * window opens no screen for, and one (`instrument://memory/<name>`) naming
 * a memory, skill, app, chat, setting or screen there is none of. A web
 * address is not checked: whether it answers depends on the network. An
 * address this cannot settle (a task, a chat by a short prefix) is left
 * alone.
 */
export async function brokenLinksIn({
  chatId,
  text,
}: {
  chatId: ChatId;
  text: string;
}): Promise<BrokenLink[]> {
  const files = filesNamedIn(text).map((written) => ({
    link: written,
    path: written,
  }));
  const addresses: { link: string; name: string; noun: string }[] = [];
  const refused: BrokenLink[] = [];
  for (const target of linkTargetsIn(text)) {
    const read = readTarget(target);
    if (read?.opens === "file") {
      files.push({ link: target, path: read.path });
    } else if (read?.opens === "address") {
      addresses.push({ link: target, name: read.name, noun: read.noun });
    } else if (read?.opens === "nothing") {
      refused.push({ link: target, reason: "not an address the app opens" });
    }
  }

  const broken = [
    ...(await missingFiles(files, chatId)),
    ...refused,
    ...(
      await Promise.all(
        addresses.map(async (address) => ({
          link: address.link,
          reason: await missingThing(address),
        })),
      )
    ).flatMap(({ link, reason }) =>
      reason === undefined ? [] : [{ link, reason }],
    ),
  ];
  return broken.filter(
    (entry, i) => broken.findIndex(({ link }) => link === entry.link) === i,
  );
}

/**
 * What a link's target opens, read in the order the renderer reads it: an
 * app address the window takes, a file by the app's address, a path, a
 * `file:` URL, and then an app address the window refuses, which opens
 * nothing. Undefined for anything else, a web address included.
 */
function readTarget(
  href: string,
):
  | undefined
  | { name: string; noun: string; opens: "address" }
  | { opens: "file"; path: string }
  | { opens: "nothing" } {
  const parsed = URL.canParse(href) ? new URL(href) : undefined;
  if (isInstrumentAddress(href)) {
    const filePath = filePathOfInstrumentLink(href);
    if (filePath !== undefined) {
      return { opens: "file", path: filePath };
    }
    const link = instrumentLinkOf(href);
    return link
      ? { name: link.name, noun: link.kind, opens: "address" }
      : { opens: "nothing" };
  }
  if (isChatFileHref(href)) {
    return { opens: "file", path: chatFilePathFromHref(href) };
  }
  if (parsed?.protocol === "file:") {
    // A Windows file's URL keeps its drive as the first segment,
    // `/C:/Users/sam/a.md`, which the shell spells `/c/Users/sam/a.md`.
    return {
      opens: "file",
      path: chatFilePathFromHref(
        parsed.pathname.replace(
          /^\/([A-Za-z]):(?=\/|$)/u,
          (_, drive: string) => `/${drive.toLowerCase()}`,
        ),
      ),
    };
  }
  return undefined;
}

async function missingFiles(
  files: { link: string; path: string }[],
  chatId: ChatId,
): Promise<BrokenLink[]> {
  if (files.length === 0) {
    return [];
  }
  const asked = (file: { path: string }) =>
    file.path.replace(/(?<=.)\/+$/u, "");
  const resolved = await resolveWorkspaceFilePaths({
    chatId,
    filePaths: files.map(asked),
  });
  const found = await Promise.all(
    files.map(async (file) => {
      const hostPath = resolved.get(asked(file));
      if (!hostPath) {
        return false;
      }
      const stats = await fs.stat(hostPath).catch(() => undefined);
      // A trailing slash hands over a folder; a path without one may name
      // either, and opens whichever it is.
      return file.path.endsWith("/")
        ? stats?.isDirectory() === true
        : stats !== undefined;
    }),
  );
  const missing = files.filter((_, i) => !found[i]);
  return Promise.all(
    missing.map(async (file) => ({
      link: file.link,
      reason: await whyNothingOpens(file.path, chatId),
    })),
  );
}

/** A step up a folder, which the app opens no file link through. */
const PARENT_STEP = /(?:^|\/)\.\.(?:\/|$)/u;

/**
 * What a file link may end in that the app opens no file by: a heading, a
 * query, or an editor's line and column (`notes.md#intro`, `a.csv?v=2`,
 * `main.ts:12:4`).
 */
const SUFFIX = /(?:#[^/]*|\?[^/]*|:\d+(?::\d+)?)$/u;

/**
 * Why a file link opens nothing, said so the agent fixes the link rather
 * than looking for a file that may be right there: a step up a folder, an
 * ending the app does not read, or no file or folder at that path.
 */
async function whyNothingOpens(
  written: string,
  chatId: ChatId,
): Promise<string> {
  if (PARENT_STEP.test(written)) {
    return "the app opens no link through `..`: write the path without it";
  }
  const suffix = SUFFIX.exec(written)?.[0];
  if (suffix !== undefined) {
    const bare = written.slice(0, -suffix.length);
    const hostPath = (
      await resolveWorkspaceFilePaths({ chatId, filePaths: [bare] })
    ).get(bare);
    if (hostPath && (await fs.stat(hostPath).catch(() => undefined))) {
      return `the app opens no link ending in \`${suffix}\`: link the file alone`;
    }
  }
  return written.endsWith("/") ? "no folder there" : "no file there";
}

/** Why an app address opens nothing, or undefined when it does or cannot be told. */
async function missingThing({
  name,
  noun,
}: {
  name: string;
  noun: string;
}): Promise<string | undefined> {
  const config = getWorkspaceConfig();
  switch (noun) {
    case "app": {
      const { apps } = await listApps(config.appsDir);
      return apps.some((app) => app.slug === name) ||
        getAppCatalog().some((entry) => entry.slug === name)
        ? undefined
        : "no app by that name";
    }
    case "chat": {
      // The window also takes a chat by the start of its id, which only it
      // can match, so only a whole id is checked.
      if (!ChatIdSchema.safeParse(name).success) {
        return undefined;
      }
      return resolveChat(name) ? undefined : "no chat by that id";
    }
    case "memory": {
      return (await readMemory(memoryDir(), name))
        ? undefined
        : "no memory by that name";
    }
    case "screen":
    case "settings": {
      const names = await guideNames(noun);
      return names === undefined || names.has(name)
        ? undefined
        : `no ${noun === "screen" ? "screen" : "setting"} by that name`;
    }
    case "skill": {
      return (await findSkill(config, name)).skill
        ? undefined
        : "no skill by that name";
    }
    default: {
      return undefined;
    }
  }
}

const GUIDE_SECTIONS = { screen: "Screens", settings: "Settings" } as const;

/**
 * The names `instrument://settings/<name>` or `instrument://screen/<name>`
 * takes, read from the product guide's generated reference, which lists
 * each in backticks under its section. Undefined when the reference cannot
 * be read, so nothing is called broken on a guess.
 */
async function guideNames(
  noun: keyof typeof GUIDE_SECTIONS,
): Promise<Set<string> | undefined> {
  const reference = await fs
    .readFile(
      path.join(
        getWorkspaceConfig().systemSkillsDir,
        SKILL_NAMES.instrumentGuide,
        "reference.md",
      ),
      "utf8",
    )
    .catch(() => undefined);
  const section = reference
    ?.split(/^## /mu)
    .find((each) => each.startsWith(`${GUIDE_SECTIONS[noun]}\n`));
  if (section === undefined) {
    return undefined;
  }
  return new Set(
    [...section.matchAll(/\(`([\w.:-]+)`\)/gu)].flatMap((match) =>
      match[1] === undefined ? [] : [match[1]],
    ),
  );
}
