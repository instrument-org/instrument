import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { useSelectedTabId } from "@/client/hooks/use-selected-tab-id";
import {
  ensureWebview,
  getWebviewElement,
  setPaintHost,
  showOverSlot,
} from "@/client/lib/agent-browser-pool";
import { type StoreId, type TaskId } from "@instrument-org/workspace/client";
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
  const targetId = `${taskId}/${sessionId}`;
  const slotRef = useRef<HTMLDivElement>(null);
  const selectedId = useSelectedTabId();
  const [draftUrl, setDraftUrl] = useState("");
  const [nav, setNav] = useState({ back: false, forward: false });

  // Position the guest over the slot while the panel's tab is active; fall back
  // to paint-host otherwise (inactive tab, or panel closed/unmounted).
  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (!slot || !active) {
      return;
    }
    ensureWebview(targetId);

    const measure = () => {
      const shown = getComputedStyle(slot).visibility === "visible";
      const rect = slot.getBoundingClientRect();
      if (shown && rect.width > 0 && rect.height > 0) {
        showOverSlot(targetId, {
          height: rect.height,
          width: rect.width,
          x: rect.x,
          y: rect.y,
        });
      } else {
        setPaintHost(targetId);
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(slot);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      setPaintHost(targetId);
    };
  }, [active, selectedId, targetId]);

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
      setDraftUrl(webview.getURL());
      setNav({ back: webview.canGoBack(), forward: webview.canGoForward() });
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
    <div className="flex h-full flex-col overflow-hidden rounded-md border bg-background">
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
            className="h-7"
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
