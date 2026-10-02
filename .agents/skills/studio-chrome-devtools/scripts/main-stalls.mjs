#!/usr/bin/env node
// Measures how late Studio's main-process event loop runs, through the V8
// inspector `studio-drive.mjs boot --inspect <port>` opens. Main is the thread
// a keystroke and a paste's clipboard read both wait on, so a stall here is
// input the window takes late, whatever the renderer is doing. Nothing is
// driven: it is safe while someone is using the machine.
//
//   node main-stalls.mjs --port 9339 --seconds 15
//   node main-stalls.mjs --port 9339 --seconds 15 --profile main.cpuprofile
//
// Reports the event-loop delay percentiles, how many stalls passed 30, 60 and
// 120 ms, and the worst ones with when they happened. With `--profile`, a CPU
// profile of the same window is written for DevTools' Performance panel.
//
// A dictation tool that pastes and restores the clipboard after 60 ms loses
// text whenever main stalls past about 40 ms, since the key takes about 20 ms
// to reach the page on a quiet thread.

import { writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1];
};
const port = Number(flag("--port", "9229"));
const seconds = Number(flag("--seconds", "10"));
const profilePath = flag("--profile");

const targets = await fetch(`http://127.0.0.1:${port}/json/list`)
  .then((response) => response.json())
  .catch(() => {
    console.error(
      `main-stalls: nothing answers on ${port}. Boot with \`studio-drive.mjs boot --inspect ${port} --purpose <purpose>\`.`,
    );
    process.exit(1);
  });
const socket = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise((resolve) => {
  socket.addEventListener("open", resolve);
});

let nextId = 0;
function send(method, params) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) {
        return;
      }
      socket.removeEventListener("message", onMessage);
      if (message.error) {
        reject(new Error(message.error.message));
      } else {
        resolve(message.result);
      }
    };
    socket.addEventListener("message", onMessage);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const { exceptionDetails, result } = await send("Runtime.evaluate", {
    awaitPromise: true,
    expression,
    returnByValue: true,
  });
  if (exceptionDetails) {
    throw new Error(
      exceptionDetails.exception?.description ?? "evaluation failed",
    );
  }
  return result.value;
}

// A 5 ms timer that records how late each tick ran, plus Node's own
// event-loop delay histogram. Installed fresh each run and removed after.
await evaluate(`(() => {
  globalThis.__mainStalls?.stop();
  const { monitorEventLoopDelay, performance } = process.getBuiltinModule("node:perf_hooks");
  const histogram = monitorEventLoopDelay({ resolution: 5 });
  histogram.enable();
  const stalls = [];
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    const late = now - last - 5;
    if (late > 15) {
      stalls.push({ at: Date.now() - late, late: Math.round(late) });
    }
    last = now;
  }, 5);
  globalThis.__mainStalls = {
    read() {
      const ms = (value) => Math.round(value / 1e5) / 10;
      return {
        max: ms(histogram.max),
        p50: ms(histogram.percentile(50)),
        p90: ms(histogram.percentile(90)),
        p99: ms(histogram.percentile(99)),
        stalls,
      };
    },
    stop() {
      clearInterval(timer);
      histogram.disable();
    },
  };
})()`);

if (profilePath) {
  await send("Profiler.enable");
  await send("Profiler.setSamplingInterval", { interval: 500 });
  await send("Profiler.start");
}
const startedAt = Date.now();
await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
if (profilePath) {
  const { profile } = await send("Profiler.stop");
  writeFileSync(profilePath, JSON.stringify(profile));
}
const reading = await evaluate(
  "(() => { const r = globalThis.__mainStalls.read(); globalThis.__mainStalls.stop(); delete globalThis.__mainStalls; return r; })()",
);
socket.close();

const over = (ms) => reading.stalls.filter((stall) => stall.late > ms).length;
console.log(
  JSON.stringify(
    {
      eventLoopDelayMs: {
        max: reading.max,
        p50: reading.p50,
        p90: reading.p90,
        p99: reading.p99,
      },
      ...(profilePath && { profile: profilePath }),
      seconds,
      stallsOver: { 120: over(120), 30: over(30), 60: over(60) },
      stalledMs: reading.stalls.reduce((sum, stall) => sum + stall.late, 0),
      worst: reading.stalls
        .toSorted((a, b) => b.late - a.late)
        .slice(0, 5)
        .map((stall) => ({
          atSeconds: Math.round((stall.at - startedAt) / 100) / 10,
          lateMs: stall.late,
        })),
    },
    undefined,
    2,
  ),
);
