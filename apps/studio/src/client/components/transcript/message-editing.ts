import { type AIGatewayModelURI } from "@instrument-org/ai-gateway/client";
import { type FileUpload, type StoreId } from "@instrument-org/workspace/client";
import { createContext } from "react";

/** An earlier version of an edited message, put up in its place. */
export interface ShownVersion {
  /** Every version, oldest first, the last of them the message as it stands. */
  versions: StoreId.Message[];
  /** The one up, never the last. */
  version: StoreId.Message;
}

export interface EditedSend {
  files?: FileUpload.Input[];
  folders?: { path: string }[];
  modelURI: AIGatewayModelURI.Type;
  prompt: string;
}

/**
 * Editing a message the person sent, and looking back at what it was: the
 * chat's own transcript gives it, and one without it offers neither.
 */
export interface MessageEditing {
  /** The message open in a box. */
  editing?: StoreId.Message;
  isSending: boolean;
  modelURI?: AIGatewayModelURI.Type;
  onCancel: () => void;
  onEdit: (message: StoreId.Message) => void;
  onModelChange: (modelURI: AIGatewayModelURI.Type) => void;
  onSend: (message: StoreId.Message, value: EditedSend) => void;
  /** Puts up one of a message's versions; the last is the conversation as it stands. */
  onShowVersion: (
    versions: StoreId.Message[],
    version: StoreId.Message,
  ) => void;
  shown?: ShownVersion;
}

export const MessageEditingContext = createContext<MessageEditing | undefined>(
  undefined,
);

/** A message's versions and which is up, or nothing for one never edited. */
export function versionsOf(
  message: { id: StoreId.Message; earlier: readonly StoreId.Message[] },
  shown: ShownVersion | undefined,
): { at: number; versions: StoreId.Message[] } | undefined {
  if (shown) {
    return message.id === shown.version
      ? {
          at: shown.versions.indexOf(shown.version),
          versions: shown.versions,
        }
      : undefined;
  }
  return message.earlier.length === 0
    ? undefined
    : {
        at: message.earlier.length,
        versions: [...message.earlier, message.id],
      };
}
