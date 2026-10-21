import { publisher } from "../rpc/publisher";
import { watchFolder } from "./folder-watch";
import { getWorkspaceSkillsDir } from "./workspace-skills-dir";

/**
 * Tells everyone listing skills when the workspace's own skills change on
 * disk, whoever changed them: the agent, the person in their files, another
 * program. Each skill's folder is watched, so a `SKILL.md` saved is heard at
 * once; deeper files are found by the folder's regular read.
 */
export async function startWatchingWorkspaceSkills(): Promise<
  () => Promise<void>
> {
  const stop = watchFolder(getWorkspaceSkillsDir(), {
    depth: 1,
    onChange: () => {
      publisher.publish("skill.changed", null);
    },
  });
  return async () => {
    stop();
  };
}
