import { APP_NAME } from "@instrument-org/shared";
import {
  countAliveAgentSessions,
  type WorkspaceActorRef,
} from "@instrument-org/workspace/electron";
import { dialog } from "electron";

import { logger } from "./electron-logger";

let skipRunningAgentsQuitWarning = false;

export function allowQuitWithoutRunningAgentsWarning() {
  skipRunningAgentsQuitWarning = true;
}

async function confirmQuitWithRunningAgents({
  aliveAgentCount,
}: {
  aliveAgentCount: number;
}) {
  const agentLabel =
    aliveAgentCount === 1
      ? "agent is still running"
      : "agents are still running";

  try {
    const { response } = await dialog.showMessageBox({
      buttons: ["Cancel", "Quit"],
      cancelId: 0,
      defaultId: 0,
      detail: `Quitting ${APP_NAME} will stop ${aliveAgentCount === 1 ? "this agent" : "these agents"} and you may lose in-progress work.`,
      message: `One or more ${agentLabel}.`,
      noLink: true,
      type: "warning",
    });

    return response === 1;
  } catch (error) {
    logger.warn("Failed to show running-agents quit warning", error);
    return true;
  }
}

export async function shouldProceedWithQuit({
  workspaceRef,
}: {
  workspaceRef: WorkspaceActorRef;
}) {
  if (shouldSkipRunningAgentsQuitWarning()) {
    return true;
  }

  const aliveAgentCount = countAliveAgentSessions(workspaceRef);
  if (aliveAgentCount === 0) {
    return true;
  }

  return confirmQuitWithRunningAgents({ aliveAgentCount });
}

export function shouldSkipRunningAgentsQuitWarning() {
  return skipRunningAgentsQuitWarning;
}
