// The chapters page: one player, the whole walkthrough, with its chapters
// beside it.
import { createEngine } from "./engine.js";

const fmt = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

export function mountChapters(app, data) {
app.innerHTML = `
  <div class="pa">
    <div class="pa-main">
      <div class="pa-stage" id="stage"></div>
      <div class="pa-bar">
        <button class="pa-play" id="play" aria-label="Play">▶</button>
        <div class="pa-track" id="track"><div class="pa-fill" id="fill"></div><div class="pa-head" id="head"></div></div>
        <span class="pa-time" id="time">0:00</span>
        <select id="speed" aria-label="Speed"><option value="1">1×</option><option value="1.5">1.5×</option><option value="2">2×</option></select>
        <button class="pa-btn" id="still" title="Open this moment as its own page, live HTML you can inspect or hand to an agent">Open this moment</button>
      </div>
    </div>
    <ol class="pa-chapters" id="chapters"></ol>
  </div>`;

const engine = createEngine(document.getElementById("stage"), data, { mode: "full" });
const track = document.getElementById("track");
const total = engine.length;
const chapterStarts = data.chapters.map((c) => engine.toPres(c.from));
for (const [i, c] of data.chapters.entries()) {
  const tick = document.createElement("div");
  tick.className = "pa-tick";
  tick.style.left = `${(chapterStarts[i] / total) * 100}%`;
  track.append(tick);
  const li = document.createElement("li");
  li.innerHTML = `<button><img src="${c.still}" alt=""><span><b>${c.title}</b><small>${c.caption}</small><em>${fmt(chapterStarts[i])}</em></span></button>`;
  li.querySelector("button").onclick = () => { engine.seekPres(chapterStarts[i] + 1); engine.play(); };
  document.getElementById("chapters").append(li);
}
const items = [...document.querySelectorAll("#chapters li")];
engine.on(({ p, playing }) => {
  document.getElementById("fill").style.width = `${(p / total) * 100}%`;
  document.getElementById("head").style.left = `${(p / total) * 100}%`;
  document.getElementById("time").textContent = `${fmt(p)} / ${fmt(total)}`;
  document.getElementById("play").textContent = playing ? "❚❚" : "▶";
  const at = chapterStarts.findLastIndex((s) => s <= p + 2);
  items.forEach((li, i) => li.classList.toggle("on", i === at));
});
document.getElementById("play").onclick = () => engine.toggle();
document.getElementById("speed").onchange = (e) => engine.setSpeed(Number(e.target.value));
const scrub = (e) => { const b = track.getBoundingClientRect(); engine.seekPres(((e.clientX - b.left) / b.width) * total); };
track.addEventListener("pointerdown", (e) => { scrub(e); track.setPointerCapture(e.pointerId); track.onpointermove = scrub; });
track.addEventListener("pointerup", () => { track.onpointermove = null; });
/** The replay's page at this moment as a page of its own, without the replay's own marks. */
const momentHtml = () => {
  const doc = new DOMParser().parseFromString(engine.stillHtml(), "text/html");
  for (const n of doc.querySelectorAll("noscript")) n.remove();
  for (const el of doc.querySelectorAll(".rrweb-paused, [class*=':hover']")) {
    el.classList.remove("rrweb-paused", ":hover");
  }
  return "<!doctype html>\n" + doc.documentElement.outerHTML;
};
document.getElementById("still").onclick = () => {
  const url = URL.createObjectURL(new Blob([momentHtml()], { type: "text/html" }));
  // A window that refuses new tabs gets the file instead.
  if (!window.open(url, "_blank")) {
    const a = document.createElement("a");
    a.href = url;
    a.download = `moment-${fmt(engine.state().p).replace(":", "m")}s.html`;
    a.click();
  }
};
addEventListener("keydown", (e) => {
  if (e.key === " ") { e.preventDefault(); engine.toggle(); }
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    const p = engine.state().p;
    const i = chapterStarts.findLastIndex((s) => s <= p + 2) + (e.key === "ArrowRight" ? 1 : -1);
    if (chapterStarts[i] !== undefined) engine.seekPres(chapterStarts[i] + 1);
  }
});
const start = Number(new URLSearchParams(location.hash.slice(1)).get("chapter"));
if (start) engine.seekPres(chapterStarts[start - 1] + 1);
}
