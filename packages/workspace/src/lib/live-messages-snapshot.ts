import { alphabetical } from "radashi";

import { type SessionMessage } from "../schemas/session/message";
import { type StoreId } from "../schemas/store-id";

// An ordered, id-keyed view of one session's messages-with-parts. The live
// message subscription seeds it from a single full read, then splices in one
// message per change event instead of re-reading and re-parsing the whole
// session each time. Messages sort by id, which is a monotonic ULID, so id
// order is chronological order (the same order a full read returns).
export class LiveMessagesSnapshot {
  private readonly byId = new Map<StoreId.Message, SessionMessage.WithParts>();

  constructor(messages: SessionMessage.WithParts[] = []) {
    this.reset(messages);
  }

  remove(messageId: StoreId.Message) {
    this.byId.delete(messageId);
  }

  reset(messages: SessionMessage.WithParts[]) {
    this.byId.clear();
    for (const message of messages) {
      this.byId.set(message.id, message);
    }
  }

  toArray() {
    return alphabetical([...this.byId.values()], (message) => message.id);
  }

  upsert(message: SessionMessage.WithParts) {
    this.byId.set(message.id, message);
  }
}
