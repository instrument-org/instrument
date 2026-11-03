// Evaluated in Studio's renderer before a take: finding what to press by the
// name a person would use, dressing the app for showing, and writing the
// page as one HTML file.
(() => {


  const squash = (s) => (s ?? "").replace(/\s+/g, " ").trim();
  const nameOf = (el) =>
    squash(
      el.getAttribute("aria-label") ||
        el.getAttribute("placeholder") ||
        (el instanceof HTMLElement ? el.innerText : el.textContent),
    );
  const INTERACTIVE =
    "button,a,[role=button],[role=option],[role=menuitem],[role=menuitemradio],[role=menuitemcheckbox],[role=tab],[role=link],[role=row],[role=listitem],input,textarea,[contenteditable=true],label,summary";

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return false;
    if (el.closest("[inert],[aria-hidden=true]")) return false;
    return true;
  };

  /** The right edge of the words inside an element, so a hand can aim beside them. */
  const textRight = (el) => {
    let right = null;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (r.width > 0) right = Math.max(right ?? 0, r.right);
    }
    return right;
  };

  /** What a thing sits on that a camera would frame it with: its dialog, menu or popover. */
  const SURFACES = "[role=dialog],[role=alertdialog],[role=menu],[role=listbox],[data-radix-popper-content-wrapper]";
  const surfaceOf = (el) => {
    const surface = el?.closest?.(SURFACES);
    if (!surface) return null;
    const r = surface.getBoundingClientRect();
    return { h: r.height, w: r.width, x: r.left, y: r.top };
  };

  const locate = (target) => {
    let candidates = target.selector
      ? [...document.querySelectorAll(target.selector)]
      : [...document.querySelectorAll("body *")];
    if (target.placeholder) candidates = candidates.filter((el) => el.getAttribute("placeholder") === target.placeholder);
    if (target.label) candidates = candidates.filter((el) => el.getAttribute("aria-label") === target.label);
    if (target.text) candidates = candidates.filter((el) => nameOf(el) === target.text);
    if (target.contains) candidates = candidates.filter((el) => nameOf(el).includes(target.contains));
    candidates = candidates.filter(visible);
    if (candidates.length === 0) return null;
    // The deepest match names the thing; what is pressed is what it sits in.
    candidates.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return ra.width * ra.height - rb.width * rb.height;
    });
    let el = candidates[target.nth ?? 0];
    if (!target.exact) el = el.closest(INTERACTIVE) ?? el;
    if (target.within) el = el.closest(target.within) ?? el;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    const covered = top && !el.contains(top) && !top.contains(el)
      ? `${top.tagName.toLowerCase()} "${nameOf(top).slice(0, 40)}"`
      : null;
    const text = el.matches("input,textarea,[contenteditable=true]") || el.closest("[contenteditable=true]");
    return {
      surface: surfaceOf(el),
      covered,
      cursor: getComputedStyle(el).cursor,
      h: r.height,
      kind: text ? "text" : "control",
      name: nameOf(el).slice(0, 80),
      textRight: text ? null : textRight(el),
      w: r.width,
      x: r.left,
      y: r.top,
    };
  };

  // --- presentation -------------------------------------------------------

  const AVATAR =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="#4f7a68"/><circle cx="48" cy="38" r="17" fill="#d9e8df"/><path d="M16 92c4-20 18-30 32-30s28 10 32 30" fill="#d9e8df"/></svg>',
    );

  const present = () => {
    if (!document.getElementById("walkthrough-present")) {
      const style = document.createElement("style");
      style.id = "walkthrough-present";
      style.textContent = "[data-walkthrough-hidden]{visibility:hidden!important}";
      document.head.append(style);
    }
    const dress = () => {
      // The development pills (server, workspace, instance) beside the bell.
      for (const span of document.querySelectorAll("span.truncate")) {
        if (squash(span.textContent) !== "Staging") continue;
        span.closest("div.gap-2")?.setAttribute("data-walkthrough-hidden", "");
      }
      for (const mb of document.querySelectorAll("[data-slot=menubar]")) {
        mb.closest("div.gap-2")?.setAttribute("data-walkthrough-hidden", "");
      }
      // The signed-in account's photo, for a stand-in.
      for (const img of document.querySelectorAll("img")) {
        if (/googleusercontent|gravatar|avatars\./.test(img.src)) img.src = AVATAR;
      }
    };
    dress();
    if (!window.__walkthroughDress) {
      window.__walkthroughDress = new MutationObserver(dress);
      window.__walkthroughDress.observe(document.body, { childList: true, subtree: true });
    }
  };

  // --- stills -------------------------------------------------------------

  const toDataUrl = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  };

  /** Rewrites every url() in a stylesheet to absolute, and to data for what the page loaded. */
  const inlineCss = async (css, base, loaded, cache) => {
    const refs = [...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)];
    let outCss = "";
    let last = 0;
    for (const m of refs) {
      const raw = m[2];
      outCss += css.slice(last, m.index);
      last = m.index + m[0].length;
      if (raw.startsWith("data:") || raw.startsWith("#")) {
        outCss += m[0];
        continue;
      }
      const abs = new URL(raw, base).href;
      const isFont = /\.(woff2?|ttf|otf)(\?|$)/.test(abs);
      const sameOrigin = abs.startsWith(location.origin);
      if (sameOrigin && (!isFont || loaded.has(abs))) {
        try {
          if (!cache.has(abs)) cache.set(abs, await toDataUrl(abs));
          outCss += `url("${cache.get(abs)}")`;
          continue;
        } catch {}
      }
      outCss += `url("${abs}")`;
    }
    return outCss + css.slice(last);
  };

  /**
   * The font files the page has drawn with: each @font-face rule whose face
   * (family, weight, style, range) the document loaded. Resource timing would
   * say it more simply, but its buffer fills with a dev build's modules.
   */
  const loadedFontUrls = () => {
    const norm = (v) => String(v ?? "").replace(/["'\s]/g, "").toUpperCase();
    const faces = new Set(
      [...document.fonts]
        .filter((f) => f.status === "loaded")
        .map((f) => [f.family, f.weight, f.style, f.unicodeRange].map(norm).join("|")),
    );
    const urls = new Set();
    const visit = (rules, base) => {
      for (const rule of rules) {
        if (rule instanceof CSSFontFaceRule) {
          const st = rule.style;
          const key = [
            st.getPropertyValue("font-family"),
            st.getPropertyValue("font-weight") || "normal",
            st.getPropertyValue("font-style") || "normal",
            st.getPropertyValue("unicode-range") || "U+0-10FFFF",
          ].map(norm).join("|");
          if (!faces.has(key)) continue;
          // The first source is the one a current browser takes.
          const m = st.getPropertyValue("src").match(/url\(\s*(['"]?)([^'")]+)\1\s*\)/);
          if (m) urls.add(new URL(m[2], base).href);
        } else if (rule.cssRules) visit(rule.cssRules, base);
      }
    };
    for (const sheet of document.styleSheets) {
      try {
        visit(sheet.cssRules, sheet.href ?? location.href);
      } catch {}
    }
    return urls;
  };

  const still = async () => {
    const loaded = loadedFontUrls();
    const cache = new Map();
    const body = document.body.cloneNode(true);
    const live = document.body.querySelectorAll("*");
    const copy = body.querySelectorAll("*");
    for (let i = 0; i < live.length; i++) {
      const a = live[i];
      const b = copy[i];
      if (!b) break;
      if (a.scrollTop || a.scrollLeft) b.setAttribute("data-still-scroll", `${a.scrollLeft},${a.scrollTop}`);
      if (a === document.activeElement) b.setAttribute("data-still-focus", "");
      if (a instanceof HTMLInputElement) {
        if (a.type === "checkbox" || a.type === "radio") {
          if (a.checked) b.setAttribute("checked", "");
        } else b.setAttribute("value", a.value);
      } else if (a instanceof HTMLTextAreaElement) {
        b.textContent = a.value;
      } else if (a instanceof HTMLCanvasElement) {
        try {
          const img = document.createElement("img");
          img.src = a.toDataURL();
          img.className = a.className;
          img.style.cssText = a.style.cssText;
          b.replaceWith(img);
        } catch {}
      } else if (a.tagName === "WEBVIEW" || a instanceof HTMLIFrameElement) {
        b.setAttribute("data-still-guest", a.getAttribute("src") ?? "");
      }
    }
    for (const s of body.querySelectorAll("script,noscript")) s.remove();
    for (const img of body.querySelectorAll("img[src]")) {
      const src = img.getAttribute("src");
      if (src.startsWith("data:")) continue;
      const abs = new URL(src, location.href).href;
      if (abs.startsWith(location.origin)) {
        try {
          img.setAttribute("src", await toDataUrl(abs));
        } catch {}
      } else img.setAttribute("src", abs);
    }

    const sheets = [];
    for (const sheet of [...document.styleSheets, ...(document.adoptedStyleSheets ?? [])]) {
      const owner = sheet.ownerNode;
      if (owner?.id === "walkthrough-present") continue;
      let css = owner instanceof HTMLStyleElement && owner.textContent.trim()
        ? owner.textContent
        : "";
      if (!css) {
        try {
          css = [...sheet.cssRules].map((r) => r.cssText).join("\n");
        } catch {
          continue;
        }
      }
      sheets.push(await inlineCss(css, sheet.href ?? location.href, loaded, cache));
    }
    const attrs = (el) =>
      [...el.attributes].map((a) => ` ${a.name}="${a.value.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`).join("");
    const freeze =
      "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}" +
      "[data-walkthrough-hidden]{visibility:hidden!important}" +
      `html,body{width:${innerWidth}px;height:${innerHeight}px;overflow:hidden}`;
    const restore =
      "for(const el of document.querySelectorAll('[data-still-scroll]')){const [x,y]=el.getAttribute('data-still-scroll').split(',').map(Number);el.scrollLeft=x;el.scrollTop=y}document.querySelector('[data-still-focus]')?.focus({preventScroll:true});";
    return (
      `<!doctype html>\n<html${attrs(document.documentElement)}>\n<head>\n<meta charset="utf-8">\n` +
      `<meta name="walkthrough-still" content="${innerWidth}x${innerHeight}@${devicePixelRatio}">\n` +
      `<title>${document.title.replace(/</g, "&lt;")}</title>\n` +
      sheets.map((css) => `<style>${css}</style>`).join("\n") +
      `\n<style>${freeze}</style>\n</head>\n` +
      body.outerHTML +
      `\n<script>${restore}</script>\n</html>\n`
    );
  };

  /** The fonts and same-origin images a replay of the page needs, as data. */
  const assets = async () => {
    const out = {};
    const urls = new Set(loadedFontUrls());
    for (const img of document.querySelectorAll("img[src]")) {
      if (img.src.startsWith(location.origin)) urls.add(img.src);
    }
    for (const url of urls) {
      try {
        out[url] = await toDataUrl(url);
      } catch {}
    }
    return out;
  };

  window.__walkthroughPage = { assets, locate, present, still, surfaceOf };
})();
