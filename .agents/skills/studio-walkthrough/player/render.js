// The render page: the engine on a fixed 1920x1080 page, stepped by the
// renderer one frame at a time.
import { createEngine } from "./engine.js";

export function mountRender(data) {
const q = new URLSearchParams(location.search);
const chapter = Number(q.get("chapter") || 0);
const range = chapter ? { from: data.chapters[chapter - 1].from, to: data.chapters[chapter - 1].to } : undefined;
const bare = q.get("bare") === "1";
const { w, h } = data.viewport;
document.body.style.cssText = bare
  ? `margin:0;background:#000;width:${w}px;height:${h}px;overflow:hidden`
  : "margin:0;background:radial-gradient(120% 90% at 50% 0%, #1f2a25 0%, #0d0f0e 60%);width:1920px;height:1080px;overflow:hidden";
const stage = document.createElement("div");
// The app at its own 1240x840, scaled to 1.2 and centered in a 1080p frame.
stage.style.cssText = bare
  ? `position:absolute;left:0;top:0;width:${w}px;height:${h}px`
  : `position:absolute;left:${(1920 - w * 1.2) / 2}px;top:${(1080 - h * 1.2) / 2}px;width:${w * 1.2}px;height:${h * 1.2}px;border-radius:12px;box-shadow:0 30px 80px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.08)`;
if (bare) document.head.insertAdjacentHTML("beforeend", "<style>.wt-fit{border-radius:0!important}</style>");
document.body.append(stage);
const engine = createEngine(stage, data, { mode: "render", range, captions: q.get("captions") !== "0", camera: q.get("camera") !== "0" });
window.renderInfo = { length: engine.length }; window.engine = engine;
window.renderAt = (p) => { engine.seekPres(p); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); };
}
