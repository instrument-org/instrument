// A studio-drive sequence (`studio-drive.mjs run`) that puts a booted Studio into each
// state a wireframe may start from and keeps it as a snapshot: the page's own DOM and
// styles (the walkthrough skill's still), its picture, and its outline, the names
// `studio-drive snapshot` prints. library.mjs turns those into the library snap() reads.
// Taken at 1280x800 and 1x, in presentation mode, with the developer strip hidden, in
// each theme a state asks for.
//
// args: { out, folder, chats: { pricing, soc2, board, renewal }, only?: string[] }
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const IN_PAGE = fs.readFileSync(path.join(here, "../../skills/studio-walkthrough/scripts/in-page.js"), "utf8");
const wait = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/** Notices for the bell, as the main process would hand them over: an update and one from the feed. */
const NOTICES = (/** @type {number} */ now) => [
  {
    action: { href: "/release-notes?since=2.0.0-beta.128", label: "What's new" },
    body: "See what's changed since version 2.0.0-beta.128.",
    id: `updated-${now}`,
    kind: "update",
    publishedAt: new Date(now - 4 * 60_000).toISOString(),
    seen: false,
    severity: "info",
    title: "Instrument updated to 2.0.0-beta.129",
  },
  {
    body: "Chats can now be filed under projects, each with its own instructions.",
    id: "feed-projects",
    kind: "whats-new",
    publishedAt: new Date(now - 26 * 3600_000).toISOString(),
    seen: true,
    severity: "info",
    title: "Projects are here",
  },
];

/**
 * Puts notices in the renderer's query cache, where the bell reads them, by finding the
 * QueryClient on React's tree. The notices come from the API, which a clean room may not
 * reach, and the store they live in is shared with the developer's own instance.
 */
const injectNotices = (/** @type {any} */ notices) => `(() => {
  const host = document.getElementById('root') ?? document.body.firstElementChild;
  const key = Object.keys(host).find((k) => k.startsWith('__reactContainer$'));
  let fiber = host[key]?.stateNode?.current ?? host[key];
  const seen = new Set();
  const stack = [fiber];
  let client = null;
  while (stack.length && !client) {
    const f = stack.pop();
    if (!f || seen.has(f)) continue;
    seen.add(f);
    const c = f.memoizedProps?.client;
    if (c && typeof c.getQueryCache === 'function') client = c;
    if (f.child) stack.push(f.child);
    if (f.sibling) stack.push(f.sibling);
  }
  if (!client) return 'no QueryClient';
  const hits = client.getQueryCache().findAll().filter((q) => JSON.stringify(q.queryKey).includes('notices') && JSON.stringify(q.queryKey).includes('list'));
  for (const q of hits) client.setQueryData(q.queryKey, ${JSON.stringify(notices)});
  return hits.length + ' queries';
})()`;

