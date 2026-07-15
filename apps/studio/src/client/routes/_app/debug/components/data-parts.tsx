import { ChatStream } from "@/client/components/chat-stream";
import { SYNTHETIC_MODEL_ID } from "@instrument-org/shared";
import { type SessionMessage, StoreId } from "@instrument-org/workspace/client";
import { createFileRoute } from "@tanstack/react-router";
import { noop } from "radashi";

import { SessionBuilder } from "../-sessions/helpers";

export const Route = createFileRoute("/_app/debug/components/data-parts")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: "Debug Data Parts" }],
  }),
});

const MODIFIED_AT = 1_718_198_400_000;

// Debug-only mocks; `as never` skips client-side branded-schema validation the
// same way the session fixtures do.
const relativePath = (path: string) => path as never;
const projectId = "debug-project" as never;

const builder = new SessionBuilder();
const sessionId = builder.getSessionId();

function contextMessage(
  realRole: "system" | "user",
  text: string,
): SessionMessage.ContextWithParts {
  const id = StoreId.newMessageId();
  return {
    id,
    metadata: {
      agentName: "main",
      createdAt: new Date(MODIFIED_AT),
      realRole,
      sessionId,
    },
    parts: [
      {
        metadata: {
          createdAt: new Date(MODIFIED_AT),
          id: StoreId.newPartId(),
          messageId: id,
          sessionId,
        },
        state: "done",
        text,
        type: "text",
      },
    ],
    role: "session-context",
  };
}

const assistantWithFileChangesId = StoreId.newMessageId();
const maxStepsId = StoreId.newMessageId();

// Every data-part type from the chat data-part display table, placed on the
// message it rides on in a real session, so `renderDataPart` renders each one
// as it would in chat. Developer mode is forced on below so the dev-only cards
// (browser status, external file changes, attached folder removals, max steps)
// show without toggling the global preference.
const messages: SessionMessage.WithParts[] = [
  contextMessage(
    "system",
    "You are an AI coding agent operating inside a live workspace. Prefer small, verifiable changes and read files before editing them.",
  ),
  contextMessage(
    "user",
    "Project instructions:\n\n- TypeScript monorepo; prefer named exports.\n- Run checks from the repo root.",
  ),
  builder.userMessage("Redesign the landing page using the attached brief.", {
    parts: [
      {
        data: {
          files: [
            {
              filename: "brief.md",
              filePath: relativePath("uploads/brief.md"),
              mimeType: "text/markdown",
              modifiedAt: MODIFIED_AT,
              size: 4096,
            },
          ],
        },
        type: "data-attachments",
      },
      {
        data: {
          instructions: "Prefer Tailwind utilities.",
          projectId,
          projectName: "Marketing Site",
        },
        type: "data-projectContext",
      },
      {
        data: {
          foldersAdded: [{ name: "assets", path: "/Users/me/assets" }],
          foldersRemoved: [],
          instructions: "Prefer Tailwind utilities. Keep copy concise.",
          instructionsChanged: true,
          projectId,
          projectName: "Marketing Site",
        },
        type: "data-projectChanges",
      },
    ],
  }),
  {
    id: assistantWithFileChangesId,
    metadata: {
      createdAt: builder.nextTime(),
      finishReason: "stop",
      modelId: "claude-sonnet-4.5",
      providerId: "anthropic",
      sessionId,
    },
    parts: [
      builder.textPart(
        "I updated the hero section and removed the legacy stylesheet.",
        assistantWithFileChangesId,
      ),
      {
        // Root-level paths: FilesGrid only surfaces output/, attachments/,
        // downloads/, and root files, so nested paths (e.g. src/…) render
        // nothing.
        data: {
          files: [
            {
              filename: "hero.tsx",
              filePath: relativePath("hero.tsx"),
              mimeType: "text/plain",
              modifiedAt: MODIFIED_AT,
              size: 3200,
              status: "modified",
            },
            {
              filename: "styles.css",
              filePath: relativePath("styles.css"),
              mimeType: "text/css",
              modifiedAt: MODIFIED_AT,
              size: 1800,
              status: "added",
            },
            {
              filename: "legacy.css",
              filePath: relativePath("legacy.css"),
              mimeType: "text/css",
              modifiedAt: MODIFIED_AT,
              size: 0,
              status: "deleted",
            },
          ],
        },
        metadata: builder.partMetadata(assistantWithFileChangesId),
        type: "data-fileChanges",
      },
    ],
    role: "assistant",
  },
  builder.userMessage("Great, keep going and check it in the browser.", {
    parts: [
      {
        data: {
          status: "open",
          target: { title: "Landing preview", url: "https://example.com" },
        },
        type: "data-browserStatus",
      },
      {
        data: {
          files: [
            {
              filename: "tokens.css",
              filePath: relativePath("src/tokens.css"),
              mimeType: "text/css",
              modifiedAt: MODIFIED_AT,
              size: 1200,
              status: "modified",
            },
          ],
        },
        type: "data-externalFileChanges",
      },
      {
        data: {
          removed: [{ name: "designs", path: "/Users/me/designs" }],
          renamed: [
            {
              newName: "CloudDocs-Downloads",
              oldName: "Downloads",
              path: "/Users/me/Library/Mobile Documents/com~apple~CloudDocs/Downloads",
            },
          ],
        },
        type: "data-attachedFolderChanges",
      },
    ],
  }),
  builder.assistantMessage(
    "Reopened the preview and re-read the externally changed tokens. Continuing the redesign.",
  ),
  {
    id: maxStepsId,
    metadata: {
      createdAt: builder.nextTime(),
      finishReason: "max-steps",
      modelId: SYNTHETIC_MODEL_ID,
      providerId: "system",
      sessionId,
      synthetic: true,
    },
    parts: [
      {
        data: { maxStepCount: 200 },
        metadata: builder.partMetadata(maxStepsId),
        type: "data-maxSteps",
      },
    ],
    role: "assistant",
  },
];

const mockTask = {
  id: "debug-task",
  urls: { assetBase: "" },
};

function RouteComponent() {
  return (
    <div className="flex size-full flex-col overflow-hidden p-4">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl">
          <ChatStream
            isAgentRunning={false}
            isDeveloperMode
            messages={messages}
            onContinue={noop}
            onModelChange={noop}
            onRetry={noop}
            onStartNewTask={noop}
            task={mockTask as never}
          />
        </div>
      </div>
    </div>
  );
}
