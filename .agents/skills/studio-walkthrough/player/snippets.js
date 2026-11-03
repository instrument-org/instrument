// The snippets page: a loop per chapter, each one thing happening, playing
// as it comes into view.
import { createEngine } from "./engine.js";

/** `title` and `lede` head the page; `alone` drops the links to a chapters page beside it. */
export function mountSnippets(app, data, { alone = false, lede, title } = {}) {
const esc = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;");
app.innerHTML = `${title ? `<header class="pb-head"><h1>${esc(title)}</h1>${lede ? `<p>${esc(lede)}</p>` : ""}</header>` : ""}<div class="pb" id="grid"></div>`;
const grid = document.getElementById("grid");
const engines = [];
for (const [i, c] of data.chapters.entries()) {
  const card = document.createElement("figure");
  card.className = "pb-card";
  card.innerHTML = `<div class="pb-stage"><img class="pb-poster" src="${c.still}" alt=""></div><figcaption><b>${c.title}</b><span>${c.caption}</span>${alone ? "" : `<a href="chapters.html#chapter=${i + 1}">Watch in the full walkthrough</a>`}</figcaption>`;
  grid.append(card);
  const stage = card.querySelector(".pb-stage");
  let engine = null;
  const io = new IntersectionObserver(([e]) => {
    if (e.isIntersecting) {
      if (!engine) {
        const host = document.createElement("div");
        host.className = "pb-host";
        stage.prepend(host);
        engine = createEngine(host, data, { mode: "snippet", loop: true, range: { from: c.from, to: c.to }, captions: false });
        engines.push(engine);
      }
      engine.play();
      card.classList.add("live");
    } else engine?.pause();
  }, { threshold: 0.4 });
  io.observe(card);
}
}
