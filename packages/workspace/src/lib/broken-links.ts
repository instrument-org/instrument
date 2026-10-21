import { APP_NAME_SLUG, APP_PROTOCOL } from "@instrument-org/shared";
import fs from "node:fs/promises";
import path from "node:path";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

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

// The parser family the renderer reads a reply with, so a link is read here
// exactly as it draws there: angle-bracket and parenthesized targets, nested
// brackets in the text, references, and nothing inside code.
const markdown = unified().use(remarkParse).use(remarkGfm);

type MarkdownNode =
  | ReturnType<typeof markdown.parse>
  | ReturnType<typeof markdown.parse>["children"][number];

const SCHEMES = new Set([`${APP_NAME_SLUG}:`, `${APP_PROTOCOL}:`]);

/**
 * The nouns the window opens an address for, as its link reader knows them
 * (`instrumentLinkOf` in Studio), each by the noun this checks it as.
 * `thread` is what older replies called a chat.
 */
const NOUNS = {
  app: "app",
  chat: "chat",
  memory: "memory",
  screen: "screen",
  settings: "settings",
  skill: "skill",
  task: "task",
  thread: "chat",
} as const;

const isNoun = (noun: string): noun is keyof typeof NOUNS =>
  Object.hasOwn(NOUNS, noun);

/** A name the window takes in an address: one segment of these characters. */
const NAME = /^[\w.:-]+$/u;

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
 * The target of every link and image a reply draws, in order. Code is shown
 * as written, so a link inside it is no link, and the files fence is read on
 * its own, as the card it renders.
 */
function linkTargetsIn(text: string): string[] {
  const definitions = new Map<string, string>();
  const found: ({ reference: string } | { url: string })[] = [];
  const visit = (node: MarkdownNode) => {
    if (node.type === "definition") {
      definitions.set(node.identifier, node.url);
    } else if (node.type === "link" || node.type === "image") {
      found.push({ url: node.url });
    } else if (
      node.type === "linkReference" ||
      node.type === "imageReference"
    ) {
      found.push({ reference: node.identifier });
    }
    if ("children" in node) {
      for (const child of node.children) {
        visit(child);
      }
    }
  };
  visit(markdown.parse(text));
  return found.flatMap((each) => {
    const url = "url" in each ? each.url : definitions.get(each.reference);
    return url ? [url] : [];
  });
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
  if (parsed && SCHEMES.has(parsed.protocol)) {
    const noun = parsed.host.toLowerCase();
    if (noun === "file") {
      // `instrument://file//Users/sam/a.md` and `instrument://file/Users/sam/a.md`
      // both name the absolute path.
      const filePath = decoded(parsed.pathname).replace(/^\/+/u, "/");
      return filePath === "/"
        ? { opens: "nothing" }
        : { opens: "file", path: filePath };
    }
    const segments = parsed.pathname.split("/").filter(Boolean);
    const name = segments[0] === undefined ? undefined : decoded(segments[0]);
    return isNoun(noun) &&
      segments.length === 1 &&
      name !== undefined &&
      NAME.test(name)
      ? { name, noun: NOUNS[noun], opens: "address" }
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
