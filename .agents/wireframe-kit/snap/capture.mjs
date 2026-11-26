// A studio-drive sequence (`studio-drive.mjs run`) that puts a booted Studio into each
// state a wireframe may start from and keeps it as a snapshot: the page whole, as the
// wireframe skill's snapshot.js keeps any page, with the app's full stylesheets so a
// part can write new markup in the app's own classes, and with its picture and its
// outline, the names `studio-drive snapshot` prints. library.mjs turns those into the
// library snap() reads. Taken at 1280x800 and 1x, in presentation mode, with the
// developer strip left out, in each theme a state asks for.
//
// Run directly, it does the whole round for the states it names, or for every state
// when it names none, and leaves the library's other states as they are:
//
//   node .agents/wireframe-kit/snap/capture.mjs <state>...
//
// That puts the wf-pricing walkthrough seed back in its clean room, boots it off screen,
// runs this file in it through studio-drive, has library.mjs fold the new snapshots into
// the library, and stops the room. A new state is one entry in STATES below.
//
// As a sequence, args: { out, folder, chats: { pricing, soc2, board, renewal }, only?: string[] }
import fs from "node:fs";
import path from "node:path";

import { SKILL } from "../kit.mjs";

const here = import.meta.dirname;
const IN_PAGE = fs.readFileSync(path.join(here, "../../skills/studio-walkthrough/scripts/in-page.js"), "utf8");
const SNAPSHOT = fs.readFileSync(path.join(SKILL, "snapshot.js"), "utf8");
const wait = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The skill's snapshot of the page, then what Studio needs of it: what capture marked
 * unseen left out (the icon sprites kept, since every icon draws from them), each page
 * of the in-app browser, which runs outside this DOM, drawn as the picture taken of its
 * box, test ids renamed (content blockers hide anything whose `data-testid` starts with
 * "app", which is Studio's whole page), and the stylesheets the snapshot cut to what
 * this page uses swapped for the app's whole sheets, each kept as its own block so the
 * states share them. A part writes new markup in the app's classes, which a cut sheet
 * would not draw.
 *
 * A page of the in-app browser comes with its picture already in the slot that shows it
 * (`pictureGuests`), where it moves and resizes with its card when a part changes the
 * layout, so the box standing in for the page itself, and the pool's wrapper around it on
 * the body, go.
 */
const studioSnapshot = (/** @type {Record<string, string>} */ pictures) => `(async () => {
  const s = await (0, eval)(${JSON.stringify(SNAPSHOT)});
  const pictures = ${JSON.stringify(pictures)};
  const d = new DOMParser().parseFromString(s.html, "text/html");
  [...d.querySelectorAll("[data-snapshot-embed]")].forEach((box, i) => {
    if (d.querySelector('[data-snap-guest-host="' + i + '"] > [data-snap-guest-picture]')) {
      const wrapper = box.parentElement;
      box.remove();
      if (wrapper && wrapper.parentElement === d.body && !wrapper.children.length) wrapper.remove();
      return;
    }
    const picture = pictures[i];
    if (!picture) return box.remove();
    const img = d.createElement("img");
    img.src = picture;
    img.alt = "The page in the in-app browser, as it looked";
    img.className = box.className;
    img.setAttribute("style", box.getAttribute("style") + ";display:block;width:100%;height:100%;object-fit:cover;object-position:top left");
    box.replaceWith(img);
  });
  for (const el of d.querySelectorAll("[data-snap-guest-host]")) el.removeAttribute("data-snap-guest-host");
  for (const el of d.querySelectorAll("[data-snap-guest-static]")) el.removeAttribute("data-snap-guest-static");
  for (const el of d.querySelectorAll("[data-snap-guest-picture]")) el.removeAttribute("data-snap-guest-picture");
  // The icon sprites sit in hidden wrappers, so they come out of them first, still unshown.
  for (const svg of d.querySelectorAll("svg[data-icon-sprite]")) {
    svg.style.display = "none";
    d.body.append(svg);
  }
  for (const el of d.querySelectorAll("[data-snap-drop], [data-walkthrough-hidden], [data-measure-hidden], [aria-hidden='true'].invisible.absolute"))
    if (!el.matches("svg[data-icon-sprite]")) el.remove();
  for (const el of d.querySelectorAll("[data-snap-drop]")) el.removeAttribute("data-snap-drop");
  for (const el of d.querySelectorAll("[data-testid]")) {
    el.setAttribute("data-tid", el.getAttribute("data-testid"));
    el.removeAttribute("data-testid");
  }
  const cache = new Map();
  const data = (url) => {
    if (!cache.has(url))
      cache.set(url, fetch(url).then((r) => r.blob()).then((b) => new Promise((done) => { const f = new FileReader(); f.onload = () => done(f.result); f.readAsDataURL(b); })));
    return cache.get(url);
  };
  const inline = async (css, base) => {
    let out = "", last = 0;
    for (const m of css.matchAll(/url\\(\\s*(['"]?)([^'")]+)\\1\\s*\\)/g)) {
      out += css.slice(last, m.index);
      last = m.index + m[0].length;
      if (m[2].startsWith("data:") || m[2].startsWith("#")) { out += m[0]; continue; }
      try { out += 'url("' + (await data(new URL(m[2], base).href)) + '")'; } catch { out += m[0]; }
    }
    return out + css.slice(last);
  };
  // A family's faces stay when the page drew with that family, in the subsets that hold
  // Latin text, so every state carries the same fonts.
  const drawn = new Set([...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/["']/g, "")));
  const latin = (range) => !range || /U\\+0{0,4}(?:0|20)-/i.test(range) || /U\\+0{0,4}41\\b/i.test(range);
  // The app's Chromium writes color-mix() in its default space with the space left out,
  // which a browser from before that spelling drops, and with it every /opacity color.
  const spelled = (css) => css.replace(/color-mix\\((?!\\s*in\\s)/g, "color-mix(in oklab, ");
  let fonts = "";
  const blocks = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    let text = "";
    for (const rule of rules) {
      if (rule instanceof CSSFontFaceRule) {
        const family = rule.style.getPropertyValue("font-family").replace(/["']/g, "").trim();
        if (drawn.has(family) && latin(rule.style.getPropertyValue("unicode-range"))) fonts += (await inline(rule.cssText, sheet.href ?? location.href)) + "\\n";
      } else text += rule.cssText + "\\n";
    }
    if (text.trim()) blocks.push(await inline(spelled(text), sheet.href ?? location.href));
  }
  const styles = [...d.head.querySelectorAll("style")];
  const freeze = styles.pop();
  for (const el of styles) el.remove();
  for (const el of d.head.querySelectorAll("link[rel~=stylesheet]")) el.remove();
  for (const css of [fonts, ...blocks]) {
    const el = d.createElement("style");
    el.textContent = css;
    d.head.insertBefore(el, freeze);
  }
  s.notes = s.notes.filter((n) => !n.startsWith("kept ")).concat(["the app's whole stylesheets in " + blocks.length + " blocks, " + Math.round(blocks.join("").length / 1024) + " KB, fonts " + Math.round(fonts.length / 1024) + " KB"]);
  s.html = "<!doctype html>\\n" + d.documentElement.outerHTML;
  s.kb = Math.round(s.html.length / 1024);
  return s;
})()`;

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

/**
 * The bookmarks of the tg-* states that show any, as the ops that add them: a folder of
 * the competitors' pricing pages on the bar, then two loose bookmarks.
 * @type {({ type: "addFolder", folder: { id: string, order: number, title: string } } | { type: "add", bookmark: { id: string, folder?: string, order: number, title: string, url: string } })[]}
 */
const BOOKMARKS = [
  { folder: { id: "snap-competitors", order: 1, title: "Competitors" }, type: "addFolder" },
  { bookmark: { folder: "snap-competitors", id: "snap-zendesk", order: 1, title: "Zendesk pricing", url: "https://www.zendesk.com/pricing" }, type: "add" },
  { bookmark: { folder: "snap-competitors", id: "snap-intercom", order: 2, title: "Intercom pricing", url: "https://www.intercom.com/pricing" }, type: "add" },
  { bookmark: { folder: "snap-competitors", id: "snap-freshdesk", order: 3, title: "Freshdesk pricing", url: "https://www.freshworks.com/freshdesk/pricing/" }, type: "add" },
  { bookmark: { id: "snap-notion", order: 2, title: "Notion pricing", url: "https://www.notion.com/pricing" }, type: "add" },
  { bookmark: { id: "snap-hn", order: 3, title: "Hacker News", url: "https://news.ycombinator.com" }, type: "add" },
];

/** Two more kept in All Bookmarks rather than on the bar, for the states that show its chip. */
const ALL_BOOKMARKS = [
  { bookmark: { id: "snap-g2", order: 1, root: "other", title: "Help desk software on G2", url: "https://www.g2.com/categories/help-desk" }, type: "add" },
  { bookmark: { id: "snap-soc2", order: 2, root: "other", title: "SOC 2 on Wikipedia", url: "https://en.wikipedia.org/wiki/System_and_Organization_Controls" }, type: "add" },
];

/**
 * Each state, by name: what it shows (INDEX.md's line for it), the themes it is taken in,
 * and how to get there from a window with one tab and nothing open (on the tab-groups
 * branch, one new group). `h` is the run's helpers: `h.app` the studio-drive handle
 * (`click`, `press`, `type`, `eval`, `goto`, and the drive words at `h.app.words`),
 * `h.go(href)`, `h.files(view, select)`, `h.chats` the seed's chats by role, `h.folder`
 * the Instrument folder, `h.after(fn)` to undo what the state left open, and for the
 * tab-groups window `h.chatAlone(id)`, `h.bookmarks()` and `h.bookmarksBar(on)`.
 */
export const STATES = {
  chat: {
    about: "The pricing chat open: rail, the chat list (Search, View options, Inbox / Drafts / Archived, a Projects section, rows with project names), the chat's head, an answer with a table, the reply box.",
    themes: ["light", "dark"],
    run: async (h) => h.go(`/chats/${h.chats.pricing}`, 1400),
  },
  "chat-plus-menu": {
    about: "The chat with the reply box's + menu open (Browser, This Mac, Attach files, Add a folder, Apps, Skills).",
    themes: ["light"],
    run: async (h) => {
      await h.go(`/chats/${h.chats.pricing}`, 1200);
      await h.app.click({ selector: 'button[aria-label="Add to this prompt"]' });
    },
  },
  "chat-view-options": {
    about: "The chat list's View options open: Three lines, Two lines, One line, and Group by day.",
    themes: ["light"],
    run: async (h) => {
      await h.go(`/chats/${h.chats.pricing}`, 1200);
      await h.app.click({ selector: 'button[aria-label="View options"]' });
      await wait(400);
    },
  },
  "chat-search": {
    about: "The chat list filtered by \"pricing\" typed into Search.",
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
    about: "The chat list on its Drafts tab, empty.",
    themes: ["light"],
    run: async (h) => {
      await h.go(`/chats/${h.chats.pricing}`, 1200);
      await h.app.click({ selector: '[role=tablist][aria-label="Places"] [role=tab]', text: "Drafts" });
      await wait(500);
      h.after(() => h.app.click({ selector: '[role=tablist][aria-label="Places"] [role=tab]', text: "Inbox" }));
    },
  },
  "chat-row-menu": {
    about: "The chat list with a chat's context menu open, right-clicked on the SOC 2 chat: Open, Open in New Tab, Open in New Window, Pop Out, Mark as read, Star, Rename, Project, Open in Files, Copy, Send feedback, Archive, Delete chat.",
    themes: ["light", "dark"],
    run: async (h) => {
      await h.go(`/chats/${h.chats.pricing}`, 1200);
      // The model titles the seed's chats when the seed is made, so the row is found by the chat's own title.
      const { title } = await h.app.rpc("workspace.chats.byId", { id: h.chats.soc2 });
      await h.app.click({ text: title }, "chat row", { button: "right" });
      await wait(400);
    },
  },
  apps: {
    about: "Apps open from the rail.",
    themes: ["light"],
    run: async (h) => h.go("/apps", 1400),
  },
  draft: {
    about: "New pressed in Chat: a new chat fills the chat pane (New chat, + Project, No model chosen).",
    themes: ["light"],
    run: async (h) => {
      await h.go(`/chats/${h.chats.pricing}`, 1200);
      await h.app.click({ selector: 'nav button[aria-label="New"]' });
      await wait(500);
    },
  },
  "draft-over-files": {
    about: "New pressed in Files: the draft docked over the Instrument folder.",
    themes: ["light"],
    run: async (h) => {
      await h.files("Table view");
      await h.app.click({ selector: 'nav button[aria-label="New"]' });
      await wait(500);
    },
  },
  "bell-update": {
    about: "The bell open on two notices: an update (What's new, Dismiss) and a What's new from the feed.",
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
    about: "Send feedback open over the chat: topic chips, the note, Add images, what's sent with it.",
    themes: ["light", "dark"],
    run: async (h) => {
      await h.go(`/chats/${h.chats.pricing}`, 1200);
      await h.app.click({ selector: 'nav[aria-label="Places"] button', text: "Help" });
      await wait(300);
      await h.app.click({ text: "Send feedback…" });
      await wait(500);
    },
  },
  "files-table": {
    about: "Files on the Instrument folder in Table view, pricing-comparison.html selected.",
    themes: ["light", "dark"],
    run: async (h) => h.files("Table view", "pricing-comparison.html"),
  },
  "files-list": {
    about: "Files in List view, the same selection.",
    themes: ["light"],
    run: async (h) => h.files("List view", "pricing-comparison.html"),
  },
  "files-grid": {
    about: "Files in Grid view, the same selection.",
    themes: ["light", "dark"],
    run: async (h) => h.files("Grid view", "pricing-comparison.html"),
  },
  "files-context-menu": {
    about: "Files in Table view with a file's context menu open.",
    themes: ["light"],
    run: async (h) => {
      await h.files("Table view", "pricing-comparison.html");
      await h.app.click({ text: "pricing-comparison.html" }, "row", { button: "right" });
      await wait(400);
    },
  },
  "files-info": {
    about: "Files with the Info card open on pricing-comparison.html (from the context menu's Info ⌘I).",
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
    about: "pricing-comparison.html open beside its folder.",
    themes: ["light"],
    run: async (h) => h.go(`/files?file=${encodeURIComponent(`${h.folder}/pricing-comparison.html`)}&path=&root=${encodeURIComponent(h.folder)}`, 1800),
  },
  "image-fit": {
    about: "An image (harbor-desk-pricing.png) open in Files at Fit, its toolbar above.",
    themes: ["light", "dark"],
    run: async (h) => h.go(`/files?file=${encodeURIComponent(`${h.folder}/Screenshots/harbor-desk-pricing.png`)}&path=Screenshots&root=${encodeURIComponent(h.folder)}`, 1800),
  },
  "image-zoom-menu": {
    about: "The image open with the Zoom menu down.",
    themes: ["light", "dark"],
    run: async (h) => {
      await h.go(`/files?file=${encodeURIComponent(`${h.folder}/Screenshots/harbor-desk-pricing.png`)}&path=Screenshots&root=${encodeURIComponent(h.folder)}`, 1800);
      await h.app.click({ selector: 'button[aria-label^="Zoom"]' });
      await wait(400);
    },
  },
  "quick-look": {
    about: "Quick Look over Files on an image, Space pressed.",
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
    about: "The in-app browser on example.com. The page itself is a picture: it runs outside the app's DOM.",
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
    about: "The browser with Find in page open on \"domain\", 1 of 2. The page is a picture.",
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
  "new-tab": {
    about: "The New tab page.",
    themes: ["light"],
    run: async (h) => h.go("/new-tab"),
  },
  settings: {
    about: "Settings open on General.",
    themes: ["light"],
    run: async (h) => {
      await h.go(`/chats/${h.chats.pricing}`, 900);
      await h.app.openModal("settings");
      await wait(700);
    },
  },
  "tg-new-tab": {
    about: "Tab groups: a new group just made with ⌘N, up above the pricing chat's group in the sidebar. The new tab as it ships: back, forward and reload off, + and New Tab in Split, the bookmarks bar with Apps, Chats and Files and the line on bookmarking (no bookmarks), the Instrument mark, \"How can I help?\" and the composer (+, Project, Auto), nothing typed.",
    themes: ["light"],
    run: async (h) => {
      await h.bookmarksBar(false);
      await h.chatAlone(h.chats.pricing);
      await h.app.words.press("Meta+n");
    },
  },
  "tg-page-beside-chat": {
    about: "Tab groups: the pricing chat's group with the chat's card on the left and a card of pages on the right, Zendesk pricing behind and Intercom pricing up, loaded, the keyboard on the page side. Bookmarks kept (the star filled on Intercom), the bookmarks bar off. The pages are a picture.",
    themes: ["light"],
    run: async (h) => {
      const { omnibar, press } = h.app.words;
      await h.bookmarksBar(false);
      await h.bookmarks();
      await h.chatAlone(h.chats.pricing);
      await omnibar.go("https://www.zendesk.com/pricing");
      await press("Meta+t");
      await omnibar.go("https://www.intercom.com/pricing");
    },
  },
  "tg-two-pages": {
    about: "Tab groups: a group of two pages split side by side, no chat card (its chat not started): Zendesk pricing on the left, Intercom pricing on the right with the keyboard, each side its own toolbar with no tab strip. The bookmarks bar off. The pages are a picture.",
    themes: ["light"],
    run: async (h) => {
      const { click, omnibar } = h.app.words;
      await h.bookmarksBar(false);
      await h.bookmarks();
      await omnibar.go("https://www.zendesk.com/pricing");
      await click("New Tab in Split");
      await omnibar.go("https://www.intercom.com/pricing");
    },
  },
  "tg-page-more-menu": {
    about: "tg-page-beside-chat with the page toolbar's ⋮ (More actions) open and its Bookmarks submenu out: Bookmark this tab…, Bookmark all tabs…, Show bookmarks bar, Bookmark manager, then the Competitors folder, Notion pricing and Hacker News.",
    themes: ["light"],
    run: async (h) => {
      const { button, item, omnibar, press } = h.app.words;
      await h.bookmarksBar(false);
      await h.bookmarks();
      await h.chatAlone(h.chats.pricing);
      await omnibar.go("https://www.zendesk.com/pricing");
      await press("Meta+t");
      await omnibar.go("https://www.intercom.com/pricing");
      await button("More actions").click();
      await item("Bookmarks").hover();
      await wait(400);
    },
  },
  "tg-page-bar": {
    about: "tg-page-beside-chat with the bookmarks bar turned on: under the page's toolbar, Apps, Chats and Files, the Competitors folder, Notion pricing and Hacker News, and the All Bookmarks chip at the bar's right end (G2 and Wikipedia kept there). The pages are a picture.",
    themes: ["light"],
    run: async (h) => {
      const { omnibar, press } = h.app.words;
      await h.bookmarksBar(true);
      await h.bookmarks({ all: true });
      await h.chatAlone(h.chats.pricing);
      await omnibar.go("https://www.zendesk.com/pricing");
      await press("Meta+t");
      await omnibar.go("https://www.intercom.com/pricing");
    },
  },
  "tg-page-bar-all-menu": {
    about: "tg-page-bar with the All Bookmarks chip's menu open: what it lists and offers today.",
    themes: ["light"],
    run: async (h) => {
      const { button, omnibar, press } = h.app.words;
      await h.bookmarksBar(true);
      await h.bookmarks({ all: true });
      await h.chatAlone(h.chats.pricing);
      await omnibar.go("https://www.zendesk.com/pricing");
      await press("Meta+t");
      await omnibar.go("https://www.intercom.com/pricing");
      await button("All Bookmarks").click();
      await wait(400);
    },
  },
  "tg-chat-alone": {
    about: "Tab groups: the pricing chat's group with the chat alone and no pages, bookmarks kept and the bookmarks bar off (a chat never shows it).",
    themes: ["light"],
    run: async (h) => {
      await h.bookmarksBar(false);
      await h.bookmarks();
      await h.chatAlone(h.chats.pricing);
    },
  },
  "tg-new-tab-bar": {
    about: "tg-new-tab with bookmarks: the new tab's bookmarks bar shows Apps, Chats and Files, then the Competitors folder, Notion pricing and Hacker News.",
    themes: ["light"],
    run: async (h) => {
      await h.bookmarksBar(false);
      await h.bookmarks();
      await h.chatAlone(h.chats.pricing);
      await h.app.words.press("Meta+n");
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
    // The tab-groups window: a new group up, every other group closed.
    oneGroup: async () => {
      if (!(await app.eval(`!!document.querySelector('nav[aria-label="Tab groups"]')`))) return;
      await app.words.press("Meta+n");
      const rows = `nav[aria-label="Tab groups"] [data-group-row]`;
      const up = await app.eval(`document.querySelector('${rows}[data-up]')?.getAttribute('aria-label')?.replace(/ tab group$/, '') ?? ''`);
      if (up && (await app.eval(`document.querySelectorAll('${rows}:not([data-up])').length`))) await app.words.group(up).menu("Close Other Tab Groups");
    },
    // A chat's group up with the chat alone in it: its pages, which the chat keeps
    // from one run to the next, closed with the side they are on.
    chatAlone: async (/** @type {string} */ id) => {
      const { title } = await app.rpc("workspace.chats.byId", { id });
      await app.words.chat(title).open();
      for (let tries = 0; tries < 3; tries++) {
        const up = (await app.words.groups()).find((g) => g.isUp);
        const at = up?.sides.findIndex((s) => !s.tabs.some((t) => t.address.startsWith("/chats")));
        if (!up || up.sides.length < 2 || at === undefined || at < 0) break;
        await app.words.side(at === 0 ? "left" : "right").button("Close Split").click();
        // Off the button, which leaves whatever comes up under it lit.
        await app.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 700, y: 640 });
      }
    },
    // The bookmarks the tg-* states show, through the window's own bridge to main
    // (`shared/bookmarks.ts`), under fixed ids so a second add is a no-op, and taken
    // away again once the state is taken.
    // `all` adds the ones kept in All Bookmarks too.
    bookmarks: async ({ all = false } = {}) => {
      const batch = (/** @type {unknown[]} */ ops) =>
        app.eval(`window.api.bookmarks.apply({ client: 'snapshot-capture', seq: Date.now(), ops: ${JSON.stringify(ops)} }).then(() => true)`);
      const kept = all ? [...BOOKMARKS, ...ALL_BOOKMARKS] : BOOKMARKS;
      await batch(kept);
      h.after(() => batch(kept.filter((op) => op.type === "addFolder" || !op.bookmark.folder).map((op) => ({ id: op.type === "add" ? op.bookmark.id : op.folder.id, type: "remove" }))));
      await wait(300);
    },
    // The bookmarks bar on pages shown or not (View › Show Bookmarks Bar), put back as it was.
    bookmarksBar: async (/** @type {boolean} */ on) => {
      const { showBookmarksBar } = await app.rpc("preferences.get");
      if (showBookmarksBar === on) return;
      await app.rpc("preferences.setShowBookmarksBar", { enabled: on });
      h.after(() => app.rpc("preferences.setShowBookmarksBar", { enabled: showBookmarksBar }));
      await wait(300);
    },
  };
  // A page in the in-app browser runs in a process of its own, drawn on the body over the
  // slot that shows it (`browser-pool.ts`), and a window kept off screen composites it
  // from stale frames: cut, scaled, half painted. So each page shown is left to finish
  // loading, put at its top and pictured from its own debug target, which paints it as
  // it is now, and the picture stands in the slot while the window is taken, the page
  // made see-through above it (not hidden, which would take the keyboard off it). The
  // slot is the window's own element with the page's box, the innermost of them that is
  // not the page's wrapper. `restoreGuests` puts the pages back.
  const pictureGuests = async () => {
    const shown = await app.eval(`(async () => {
      const out = [];
      for (const [i, el] of [...document.querySelectorAll('webview, iframe')].entries()) {
        const r = el.getBoundingClientRect();
        if (el.tagName !== 'WEBVIEW' || getComputedStyle(el).visibility === 'hidden' || Number(getComputedStyle(el.parentElement ?? el).opacity) < 0.5 || r.width <= 4 || r.height <= 4) continue;
        for (let t = 0; t < 60; t++) {
          let loading = false;
          try { loading = el.isLoading(); } catch {}
          if (!loading) break;
          await new Promise((done) => setTimeout(done, 250));
        }
        const mark = 'snap-' + i + '-' + Math.random().toString(36).slice(2);
        try { await el.executeJavaScript('window.__snapGuest = ' + JSON.stringify(mark) + '; window.scrollTo(0, 0); 1'); } catch { continue; }
        const near = (a, b) => Math.abs(a - b) <= 2;
        let host = null;
        for (const e of document.body.querySelectorAll('*')) {
          if (e.contains(el) || e.matches('webview, iframe') || e.closest('svg')) continue;
          const q = e.getBoundingClientRect();
          if (near(q.x, r.x) && near(q.y, r.y) && near(q.width, r.width) && near(q.height, r.height)) host = e;
        }
        if (!host) continue;
        host.setAttribute('data-snap-guest-host', String(i));
        out.push({ i, mark, radius: getComputedStyle(el.parentElement ?? el).borderRadius });
      }
      return out;
    })()`);
    if (!shown.length) return;
    await wait(600);
    /** @type {{ i: number, radius: string, src: string }[]} */
    const taken = [];
    const targets = (await (await fetch(`http://127.0.0.1:${app.port}/json/list`)).json()).filter((/** @type {any} */ t) => t.type === "webview");
    for (const target of targets) {
      const socket = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((open, fail) => ((socket.onopen = open), (socket.onerror = fail)));
      let id = 0;
      const send = (/** @type {string} */ method, params = {}) =>
        new Promise((answer) => {
          const n = ++id;
          socket.addEventListener("message", function reply(m) {
            const msg = JSON.parse(String(m.data));
            if (msg.id !== n) return;
            socket.removeEventListener("message", reply);
            answer(msg.result);
          });
          socket.send(JSON.stringify({ id: n, method, params }));
        });
      try {
        const { result } = await send("Runtime.evaluate", { expression: "[window.__snapGuest, innerWidth, innerHeight, devicePixelRatio]", returnByValue: true });
        const [mark, width, height, ratio] = result?.value ?? [];
        const guest = shown.find((g) => g.mark === mark);
        if (!guest) continue;
        const { data } = await send("Page.captureScreenshot", { format: "jpeg", quality: 82, clip: { x: 0, y: 0, width, height, scale: 1 / ratio } });
        if (data) taken.push({ i: guest.i, radius: guest.radius, src: `data:image/jpeg;base64,${data}` });
      } finally {
        socket.close();
      }
    }
    await app.eval(`(async () => {
      for (const { i, radius, src } of ${JSON.stringify(taken)}) {
        const host = document.querySelector('[data-snap-guest-host="' + i + '"]');
        const el = document.querySelectorAll('webview, iframe')[i];
        if (!host || !el) continue;
        const img = document.createElement('img');
        img.src = src;
        img.alt = 'The page in the in-app browser, as it looked';
        img.setAttribute('data-snap-guest-picture', '');
        img.setAttribute('style', 'position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:cover;object-position:left top;border-radius:' + radius);
        if (getComputedStyle(host).position === 'static') host.setAttribute('data-snap-guest-static', '');
        host.append(img);
        await img.decode().catch(() => {});
        el.setAttribute('data-snap-guest-hidden', el.style.opacity);
        el.style.opacity = '0';
      }
      for (const host of document.querySelectorAll('[data-snap-guest-static]')) host.style.position = 'relative';
    })()`);
    await wait(150);
  };
  const restoreGuests = () =>
    app.eval(`(() => {
      for (const img of document.querySelectorAll('[data-snap-guest-picture]')) img.remove();
      for (const host of document.querySelectorAll('[data-snap-guest-static]')) { host.style.position = ''; host.removeAttribute('data-snap-guest-static'); }
      for (const host of document.querySelectorAll('[data-snap-guest-host]')) host.removeAttribute('data-snap-guest-host');
      for (const el of document.querySelectorAll('[data-snap-guest-hidden]')) { el.style.opacity = el.getAttribute('data-snap-guest-hidden'); el.removeAttribute('data-snap-guest-hidden'); }
    })()`);
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
        await h.oneGroup();
        if (await app.eval(`!!document.querySelector('button[aria-label="Discard draft"]')`)) await app.click({ selector: 'button[aria-label="Close"]' });
        await wait(300);
        await hideDevChrome();
        await state.run(h);
        await wait(700);
        await pictureGuests();
        await hideDevChrome();
        await app.eval(`window.__walkthroughPage.present(${JSON.stringify({ rootCrumb: path.basename(h.folder) })})`);
        await wait(200);
        await app.shot(path.join(out, "raw", `${key}.png`));
        const outline = await app.snapshot({ depth: 14 });
        fs.writeFileSync(path.join(out, "raw", `${key}.outline.txt`), typeof outline === "string" ? outline : JSON.stringify(outline, null, 1));
        await markDrop();
        // A frame in the window's own page that is another document is kept as a picture
        // of its box, drawn where it was; a page of the in-app browser already has its
        // picture in its slot (pictureGuests).
        const guests = await app.eval(`[...document.querySelectorAll('webview, iframe')].map((el, i) => {
          const r = el.getBoundingClientRect();
          const pictured = !!document.querySelector('[data-snap-guest-host="' + i + '"] > [data-snap-guest-picture]');
          return { i, x: r.x, y: r.y, width: r.width, height: r.height, shown: !pictured && getComputedStyle(el).visibility !== 'hidden' && Number(getComputedStyle(el.parentElement ?? el).opacity) >= 0.5 };
        })`);
        /** @type {Record<string, string>} */
        const pictures = {};
        for (const g of guests) {
          if (!g.shown || g.width <= 4 || g.height <= 4) continue;
          const { data } = await app.cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 82, clip: { x: g.x, y: g.y, width: g.width, height: g.height, scale: 1 } });
          pictures[g.i] = `data:image/jpeg;base64,${data}`;
        }
        const snapshot = await app.eval(studioSnapshot(pictures));
        fs.writeFileSync(path.join(out, "raw", `${key}.json`), JSON.stringify(snapshot));
        await app.eval(`document.querySelectorAll('[data-snap-drop]').forEach((e) => e.removeAttribute('data-snap-drop'))`);
        const html = snapshot.html;
        done.push(`${key} ${Math.round(html.length / 1024)} KB`);
      } catch (error) {
        done.push(`${key} FAILED: ${String(error instanceof Error ? error.message : error).slice(0, 240)}`);
      }
      await restoreGuests().catch(() => {});
      for (const fn of afters.splice(0)) await Promise.resolve(fn()).catch(() => {});
    }
  }
  if (before?.theme) await app.rpc("preferences.setTheme", { theme: before.theme });
  await app.cdp.send("Emulation.clearDeviceMetricsOverride");
  return done;
};

