import { readTopicsSync, type Topic, writeTopicSync } from "../chat/topics";
import { listedFolderPaths } from "../chat/topic-file";
import { readJsonRecordSync, updateJsonRecordSync } from "../json-record-file";
import { permissionSettingsOf, permissionsFileIn } from "./rules";
import { addedTopicFolders } from "./topic-folders";

/**
 * The mark in this computer's permission settings that the folders a topic's
 * `TOPIC.md` listed were taken in here. Outside the settings' schema, so no
 * write of the settings, a reset included, drops it.
 */
const MOVED_MARK = "topicFoldersMoved";

/**
 * Brings the folders granted under each topic out of its `TOPIC.md` and into
 * this computer's permission settings, once per computer.
 *
 * Builds before this wrote them as front matter. The file travels with the
 * workspace, so a grant made on one computer opened the same-named path on
 * another, and where the workspace is the person's own folder the agent can
 * write the file, which widened what every chat under the topic reaches
 * without a card.
 *
 * Once, and never again: a `folders:` key in a `TOPIC.md` after this is a
 * key the build does not read, whoever wrote it, so an edit to the file
 * never opens a folder. What is held here already is kept, with the file's
 * folders after it.
 *
 * The key is then taken out of each file, after the settings hold it, so a
 * crash between the two leaves a key nothing reads rather than a grant lost.
 * Another computer that has not moved them yet finds the file without them
 * and asks again before opening any of them, which is the right answer for
 * folders granted on a different computer.
 */
export function moveTopicFolders({
  machineDir,
  rootDir,
}: {
  machineDir: string;
  rootDir: string;
}): { moved: number } {
  const file = permissionsFileIn(machineDir);
  const read = readJsonRecordSync(file);
  if (read.kind === "read" && read.record[MOVED_MARK] === true) {
    return { moved: 0 };
  }
  const listing = readTopicsSync(rootDir).flatMap((topic) => {
    if (topic.others === undefined || !("folders" in topic.others)) {
      return [];
    }
    return [{ paths: listedFolderPaths(topic.others.folders), topic }];
  });
  updateJsonRecordSync(file, (record) => {
    let topics = permissionSettingsOf(record).topics;
    for (const { paths, topic } of listing) {
      topics = addedTopicFolders(topics, topic.id, paths, new Date());
    }
    return { [MOVED_MARK]: true, topics };
  });
  for (const { topic } of listing) {
    writeTopicSync(rootDir, withoutFolders(topic));
  }
  return {
    moved: listing.filter(({ paths }) => paths.length > 0).length,
  };
}

function withoutFolders(topic: Topic): Topic {
  const { others, ...rest } = topic;
  const { folders: _folders, ...kept } = others ?? {};
  return Object.keys(kept).length > 0 ? { ...rest, others: kept } : rest;
}
