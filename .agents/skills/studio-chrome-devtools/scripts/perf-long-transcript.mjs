// Measures a long chat's transcript read back, and checks that nothing on
// screen moves that the reader did not move: opening it, scrolling to its top
// with the wheel (every older page loading on the way), stepping down to the
// end and back at several zooms, and streaming a reply into it from a paced
// stand-in model on loopback, followed at the end and then read from above.
//
//   node studio-drive.mjs boot --purpose "long transcript" --workspace long-work-chat
//   node studio-drive.mjs run perf-long-transcript.mjs --allow-reload --workspace long-work-chat
//
// Counts come first: DOM nodes (the window's and the transcript's), turns
// drawn and turns standing as boxes, the heap after a collection, React
// commits and fibers per commit, long animation frames. `moves` are the
// checks: each one a place on screen that shifted by more than a pixel when
// the step said where it should be (`steps`), or a move the transcript debug
// page's trace would count (`trace`: following the end and slipping off it,
// or the reader's place shifting with no input). A clean run has none.
//
// Reaching the top also reports how the column's height went: `scrollHeight`
// right as the chat opened, settled, and with every turn loaded, and while
// getting there, each change of it and each time the scrollbar's thumb moved
// down while the reader went up (`height`).
//
// Args: `chat` (harbor-survey), `zooms` ([1, 0.75, 1.5]), `words` (600) and
// `delayMs` (20) for the streamed reply, `wheelPx` (500) per wheel step,
// `reach` ("wheel") for how the top is reached ("drag" takes the position
// to 0 as the scrollbar's thumb would and leaves it there until every page
// is in), `stream` (true) to stream the
// replies.

import { createServer } from "node:http";

import { chatHref } from "../../../../apps/studio/scripts/drive-routes.ts";
import { installProbe } from "./perf-screens.mjs";
import { sleep } from "./studio-app.mjs";

const MODEL_ID = "perf-paced-stand-in";

