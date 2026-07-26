import type { Result } from "neverthrow";

import type { Session } from "../../schemas/session";
import type { SessionMessage } from "../../schemas/session/message";

import { isToolPart } from "../../lib/is-tool-part";
import { type SessionMessagePart } from "../../schemas/session/message-part";

export function sessionToShorthand(
  sessionResult: Result<Session.WithMessagesAndParts, unknown>,
): string {
  if (sessionResult.isErr()) {
    return `<session-error>${JSON.stringify(sessionResult.error)}</session-error>`;
  }

  const session = sessionResult.value;
  const messageCount = ` count="${session.messages.length}"`;
  const title = ` title="${session.title}"`;
  const messages = session.messages.map(messageToShorthand);

  return `<session${title}${messageCount}>\n${indent(messages.join("\n"))}\n</session>`;
}

function indent(text: string, level = 1): string {
  const spaces = "  ".repeat(level);
  return text
    .split("\n")
    .map((line) => (line ? `${spaces}${line}` : line))
    .join("\n");
}

function messagePartToShorthand(part: SessionMessagePart.Type): string {
  if (isToolPart(part)) {
    const toolName = ` tool="${part.type.replace("tool-", "")}"`;
    const state = ` state="${part.state}"`;
    const callId = ` callId="${part.toolCallId}"`;

    let content = "";

    switch (part.state) {
      case "input-available":
      case "input-streaming": {
        if (part.input !== undefined) {
          content = `\n${indent("<input>")}\n${indent(JSON.stringify(part.input, null, 2), 2)}\n${indent("</input>")}\n`;
        }

        break;
      }
      case "output-available": {
        // Tool outputs are intentionally generic in this snapshot serializer.
        // oxlint-disable-next-line typescript/no-unsafe-assignment
        const output =
          part.type === "tool-generate_image" && part.output.state === "success"
            ? {
                ...part.output,
                sourceImages: undefined,
              }
            : part.output;
        content += `\n${indent("<input>")}\n${indent(JSON.stringify(part.input, null, 2), 2)}\n${indent("</input>")}`;
        content += `\n${indent("<output>")}\n${indent(
          JSON.stringify(
            output,
            // oxlint-disable-next-line typescript/no-unsafe-return
            (key, value) => (key === "modifiedAt" ? undefined : value),
            2,
          ),
          2,
        )}\n${indent("</output>")}\n`;

        break;
      }
      case "output-error": {
        content += `\n${indent("<input>")}\n${indent(JSON.stringify(part.input || part.rawInput || "none", null, 2), 2)}\n${indent("</input>")}`;
        content += `\n${indent(`<error>${part.errorText}</error>`)}\n`;

        break;
      }
      // No default
    }

    return `<tool${toolName}${state}${callId}>${content}</tool>`;
  }

  switch (part.type) {
    case "data-attachedFolderChanges": {
      const foldersList = part.data.removed
        .map(
          (folder) => `<folder name="${folder.name}" path="${folder.path}" />`,
        )
        .join("\n");
      return `<data-attachedFolderChanges>\n${indent(foldersList)}\n</data-attachedFolderChanges>`;
    }
    case "data-attachments": {
      const filesList = part.data.files
        .map((file) => {
          const filename = ` filename="${file.filename}"`;
          const mimeType = ` mimeType="${file.mimeType}"`;
          const size = ` size="${file.size}"`;
          return `<file${filename}${mimeType}${size} />`;
        })
        .join("\n");
      return `<data-attachments>\n${indent(filesList)}\n</data-attachments>`;
    }
    case "data-browserStatus": {
      const target =
        part.data.status === "open"
          ? `${part.data.target.title ? ` title="${part.data.target.title}"` : ""} url="${part.data.target.url}"`
          : "";
      const previousUrl =
        part.data.status === "closed" && part.data.previousTarget
          ? ` previousUrl="${part.data.previousTarget.url}"`
          : "";
      return `<data-browserStatus status="${part.data.status}"${target}${previousUrl} />`;
    }
    case "data-externalFileChanges": {
      const filesList = part.data.files
        .map((file) => {
          const filename = ` filename="${file.filename}"`;
          const status = ` status="${file.status}"`;
          return `<file${filename}${status} />`;
        })
        .join("\n");
      return `<data-externalFileChanges>\n${indent(filesList)}\n</data-externalFileChanges>`;
    }
    case "data-fileChanges": {
      const filesList = part.data.files
        .map((file) => {
          const filename = ` filename="${file.filename}"`;
          const status = ` status="${file.status}"`;
          return `<file${filename}${status} />`;
        })
        .join("\n");
      return `<data-fileChanges>\n${indent(filesList)}\n</data-fileChanges>`;
    }
    case "data-intent": {
      return `<data-intent>${part.data.text}</data-intent>`;
    }
    case "data-maxSteps": {
      return `<data-maxSteps maxStepCount="${part.data.maxStepCount}" />`;
    }
    case "data-projectChanges": {
      const projectName = ` projectName="${part.data.projectName}"`;
      const instructions = part.data.instructionsChanged
        ? ` instructionsChanged`
        : "";
      const added =
        part.data.foldersAdded.length > 0
          ? ` added="${part.data.foldersAdded.map((folder) => folder.name).join(",")}"`
          : "";
      const removed =
        part.data.foldersRemoved.length > 0
          ? ` removed="${part.data.foldersRemoved.map((folder) => folder.name).join(",")}"`
          : "";
      return `<data-projectChanges${projectName}${instructions}${added}${removed} />`;
    }
    case "data-projectContext": {
      const projectName = ` projectName="${part.data.projectName}"`;
      const instructions = part.data.instructions ? ` instructions` : "";
      return `<data-projectContext${projectName}${instructions} />`;
    }
    case "data-skillChanges": {
      const created =
        part.data.created.length > 0
          ? ` created="${part.data.created.join(",")}"`
          : "";
      const updated =
        part.data.updated.length > 0
          ? ` updated="${part.data.updated.join(",")}"`
          : "";
      return `<data-skillChanges${created}${updated} />`;
    }
    case "data-skillMentions": {
      return `<data-skillMentions>${part.data.names.join(",")}</data-skillMentions>`;
    }
    case "file": {
      const filename = part.filename ? ` filename="${part.filename}"` : "";
      const mediaType = ` mediaType="${part.mediaType}"`;
      return `<file${filename}${mediaType}>${part.url}</file>`;
    }
    case "reasoning": {
      const state = ` state="${part.state ?? "unknown"}"`;
      return `<reasoning${state}>${part.text}</reasoning>`;
    }
    case "source-document": {
      const filename = part.filename ? ` filename="${part.filename}"` : "";
      const mediaType = ` mediaType="${part.mediaType}"`;
      return `<source-document${filename}${mediaType}>${part.title}</source-document>`;
    }
    case "source-url": {
      const title = part.title ? ` title="${part.title}"` : "";
      return `<source-url${title}>${part.url}</source-url>`;
    }
    case "step-start": {
      const stepCount = ` step="${part.metadata.stepCount}"`;
      return `<step-start${stepCount} />`;
    }
    case "text": {
      const state = part.state ? ` state="${part.state}"` : "";
      return `<text${state}>${part.text}</text>`;
    }
    default: {
      const unknownPart: never = part;
      return `<unknown-part type="${(unknownPart as { type: string }).type}" />`;
    }
  }
}

