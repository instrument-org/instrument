import { toast } from "@/client/lib/toast";
import { rpcClient } from "@/client/rpc/client";
import { type Uploader } from "@milkdown/kit/plugin/upload";
import { imageSchema } from "@milkdown/kit/preset/commonmark";
import {
  Fragment,
  type Node as PMNode,
  type Schema,
  Slice,
} from "@milkdown/kit/prose/model";
import {
  type EditorView,
  type NodeViewConstructor,
} from "@milkdown/kit/prose/view";
import { $remark, $view } from "@milkdown/kit/utils";

// Files given to the Markdown editor: pasted, dropped, or picked from the
// slash menu. Each is put in the file's folder (copied in unless it is already
// there or below) and linked by its path relative to the file, which is how
// the file reads in any other Markdown app and how the editor resolves it. A
// picture goes in as an image, anything else as a link named for the file.

/** A file put beside the Markdown file: its link, and whether it shows as a picture. */
interface Placed {
  image: boolean;
  name: string;
  src: string;
}

/**
 * Crepe's uploader, which its upload plugin calls with what was pasted or
 * dropped and places at the drop: the files, put beside the file.
 */
export function fileUploader(folder: string): Uploader {
  return async (files, schema) =>
    Fragment.from(nodesFor(schema, await placeFiles(folder, [...files])));
}

/** Puts `files` beside the file in `folder`, then links them at the selection. */
export async function insertFiles(
  view: EditorView,
  folder: string,
  files: File[],
): Promise<void> {
  const placed = await placeFiles(folder, files);
  if (view.isDestroyed || placed.length === 0) {
    return;
  }
  const slice = new Slice(
    Fragment.from(nodesFor(view.state.schema, placed)),
    0,
    0,
  );
  view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
  view.focus();
}

/** Each file as the editor shows it: a picture as an image, anything else a link named for it, with a space beside a link. */
function nodesFor(schema: Schema, placed: Placed[]): PMNode[] {
  const { image } = schema.nodes;
  const { link } = schema.marks;
  const shown = placed.map((file) => ({
    asImage: file.image && image !== undefined,
    file,
  }));
  return shown.flatMap(({ asImage, file }, index) => {
    const node =
      asImage && image
        ? image.create({ alt: "", src: file.src, title: "" })
        : schema.text(file.name, link ? [link.create({ href: file.src })] : []);
    const besideLink = !asImage || shown[index - 1]?.asImage === false;
    return index > 0 && besideLink ? [schema.text(" "), node] : [node];
  });
}

/** Each file's link, or none and a toast when one of them could not be put there. */
async function placeFiles(folder: string, files: File[]): Promise<Placed[]> {
  try {
    return await Promise.all(files.map((file) => placeFile(folder, file)));
  } catch (error) {
    toast.error(
      files.length === 1 ? "Couldn't add the file" : "Couldn't add the files",
      { cause: error },
    );
    return [];
  }
}

/** Where `file` went in `folder`, written as a Markdown link writes it. */
async function placeFile(folder: string, file: File): Promise<Placed> {
  const image = file.type.startsWith("image/");
  const from = window.api.getFilePath(file);
  const { path } = await (from
    ? rpcClient.files.addFile.call({ folder, from })
    : rpcClient.files.addFile.call({
        content: await base64Of(file),
        folder,
        // A copied picture comes as `image.png` whatever it is; it is named for when it came in.
        name: image || !file.name ? pastedName(file.type) : file.name,
      }));
  // Always below the folder, since it is put there; a path is escaped a
  // segment at a time so a space or `#` in a name still reads as the name.
  const relative = path.startsWith(folder) ? path.slice(folder.length) : path;
  return {
    image,
    name: relative.split(/[/\\]/).at(-1) ?? relative,
    src: relative.split(/[/\\]/).map(encodeURIComponent).join("/"),
  };
}

/** A name for a picture pasted with no file behind it: when it came in, local time. */
function pastedName(type: string): string {
  const extension =
    { "image/jpeg": "jpg", "image/svg+xml": "svg" }[type] ??
    type.replace(/^image\//, "");
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    now.getMonth() + 1,
    now.getDate(),
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
  ]
    .map((part) => part.toString().padStart(2, "0"))
    .join("");
  return `Pasted image ${stamp}.${extension || "png"}`;
}

