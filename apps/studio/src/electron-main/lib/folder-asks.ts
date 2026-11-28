import fs from "node:fs/promises";
import path from "node:path";

/** What macOS answered this app for a folder a Files search asked to open. */
type FolderAnswer = "allowed" | "refused";

/** One folder a search stepped over that the person can let it into. */
type FolderAsk = {
  name: string;
  path: string;
  /** macOS refused it, so only System Settings opens it now. */
  refused?: true;
  /** Windows has no prompt: the search just moves into the folder. */
  searchIn?: true;
};

// oxlint-disable-next-line studio/no-os-words -- a folder only Windows has
const APP_DATA = "AppData";

/** iCloud Drive's own folder, from the home folder; macOS only. */
const ICLOUD_DRIVE = path.join(
  // oxlint-disable-next-line studio/no-os-words -- a folder only macOS has
  "Library",
  "Mobile Documents",
  "com~apple~CloudDocs",
);

/** macOS's answers for the folders a search asked to open, this run. */
const answers = new Map<string, FolderAnswer>();

/**
 * What macOS answered for each folder a search asked to open: this run's
 * answers, over the folders let in on earlier runs (`kept`). A refusal is
 * kept for this run only, since System Settings can change it.
 */
export function folderAnswers(
  kept: readonly string[],
): ReadonlyMap<string, FolderAnswer> {
  return new Map([
    ...kept.map((folder) => [folder, "allowed"] as const),
    ...answers,
  ]);
}

/**
 * The folders under `root` a search steps over that the person can let it
 * into: on a Mac, those macOS asks about (Desktop, Documents, Downloads and
 * iCloud Drive) that it hasn't let in yet; on Windows, AppData. The other
 * folders a search leaves out are the programs' own, and aren't named.
 */
export function folderAsks({
  home,
  known,
  notSearched,
  platform = process.platform,
  root,
}: {
  home: string;
  known: ReadonlyMap<string, FolderAnswer>;
  notSearched: readonly string[];
  platform?: NodeJS.Platform;
  root: string;
}): FolderAsk[] {
  if (platform === "win32") {
    return notSearched
      .filter((folder) => path.win32.basename(folder) === APP_DATA)
      .map((folder) => ({ name: APP_DATA, path: folder, searchIn: true }));
  }
  if (platform !== "darwin") {
    return [];
  }
  const top = root.endsWith("/") ? root : `${root}/`;
  return [
    ...["Desktop", "Documents", "Downloads"].map((name) => ({
      name,
      path: path.join(home, name),
    })),
    {
      name: "iCloud Drive",
      path: path.join(home, ICLOUD_DRIVE),
    },
  ].flatMap((ask): FolderAsk[] => {
    if (!ask.path.startsWith(top)) {
      return [];
    }
    const answer = known.get(ask.path);
    return answer === "allowed"
      ? []
      : [answer === "refused" ? { ...ask, refused: true } : ask];
  });
}

/**
 * Lists `folder` as the app, which is when macOS puts up its prompt for a
 * folder it guards and nobody has answered for, and keeps the answer.
 */
export async function askFolder(folder: string): Promise<FolderAnswer> {
  const answer = await fs.readdir(folder).then(
    (): FolderAnswer => "allowed",
    (): FolderAnswer => "refused",
  );
  answers.set(folder, answer);
  return answer;
}
