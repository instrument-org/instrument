import { easeStep, followStep } from "@/shared/live-page";
import fs from "node:fs/promises";
import path from "node:path";

import { createScopedLogger } from "./electron-logger";
import { getRegistryDir } from "./registry-dir";
import { PAGE_HOSTS } from "./rendered-pictures";

const log = createScopedLogger("LivePage");

/**
 * The web fonts `page.mjs` links into a page it builds (`FONTS` in the page
 * skill's `lib/check.mjs`), linked here too so a page reads in the same type
 * before its build as after it.
 */
const FONTS =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400..800&family=JetBrains+Mono:wght@400;600&family=Roboto+Serif:ital,wght@0,400..700;1,400..700&display=swap";

/**
 * What a page drawn in a card may do: run its own scripts, and load its type,
 * styles and libraries from the page skill's hosts and nothing else. No
 * fetch, no forms and no frames of its own. The window frames it sandboxed
 * with scripts alone, so its origin is opaque: it reaches nothing of the
 * app's and keeps nothing between pages, and it opens no dialog, popup or
 * download and cannot send the window anywhere.
 */
function livePagePolicy(): string {
  const hosts = [...PAGE_HOSTS].map((host) => `https://${host}`).join(" ");
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${hosts}`,
    `style-src 'unsafe-inline' ${hosts}`,
    `font-src data: ${hosts}`,
    "img-src data: blob:",
    "media-src data: blob:",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
}

/**
 * The frame's own script. It takes the port the window hands it as the frame
 * loads, then writes what comes over it into its own document, opened once
 * and written piece by piece so the browser's parser draws the page as it
 * arrives, and tells the window when the page first draws something and when
 * a whole page has loaded. Opening the document keeps the window, so the
 * script's state and the port outlive it, and the page shares the window with
 * the script: a page that tampers with it breaks only its own card. It moves
 * the page's scroll itself, a step each frame, following the page's foot as
 * it grows or gliding to a place. The message shapes are `LivePageMessage` in
 * `shared/live-page.ts`.
 */
const FRAME_SCRIPT = String.raw`(() => {
  const followStep = (${followStep.toString()});
  const easeStep = (${easeStep.toString()});
  const foundation = JSON.parse(document.getElementById("foundation").textContent);
  // Kept before any page runs, since a page shares this window and may
  // replace what it finds on it.
  const page = document;
  const view = window;
  const nextFrame = requestAnimationFrame.bind(window);
  const later = setTimeout.bind(window);
  let port;
  let opened = 0;
  let shows = false;
  let looking = false;
  const say = (message) => port.postMessage({ livePage: message });
  // The scroll the frame moves: where it is (kept apart from the page's own,
  // which may round), where it last put the page, how fast it moves, and what
  // it does, "follow" or a glide.
  let at = 0;
  let placed;
  let velocity = 0;
  let motion;
  let isWhole = false;
  let lastFrame;
  // The page's own scrolling element is the only thing the frame scrolls:
  // nothing that scrolls an element into view or focuses one, either of which
  // can carry on into the window around the card.
  const scroller = () => page.scrollingElement || page.documentElement;
  const foot = () => Math.max(0, scroller().scrollHeight - scroller().clientHeight);
  const place = (y) => {
    at = y;
    scroller().scrollTop = y;
    placed = scroller().scrollTop;
  };
  // The card is a picture of the page, so it shows no scrollbar, which would
  // also come and go as the page moves, and it scrolls at once, whatever the
  // page asks of its own scrolling.
  const hideScrollbar = () => {
    if (!page.documentElement) return;
    page.documentElement.style.setProperty("scrollbar-width", "none");
    page.documentElement.style.setProperty("scroll-behavior", "auto", "important");
  };
  // A page's scrolling an element into view or focusing one carries on into
  // the window around the card, past the frame's inert wrapper: it scrolls
  // the transcript and takes the window's focus from wherever it was. So in a
  // card neither does anything, nor does opening a dialog as a modal one,
  // which focuses it. Its autofocus the browser ignores already, in a frame
  // of another origin.
  const keepToItself = (view) => {
    const nothing = () => {};
    for (const name of ["scrollIntoView", "scrollIntoViewIfNeeded"]) view.Element.prototype[name] = nothing;
    for (const kind of ["HTMLElement", "SVGElement", "MathMLElement"]) if (view[kind]) view[kind].prototype.focus = nothing;
    view.focus = nothing;
    view.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  };
  const stop = () => {
    motion = undefined;
    lastFrame = undefined;
    say({ type: "rest" });
  };
  const step = (now) => {
    if (!motion || opened === 0) return;
    const ms = lastFrame === undefined ? 16 : now - lastFrame;
    lastFrame = now;
    if (motion === "follow") {
      // The page moved under the scroll itself, as when a table above the
      // view widens its rows: the browser keeps what is in view still by
      // scrolling, and the follow carries on from there.
      const moved = scroller().scrollTop - placed;
      if (placed !== undefined && Math.abs(moved) > 1) at += moved;
      const target = foot();
      [at, velocity] = followStep(at, velocity, target, ms);
      // Once the page is whole and the scroll has all but arrived, it lands.
      if (isWhole && Math.abs(target - at) < 1 && Math.abs(velocity) < 0.03) {
        place(target);
        return stop();
      }
      place(at);
    } else {
      const elapsed = now - motion.started;
      place(easeStep(motion.from, motion.to, elapsed, motion.ms));
      if (elapsed >= motion.ms) return stop();
    }
    nextFrame(step);
  };
  const move = (next) => {
    const isMoving = motion !== undefined;
    motion = next;
    if (!isMoving) nextFrame(step);
  };
  // The card comes once the source draws enough to see, so the page shows
  // once it draws anything at all: some text, or a picture with a size.
  const drawsAnything = (body) => {
    if (body.innerText.trim() !== "") return true;
    for (const element of body.querySelectorAll("img, svg, canvas, video")) {
      const box = element.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) return true;
    }
    return false;
  };
  const look = () => {
    if (shows || looking) return;
    looking = true;
    nextFrame(() => {
      looking = false;
      if (!shows && page.body && drawsAnything(page.body)) {
        shows = true;
        say({ type: "shows" });
      }
    });
  };
  const onScroll = () => say({ type: "scroll", x: view.scrollX, y: view.scrollY });
  const hear = (message) => {
    if (message.type === "open") {
      // The page replaces this document in place. The window stays, and with
      // it this script's state and the port, though not its listeners.
      page.open();
      opened += 1;
      shows = false;
      isWhole = false;
      at = 0;
      placed = undefined;
      velocity = 0;
      keepToItself(view);
      view.addEventListener("scroll", onScroll, { passive: true });
    } else if (opened === 0) {
      return;
    } else if (message.type === "write") {
      for (const piece of message.pieces) page.write(piece === null ? foundation : piece);
      hideScrollbar();
      look();
    } else if (message.type === "follow" && motion !== "follow") {
      at = scroller().scrollTop;
      velocity = 0;
      move("follow");
    } else if (message.type === "glide") {
      move({ from: scroller().scrollTop, ms: message.ms, started: performance.now(), to: message.to.y });
    } else if (message.type === "close") {
      const generation = opened;
      let settled = false;
      const settle = () => {
        if (settled || generation !== opened) return;
        settled = true;
        const wait = new Promise((resolve) => later(resolve, 1500));
        Promise.race([page.fonts ? page.fonts.ready : undefined, wait]).then(() => {
          if (generation !== opened) return;
          hideScrollbar();
          // Placed once its type has loaded, since that moves its foot.
          if (message.scroll) place(message.scroll === "end" ? foot() : message.scroll.y);
          nextFrame(() => nextFrame(() => {
            if (generation === opened) say({ type: "loaded" });
          }));
        });
      };
      isWhole = true;
      view.addEventListener("load", settle, { once: true });
      later(settle, 4000);
      page.close();
      if (page.readyState === "complete") settle();
      look();
    }
  };
  // The window hands over the port it talks on once, as the frame loads, and
  // everything after goes over it.
  const takePort = (event) => {
    if (port || !event.ports[0]) return;
    port = event.ports[0];
    view.removeEventListener("message", takePort);
    port.onmessage = (event) => {
      const message = event.data ? event.data.livePage : undefined;
      if (message) hear(message);
    };
    say({ type: "ready" });
  };
  view.addEventListener("message", takePort);
})();`;

let frameDocument: Promise<string> | undefined;

/** The page skill's foundation as `page.mjs` puts it into a page's head, from the copy the app ships. */
async function foundationBlock(): Promise<string> {
  const dir = path.join(getRegistryDir(), "skills", "instrument-page", "lib");
  try {
    const [css, js] = await Promise.all([
      fs.readFile(path.join(dir, "foundation.css"), "utf8"),
      fs.readFile(path.join(dir, "foundation.js"), "utf8"),
    ]);
    return [
      '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
      `<link rel="stylesheet" href="${FONTS}">`,
      `<style>\n${css}\n</style>`,
      `<script>\n${js}\n</script>`,
    ].join("\n");
  } catch (error) {
    // A page is drawn plain rather than not at all.
    log.warn(`Could not read the page skill's foundation: ${String(error)}`);
    return "";
  }
}

/** Text as JSON for a script element, `<` escaped so no `</script>` in it ends the element. */
const scriptJson = (text: string) =>
  JSON.stringify(text).replaceAll("<", "\\u003c");

async function makeFrameDocument(): Promise<string> {
  return `<!doctype html>
<html><head><meta charset="utf-8">
</head><body>
<script type="application/json" id="foundation">${scriptJson(await foundationBlock())}</script>
<script>${FRAME_SCRIPT}</script>
</body></html>`;
}

/** The frame document, on the app scheme's live-page host. */
export async function handleLivePageRequest({
  request,
  url,
}: {
  request: Request;
  url: URL;
}): Promise<Response> {
  if (request.method !== "GET" || url.pathname !== "/") {
    return new Response(null, { status: 404 });
  }
  frameDocument ??= makeFrameDocument();
  return new Response(await frameDocument, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": livePagePolicy(),
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}
