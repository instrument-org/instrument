// The fades are real stylesheet rules on a real scroll timeline, and whether
// one is drawn is a question of measured layout, so only a real browser can
// answer it. `setup-browser.ts` runs `watchScrollFades` as the app does.
import { afterEach, expect, it } from "vitest";

const rows = (count: number) =>
  Array.from(
    { length: count },
    (_, i) => `<div style="height:20px;line-height:20px">${i}</div>`,
  ).join("");

let scroller: HTMLDivElement;

afterEach(() => {
  scroller.remove();
});

const mount = (className: string, html: string) => {
  scroller = document.createElement("div");
  scroller.className = className;
  scroller.style.maxHeight = "100px";
  scroller.style.width = "100px";
  scroller.innerHTML = html;
  document.body.append(scroller);
  return scroller;
};

const fadeTop = () =>
  getComputedStyle(scroller).getPropertyValue("--scroll-fade-top");

it("marks a scroller only while it overflows, as rows come and go", async () => {
  mount("overflow-y-auto scroll-fade-y", rows(2));
  await expect.poll(() => scroller.hasAttribute("data-overflow-y")).toBe(false);

  scroller.insertAdjacentHTML("beforeend", rows(20));
  await expect.poll(() => scroller.hasAttribute("data-overflow-y")).toBe(true);

  scroller.replaceChildren();
  await expect.poll(() => scroller.hasAttribute("data-overflow-y")).toBe(false);
});

it("drops the top fade of a scroller that stops overflowing", async () => {
  mount("overflow-y-auto scroll-fade-y", `<div style="height:400px"></div>`);
  await expect.poll(() => scroller.hasAttribute("data-overflow-y")).toBe(true);
  scroller.scrollTop = 300;
  await expect.poll(fadeTop).toBe("24px");

  // A child shrinking, not one leaving: only its size says so.
  (scroller.firstElementChild as HTMLElement).style.height = "50px";
  await expect.poll(fadeTop).toBe("0px");
});

it("marks a scroller that takes the class after it is in the document", async () => {
  mount("overflow-y-auto", rows(20));
  scroller.classList.add("scroll-fade-y");
  await expect.poll(() => scroller.hasAttribute("data-overflow-y")).toBe(true);
  scroller.classList.remove("scroll-fade-y");
  await expect.poll(() => scroller.hasAttribute("data-overflow-y")).toBe(false);
});

it("measures text written straight into a scroller", async () => {
  mount("overflow-y-auto scroll-fade-y", "short");
  await expect.poll(() => scroller.hasAttribute("data-overflow-y")).toBe(false);
  scroller.firstChild!.nodeValue = "a long line of words ".repeat(40);
  await expect.poll(() => scroller.hasAttribute("data-overflow-y")).toBe(true);
});

it("marks a scroller across with scroll-fade-x", async () => {
  mount(
    "overflow-x-auto scroll-fade-x whitespace-nowrap",
    "a line far wider than the box it is in",
  );
  await expect.poll(() => scroller.hasAttribute("data-overflow-x")).toBe(true);
  expect(scroller.hasAttribute("data-overflow-y")).toBe(false);
});
