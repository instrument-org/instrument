import { useIsActiveTab } from "@/client/hooks/use-active-tab";
import { isTypingInto } from "@/client/lib/is-typing-into";
import { useEffect } from "react";

/**
 * Left and right to step, space to play.
 *
 * Bare keys, so this yields twice over. It yields to whatever is being typed
 * into, because a space is a space before it is a shortcut. And it yields to
 * every tab but its own: Studio mounts all of them into one web contents and
 * hides the background ones with CSS, so a listener on `window` here goes on
 * running while the user is somewhere else entirely -- which is a debug page
 * quietly eating the space bar in the composer.
 */
export function usePlaybackKeys({
  onStep,
  onTogglePlay,
}: {
  onStep: (by: -1 | 1) => void;
  onTogglePlay: () => void;
}) {
  const isActiveTab = useIsActiveTab();

  useEffect(() => {
    if (!isActiveTab) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        isTypingInto(event.target)
      ) {
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        onStep(event.key === "ArrowLeft" ? -1 : 1);
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        onTogglePlay();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isActiveTab, onStep, onTogglePlay]);
}
