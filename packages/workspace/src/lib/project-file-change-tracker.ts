import { type StoreId } from "../schemas/store-id";
import { type ProjectFileIndex } from "./get-project-files";

const TURN_START_SNAPSHOT_TTL_MS = 6 * 60 * 60 * 1000;

const turnStartSnapshots = new Map<
  StoreId.Session,
  {
    fileIndex: ProjectFileIndex;
    timeoutId: ReturnType<typeof setTimeout>;
  }
>();

export function consumeTurnStartProjectFileIndex(sessionId: StoreId.Session) {
  const snapshot = turnStartSnapshots.get(sessionId);
  if (!snapshot) {
    return;
  }

  clearTurnStartProjectFileIndex(sessionId);
  return snapshot.fileIndex;
}

export function rememberTurnStartProjectFileIndex({
  fileIndex,
  sessionId,
}: {
  fileIndex: ProjectFileIndex;
  sessionId: StoreId.Session;
}) {
  clearTurnStartProjectFileIndex(sessionId);

  const timeoutId = setTimeout(() => {
    turnStartSnapshots.delete(sessionId);
  }, TURN_START_SNAPSHOT_TTL_MS);

  turnStartSnapshots.set(sessionId, {
    fileIndex,
    timeoutId,
  });
}

function clearTurnStartProjectFileIndex(sessionId: StoreId.Session) {
  const snapshot = turnStartSnapshots.get(sessionId);
  if (!snapshot) {
    return;
  }

  clearTimeout(snapshot.timeoutId);
  turnStartSnapshots.delete(sessionId);
}
