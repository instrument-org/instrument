import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { useIsActiveTab } from "@/client/hooks/use-active-tab";
import {
  getWebviewElement,
  setPaintHost,
  showOverSlot,
} from "@/client/lib/agent-browser-pool";
import {
  encodeBrowserTargetId,
  type StoreId,
  type TaskId,
} from "@instrument-org/workspace/client";
import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * The agent browser, hosted in the task page's artifact panel. The guest
 * `<webview>` lives in the body-mounted pool; this just measures a slot and
 * tells the pool to show the guest over it while the panel is visible, plus
 * lightweight navigation controls so the user can take over (drive the same
 * guest the agent uses). The guest only exists once the agent has opened a
 * browser for the session (`active`); otherwise we show a placeholder.
 */
export function TaskBrowserPanel({
  active,
  onClose,
  sessionId,
  taskId,
}: {
  active: boolean;
  onClose: () => void;
  sessionId: StoreId.Session;
  taskId: TaskId;
}) {
  const targetId = encodeBrowserTargetId(taskId, sessionId);
  const slotRef = useRef<HTMLDivElement>(null);
  const isActiveTab = useIsActiveTab();
  const [draftUrl, setDraftUrl] = useState("");
  const [nav, setNav] = useState({ back: false, forward: false });

  // Show the guest over the slot only while this is the foreground tab; park it
  // in paint-host otherwise. Every tab stays mounted (hidden via CSS), so the
  // guest's own DOM visibility can't tell us we've been backgrounded -- the
  // active-tab signal is authoritative.
  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (!slot || !active) {
      return;
    }

    if (!isActiveTab) {
      setPaintHost(targetId);
      return;
    }

    const measure = () => {
      const rect = slot.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        showOverSlot(targetId, {
          height: rect.height,
          width: rect.width,
          x: rect.x,
          y: rect.y,
        });
      } else {
        setPaintHost(targetId);
      }
      return rect;
    };

    // The artifact panel slides in via a transform, which getBoundingClientRect
    // folds into `rect.x` (ResizeObserver can't catch it -- the size is
    // unchanged). Track the slot each frame so the guest follows the panel, and
    // stop once the position holds for two frames, i.e. the slot has settled.
    let raf = 0;
    let stableFrames = 0;
    let last = measure();
    const track = () => {
      const rect = measure();
      stableFrames =
        rect.x === last.x && rect.y === last.y ? stableFrames + 1 : 0;
      last = rect;
      if (stableFrames < 2) {
        raf = requestAnimationFrame(track);
      }
    };
    raf = requestAnimationFrame(track);

    const observer = new ResizeObserver(measure);
    observer.observe(slot);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("resize", measure);
      setPaintHost(targetId);
    };
  }, [active, isActiveTab, targetId]);

  // Mirror the guest's URL + nav availability into the controls (it navigates
  // from agent CDP commands too, not just user input).
  useEffect(() => {
    if (!active) {
      return;
    }
    const webview = getWebviewElement(targetId);
    if (!webview) {
      return;
    }
    const sync = () => {
      // getURL/canGoBack throw if the guest hasn't attached its WebContents yet;
      // the did-navigate events that also drive this only fire once it has.
      try {
        setDraftUrl(webview.getURL());
        setNav({ back: webview.canGoBack(), forward: webview.canGoForward() });
      } catch {
        // Not attached yet; a did-navigate will re-run sync once it is.
      }
    };
    sync();
    webview.addEventListener("did-navigate", sync);
    webview.addEventListener("did-navigate-in-page", sync);
    return () => {
      webview.removeEventListener("did-navigate", sync);
      webview.removeEventListener("did-navigate-in-page", sync);
    };
  }, [active, targetId]);

  const webviewFor = () => getWebviewElement(targetId);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center gap-1 border-b p-1.5">
        <Button
          disabled={!nav.back}
          onClick={() => webviewFor()?.goBack()}
          size="icon-sm"
          variant="ghost"
        >
          <ArrowLeftIcon className="size-4" />
        </Button>
        <Button
          disabled={!nav.forward}
          onClick={() => webviewFor()?.goForward()}
          size="icon-sm"
          variant="ghost"
        >
          <ArrowRightIcon className="size-4" />
        </Button>
        <Button
          onClick={() => webviewFor()?.reload()}
          size="icon-sm"
          variant="ghost"
        >
          <ArrowClockwiseIcon className="size-4" />
        </Button>
        <form
          className="min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            const target = normalizeUrl(draftUrl);
            if (target) {
              void webviewFor()?.loadURL(target);
            }
          }}
        >
          <Input
            className="h-7 text-ellipsis"
            onChange={(event) => {
              setDraftUrl(event.target.value);
            }}
            placeholder="Enter a URL"
            spellCheck={false}
            value={draftUrl}
          />
        </form>
        <Button onClick={onClose} size="icon-sm" variant="ghost">
          <XIcon className="size-4" />
        </Button>
      </div>
      {active ? (
        <div className="relative flex-1" ref={slotRef} />
      ) : (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
          The agent hasn’t opened a browser in this session yet.
        </div>
      )}
    </div>
  );
}

function normalizeUrl(input: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) {
    return undefined;
  }
  return /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
