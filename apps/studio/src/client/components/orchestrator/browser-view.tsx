import { Button } from "@/client/components/ui/button";
import { cn } from "@/client/lib/utils";
import { ORCHESTRATOR_BROWSER_PARTITION } from "@/shared/browser";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/ArrowClockwise";
import { ArrowLeftIcon } from "@phosphor-icons/react/ArrowLeft";
import { ArrowRightIcon } from "@phosphor-icons/react/ArrowRight";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { XIcon } from "@phosphor-icons/react/X";
import {
  type Ref,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { z } from "zod";

export interface BrowserPage {
  title: string;
  url: string;
}

export interface BrowserViewHandle {
  /** Loads an address, or searches for words. */
  open: (input: string) => void;
  /** Reads the page as it is at that moment; undefined while nothing is open. */
  readPage: () => Promise<PageContext | undefined>;
}

/** What the page had on it that the words in a message can refer to. */
export interface PageContext {
  selection?: string;
  text?: string;
  title: string;
  url: string;
}

/**
 * How much of the page goes with a message. The lead is enough to say what a
 * page is about; the page itself is for a task, which has a browser.
 */
const PAGE_TEXT_MAX = 1500;
const SELECTION_MAX = 2000;

const BLANK = "about:blank";

// Subset of Electron's `<webview>` tag API this view drives.
interface WebviewElement extends HTMLElement {
  canGoBack(): boolean;
  canGoForward(): boolean;
  executeJavaScript(code: string): Promise<unknown>;
  getTitle(): string;
  getURL(): string;
  goBack(): void;
  goForward(): void;
  loadURL(url: string): Promise<void>;
  reload(): void;
  stop(): void;
}

const PageWordsSchema = z.object({ selection: z.string(), text: z.string() });

/**
 * Runs in the page: what is selected, and its text with the whitespace folded,
 * from the main content when the page marks one so a banner or a menu does
 * not stand in for the article.
 */
const READ_PAGE_WORDS = `({
  selection: String(window.getSelection() ?? ""),
  text: (
    (document.querySelector("main, article, [role=main]") ?? document.body)
      ?.innerText ?? ""
  )
    .replace(/\\s+/g, " ")
    .trim(),
})`;

/**
 * The window's own browser, driven by hand. What it shows rides along with
 * every message sent while this tab is on screen, so "this page" means it.
 * The guest is created once and kept for the life of the view; the tab
 * switching away hides it rather than unmounting it, so the page stays.
 */
export function BrowserView({
  onPageChange,
  ref,
}: {
  /** Told the page on screen whenever it changes, and undefined when none is. */
  onPageChange?: (page: BrowserPage | undefined) => void;
  ref: Ref<BrowserViewHandle>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const webviewRef = useRef<null | WebviewElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState<BrowserPage>();
  const onPageChangeRef = useRef(onPageChange);
  useEffect(() => {
    onPageChangeRef.current = onPageChange;
  }, [onPageChange]);
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState({ back: false, forward: false });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    // `webview` is a custom element the window enables with webviewTag.
    const webview = document.createElement("webview") as WebviewElement;
    webview.setAttribute("partition", ORCHESTRATOR_BROWSER_PARTITION);
    webview.setAttribute("src", BLANK);
    // A sign-in popup has to reach the window-open handler in the main
    // process, which turns it into a navigation of this same guest.
    webview.setAttribute("allowpopups", "true");
    webview.style.width = "100%";
    webview.style.height = "100%";
    webview.style.border = "0";
    webviewRef.current = webview;

    const sync = () => {
      const url = webview.getURL();
      const next =
        url && url !== BLANK ? { title: webview.getTitle(), url } : undefined;
      setPage(next);
      onPageChangeRef.current?.(next);
      setHistory({
        back: webview.canGoBack(),
        forward: webview.canGoForward(),
      });
      // The bar follows the page unless the user is typing in it.
      if (document.activeElement !== addressRef.current) {
        setAddress(next?.url ?? "");
      }
    };
    const onStart = () => {
      setLoading(true);
    };
    const onStop = () => {
      setLoading(false);
      sync();
    };
    for (const event of [
      "did-navigate",
      "did-navigate-in-page",
      "page-title-updated",
      "did-finish-load",
      "did-fail-load",
    ]) {
      webview.addEventListener(event, sync);
    }
    webview.addEventListener("did-start-loading", onStart);
    webview.addEventListener("did-stop-loading", onStop);
    host.append(webview);

    return () => {
      webviewRef.current = null;
      webview.remove();
    };
  }, []);

  const go = async (input: string) => {
    const text = input.trim();
    if (!text) {
      return;
    }
    // A scheme is an address; a dotted word is a host; anything else is a
    // search.
    const url = /^[a-z][a-z0-9+.-]*:/i.test(text)
      ? text
      : /\s/.test(text) || !text.includes(".")
        ? `https://duckduckgo.com/?q=${encodeURIComponent(text)}`
        : `https://${text}`;
    webviewRef.current?.focus();
    try {
      await webviewRef.current?.loadURL(url);
    } catch {
      // A load another load overtakes rejects; the later one is the one wanted.
    }
  };

  useImperativeHandle(
    ref,
    () => ({
      open: (input: string) => {
        void go(input);
      },
      readPage: async () => {
        const webview = webviewRef.current;
        const url = webview?.getURL();
        if (!webview || !url || url === BLANK) {
          return;
        }
        const base = { title: webview.getTitle(), url };
        let raw: unknown;
        try {
          raw = await webview.executeJavaScript(READ_PAGE_WORDS);
        } catch {
          // A page mid-navigation, or one that blocks scripts: its address and
          // title still say what the user was looking at.
          return base;
        }
        const words = PageWordsSchema.safeParse(raw);
        if (!words.success) {
          return base;
        }
        const selection = words.data.selection.trim().slice(0, SELECTION_MAX);
        const text = words.data.text.slice(0, PAGE_TEXT_MAX);
        return {
          ...base,
          ...(selection ? { selection } : {}),
          ...(text ? { text } : {}),
        };
      },
      // Once: the handle reads the webview through its ref, and a new object per
      // render would hand the parent a new handle every time.
    }),
    [],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
        <Button
          aria-label="Back"
          disabled={!history.back}
          onClick={() => {
            webviewRef.current?.goBack();
          }}
          size="icon-sm"
          variant="ghost"
        >
          <ArrowLeftIcon />
        </Button>
        <Button
          aria-label="Forward"
          disabled={!history.forward}
          onClick={() => {
            webviewRef.current?.goForward();
          }}
          size="icon-sm"
          variant="ghost"
        >
          <ArrowRightIcon />
        </Button>
        <Button
          aria-label={loading ? "Stop" : "Reload"}
          disabled={!page}
          onClick={() => {
            if (loading) {
              webviewRef.current?.stop();
            } else {
              webviewRef.current?.reload();
            }
          }}
          size="icon-sm"
          variant="ghost"
        >
          {loading ? <XIcon /> : <ArrowClockwiseIcon />}
        </Button>
        <input
          aria-label="Address"
          className={cn(
            "h-8 min-w-0 flex-1 rounded-md border border-border bg-muted/40 px-3 text-sm outline-none",
            "focus:border-foreground/30",
          )}
          onChange={(event) => {
            setAddress(event.target.value);
          }}
          onFocus={(event) => {
            event.target.select();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void go(address);
            } else if (event.key === "Escape") {
              setAddress(page?.url ?? "");
              event.currentTarget.blur();
            }
          }}
          placeholder="Search or enter an address"
          ref={addressRef}
          spellCheck={false}
          type="text"
          value={address}
        />
      </div>
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0" ref={hostRef} />
        {page ? null : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background text-sm text-muted-foreground">
            <GlobeIcon className="size-8" />
            <p>
              Enter an address above. What you are looking at goes with what you
              say.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
