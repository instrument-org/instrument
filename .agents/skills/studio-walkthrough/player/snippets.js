// The snippets page: a loop per chapter, each one thing happening, playing
// as it comes into view. A clip opens large on a click, with its captions,
// and the arrow keys step through the others.
import { createEngine } from "./engine.js";

/**
 * @typedef {import("./types").Take} Take
 * @typedef {import("./types").Engine} Engine
 * @typedef {{ card: HTMLElement, engine: Engine | null, visible: boolean }} Card
 */

/** @param {string} text */
const esc = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/**
 * @param {HTMLElement} app
 * @param {Take} data
 * @param {{ alone?: boolean, lede?: string, title?: string }} [options] `title` and `lede` head the page; `alone` drops the links to a chapters page beside it.
 */
export function mountSnippets(app, data, { alone = false, lede, title } = {}) {
  const head = title
    ? `<header class="pb-head"><h1>${esc(title)}</h1>${lede ? `<p>${esc(lede)}</p>` : ""}</header>`
    : "";
  app.innerHTML = `${head}<div class="pb"></div>`;
  const grid = /** @type {HTMLElement} */ (app.querySelector(".pb"));
  /** @type {Card[]} */
  const cards = [];
  /** The clip open large, by its chapter, and its player. */
  /** @type {number | null} */
  let shown = null;
  /** @type {Engine | null} */
  let big = null;

  for (const [i, c] of data.chapters.entries()) {
    const card = document.createElement("figure");
    card.className = "pb-card";
    const link = alone
      ? ""
      : `<a href="chapters.html#chapter=${String(i + 1)}">Watch in the full walkthrough</a>`;
    card.innerHTML = `<button class="pb-stage" type="button" aria-label="Play “${esc(c.title)}” large"><img class="pb-poster" src="${c.still ?? ""}" alt=""><span class="pb-grow" aria-hidden="true"></span></button><figcaption><b>${esc(c.title)}</b><span>${esc(c.caption)}</span>${link}</figcaption>`;
    grid.append(card);
    const stage = /** @type {HTMLElement} */ (card.querySelector(".pb-stage"));
    /** @type {Card} */
    const entry = { card, engine: null, visible: false };
    cards.push(entry);
    stage.addEventListener("click", () => {
      open(i);
    });
    new IntersectionObserver(
      ([seen]) => {
        entry.visible = Boolean(seen?.isIntersecting);
        if (!entry.visible) {
          entry.engine?.pause();
          return;
        }
        if (!entry.engine) {
          const host = document.createElement("div");
          host.className = "pb-host";
          stage.prepend(host);
          entry.engine = createEngine(host, data, {
            captions: false,
            loop: true,
            mode: "snippet",
            range: { from: c.from, to: c.to },
          });
        }
        if (shown === null) entry.engine.play();
        card.classList.add("live");
      },
      { threshold: 0.4 },
    ).observe(card);
  }

  // --- one clip, large ---------------------------------------------------------
  const modal = document.createElement("div");
  modal.className = "pb-modal";
  modal.hidden = true;
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.innerHTML = `
    <div class="pb-modal-frame">
      <div class="pb-modal-stage"></div>
      <div class="pb-modal-bar">
        <button class="pb-step" data-step="-1" type="button" aria-label="Previous clip">‹</button>
        <div class="pb-modal-text"><b></b><span></span></div>
        <button class="pb-step" data-step="1" type="button" aria-label="Next clip">›</button>
        <button class="pb-close" type="button" aria-label="Close">✕</button>
      </div>
    </div>`;
  app.append(modal);
  /** @param {string} selector */
  const part = (selector) =>
    /** @type {HTMLElement} */ (modal.querySelector(selector));
  const modalStage = part(".pb-modal-stage");
  const previous = /** @type {HTMLButtonElement} */ (part('[data-step="-1"]'));
  const next = /** @type {HTMLButtonElement} */ (part('[data-step="1"]'));

  /** @param {number} index */
  function open(index) {
    const c = data.chapters[index];
    if (!c) return;
    big?.destroy();
    modalStage.replaceChildren();
    const host = document.createElement("div");
    host.className = "pb-modal-host";
    modalStage.append(host);
    modal.hidden = false;
    document.body.classList.add("pb-open");
    // The grid rests while one plays large.
    for (const entry of cards) entry.engine?.pause();
    const playing = createEngine(host, data, {
      loop: true,
      mode: "snippet",
      range: { from: c.from, to: c.to },
    });
    playing.play();
    big = playing;
    shown = index;
    part(".pb-modal-text b").textContent = c.title;
    part(".pb-modal-text span").textContent = c.caption;
    previous.disabled = index === 0;
    next.disabled = index === data.chapters.length - 1;
    part(".pb-close").focus({ preventScroll: true });
  }

  function close() {
    big?.destroy();
    big = null;
    shown = null;
    modal.hidden = true;
    modalStage.replaceChildren();
    document.body.classList.remove("pb-open");
    for (const entry of cards) if (entry.visible) entry.engine?.play();
  }

  /** @param {number} by */
  const step = (by) => {
    if (shown === null) return;
    open(Math.min(Math.max(shown + by, 0), data.chapters.length - 1));
  };
  modal.addEventListener("click", (event) => {
    const target = /** @type {Element} */ (event.target);
    const stepper = target.closest(".pb-step");
    if (stepper instanceof HTMLElement) step(Number(stepper.dataset.step));
    else if (target.closest(".pb-close") || target === modal) close();
  });
  modalStage.addEventListener("click", () => {
    big?.toggle();
  });
  addEventListener("keydown", (event) => {
    if (shown === null) return;
    if (event.key === "Escape") close();
    else if (event.key === "ArrowRight") step(1);
    else if (event.key === "ArrowLeft") step(-1);
    else if (event.key === " ") {
      event.preventDefault();
      big?.toggle();
    }
  });
}