/** The capture round as one command; see the top of this file. */
async function captureStates(/** @type {string[]} */ names) {
  const { execFileSync } = await import("node:child_process");
  const os = await import("node:os");
  const { CHECKOUT_KEY, REPO_ROOT } = await import("../../skills/studio-chrome-devtools/scripts/studio-app.mjs");
  const { LIBRARY } = await import("./lib.mjs");
  const unknown = names.filter((n) => !(n in STATES));
  if (unknown.length)
    throw new Error(`no state ${unknown.join(", ")} in capture.mjs: add an entry to STATES for it. It has ${Object.keys(STATES).join(", ")}`);
  const DRIVE = path.join(REPO_ROOT, ".agents/skills/studio-chrome-devtools/scripts/studio-drive.mjs");
  const WALK = path.join(REPO_ROOT, ".agents/skills/studio-walkthrough/scripts/walkthrough.mjs");
  const SEED = "wf-pricing";
  const ROOM = "Instrument";
  const node = (/** @type {string[]} */ argv) =>
    execFileSync("node", argv, { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });

  // A seed lives in studio-drive's cache for one checkout, so a checkout without one
  // takes the newest copy another checkout on this machine made, and a machine without
  // any makes it from seed/wf-pricing.seed.json, which runs its chats through the model.
  const cache = path.join(
    process.env.LOCALAPPDATA ??
      (process.platform === "darwin" ? path.join(os.homedir(), "Library", "Caches") : (process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"))),
    "instrument-studio-drive",
  );
  const mine = path.join(cache, CHECKOUT_KEY, "walkthrough-seeds", SEED);
  if (!fs.existsSync(path.join(mine, "seed.json"))) {
    const theirs = (fs.existsSync(cache) ? fs.readdirSync(cache) : [])
      .map((key) => path.join(cache, key, "walkthrough-seeds", SEED))
      .filter((dir) => fs.existsSync(path.join(dir, "seed.json")))
      .sort((a, b) => fs.statSync(path.join(b, "seed.json")).mtimeMs - fs.statSync(path.join(a, "seed.json")).mtimeMs)[0];
    if (theirs) fs.cpSync(theirs, mine, { recursive: true });
    else node([WALK, "seed", path.join(import.meta.dirname, "seed", `${SEED}.seed.json`)]);
  }

  /** Stops the room and waits for its port to come free, so a boot straight after finds it free. */
  const stop = async () => {
    const port = Number(node([DRIVE, "port", "--clean-room", ROOM]).trim());
    node([DRIVE, "stop", "--clean-room", ROOM]);
    const { connect } = await import("node:net");
    const listening = () =>
      new Promise((done) => {
        const socket = connect({ host: "127.0.0.1", port });
        socket.once("connect", () => (socket.destroy(), done(true)));
        socket.once("error", () => done(false));
      });
    for (let tries = 0; tries < 100 && (await listening()); tries++) await wait(200);
  };
  const started = Date.now();
  // Signed in, so a chat's reply box shows its model rather than a sign-in warning.
  /** @returns {{ cleanRoom: string }} */
  const boot = () => JSON.parse(node([DRIVE, "boot", "--purpose", "snapshot capture", "--clean-room", ROOM, "--with-sign-ins"]));
  try {
    node([WALK, "open", SEED]);
  } catch (error) {
    // The seed's machine folder goes where the app keeps the room's, which it has only
    // after the room's first boot from this checkout.
    if (!String(/** @type {any} */ (error).stderr ?? error).includes("has not registered")) throw error;
    boot();
    node([WALK, "open", SEED]);
  }
  await stop();
  const room = boot();
  try {
    const ids = fs.readdirSync(path.join(room.cleanRoom, ".instrument", "chats"));
    const chat = (/** @type {string} */ slug) => ids.find((id) => id.includes(slug));
    const args = {
      out: LIBRARY,
      folder: room.cleanRoom,
      chats: { pricing: chat("help-desk"), soc2: chat("four-firms"), board: chat("q3-board"), renewal: chat("two-sentence") },
      ...(names.length ? { only: names } : {}),
    };
    const argsFile = path.join(os.tmpdir(), `snap-capture-${process.pid}.json`);
    fs.writeFileSync(argsFile, JSON.stringify(args));
    const result = JSON.parse(node([DRIVE, "run", import.meta.filename, "--quiet", "--clean-room", ROOM, "--args", `@${argsFile}`]));
    fs.rmSync(argsFile, { force: true });
    if (result.ok === false) throw new Error(`capture stopped at ${result.stoppedAt}: ${result.error}`);
    /** @type {string[]} */
    const done = result.value ?? result.result ?? result;
    for (const line of done) console.log(line);
    const taken = [...new Set(done.filter((l) => !l.includes("FAILED")).map((l) => l.split(" ")[0].replace(/\.dark$/, "")))];
    if (taken.length) process.stdout.write(node([path.join(here, "library.mjs"), "--only", taken.join(",")]));
    console.log(`${Math.round((Date.now() - started) / 1000)} s`);
    if (done.some((l) => l.includes("FAILED"))) process.exitCode = 1;
  } finally {
    await stop();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    await captureStates(process.argv.slice(2));
  } catch (error) {
    console.error(`capture: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
