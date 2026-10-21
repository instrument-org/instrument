import { APP_NAME_SLUG, APP_PROTOCOL } from "@instrument-org/shared";
import fs from "node:fs/promises";
import path from "node:path";

import { ChatIdSchema, type ChatId } from "../schemas/chat-id";
import { getAppCatalog } from "./apps/catalog";
import { listApps } from "./apps/store";
import { chatFilePathFromHref, isChatFileHref } from "./chat-file-href";
import { memoryDir, readMemory } from "./memory/store";
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

// Code is shown as written, so a link inside it is no link. The files fence
// is read on its own, as the card it renders.
const CODE_FENCE = /^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1[ \t]*$/gmu;
const INLINE_CODE = /`[^`\n]+`/gu;
// The same reading of a Markdown link's target the renderer's chips use.
const LINK = /\[[^\]]*\]\(\s*([^)\s]+)/gu;

const SCHEMES = new Set([`${APP_NAME_SLUG}:`, `${APP_PROTOCOL}:`]);

/**
 * Every link in a reply that would open nothing: a files fence line or a
 * file link naming no file or folder the chat can reach, and an app address
 * (`instrument://memory/<name>`) naming a memory, skill, app, chat, setting
 * or screen there is none of. A web address is not checked: whether it
 * answers depends on the network. An address this cannot settle (a task, a
 * chat by a short prefix, a noun it does not know) is left alone.
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
  const prose = text.replaceAll(CODE_FENCE, "").replaceAll(INLINE_CODE, "");
  for (const match of prose.matchAll(LINK)) {
    const target = match[1];
    if (target === undefined) {
      continue;
    }
    if (isChatFileHref(target)) {
      files.push({ link: target, path: chatFilePathFromHref(target) });
      continue;
    }
    const address = appAddressOf(target);
    if (address?.noun === "file") {
      files.push({ link: target, path: address.name });
    } else if (address) {
      addresses.push({ link: target, ...address });
    }
  }

  const broken = [
    ...(await missingFiles(files, chatId)),
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

/** The noun and the one name an app address leads with, or undefined for any other address. */
function appAddressOf(
  href: string,
): undefined | { name: string; noun: string } {
  if (!URL.canParse(href)) {
    return undefined;
  }
  const parsed = new URL(href);
  if (!SCHEMES.has(parsed.protocol)) {
    return undefined;
  }
  const noun = parsed.host.toLowerCase();
  if (noun === "file") {
    // `instrument://file//Users/sam/a.md` and `instrument://file/Users/sam/a.md`
    // both name the absolute path.
    const filePath = decoded(parsed.pathname).replace(/^\/+/u, "/");
    return filePath === "/" ? undefined : { name: filePath, noun };
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  const [first] = segments;
  return segments.length === 1 && first !== undefined
    ? { name: decoded(first), noun }
    : undefined;
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
  return files.flatMap((file, i) =>
    found[i]
      ? []
      : [
          {
            link: file.link,
            reason: file.path.endsWith("/")
              ? "no folder there"
              : "no file there",
          },
        ],
  );
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
    case "chat":
    case "thread": {
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

function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
