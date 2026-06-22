import { EventPublisher } from "@orpc/server";

import { type WorkspaceSnapshot } from "../machines/workspace";
import { type SessionMessagePart } from "../schemas/session/message-part";
import { type StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";

export const publisher = new EventPublisher<{
  "message.removed": {
    id: TaskId;
    messageId: StoreId.Message;
    sessionId: StoreId.Session;
  };
  "message.updated": {
    id: TaskId;
    messageId: StoreId.Message;
    sessionId: StoreId.Session;
  };
  "part.updated": {
    id: TaskId;
    part: SessionMessagePart.Type;
  };
  "project.files.changed": {
    id: TaskId;
  };
  "project.outputArtifactsCreated": {
    files: { filePath: string; modifiedAt: number }[];
    id: TaskId;
    sessionId: StoreId.Session;
  };
  "project.removed": {
    id: TaskId;
  };
  "project.updated": {
    id: TaskId;
  };
  "replay.changed": {
    id: TaskId;
    isActive: boolean;
    sessionId: StoreId.Session;
  };
  "runtime.log.updated": {
    id: TaskId;
  };
  "session.added": {
    id: TaskId;
    sessionId: StoreId.Session;
  };
  "session.done": {
    id: TaskId;
    sessionId: StoreId.Session;
  };
  "session.removed": {
    id: TaskId;
    sessionId: StoreId.Session;
  };
  "session.tagsChanged": {
    id: TaskId;
    sessionId: StoreId.Session;
  };
  "session.updated": {
    id: TaskId;
    sessionId: StoreId.Session;
  };
  "workspaceActor.snapshot": WorkspaceSnapshot;
}>({
  maxBufferedEvents: 1, // Holds only last event in memory
});