export default async (app, args = {}) => {
  const chat = args.chat ?? "harbor-survey";
  const stub = await pacedModel({
    delayMs: args.delayMs ?? 20,
    words: args.words ?? 600,
  });
  try {
    const modelURI = await addStandIn(app, stub.baseURL);
    await installProbe(app);
    await app.waitFor("window.__studioDrive && window.__perfProbe", {
      timeout: 60_000,
    });
    await sleep(3000);
    await app.eval(PAGE_HELPERS);

    const measure = async (label) => {
      await app.cdp.send("HeapProfiler.collectGarbage");
      const snapshot = await app.eval(
        "window.__perfProbe.snapshot({components: 8, rpc: 4})",
      );
      return {
        label,
        ...(await app.eval("window.__transcriptProbe.counts()")),
        heapMb: snapshot.heapMb,
        commits: snapshot.commits,
        fibersPerCommit: Math.round(
          snapshot.fibersRendered / Math.max(snapshot.commits, 1),
        ),
        longFrames: {
          count: snapshot.longFrames.count,
          totalMs: Math.round(snapshot.longFrames.totalMs),
          blockingMs: Math.round(snapshot.longFrames.blockingMs),
          worstMs: snapshot.longFrames.worst.map((frame) =>
            Math.round(frame.ms),
          ),
        },
        topComponents: snapshot.topComponents,
      };
    };
    const reset = () => app.eval("window.__perfProbe.reset()");
    const results = { phases: [], moves: {} };

    // Opening the chat: its last page of turns.
    await reset();
    await app.goto(chatHref(chat));
    await app.waitFor(
      "document.querySelectorAll('[data-group-up] [data-message-scroller-item]').length > 10",
      { timeout: 30_000 },
    );
    const firstScrollHeight = (
      await app.eval("window.__transcriptProbe.counts()")
    ).scrollHeight;
    await sleep(2500);
    const opened = await measure("open");
    results.phases.push(opened);

    // To the top with the wheel, the way a reader goes back through it. A
    // view left at the very top keeps the page above it unasked for until
    // the reader moves, so one held there turns back down a little first.
    // Or by the scrollbar's thumb, dragged to the top and held there.
    await reset();
    await app.eval("window.__transcriptProbe.height.start()");
    const reach = args.reach ?? "wheel";
    const wheelPx = args.wheelPx ?? 500;
    let steps = 0;
    let nudges = 0;
    let heldAtTop = 0;
    const dragged = reach === "drag" ? await dragToTop(app) : undefined;
    while (reach === "wheel" && steps < 6000) {
      const at = await app.eval("window.__transcriptProbe.where()");
      if (at.scrollTop <= 0 && !at.hasOlder) {
        break;
      }
      heldAtTop = at.scrollTop <= 0 ? heldAtTop + 1 : 0;
      if (heldAtTop > 15) {
        await wheel(app, 3 * wheelPx);
        nudges += 1;
        heldAtTop = 0;
      } else {
        await wheel(app, -wheelPx);
      }
      steps += 1;
      await sleep(30);
    }
    await sleep(1500);
    const height = await app.eval("window.__transcriptProbe.height.stop()");
    const top = await measure("scrolled to the top");
    results.phases.push({
      ...top,
      ...(dragged ? { dragged } : { wheelSteps: steps, nudges }),
    });
    results.height = {
      ...height,
      scrollHeight: {
        firstFrame: firstScrollHeight,
        open: opened.scrollHeight,
        loaded: top.scrollHeight,
        openOffBy: opened.scrollHeight - top.scrollHeight,
      },
    };

    // Down to the end and back up in steps, at each zoom.
    for (const zoom of args.zooms ?? [1, 0.75, 1.5]) {
      await app.eval(`window.__transcriptProbe.setZoom(${zoom.toString()})`);
      await sleep(500);
      await reset();
      const down = await app.eval(
        "window.__transcriptProbe.stepThrough(1, 0.45)",
      );
      const up = await app.eval(
        "window.__transcriptProbe.stepThrough(-1, 0.45)",
      );
      results.moves[`zoom ${zoom.toString()}`] = { down, up };
      results.phases.push(await measure(`stepped down and up at ${zoom}x`));
    }
    await app.eval("window.__transcriptProbe.setZoom(1)");
    await sleep(500);

    if (args.stream === false) {
      return results;
    }

    // A reply streaming in, followed at the end.
    const { sessionId } = await app.rpc("workspace.chats.session", {
      id: chat,
    });
    await app.eval("window.__transcriptProbe.toEnd()");
    await sleep(500);
    await reset();
    await app.eval("window.__transcriptProbe.trace.start()");
    await app.rpc("workspace.message.create", {
      id: chat,
      modelURI,
      prompt: "Pass 301: write up the whole survey.",
      sessionId,
    });
    await waitForTurn(app, chat, 120_000);
    results.moves["streaming, followed"] = await app.eval(
      "window.__transcriptProbe.trace.stop()",
    );
    results.phases.push(await measure("streamed a reply at the end"));

    // Another, read from two screens up once it has started.
    await reset();
    await app.rpc("workspace.message.create", {
      id: chat,
      modelURI,
      prompt: "Pass 302: and once more.",
      sessionId,
    });
    await sleep(2500);
    for (let at = 0; at < 3; at++) {
      await wheel(app, -400);
      await sleep(60);
    }
    await sleep(500);
    await app.eval("window.__transcriptProbe.trace.start()");
    await waitForTurn(app, chat, 120_000);
    results.moves["streaming, read from above"] = await app.eval(
      "window.__transcriptProbe.trace.stop()",
    );
    results.phases.push(await measure("streamed a reply read from above"));
    results.standIn = { requests: stub.requests };
    return results;
  } finally {
    stub.server.closeAllConnections?.();
    stub.server.close();
  }
};

/** A wheel turn over the transcript, as real input. */
async function wheel(app, deltaY) {
  const { x, y } = await app.eval("window.__transcriptProbe.center()");
  await app.cdp.send("Input.dispatchMouseEvent", {
    deltaX: 0,
    deltaY,
    type: "mouseWheel",
    x,
    y,
  });
}

/**
 * The scrollbar's thumb dragged to the top and held there until no older
 * page is left to load. macOS draws overlay scrollbars, which take no
 * synthesized press in a window off screen, so this is what the scroll
 * owner sees of one: a press on the viewport itself, then the position
 * stepped to 0 over ten frames and left there. Says how long the pages took
 * and how far from the top the view was at most once it got there.
 */
