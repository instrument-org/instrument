/**
 * Replacing an image: the popover that takes a file from this computer or a
 * link, and the image's description (its `alt`), each written as a splice of
 * the image's start tag.
 */
import { computePosition, flip, offset, shift } from "@floating-ui/dom";

import { staticEntry } from "./classify";
import { type Editor, type ImageApi } from "./context";
import { find, findAs } from "./dom";
import { clip } from "./payload";
import { regionOf } from "./regions";
import { type Splice } from "./source";

const escAttr = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll('"', "&quot;");

export function createImage(ed: Editor): ImageApi {
  const { state, ui } = ed;
  const { imgFile, imgPop } = ui;
  const urlInput = findAs(imgPop, "[name=url]", HTMLInputElement);
  const altInput = findAs(imgPop, "[name=alt]", HTMLInputElement);

  function openImgPop() {
    const { info, sel } = state;
    if (!sel || info?.kind !== "image") {
      return;
    }
    ed.asks.closeAsk();
    imgPop.hidden = false;
    urlInput.value = "";
    altInput.value = sel.getAttribute("alt") ?? "";
    void computePosition(
      { getBoundingClientRect: () => sel.getBoundingClientRect() },
      imgPop,
      {
        middleware: [
          offset(10),
          flip({ padding: { bottom: 70, top: 8 } }),
          shift({ padding: 10 }),
        ],
        placement: "bottom-start",
        strategy: "fixed",
      },
    ).then(({ x, y }) => {
      imgPop.style.left = `${x}px`;
      imgPop.style.top = `${y}px`;
    });
  }
  function closeImgPop() {
    imgPop.hidden = true;
  }

  async function setImage(url: string, label: string) {
    const img = state.sel;
    if (img?.tagName !== "IMG") {
      return;
    }
    closeImgPop();
    const entry = staticEntry(state.A, img).entry;
    const at = entry?.loc.attrs?.src;
    if (!entry || !at) {
      return;
    }
    const splices: Splice[] = [
      {
        end: at.endOffset,
        start: at.startOffset,
        text: `src="${escAttr(url)}"`,
      },
    ];
    const ss = entry.loc.attrs?.srcset;
    if (ss) {
      let s = ss.startOffset;
      while (/\s/.test(state.src[s - 1] ?? "")) {
        s--;
      }
      splices.push({ end: ss.endOffset, start: s, text: "" });
    }
    const tag = entry.loc.startTag;
    const res = await ed.history.write({
      key: `img:${tag.startOffset}`,
      label,
      regions: [regionOf(state.src, tag.startOffset, tag.endOffset, splices)],
    });
    if (!res.ok) {
      ed.asks.toAgentChange(
        img,
        `Replace this image with ${url}`,
        "the agent changed this part of the page",
      );
      return;
    }
    ed.live.withAttributes(() => {
      img.removeAttribute("srcset");
      img.setAttribute("src", url);
    });
    if (res.external) {
      await ed.reload.reloadKeeping(res.prev);
    }
    if (state.sel) {
      state.info = ed.selection.inspect(state.sel);
    }
    ed.overlay.showToast(label, { undo: true });
    ed.status(`Saved ${label}${ss ? " (dropped srcset)" : ""}`);
    ed.overlay.layout();
  }

  async function setAlt(value: string) {
    const img = state.sel;
    if (img?.tagName !== "IMG" || (img.getAttribute("alt") ?? "") === value) {
      return;
    }
    const entry = staticEntry(state.A, img).entry;
    if (!entry) {
      return;
    }
    const a = entry.loc.attrs?.alt;
    const text = `alt="${escAttr(value)}"`;
    const tag = entry.loc.startTag;
    const sp = a
      ? { end: a.endOffset, start: a.startOffset, text }
      : {
          end: tag.startOffset + 4,
          start: tag.startOffset + 4,
          text: ` ${text}`,
        };
    const res = await ed.history.write({
      key: `alt:${tag.startOffset}`,
      label: "Image description",
      regions: [regionOf(state.src, tag.startOffset, tag.endOffset, [sp])],
    });
    if (!res.ok) {
      return;
    }
    img.setAttribute("alt", value);
    ed.overlay.showToast("Image description updated", { undo: true });
  }

  function init() {
    find(imgPop, "[data-upload]").addEventListener("click", () => {
      imgFile.value = "";
      imgFile.click();
    });
    imgFile.addEventListener("change", () => {
      const file = imgFile.files?.[0];
      if (!file) {
        return;
      }
      const fr = new FileReader();
      fr.addEventListener("load", () => {
        const { result } = fr;
        if (typeof result === "string") {
          void ed.serial(() => setImage(result, `Image → ${file.name}`));
        }
      });
      fr.readAsDataURL(file);
    });
    findAs(imgPop, "form[data-url]", HTMLFormElement).addEventListener(
      "submit",
      (e) => {
        e.preventDefault();
        const url = urlInput.value.trim();
        if (url) {
          void ed.serial(() =>
            setImage(
              url,
              `Image → ${clip(url.replace(/^https?:\/\//, ""), 32)}`,
            ),
          );
        }
      },
    );
    altInput.addEventListener("change", () => {
      void ed.serial(() => setAlt(altInput.value));
    });
    altInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        altInput.blur();
      }
    });
  }

  return { closeImgPop, init, openImgPop };
}
