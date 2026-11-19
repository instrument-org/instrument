import { getComputerFileUrl } from "@/client/lib/computer-file-url";
import { rpcClient } from "@/client/rpc/client";
import {
  LIVE_PAGE_FRAME_URL,
  LIVE_PAGE_WIDTH,
  type LivePageMessage,
} from "@/shared/live-page";
import { skipToken, useQuery } from "@tanstack/react-query";
import {
  type CSSProperties,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { z } from "zod";

import { feedPage, NEW_FEED, type PageFeed } from "./live-page-feed";
import {
  liveFrames,
  type LiveFramesEvent,
  NO_FRAMES,
} from "./live-page-frames";

/** How long a frame swapped out stays under the one that took its place. */
const RETIRE_MS = 150;
/**
 * How long a finished page takes to glide back to its top once the file has
 * taken over at the foot the writing scrolled to, so the card shows its
 * headline when someone scrolls back to it. 0 leaves it at the foot.
 */
const SETTLE_BACK_MS: number = 400;
/** How often the file is looked at for a write while its page is up. */
const WATCH_MS = 500;
/** The card's size before it is measured: its width at most, and its height. */
const CARD_SIZE = { height: 208, width: 460 };

/** What a frame tells the window (`LivePageMessage` has the rest). */
const FrameSaysSchema = z.object({
  livePage: z.discriminatedUnion("type", [
    z.object({ type: z.literal("loaded") }),
    z.object({ type: z.literal("ready") }),
    z.object({ type: z.literal("rest") }),
    z.object({ type: z.literal("scroll"), x: z.number(), y: z.number() }),
    z.object({ type: z.literal("shows") }),
  ]),
});

type Scroll = { x: number; y: number };

const TOP: Scroll = { x: 0, y: 0 };

type LivePageProps = {
  isWriting: boolean;
  /** Where the file is on this computer, once known. */
  place: string | undefined;
  /** The whole source so far, while a call writes it whole. */
  source: string | undefined;
  /** When the call last wrote it, once it has said. */
  version: number | undefined;
};

/**
 * A page's file drawn as a page, drawn afresh only for another file. Calls
 * name one file by different paths (a write by the path it was given, a
 * shell call's change by where it is), so two are one file when they are in
 * one place, or, until that is known, when they name it alike.
 */
export function LivePage({ path, ...props }: LivePageProps & { path: string }) {
  const { place } = props;
  const [file, setFile] = useState({ drawn: 0, path, place });
  const isSameFile =
    place !== undefined && file.place !== undefined
      ? place === file.place
      : path === file.path;
  const known = place ?? file.place;
  if (!isSameFile) {
    setFile({ drawn: file.drawn + 1, path, place });
  } else if (path !== file.path || known !== file.place) {
    setFile({ drawn: file.drawn, path, place: known });
  }
  return <PageFrames key={file.drawn} {...props} />;
}

/**
 * A page's file drawn as a page, laid out at a desk's width and scaled down
 * to the card. While a call writes it whole, its source is drawn as it
 * arrives, and the card keeps the page's foot in view as it grows; once the
 * file is there, it draws from the file where the writing left off, then
 * glides back to the top. Every later write of the file draws again in place
 * (`liveFrames`).
 */
function PageFrames({ isWriting, place, source, version }: LivePageProps) {
  const [state, dispatch] = useReducer(liveFrames, NO_FRAMES);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(CARD_SIZE);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(() => {
      setSize({ height: element.clientHeight, width: element.clientWidth });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  // What the call wrote last, kept once it is done for the frame fed from it.
  const [streamed, setStreamed] = useState(source);
  if (source !== undefined && source !== streamed) {
    setStreamed(source);
  }
  const isStreaming = source !== undefined;
  useEffect(() => {
    if (isStreaming) {
      dispatch({ type: "stream" });
    }
  }, [isStreaming]);

  const { data: watched } = useQuery(
    rpcClient.files.live.info.experimental_liveOptions({
      input:
        place === undefined ? skipToken : { intervalMs: WATCH_MS, path: place },
    }),
  );
  // The file is read once no call is writing it whole, each time it changes.
  const newest = Math.max(version ?? 0, watched?.modifiedAt ?? 0);
  const fileVersion =
    place === undefined || isStreaming || newest === 0 ? undefined : newest;
  useEffect(() => {
    if (place === undefined || fileVersion === undefined) {
      return;
    }
    const controller = new AbortController();
    void fetch(getComputerFileUrl({ hostPath: place, version: fileVersion }), {
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.text() : undefined))
      .then((text) => {
        if (text !== undefined) {
          dispatch({ text, type: "file" });
        }
      })
      .catch(() => {
        // Gone, refused or replaced by a newer read: the page up stays.
      });
    return () => {
      controller.abort();
    };
  }, [place, fileVersion]);

  const isRetiring = state.retiring.length > 0;
  useEffect(() => {
    if (!isRetiring) {
      return;
    }
    const timer = setTimeout(() => {
      dispatch({ type: "retired" });
    }, RETIRE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [isRetiring, state.retiring]);

  // Once the swap has painted, the file's frame that took over from the
  // writing settles back to its top, or, with no settling back, stays.
  const settling = isRetiring ? undefined : state.settling;
  useEffect(() => {
    if (settling !== undefined && SETTLE_BACK_MS <= 0) {
      dispatch({ key: settling, type: "rest" });
    }
  }, [settling]);

  const scrolls = useRef(new Map<number, Scroll>());
  // Where a new frame opens: where the one up stands once it is still, so
  // the swap moves nothing.
  const placeFrom = (): "end" | Scroll => {
    const shown = state.frames.find(({ key }) => key === state.shown);
    if (!shown) {
      return TOP;
    }
    if (!shown.file) {
      return "end";
    }
    return state.settling === shown.key
      ? TOP
      : (scrolls.current.get(shown.key) ?? TOP);
  };

  const scale = size.width / LIVE_PAGE_WIDTH;
  const height = Math.ceil(size.height / scale);
  return (
    <div className="absolute inset-0 overflow-hidden bg-card" ref={box}>
      {/* A picture of the page: the card is the one control. */}
      <div className="absolute inset-0" inert>
        {state.frames.map((frame) => {
          const isShown = frame.key === state.shown;
          const isUnder = state.retiring.includes(frame.key);
          return (
            <LiveFrame
              height={height}
              isComplete={frame.file !== undefined || !isWriting}
              isFollowing={!frame.file}
              isSettling={SETTLE_BACK_MS > 0 && frame.key === settling}
              key={frame.key}
              onEvent={dispatch}
              onScroll={(scroll) => {
                scrolls.current.set(frame.key, scroll);
              }}
              placeFrom={frame.file ? placeFrom : undefined}
              scale={scale}
              style={{
                opacity: isShown || isUnder ? 1 : 0,
                zIndex: isShown ? 2 : isUnder ? 1 : 0,
              }}
              frameKey={frame.key}
              text={frame.file?.text ?? streamed ?? ""}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * One frame of a page, fed `text` as it changes (`feedPage`), and closed once
 * `isComplete`. Never loaded again: a new page is a new frame.
 */
function LiveFrame({
  frameKey,
  height,
  isComplete,
  isFollowing,
  isSettling,
  onEvent,
  onScroll,
  placeFrom,
  scale,
  style,
  text,
}: {
  frameKey: number;
  height: number;
  isComplete: boolean;
  /** Keeps the page's foot in view as it grows, until it is whole. */
  isFollowing: boolean;
  /** Glides back to the page's top. */
  isSettling: boolean;
  onEvent: (event: LiveFramesEvent) => void;
  onScroll: (scroll: Scroll) => void;
  /** Where the page up will stand, for this one to open at the same place. */
  placeFrom: (() => "end" | Scroll) | undefined;
  scale: number;
  style: CSSProperties;
  text: string;
}) {
  const [port, setPort] = useState<MessagePort>();
  const [isReady, setIsReady] = useState(false);
  useEffect(() => {
    if (!port) {
      return;
    }
    const listen = (event: MessageEvent) => {
      const said = FrameSaysSchema.safeParse(event.data);
      if (!said.success) {
        return;
      }
      const { livePage } = said.data;
      switch (livePage.type) {
        case "loaded": {
          onEvent({ key: frameKey, type: "loaded" });
          break;
        }
        case "ready": {
          setIsReady(true);
          break;
        }
        case "rest": {
          onEvent({ key: frameKey, type: "rest" });
          break;
        }
        case "scroll": {
          onScroll({ x: livePage.x, y: livePage.y });
          break;
        }
        case "shows": {
          onEvent({ key: frameKey, type: "shows" });
          break;
        }
      }
    };
    port.addEventListener("message", listen);
    port.start();
    return () => {
      port.removeEventListener("message", listen);
    };
  }, [frameKey, onEvent, onScroll, port]);
  useEffect(
    () => () => {
      port?.close();
    },
    [port],
  );

  const feed = useRef<PageFeed>(NEW_FEED);
  useEffect(() => {
    if (!isReady) {
      return;
    }
    const step = feedPage(feed.current, text, isComplete);
    feed.current = step.feed;
    if (step.open) {
      tell(port, { type: "open" });
    }
    if (step.pieces.length > 0) {
      tell(port, { pieces: step.pieces, type: "write" });
    }
    if (step.close) {
      const scroll = placeFrom?.();
      tell(port, { ...(scroll && { scroll }), type: "close" });
    }
  }, [isComplete, isReady, placeFrom, port, text]);

  useEffect(() => {
    if (isReady && isFollowing) {
      tell(port, { type: "follow" });
    }
  }, [isFollowing, isReady, port]);

  useEffect(() => {
    if (isReady && isSettling) {
      tell(port, { ms: SETTLE_BACK_MS, to: TOP, type: "glide" });
    }
  }, [isReady, isSettling, port]);

  return (
    <iframe
      className="pointer-events-none absolute top-0 left-0 origin-top-left border-0"
      // Once its document has loaded, the frame's script gets one end of a
      // channel, and everything after goes over it. The frame loads again
      // each time a page written into it finishes, and keeps the port it has.
      onLoad={(event) => {
        if (port) {
          return;
        }
        const channel = new MessageChannel();
        setPort(channel.port1);
        // The frame's origin is opaque, so none can be named here.
        event.currentTarget.contentWindow?.postMessage(null, "*", [
          channel.port2,
        ]);
      }}
      // Scripts run, with an opaque origin: the frame reaches nothing of the
      // app's, and its document's policy keeps the network to the page
      // skill's hosts (`live-page-frame.ts`).
      sandbox="allow-scripts"
      src={LIVE_PAGE_FRAME_URL}
      style={{
        ...style,
        height,
        transform: `scale(${scale.toString()})`,
        width: LIVE_PAGE_WIDTH,
      }}
      tabIndex={-1}
      title="Page"
    />
  );
}

/** Sends a frame's page a message (`LivePageMessage`). */
function tell(port: MessagePort | undefined, message: LivePageMessage) {
  port?.postMessage({ livePage: message });
}