async function dragToTop(app) {
  await app.eval("window.__transcriptProbe.dragToTop()");
  const started = Date.now();
  let offTop = 0;
  for (;;) {
    const at = await app.eval("window.__transcriptProbe.where()");
    offTop = Math.max(offTop, at.scrollTop);
    if (!at.hasOlder || Date.now() - started > 60_000) {
      break;
    }
    await sleep(50);
  }
  await sleep(500);
  return {
    ms: Date.now() - started,
    offTop,
    ...(await app.eval("window.__transcriptProbe.firstOnScreen()")),
  };
}

async function waitForTurn(app, chat, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let sawWorking = false;
  while (Date.now() < deadline) {
    await sleep(500);
    const info = await app.rpc("workspace.chats.byId", { id: chat });
    if (info?.working) {
      sawWorking = true;
    } else if (sawWorking) {
      await sleep(1500);
      return true;
    }
  }
  return false;
}

async function addStandIn(app, baseURL) {
  const name = "Perf paced stand-in";
  for (const old of (await app.rpc("providerConfig.list", {})).filter(
    (entry) => entry.displayName === name,
  )) {
    await app.rpc("providerConfig.remove", { id: old.id });
  }
  await app.rpc("providerConfig.create", {
    config: {
      apiKey: "x",
      baseURL,
      displayName: name,
      type: "openai-compatible",
    },
    skipValidation: true,
  });
  for (let at = 0; at < 60; at++) {
    const listed = await app.rpc("gateway.models.list", {});
    const uri = (Array.isArray(listed) ? listed : listed.models).find(
      (model) => String(model.uri).includes(MODEL_ID),
    )?.uri;
    if (uri) {
      return uri;
    }
    await sleep(250);
  }
  throw new Error("The stand-in model was never listed.");
}

/**
 * An OpenAI-compatible model on loopback that streams `words` words of a
 * reply, one every `delayMs`, and answers anything else (a title) at once.
 */
function pacedModel({ delayMs, words }) {
  const requests = [];
  const sentence =
    "The harbor master walked the outer wall each morning to count the boats and note which berths had moved overnight. ";
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (data) => {
      body += data;
    });
    request.on("end", async () => {
      if (request.method === "GET" && (request.url ?? "").endsWith("/models")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            data: [{ created: 0, id: MODEL_ID, object: "model", owned_by: "perf" }],
            object: "list",
          }),
        );
        return;
      }
      let parsed = {};
      try {
        parsed = JSON.parse(body);
      } catch {
        // A request with no body is answered as a short one.
      }
      const isTurn =
        Array.isArray(parsed.tools) && parsed.tools.length > 0;
      requests.push({ isTurn });
      const text = isTurn
        ? sentence.repeat(Math.ceil(words / 20)).split(/(?<=\s)/).slice(0, words).join("")
        : "Harbor survey";
      const usage = { completion_tokens: 10, prompt_tokens: 10, total_tokens: 20 };
      if (parsed.stream === false) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            choices: [{ finish_reason: "stop", index: 0, message: { content: text, role: "assistant" } }],
            id: "x",
            model: MODEL_ID,
            object: "chat.completion",
            usage,
          }),
        );
        return;
      }
      response.writeHead(200, { "cache-control": "no-cache", "content-type": "text/event-stream" });
      const chunk = (delta, finish = null) =>
        `data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish, index: 0 }], created: 0, id: "x", model: MODEL_ID, object: "chat.completion.chunk" })}\n\n`;
      response.write(chunk({ content: "", role: "assistant" }));
      for (const piece of isTurn ? (text.match(/\S+\s*/g) ?? []) : [text]) {
        response.write(chunk({ content: piece }));
        if (isTurn) {
          await sleep(delayMs);
        }
      }
      response.write(chunk({}, "stop"));
      response.write(
        `data: ${JSON.stringify({ choices: [], id: "x", model: MODEL_ID, object: "chat.completion.chunk", usage })}\n\n`,
      );
      response.end("data: [DONE]\n\n");
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        baseURL: `http://127.0.0.1:${server.address().port.toString()}/v1`,
        requests,
        server,
      });
    });
  });
}