/** Each state, by name: how to get there from a window with one tab and nothing open. */
const STATES = {
  chat: { themes: ["light", "dark"], run: async (h) => h.go(`/chats/${h.chats.pricing}`, 1400) },
  "chat-plus-menu": {
    themes: ["light"],
    run: async (h) => {
      await h.go(`/chats/${h.chats.pricing}`, 1200);
      await h.app.click({ selector: 'button[aria-label="Add to this prompt"]' });
    },
  },
  "chat-view-options": {
    themes: ["light"],
    run: async (h) => {
      await h.go(`/chats/${h.chats.pricing}`, 1200);
      await h.app.click({ selector: 'button[aria-label="View options"]' });
      await wait(400);
    },
  },
  "chat-search": {
    themes: ["light"],
    run: async (h) => {
      await h.go(`/chats/${h.chats.pricing}`, 1200);
      await h.app.click({ selector: '[role=combobox][aria-label="Search chats"]' });
      await h.app.type("pricing");
      await wait(700);
      h.after(async () => {
        await h.app.click({ selector: '[role=combobox][aria-label="Search chats"]' });
        await h.app.eval(`(() => { const e = document.querySelector('[role=combobox][aria-label="Search chats"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(e, ''); e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      });
    },
  },
  "chat-drafts": {
    themes: ["light"],
    run: async (h) => {
      await h.go(`/chats/${h.chats.pricing}`, 1200);
      await h.app.click({ selector: '[role=tablist][aria-label="Places"] [role=tab]', text: "Drafts" });
      await wait(500);
      h.after(() => h.app.click({ selector: '[role=tablist][aria-label="Places"] [role=tab]', text: "Inbox" }));
    },
  },
  apps: { themes: ["light"], run: async (h) => h.go("/apps", 1400) },
  draft: {
    themes: ["light"],
    run: async (h) => {
      await h.go(`/chats/${h.chats.pricing}`, 1200);
      await h.app.click({ selector: 'nav button[aria-label="New"]' });
      await wait(500);
    },
  },
  "draft-over-files": {
    themes: ["light"],
    run: async (h) => {
      await h.files("Table view");
      await h.app.click({ selector: 'nav button[aria-label="New"]' });
      await wait(500);
    },
  },
  "bell-update": {
    themes: ["light", "dark"],
    run: async (h) => {
      await h.go(`/chats/${h.chats.pricing}`, 1200);
      await h.app.eval(injectNotices(NOTICES(Date.now())));
      await wait(300);
      await h.app.click({ selector: 'button[aria-label^="Notifications"]' });
      await wait(500);
      await h.app.eval(injectNotices(NOTICES(Date.now())));
    },
  },
  feedback: {
    themes: ["light", "dark"],
    run: async (h) => {
      await h.go(`/chats/${h.chats.pricing}`, 1200);
      await h.app.click({ text: "Feedback", selector: 'nav[aria-label="Places"] button' });
      await wait(500);
    },
  },
  "files-table": { themes: ["light", "dark"], run: async (h) => h.files("Table view", "pricing-comparison.html") },
  "files-list": { themes: ["light"], run: async (h) => h.files("List view", "pricing-comparison.html") },
  "files-grid": { themes: ["light", "dark"], run: async (h) => h.files("Grid view", "pricing-comparison.html") },
  "files-context-menu": {
    themes: ["light"],
    run: async (h) => {
      await h.files("Table view", "pricing-comparison.html");
      await h.app.click({ text: "pricing-comparison.html" }, "row", { button: "right" });
      await wait(400);
    },
  },
  "files-info": {
    themes: ["light", "dark"],
    run: async (h) => {
      await h.files("Table view", "pricing-comparison.html");
      await h.app.click({ text: "pricing-comparison.html" }, "row", { button: "right" });
      await wait(400);
      await h.app.click({ text: "Info ⌘I" });
      await wait(700);
    },
  },
  "files-beside": {
    themes: ["light"],
    run: async (h) => h.go(`/files?file=${encodeURIComponent(`${h.folder}/pricing-comparison.html`)}&path=&root=${encodeURIComponent(h.folder)}`, 1800),
  },
  "image-fit": {
    themes: ["light", "dark"],
    run: async (h) => h.go(`/files?file=${encodeURIComponent(`${h.folder}/Screenshots/harbor-desk-pricing.png`)}&path=Screenshots&root=${encodeURIComponent(h.folder)}`, 1800),
  },
  "image-zoom-menu": {
    themes: ["light", "dark"],
    run: async (h) => {
      await h.go(`/files?file=${encodeURIComponent(`${h.folder}/Screenshots/harbor-desk-pricing.png`)}&path=Screenshots&root=${encodeURIComponent(h.folder)}`, 1800);
      await h.app.click({ selector: 'button[aria-label^="Zoom"]' });
      await wait(400);
    },
  },
  "quick-look": {
    themes: ["light", "dark"],
    run: async (h) => {
      await h.app.goto(`/files?path=Screenshots&root=${encodeURIComponent(h.folder)}&select=${encodeURIComponent("harbor-desk-pricing.png")}`);
      await wait(1000);
      await h.app.click({ text: "Table view" });
      await wait(400);
      await h.app.click({ text: "harbor-desk-pricing.png" });
      await h.app.press(" ");
      await wait(900);
    },
  },
  "browser-page": {
    themes: ["light"],
    run: async (h) => {
      await h.go("/browser");
      await h.app.eval(`document.querySelector('[role=combobox]').focus()`);
      await h.app.type("https://example.com");
      await h.app.press("Enter");
      await wait(2500);
    },
  },
  "browser-find": {
    themes: ["light", "dark"],
    run: async (h) => {
      await h.go("/browser");
      await h.app.eval(`document.querySelector('[role=combobox]').focus()`);
      await h.app.type("https://example.com");
      await h.app.press("Enter");
      await wait(2500);
      // ⌘F belongs to the menu bar, which CDP cannot reach; the More menu has the same item.
      await h.app.click({ selector: 'button[aria-label="More actions"]' });
      await wait(300);
      await h.app.click({ text: "Find in page ⌘F" });
      await wait(400);
      await h.app.type("domain");
      await wait(800);
    },
  },
  "new-tab": { themes: ["light"], run: async (h) => h.go("/new-tab") },
  settings: {
    themes: ["light"],
    run: async (h) => {
      await h.go(`/chats/${h.chats.pricing}`, 900);
      await h.app.openModal("settings");
      await wait(700);
    },
  },
};

export default async (app, args) => {
  const out = args.out;
  fs.mkdirSync(path.join(out, "raw"), { recursive: true });
  const done = [];
  const afters = [];
  const h = {
    app,
    chats: args.chats,
    folder: args.folder,
    after: (fn) => afters.push(fn),
    go: async (href, ms = 900) => {
      await app.goto(href);
      await wait(ms);
    },
    files: async (view, select) => {
      await app.goto(`/files?path=&root=${encodeURIComponent(h.folder)}${select ? `&select=${encodeURIComponent(select)}` : ""}`);
      await wait(1000);
      await app.click({ text: view });
      await wait(400);
    },
    oneTab: async () => {
      for (let i = 0; i < 20; i++) {
        const count = await app.eval(`document.querySelectorAll('[role=tablist][aria-label="Open tabs"] [role=tab]').length`);
        if (count <= 1) break;
        await app.click({ selector: '[role=tab][aria-selected=true] button[aria-label^="Close"]' });
        await wait(250);
      }
    },
  };
  const hideDevChrome = () =>
    app.eval(`(() => {
      for (const strip of document.querySelectorAll('[data-developer-strip]')) strip.setAttribute('data-snap-drop', '');
    })()`);
  // What a reader never sees goes, so a page's text holds only what its frames show.
  // Inside an <svg> nothing is dropped: a sprite's symbols draw only where they are used.
  const markDrop = () =>
    app.eval(`(() => {
      let n = 0;
      for (const el of document.body.querySelectorAll('*')) {
        if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
        if (el.closest('[data-snap-drop]') !== el && el.closest('[data-snap-drop]')) continue;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const srOnly = cs.position === 'absolute' && r.width <= 1 && r.height <= 1 && cs.overflow === 'hidden';
        if (cs.display === 'none' || srOnly) { el.setAttribute('data-snap-drop', ''); n++; }
      }
      return n;
    })()`);

  // The pricing and SOC 2 chats filed under projects, so the list shows its project pills.
  // The walkthrough seed has no projects, so they are made here when the room lacks them.
  const projects = await app.rpc("workspace.projects.list", {});
  for (const [name, emoji, chat] of [
    ["Pricing", "💼", args.chats.pricing],
    ["Security reviews", "🛡️", args.chats.soc2],
  ]) {
    const project = projects.find((p) => p.name === name) ?? (await app.rpc("workspace.projects.create", { name, emoji }));
    await app.rpc("workspace.chats.setProject", { id: chat, project: project.id });
  }

  await app.eval(IN_PAGE);
  await app.eval("window.__walkthroughPage.watchPictures()");
  await app.eval(`window.__walkthroughPage.present(${JSON.stringify({ rootCrumb: path.basename(h.folder) })})`);
  const before = await app.rpc("preferences.get");
  await app.cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await wait(800);
  for (const [name, state] of Object.entries(STATES)) {
    if (args.only && !args.only.includes(name)) continue;
    for (const theme of state.themes) {
      const key = theme === "light" ? name : `${name}.dark`;
      try {
        await app.rpc("preferences.setTheme", { theme });
        await app.press("Escape");
        await app.press("Escape");
        await app.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 700, y: 640 });
        await h.oneTab();
        if (await app.eval(`!!document.querySelector('button[aria-label="Discard draft"]')`)) await app.click({ selector: 'button[aria-label="Close"]' });
        await wait(300);
        await hideDevChrome();
        await state.run(h);
        await wait(700);
        await hideDevChrome();
        await app.eval(`window.__walkthroughPage.present(${JSON.stringify({ rootCrumb: path.basename(h.folder) })})`);
        await wait(200);
        await app.shot(path.join(out, "raw", `${key}.png`));
        const outline = await app.snapshot({ depth: 14 });
        fs.writeFileSync(path.join(out, "raw", `${key}.outline.txt`), typeof outline === "string" ? outline : JSON.stringify(outline, null, 1));
        await markDrop();
        // A page in the in-app browser runs in a process of its own, outside this DOM, so
        // each one is kept as a picture of the box it fills, and library.mjs draws that
        // picture where the page was.
        const guests = await app.eval(`[...document.querySelectorAll('webview, iframe')].map((el, i) => {
          el.setAttribute('data-snap-guest', String(i));
          const r = el.getBoundingClientRect();
          return { i, x: r.x, y: r.y, width: r.width, height: r.height, shown: getComputedStyle(el).visibility !== 'hidden' };
        }).filter((g) => g.shown && g.width > 4 && g.height > 4)`);
        const pictures = {};
        for (const g of guests) {
          const { data } = await app.cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 82, clip: { x: g.x, y: g.y, width: g.width, height: g.height, scale: 1 } });
          pictures[g.i] = `data:image/jpeg;base64,${data}`;
        }
        if (guests.length) fs.writeFileSync(path.join(out, "raw", `${key}.guests.json`), JSON.stringify(pictures));
        const html = await app.eval("window.__walkthroughPage.still()");
        fs.writeFileSync(path.join(out, "raw", `${key}.html`), html);
        await app.eval(`document.querySelectorAll('[data-snap-drop],[data-snap-guest]').forEach((e) => { e.removeAttribute('data-snap-drop'); e.removeAttribute('data-snap-guest'); })`);
        done.push(`${key} ${Math.round(html.length / 1024)} KB`);
      } catch (error) {
        done.push(`${key} FAILED: ${String(error instanceof Error ? error.message : error).slice(0, 240)}`);
      }
      for (const fn of afters.splice(0)) await Promise.resolve(fn()).catch(() => {});
    }
  }
  if (before?.theme) await app.rpc("preferences.setTheme", { theme: before.theme });
  await app.cdp.send("Emulation.clearDeviceMetricsOverride");
  return done;
};
