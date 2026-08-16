import {
  type ComposeDraft,
  type ComposeStep,
  FilesStep,
  FoldersStep,
  ModelStep,
  OptionsStep,
  ProjectStep,
} from "@/client/components/overlay/compose";
import { Launcher } from "@/client/components/overlay/launcher";
import { OverlayShell } from "@/client/components/overlay/shell";
import { TaskView } from "@/client/components/overlay/task-view";
import { useDefaultModelURI } from "@/client/hooks/use-default-model-uri";
import { rpcClient } from "@/client/rpc/client";
import { type TaskId } from "@instrument-org/workspace/client";
import { safe } from "@orpc/client";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/overlay/")({
  component: OverlayPanel,
});

const hideOverlay = () => {
  void safe(rpcClient.overlay.hide.call());
};

type Screen =
  | { kind: "compose"; step: ComposeStep }
  | { kind: "launcher" }
  | { kind: "task"; taskId: TaskId };

const emptyDraft = (prompt: string): ComposeDraft => ({
  files: [],
  folders: [],
  modelURI: undefined,
  projectId: null,
  prompt,
});

/**
 * The launcher is where you land and where everything returns to.
 *
 * Escape pops exactly one level -- a picker back to the options, the options
 * back to the launcher, the launcher away -- so the key means the same thing
 * everywhere and never throws away more than the step you are in.
 *
 * All of it is held here rather than in the screens: the draft has to outlive
 * a picker that opens a native dialog, and the one place every screen agrees
 * on is above all of them.
 */
function OverlayPanel() {
  const [screen, setScreen] = useState<Screen>({ kind: "launcher" });
  const [draft, setDraft] = useState<ComposeDraft>(() => emptyDraft(""));
  const [defaultModelURI] = useDefaultModelURI();

  const createTask = useMutation(
    rpcClient.workspace.task.create.mutationOptions(),
  );

  const startTask = (from: ComposeDraft) => {
    const modelURI = from.modelURI ?? defaultModelURI;
    if (!modelURI) {
      toast.error("No model available", {
        description: "Add a provider in Settings first.",
      });
      return;
    }

    createTask.mutate(
      {
        files: from.files.length > 0 ? from.files : undefined,
        folders: from.folders.length > 0 ? from.folders : undefined,
        modelURI,
        projectId: from.projectId,
        prompt: from.prompt.trim(),
      },
      {
        onError: (error) => {
          toast.error(`Could not start the task: ${error.message}`);
        },
        onSuccess: ({ id }) => {
          setDraft(emptyDraft(""));
          setScreen({ kind: "task", taskId: id });
        },
      },
    );
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();

      if (screen.kind === "launcher") {
        hideOverlay();
        return;
      }
      if (screen.kind === "compose" && screen.step !== "options") {
        setScreen({ kind: "compose", step: "options" });
        return;
      }
      setScreen({ kind: "launcher" });
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [screen]);

  // Dismissing returns the panel to its zero state, so summoning it is always
  // the same act rather than a resume of wherever it was left.
  //
  // Driven by main saying so, not by the page going hidden: a native file or
  // folder dialog hides the page too, and treating that as a dismissal threw
  // away the draft of anyone who opened one.
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    const listen = async () => {
      const [error, iterator] = await safe(
        rpcClient.overlay.live.dismissed.call(),
      );
      if (error) {
        return;
      }
      for await (const _ of iterator) {
        if (cancelledRef.current) {
          return;
        }
        setScreen({ kind: "launcher" });
        setDraft(emptyDraft(""));
      }
    };

    void listen();
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  if (screen.kind === "task") {
    return (
      <OverlayShell>
        <TaskView
          onBack={() => {
            setScreen({ kind: "launcher" });
          }}
          taskId={screen.taskId}
        />
      </OverlayShell>
    );
  }

  if (screen.kind === "compose") {
    const backToOptions = () => {
      setScreen({ kind: "compose", step: "options" });
    };

    return (
      <OverlayShell>
        {screen.step === "options" && (
          <OptionsStep
            draft={draft}
            fallbackModelURI={defaultModelURI}
            isCreating={createTask.isPending}
            onBack={() => {
              setScreen({ kind: "launcher" });
            }}
            onOpenStep={(step) => {
              setScreen({ kind: "compose", step });
            }}
            onPromptChange={(prompt) => {
              setDraft((current) => ({ ...current, prompt }));
            }}
            onStartTask={() => {
              startTask(draft);
            }}
          />
        )}
        {screen.step === "model" && (
          <ModelStep
            onBack={backToOptions}
            onPick={(modelURI) => {
              setDraft((current) => ({ ...current, modelURI }));
              backToOptions();
            }}
            selectedURI={draft.modelURI ?? defaultModelURI}
          />
        )}
        {screen.step === "files" && (
          <FilesStep
            files={draft.files}
            onBack={backToOptions}
            onChange={(files) => {
              setDraft((current) => ({ ...current, files }));
            }}
          />
        )}
        {screen.step === "folders" && (
          <FoldersStep
            folders={draft.folders}
            onBack={backToOptions}
            onChange={(folders) => {
              setDraft((current) => ({ ...current, folders }));
            }}
          />
        )}
        {screen.step === "project" && (
          <ProjectStep
            onBack={backToOptions}
            onPick={(projectId) => {
              setDraft((current) => ({ ...current, projectId }));
              backToOptions();
            }}
            selectedId={draft.projectId}
          />
        )}
      </OverlayShell>
    );
  }

  return (
    <OverlayShell>
      <Launcher
        draftPrompt={draft.prompt}
        onOpenTask={(taskId) => {
          setScreen({ kind: "task", taskId });
        }}
        onQuickSend={(prompt) => {
          startTask(emptyDraft(prompt));
        }}
        onResumeDraft={() => {
          setScreen({ kind: "compose", step: "options" });
        }}
        onReview={(prompt) => {
          setDraft(emptyDraft(prompt));
          setScreen({ kind: "compose", step: "options" });
        }}
      />
    </OverlayShell>
  );
}
