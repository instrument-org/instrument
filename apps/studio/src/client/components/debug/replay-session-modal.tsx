import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/client/components/ui/alert-dialog";
import { Button } from "@/client/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@/client/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/client/components/ui/radio-group";
import { rpcClient } from "@/client/rpc/client";
import { type StoreId, type Task } from "@instrument-org/workspace/client";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

type PlaybackSpeed = "instant" | "normal" | "slow";

type ReplayMode = "new-session" | "new-task";

const PLAYBACK_SPEEDS: {
  delayMs: number;
  description: string;
  label: string;
  value: PlaybackSpeed;
}[] = [
  {
    delayMs: 0,
    description: "No delay between steps",
    label: "Instant",
    value: "instant",
  },
  {
    delayMs: 500,
    description: "500ms between steps",
    label: "Normal",
    value: "normal",
  },
  {
    delayMs: 5000,
    description: "5s between steps",
    label: "Slow",
    value: "slow",
  },
];

export function ReplaySessionModal({
  isOpen,
  onClose,
  selectedSessionId,
  task,
}: {
  isOpen: boolean;
  onClose: () => void;
  selectedSessionId: StoreId.Session | undefined;
  task: Task;
}) {
  const [mode, setMode] = useState<ReplayMode>("new-session");
  const [speed, setSpeed] = useState<PlaybackSpeed>("instant");
  const navigate = useNavigate();

  const delayMs = PLAYBACK_SPEEDS.find((s) => s.value === speed)?.delayMs ?? 0;

  const replayMutation = useMutation(
    rpcClient.workspace.debug.replaySession.mutationOptions({
      onError: (error: Error) => {
        toast.error("Failed to replay chat", { description: error.message });
      },
      onSuccess: (result) => {
        onClose();
        void navigate({
          params: { id: result.id },
          search: (prev) => ({ ...prev, selectedSessionId: result.sessionId }),
          to: "/tasks/$id",
        });
      },
    }),
  );

  const handleConfirm = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!selectedSessionId) {
      return;
    }
    replayMutation.mutate({
      delayMs,
      id: task.id,
      mode,
      sessionId: selectedSessionId,
    });
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setMode("new-session");
      setSpeed("instant");
      onClose();
    }
  };

  return (
    <AlertDialog onOpenChange={handleOpenChange} open={isOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Replay chat</AlertDialogTitle>
          <AlertDialogDescription>
            Replays the full chat session, re-running each tool call to produce
            fresh output. Choose where the replay should run.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-4">
          <RadioGroup
            className="gap-2"
            onValueChange={(v) => {
              setMode(v as ReplayMode);
            }}
            value={mode}
          >
            <FieldLabel htmlFor="mode-new-session">
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldTitle>New session (same task)</FieldTitle>
                  <FieldDescription>
                    Creates a new session in this task and runs the tools there.
                  </FieldDescription>
                </FieldContent>
                <RadioGroupItem id="mode-new-session" value="new-session" />
              </Field>
            </FieldLabel>
            <FieldLabel htmlFor="mode-new-task">
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldTitle>New task</FieldTitle>
                  <FieldDescription>
                    Creates a fresh task named &quot;Replay of {task.title}
                    &quot; and runs the tools there.
                  </FieldDescription>
                </FieldContent>
                <RadioGroupItem id="mode-new-task" value="new-task" />
              </Field>
            </FieldLabel>
          </RadioGroup>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Playback speed</span>
            <RadioGroup
              className="flex gap-2"
              onValueChange={(v) => {
                setSpeed(v as PlaybackSpeed);
              }}
              value={speed}
            >
              {PLAYBACK_SPEEDS.map(({ description, label, value }) => (
                <FieldLabel htmlFor={`speed-${value}`} key={value}>
                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldTitle>{label}</FieldTitle>
                      <FieldDescription>{description}</FieldDescription>
                    </FieldContent>
                    <RadioGroupItem id={`speed-${value}`} value={value} />
                  </Field>
                </FieldLabel>
              ))}
            </RadioGroup>
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            disabled={!selectedSessionId || replayMutation.isPending}
            onClick={handleConfirm}
          >
            {replayMutation.isPending ? "Starting replay..." : "Replay"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
