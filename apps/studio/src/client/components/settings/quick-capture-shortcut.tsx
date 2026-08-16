import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { Kbd, KbdGroup } from "@/client/components/ui/kbd";
import { Label } from "@/client/components/ui/label";
import { acceleratorFromEvent } from "@/client/lib/accelerator-from-event";
import { formatAccelerator } from "@/client/lib/format-accelerator";
import { isMacOS } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { DEFAULT_QUICK_CAPTURE_ACCELERATOR } from "@/shared/constants";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

/**
 * Records a global chord by listening for one, rather than asking anyone to
 * type an Electron accelerator string. Whatever we ship as the default will
 * collide with something on someone's machine, so changing it has to be easy
 * and has to say when the new pick is taken too.
 */
export function QuickCaptureShortcut() {
  const [isRecording, setIsRecording] = useState(false);
  const [problem, setProblem] = useState<null | string>(null);

  const { data: preferences } = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );
  const setAcceleratorMutation = useMutation(
    rpcClient.overlay.setAccelerator.mutationOptions(),
  );

  const accelerator =
    preferences?.quickCaptureAccelerator ?? DEFAULT_QUICK_CAPTURE_ACCELERATOR;

  const save = useCallback(
    async (next: string) => {
      const result = await setAcceleratorMutation.mutateAsync({
        accelerator: next,
      });
      if (result.taken) {
        setProblem("Another app is already using that shortcut.");
        return;
      }
      setProblem(null);
      setIsRecording(false);
    },
    [setAcceleratorMutation],
  );

  useEffect(() => {
    if (!isRecording) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      // Everything goes to the recorder while it is armed, including chords the
      // app itself would otherwise act on.
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setIsRecording(false);
        setProblem(null);
        return;
      }

      const recorded = acceleratorFromEvent(event, { isMac: isMacOS() });
      if (recorded.kind === "incomplete") {
        return;
      }
      if (recorded.kind === "unsupported") {
        setProblem(recorded.reason);
        return;
      }

      void save(recorded.accelerator);
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, [isRecording, save]);

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Label>Quick capture shortcut</Label>
          <p className="text-xs text-muted-foreground">
            Summons the quick capture panel from any app.
          </p>
          {problem && <p className="text-xs text-destructive">{problem}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isRecording ? (
            <span className="text-xs text-muted-foreground">
              Press a shortcut, or Esc to cancel
            </span>
          ) : accelerator ? (
            <KbdGroup>
              {formatAccelerator(accelerator).map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
            </KbdGroup>
          ) : (
            <span className="text-xs text-muted-foreground">None</span>
          )}

          <Button
            onClick={() => {
              setProblem(null);
              setIsRecording((recording) => !recording);
            }}
            size="sm"
            variant="outline"
          >
            {isRecording ? "Cancel" : "Change"}
          </Button>

          {accelerator && !isRecording && (
            <Button
              onClick={() => {
                void save("");
              }}
              size="sm"
              variant="ghost"
            >
              Clear
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
