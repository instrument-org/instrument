import { ChatStream } from "@/client/components/chat-stream";
import { SessionStream } from "@/client/components/session-stream";
import { Checkbox } from "@/client/components/ui/checkbox";
import { Label } from "@/client/components/ui/label";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { presetSessions } from "../-sessions";

const searchSchema = z.object({
  session: z.string().optional(),
});

export const Route = createFileRoute("/_app/debug/components/session-stream")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: "Debug Session Stream" }],
  }),
  validateSearch: searchSchema,
});

const createEventHandler = (eventName: string) => {
  return () => {
    toast.info(`${eventName} clicked`);
  };
};

function RouteComponent() {
  const { session: sessionParam } = Route.useSearch();
  const [isAgentRunning, setIsAgentRunning] = useState(true);
  const [isDeveloperMode, setIsDeveloperMode] = useState(false);
  const [useChatStream, setUseChatStream] = useState(true);

  const selectedSessionId = sessionParam ?? presetSessions[0]?.id;
  const selectedSession = presetSessions.find(
    (s) => s.id === selectedSessionId,
  );

  const mockProject = {
    subdomain: "debug-project",
    urls: { assetBase: "" },
  };

  return (
    <div className="flex size-full flex-col gap-4 overflow-hidden p-4">
      <div className="flex gap-6 rounded-md border bg-muted/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <Checkbox
            checked={isAgentRunning}
            id="agent-running"
            onCheckedChange={(checked) => {
              setIsAgentRunning(checked === true);
            }}
          />
          <Label className="cursor-pointer text-sm" htmlFor="agent-running">
            Agent Running
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            checked={isDeveloperMode}
            id="developer-mode"
            onCheckedChange={(checked) => {
              setIsDeveloperMode(checked === true);
            }}
          />
          <Label className="cursor-pointer text-sm" htmlFor="developer-mode">
            Developer Mode
          </Label>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Checkbox
            checked={useChatStream}
            id="chat-stream"
            onCheckedChange={(checked) => {
              setUseChatStream(checked === true);
            }}
          />
          <Label className="cursor-pointer text-sm" htmlFor="chat-stream">
            New Chat Stream
          </Label>
        </div>
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-2xl">
            {selectedSession ? (
              useChatStream ? (
                <ChatStream
                  isAgentRunning={isAgentRunning}
                  isDeveloperMode={isDeveloperMode}
                  messages={selectedSession.messages}
                  onContinue={createEventHandler("Continue")}
                  onModelChange={createEventHandler("Model Change")}
                  onRetry={createEventHandler("Retry")}
                  onStartNewChat={createEventHandler("Start New Chat")}
                  project={mockProject as never}
                />
              ) : (
                <SessionStream
                  isAgentRunning={isAgentRunning}
                  isDeveloperMode={isDeveloperMode}
                  messages={selectedSession.messages}
                  onContinue={createEventHandler("Continue")}
                  onModelChange={createEventHandler("Model Change")}
                  onRetry={createEventHandler("Retry")}
                  onStartNewChat={createEventHandler("Start New Chat")}
                  project={mockProject as never}
                />
              )
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No session available
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
