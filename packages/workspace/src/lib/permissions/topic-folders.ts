import { AbsolutePathSchema } from "../../schemas/paths";
import { getCurrentDate } from "../get-current-date";
import { updateJsonRecordSync } from "../json-record-file";
import {
  type PermissionSettings,
  permissionSettingsOf,
  permissionsFileIn,
  readPermissionSettings,
  updatePermissionSettings,
} from "./rules";

/**
 * Every topic's granted folders on this computer, by topic id, each in the
 * order it was added. Kept in this computer's permission settings rather
 * than in the topic's `TOPIC.md`; see `topics` there.
 */
export async function everyTopicsFolderPaths(): Promise<Map<string, string[]>> {
  const settings = await readPermissionSettings();
  return new Map(
    Object.keys(settings.topics).map((topicId) => [
      topicId,
      pathsIn(settings.topics, topicId),
    ]),
  );
}

/**
 * Sets the folders granted under a topic to `paths`, in that order. A folder
 * already granted keeps when it was added, and a topic left with none is
 * taken out of the file.
 */
export async function setTopicFolders(
  topicId: string,
  paths: readonly string[],
): Promise<void> {
  await updatePermissionSettings((settings) => ({
    ...settings,
    topics: topicsWithFolders(
      settings.topics,
      topicId,
      paths,
      getCurrentDate(),
    ),
  }));
}

/**
 * Adds folders to the ones granted under a topic, for a launch step that
 * runs before the workspace is up and names this computer's machine folder
 * outright. A folder already granted is left as it is, so a second run adds
 * nothing.
 */
export function addTopicFoldersSync({
  machineDir,
  paths,
  topicId,
}: {
  machineDir: string;
  paths: readonly string[];
  topicId: string;
}): void {
  updateJsonRecordSync(permissionsFileIn(machineDir), (record) => {
    const { topics } = permissionSettingsOf(record);
    const next = addedTopicFolders(topics, topicId, paths, new Date());
    return pathsIn(next, topicId).length === pathsIn(topics, topicId).length
      ? undefined
      : { topics: next };
  });
}

/** Every topic's folders with `paths` added after the ones `topicId` has. */
export function addedTopicFolders(
  topics: Topics,
  topicId: string,
  paths: readonly string[],
  at: Date,
): Topics {
  return topicsWithFolders(
    topics,
    topicId,
    [...pathsIn(topics, topicId), ...paths],
    at,
  );
}

type Topics = PermissionSettings["topics"];

/**
 * Every topic's folders with the ones under `topicId` set to `paths`, a path
 * that is not absolute left out, since it names no folder on this computer.
 */
function topicsWithFolders(
  topics: Topics,
  topicId: string,
  paths: readonly string[],
  at: Date,
): Topics {
  const held = topics[topicId]?.folders ?? [];
  const folders = [...new Set(paths)].flatMap((each) => {
    const known = held.find((folder) => folder.path === each);
    if (known) {
      return [known];
    }
    const parsed = AbsolutePathSchema.safeParse(each);
    return parsed.success ? [{ addedAt: at, path: parsed.data }] : [];
  });
  const { [topicId]: _taken, ...rest } = topics;
  return folders.length === 0 ? rest : { ...rest, [topicId]: { folders } };
}

function pathsIn(topics: Topics, topicId: string): string[] {
  return (topics[topicId]?.folders ?? []).map((folder) => folder.path);
}