function base64Of(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const url = typeof reader.result === "string" ? reader.result : "";
      resolve(url.replace(/^data:[^,]*,/, ""));
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Couldn't read the file"));
    });
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------- size

// A picture's size is its width, which plain Markdown cannot say: a picture
// given one is written as an `<img>` tag with `width`, which GitHub and most
// Markdown apps draw at that width, and an `<img>` tag that says no more than
// a picture can is read back as one, so it gets the same handle.

/** The attributes an `<img>` tag may carry and still read as a picture. */
const IMG_ATTRS = new Set(["alt", "src", "title", "width"]);
const IMG_TAG =
  /^<img\b((?:\s+[a-z-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>$/i;
const IMG_ATTR =
  /([a-z-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gi;

/** The picture an `<img>` tag is, or none for a tag that says more than a picture can. */
export function imageOfTag(
  html: string,
):
  | undefined
  | { alt: string; src: string; title: string; width: null | number } {
  const attrs = IMG_TAG.exec(html.trim())?.[1];
  if (attrs === undefined) {
    return undefined;
  }
  const found = new Map<string, string>();
  for (const [, name = "", ...values] of attrs.matchAll(IMG_ATTR)) {
    const key = name.toLowerCase();
    if (!IMG_ATTRS.has(key) || found.has(key)) {
      return undefined;
    }
    found.set(key, decodeEntities(values.find((v) => v !== undefined) ?? ""));
  }
  const src = found.get("src");
  const width = found.get("width");
  if (!src || (width !== undefined && !/^\d+(?:px)?$/.test(width))) {
    return undefined;
  }
  return {
    alt: found.get("alt") ?? "",
    src,
    title: found.get("title") ?? "",
    width: width === undefined ? null : Number.parseInt(width, 10),
  };
}

/** A picture at a width, as the `<img>` tag the file has it as. */
export function tagOfImage(attrs: {
  alt: string;
  src: string;
  title: string;
  width: number;
}): string {
  return [
    `<img src="${encodeEntities(attrs.src)}"`,
    ...(attrs.alt ? [`alt="${encodeEntities(attrs.alt)}"`] : []),
    ...(attrs.title ? [`title="${encodeEntities(attrs.title)}"`] : []),
    `width="${String(attrs.width)}">`,
  ].join(" ");
}

const ENTITIES: Record<string, string> = {
  "&#39;": "'",
  "&amp;": "&",
  "&gt;": ">",
  "&lt;": "<",
  "&quot;": '"',
};
const decodeEntities = (value: string) =>
  value.replace(
    /&(?:amp|lt|gt|quot|#39);/g,
    (entity) => ENTITIES[entity] ?? entity,
  );
const encodeEntities = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

interface MdNode {
  alt?: null | string;
  children?: MdNode[];
  position?: unknown;
  title?: null | string;
  type: string;
  url?: string;
  value?: unknown;
  width?: null | number;
}

/** Turns every `<img>` tag that is only a picture into one, wrapped in a paragraph where it stands as a block. */
function readImageTags(parent: MdNode) {
  const children = parent.children;
  if (!children) {
    return;
  }
  for (const [index, child] of children.entries()) {
    const image =
      child.type === "html" && typeof child.value === "string"
        ? imageOfTag(child.value)
        : undefined;
    if (!image) {
      readImageTags(child);
      continue;
    }
    const node: MdNode = {
      alt: image.alt,
      title: image.title,
      type: "image",
      url: image.src,
      width: image.width,
      ...(child.position ? { position: child.position } : {}),
    };
    children[index] =
      parent.type === "paragraph" ||
      parent.type === "tableCell" ||
      parent.type === "heading"
        ? node
        : { children: [node], type: "paragraph" };
  }
}

/** Reads `<img>` tags that are only a picture as pictures. */
export const imageTags = $remark("imageTags", () => () => readImageTags);

/** The image node with a width: written as an `<img>` tag when it has one. */
export const imageWidth = imageSchema.extendSchema((prev) => (ctx) => {
  const base = prev(ctx);
  return {
    ...base,
    attrs: { ...base.attrs, width: { default: null } },
    parseMarkdown: {
      match: base.parseMarkdown.match,
      runner: (state, node, type) => {
        state.addNode(type, {
          alt: typeof node.alt === "string" ? node.alt : "",
          src: typeof node.url === "string" ? node.url : "",
          title: typeof node.title === "string" ? node.title : "",
          width: typeof node.width === "number" ? node.width : null,
        });
      },
    },
    toMarkdown: {
      match: base.toMarkdown.match,
      runner: (state, node) => {
        const width = node.attrs.width as null | number;
        if (width === null) {
          base.toMarkdown.runner(state, node);
          return;
        }
        state.addNode(
          "html",
          undefined,
          tagOfImage({
            alt: String(node.attrs.alt ?? ""),
            src: String(node.attrs.src ?? ""),
            title: String(node.attrs.title ?? ""),
            width,
          }),
        );
      },
    },
  };
});

/** The smallest a picture is dragged down to, in CSS pixels. */
const MIN_WIDTH = 32;

/**
 * An image in the file: its own picture, resolved against the file's folder,
 * with a handle on its corner that drags its width. A double-click on the
 * handle gives the picture back its own size. One that does not load says
 * which file it was looking for.
 */
export function imageView(resolveSrc: (src: string) => string) {
  const render: NodeViewConstructor = (node, view, getPos) => {
    let current = node;
    const frame = document.createElement("span");
    frame.className = "md-image";
    frame.contentEditable = "false";
    const img = document.createElement("img");
    const missing = document.createElement("span");
    missing.className = "md-image-missing";
    const handle = document.createElement("span");
    handle.className = "md-image-handle";
    handle.title = "Drag to resize. Double-click for the picture's own size.";
    frame.append(img, missing, handle);

    img.addEventListener("load", () => {
      frame.classList.remove("md-image-broken");
    });
    img.addEventListener("error", () => {
      frame.classList.toggle("md-image-broken", img.getAttribute("src") !== "");
    });

    const draw = (n: PMNode) => {
      const raw = String(n.attrs.src ?? "");
      const src = resolveSrc(raw);
      if (img.getAttribute("src") !== src) {
        img.src = src;
      }
      img.alt = String(n.attrs.alt ?? "");
      img.title = String(n.attrs.title ?? "");
      const width = n.attrs.width as null | number;
      img.style.width = width === null ? "" : `${String(width)}px`;
      let name = raw.split(/[/\\]/).at(-1) ?? raw;
      try {
        name = decodeURIComponent(name);
      } catch {
        // Written unescaped, as it is.
      }
      missing.textContent = `Couldn't find “${name}”`;
    };
    draw(node);

    const setWidth = (width: null | number) => {
      const pos = getPos();
      if (pos === undefined) {
        return;
      }
      view.dispatch(
        view.state.tr.setNodeMarkup(pos, undefined, {
          ...current.attrs,
          width,
        }),
      );
    };

    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      handle.setPointerCapture(event.pointerId);
      const startX = event.clientX;
      const startWidth = img.offsetWidth;
      // On-screen pixels per layout pixel, which the app's zoom changes.
      const scale = img.getBoundingClientRect().width / (startWidth || 1);
      const room = frame.parentElement?.clientWidth ?? Number.POSITIVE_INFINITY;
      let width = startWidth;
      frame.classList.add("md-image-resizing");
      const move = (e: PointerEvent) => {
        width = Math.round(
          Math.min(
            room,
            Math.max(MIN_WIDTH, startWidth + (e.clientX - startX) / scale),
          ),
        );
        img.style.width = `${String(width)}px`;
      };
      const up = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        frame.classList.remove("md-image-resizing");
        if (width !== startWidth) {
          setWidth(width);
        }
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });
    handle.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setWidth(null);
    });

    return {
      dom: frame,
      ignoreMutation: () => true,
      stopEvent: (event) => event.target === handle,
      update(n) {
        if (n.type !== node.type) {
          return false;
        }
        current = n;
        draw(n);
        return true;
      },
    };
  };
  return $view(imageSchema.node, () => render);
}