/** What the run reads and does in the page, installed once after the reload. */
const PAGE_HELPERS = String.raw`(() => {
  const viewport = () =>
    document.querySelector("[data-group-up] [data-slot=message-scroller-viewport]") ??
    document.querySelector("[data-slot=message-scroller-viewport]");
  const frames = (n) =>
    new Promise((resolve) => {
      const next = (left) => (left === 0 ? resolve() : requestAnimationFrame(() => next(left - 1)));
      next(n);
    });
  const scaleOf = (element) => element.getBoundingClientRect().height / element.offsetHeight || 1;
  /** The row under the middle of the view, and where it is on screen. */
  const middleRow = (view) => {
    const box = view.getBoundingClientRect();
    const middle = box.top + box.height / 2;
    const row = [...view.querySelectorAll("[data-message-scroller-item]")].find((item) => {
      const rect = item.getBoundingClientRect();
      return rect.top <= middle && rect.bottom >= middle;
    });
    return row ? { row, top: row.getBoundingClientRect().top } : undefined;
  };
  const trace = { events: [], stop: undefined };
  const heights = { stop: undefined };
  window.__transcriptProbe = {
    /** A press on the scrollbar, and the position taken to 0 over ten frames. */
    async dragToTop() {
      const view = viewport();
      view.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      const from = view.scrollTop;
      for (let step = 9; step >= 0; step--) {
        view.scrollTop = (from * step) / 10;
        await frames(1);
      }
    },
    /** The first row a person sees at the top of the view, and whether it is the chat's first. */
    firstOnScreen() {
      const view = viewport();
      const content = view.querySelector("[data-slot=message-scroller-content]");
      const viewTop = view.getBoundingClientRect().top;
      const first = content.firstElementChild;
      const row = [...content.querySelectorAll(":scope > [data-message-scroller-item]")].find(
        (item) => item.getBoundingClientRect().bottom > viewTop,
      );
      return {
        scrollTop: view.scrollTop,
        isFirstTurn: first === row,
        rowTop: row ? Math.round(row.getBoundingClientRect().top - viewTop) : undefined,
      };
    },
    /**
     * Counts, frame by frame, each change of the column's scrollHeight and each
     * frame the thumb moved down by more than half a percent of the track
     * (a nudge down from the very top is one of those).
     */
    height: {
      start() {
        const view = viewport();
        const seen = { changes: 0, grew: 0, shrank: 0, largestPx: 0, totalPx: 0, thumbDown: 0, frames: 0 };
        let height = view.scrollHeight;
        let thumb = view.scrollTop / view.scrollHeight;
        let frame = 0;
        const tick = () => {
          frame = requestAnimationFrame(tick);
          seen.frames += 1;
          const next = view.scrollHeight;
          if (next !== height) {
            const change = next - height;
            seen.changes += 1;
            if (change > 0) seen.grew += 1; else seen.shrank += 1;
            seen.largestPx = Math.max(seen.largestPx, Math.abs(change));
            seen.totalPx += Math.abs(change);
            height = next;
          }
          const at = view.scrollTop / view.scrollHeight;
          if (at - thumb > 0.005) seen.thumbDown += 1;
          thumb = at;
        };
        frame = requestAnimationFrame(tick);
        heights.stop = () => {
          cancelAnimationFrame(frame);
          return seen;
        };
      },
      stop() {
        return heights.stop?.();
      },
    },
    center() {
      const box = viewport().getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    },
    counts() {
      const view = viewport();
      const content = view.querySelector("[data-slot=message-scroller-content]");
      const items = [...content.querySelectorAll(":scope > [data-message-scroller-item]")];
      return {
        domNodes: document.getElementsByTagName("*").length,
        transcriptNodes: content.getElementsByTagName("*").length,
        turns: items.filter((item) => item.dataset.scrollAnchor === "true").length,
        items: items.length,
        boxes: items.filter((item) => item.hasAttribute("data-placeholder")).length,
        scrollHeight: view.scrollHeight,
      };
    },
    where() {
      const view = viewport();
      return {
        scrollTop: view.scrollTop,
        // OlderTurns stands above the first turn while there are older ones.
        hasOlder: !view
          .querySelector("[data-slot=message-scroller-content]")
          .firstElementChild?.hasAttribute("data-message-scroller-item"),
      };
    },
    setZoom(zoom) {
      const root = [...document.querySelectorAll("div[style]")].find((element) =>
        element.style.getPropertyValue("--app-zoom"),
      );
      root?.style.setProperty("--app-zoom", String(zoom));
    },
    async toEnd() {
      const view = viewport();
      view.scrollTop = view.scrollHeight;
      await frames(3);
    },
    /**
     * Steps the view by 'fraction' of its height to the far end in 'direction',
     * a few frames apart, and lists every step after which the row in the
     * middle of the view was not where the step put it.
     */
    async stepThrough(direction, fraction) {
      const view = viewport();
      const scale = scaleOf(view);
      const misses = [];
      let steps = 0;
      for (;;) {
        const before = middleRow(view);
        const from = view.scrollTop;
        view.scrollTop = from + direction * fraction * view.clientHeight;
        const moved = view.scrollTop - from;
        if (Math.abs(moved) < 1) {
          break;
        }
        steps += 1;
        await frames(3);
        if (before && before.row.isConnected) {
          const off = before.row.getBoundingClientRect().top - (before.top - moved * scale);
          if (Math.abs(off) > 1) {
            misses.push({ at: Math.round(from), px: Math.round(off) });
          }
        }
      }
      return { steps, misses: misses.length, worst: misses.sort((a, b) => Math.abs(b.px) - Math.abs(a.px)).slice(0, 5) };
    },
    // The transcript debug page's trace (use-scroll-trace.ts): a move with no
    // input from the reader, or the end slipping out of view while followed.
    trace: {
      start() {
        const view = viewport();
        trace.events = [];
        let lastInput = -Infinity;
        const onInput = () => { lastInput = performance.now(); };
        const inputs = ["wheel", "pointerdown", "keydown", "touchmove"];
        for (const type of inputs) view.addEventListener(type, onInput, { passive: true });
        let reference;
        let behind;
        let frame = 0;
        const check = (afterResize) => {
          const mode = view.dataset.scrollMode ?? "";
          const sliding = view.closest("[data-slot=message-scroller]")?.hasAttribute("data-sliding");
          if (performance.now() - lastInput < 400 || sliding) {
            reference = undefined;
            return;
          }
          const viewTop = view.getBoundingClientRect().top;
          const items = [...view.querySelectorAll("[data-message-scroller-item]")];
          const anchor = mode === "anchor" ? items.filter((item) => item.matches("[data-scroll-anchor=true]")).at(-1) : undefined;
          const element = anchor ?? items.find((item) => item.getBoundingClientRect().bottom > viewTop);
          if (element) {
            const top = element.getBoundingClientRect().top - viewTop;
            if (reference?.element === element) {
              const delta = Math.round(top - reference.top);
              if (mode === "follow" ? delta > 1 : Math.abs(delta) > 1) {
                trace.events.push({ kind: mode === "follow" ? "jumped" : "moved", mode, px: delta });
              }
            }
            reference = { element, top };
          }
          const gap = Math.round(view.scrollHeight - view.clientHeight - view.scrollTop);
          const height = view.scrollHeight;
          if (afterResize && mode === "follow" && gap > 1) behind = { height };
        };
        const confirm = () => {
          frame = requestAnimationFrame(confirm);
          const pending = behind;
          behind = undefined;
          if (!pending || view.scrollHeight !== pending.height) return;
          const gap = Math.round(view.scrollHeight - view.clientHeight - view.scrollTop);
          if ((view.dataset.scrollMode ?? "") === "follow" && gap > 1) {
            trace.events.push({ kind: "behind", mode: "follow", px: gap });
          }
        };
        frame = requestAnimationFrame(confirm);
        const content = view.querySelector("[data-slot=message-scroller-content]");
        const resizes = new ResizeObserver(() => check(true));
        const onScroll = () => check(false);
        resizes.observe(view);
        resizes.observe(content);
        view.addEventListener("scroll", onScroll, { passive: true });
        trace.stop = () => {
          cancelAnimationFrame(frame);
          resizes.disconnect();
          view.removeEventListener("scroll", onScroll);
          for (const type of inputs) view.removeEventListener(type, onInput);
        };
      },
      stop() {
        trace.stop?.();
        return { count: trace.events.length, events: trace.events.slice(0, 10) };
      },
    },
  };
})()`;
