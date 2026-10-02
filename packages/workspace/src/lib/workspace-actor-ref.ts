import { type WorkspaceActorRef } from "../machines/workspace";

// The one workspace actor per process, published the way the config is so a
// shell command running inside a tool call can reach the machine that owns
// every session without the ref being threaded through the tool layer. Set by
// the machine itself when its context is created.
let current: undefined | WorkspaceActorRef;

export function getWorkspaceActorRef(): WorkspaceActorRef {
  if (!current) {
    throw new Error("Workspace actor has not been created");
  }
  return current;
}

export function setWorkspaceActorRef(ref: WorkspaceActorRef): void {
  current = ref;
}
