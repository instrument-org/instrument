// A contact sheet of a built take: a frame every few seconds of the finished
// cut, each stamped with its time, on one image to look over before anything
// is shared. A stray window, a click that missed, or a camera framing the
// wrong thing shows up here at a glance.

import path from "node:path";

import { launch, sizedPage } from "./browser.mjs";

export async function filmTake(take, { every = 2000, out } = {}) {
  const sheet = out ?? path.join(take, "contact-sheet.png");
  const browser = await launch();
  const { capture, page } = await sizedPage(browser, {
    height: 1080,
    scale: 0.5,
    width: 1920,
  });
  await page.goto(`file://${path.join(take, "render.html")}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(() => window.renderInfo);
  const { length } = await page.evaluate(() => window.renderInfo);
  const frames = [];
  for (let p = 0; p <= length; p += every) {
    await page.evaluate((at) => window.renderAt(at), p);
    await page.waitForTimeout(200);
    const jpeg = await capture(null, { format: "jpeg", quality: 82 });
    frames.push({ p, src: `data:image/jpeg;base64,${jpeg.toString("base64")}` });
  }
  await page.close();

  const columns = 5;
  const sheetPage = await browser.newPage({
    deviceScaleFactor: 1,
    viewport: { height: 600, width: columns * 486 + 12 },
  });
  await sheetPage.setContent(`<!doctype html><body style="margin:0;background:#101211">
<div style="display:grid;grid-template-columns:repeat(${columns},480px);gap:6px;padding:6px">
${frames
  .map(
    (f) =>
      `<figure style="margin:0;position:relative"><img src="${f.src}" style="width:480px;display:block"><span style="position:absolute;left:6px;top:4px;font:600 13px system-ui;color:#fff;background:#000b;padding:1px 6px;border-radius:4px">${Math.floor(f.p / 60000)}:${String(Math.round(f.p / 1000) % 60).padStart(2, "0")}</span></figure>`,
  )
  .join("\n")}
</div></body>`);
  await sheetPage.screenshot({ fullPage: true, path: sheet });
  await browser.close();
  return { frames: frames.length, lengthMs: Math.round(length), sheet };
}