function messageToShorthand(message: SessionMessage.WithParts): string {
  const parts = message.parts.map(messagePartToShorthand);

  switch (message.role) {
    case "assistant": {
      const error = message.metadata.error
        ? ` errorKind="${message.metadata.error.kind}" errorMessage="${message.metadata.error.message}"`
        : "";
      const finishReason = ` finishReason="${message.metadata.finishReason}"`;
      const usage = message.metadata.usage;
      const tokens = usage ? ` tokens="${usage.totalTokens || 0}"` : "";
      const modelId = ` model="${message.metadata.modelId}"`;
      const provider = ` provider="${message.metadata.providerId}"`;
      const base = `assistant${finishReason}${tokens}${modelId}${provider}${error}`;

      return parts.length > 0
        ? `<${base}>\n${indent(parts.join("\n"))}\n</assistant>`
        : `<${base} />`;
    }
    case "session-context": {
      return `<session-context ${message.metadata.agentName} realRole="${message.metadata.realRole}" />`;
    }
    case "system": {
      return parts.length > 0
        ? `<system>\n${indent(parts.join("\n"))}\n</system>`
        : `<system />`;
    }
    case "user": {
      return parts.length > 0
        ? `<user>\n${indent(parts.join("\n"))}\n</user>`
        : `<user />`;
    }
    default: {
      const unknownMessage: never = message;
      return `<unknown-message role="${(unknownMessage as { role: string }).role}" />`;
    }
  }
}
