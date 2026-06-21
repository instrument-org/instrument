import {
  EventPublisher,
} from "@orpc/server";

import {
  type WorkspaceSnapshot,
} from "../machines/workspace";
import {
  type SessionMessagePart,
} from "../schemas/session/message-part";
import {
  type StoreId,
} from "../schemas/store-id";
import {
  type TaskId,
} from "../schemas/task-id";

export const publisher = new EventPublisher<{
  "appState.session.added": {
    sessionId: StoreId.Session;
    subdomain: TaskId;
  };
  "appState.session.done": {
    sessionId: StoreId.Session;
    subdomain: TaskId;
  };
  "appState.session.tagsChanged": {
    sessionId: StoreId.Session;
    subdomain: TaskId;
  };
  "message.removed": {
    messageId: StoreId.Message;
    sessionId: StoreId.Session;
    subdomain: TaskId;
  };
  "message.updated": {
    messageId: StoreId.Message;
    sessionId: StoreId.Session;
    subdomain: TaskId;
  };
  "part.updated": {
    part: SessionMessagePart.Type;
    subdomain: TaskId;
  };
  "project.files.changed": {
    subdomain: TaskId;
  };
  "project.outputArtifactsCreated": {
    files: { filePath: string; modifiedAt: number }[];
    sessionId: StoreId.Session;
    subdomain: TaskId;
  };
  "project.removed": {
    subdomain: TaskId;
  };
  "project.updated": {
    subdomain: TaskId;
  };
  "replay.changed": {
    isActive: boolean;
    sessionId: StoreId.Session;
    subdomain: TaskId;
  };
  "runtime.log.updated": {
    subdomain: TaskId;
  };
  "session.removed": {
    sessionId: StoreId.Session;
    subdomain: TaskId;
  };
  "session.updated": {
    sessionId: StoreId.Session;
    subdomain: TaskId;
  };
  "workspaceActor.snapshot": WorkspaceSnapshot;
}>({
  maxBufferedEvents: 1, // Holds only last event in memory
});
