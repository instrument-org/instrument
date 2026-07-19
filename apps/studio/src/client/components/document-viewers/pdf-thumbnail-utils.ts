// Vendored from Extend UI (https://ui.extend.ai), MIT licensed.
// Local changes: load pdfium from the app protocol instead of a CDN, and bound
// `renderPdfThumbnailUrl`'s cache so evicted object URLs are revoked.
// `loadSharedPdfEngine` is the only entry point Studio calls; the thumbnail and
// document helpers are kept so re-syncing with upstream stays a straight copy.

import type { PdfDocumentObject, PdfEngine } from "@embedpdf/models";

import { PDFIUM_WASM_URL } from "@/client/lib/document-wasm";

// Each cached entry pins a decoded PNG blob in memory, and the renderer process
// outlives any single document, so the cache is bounded and evicted entries have
// their object URLs revoked.
const THUMBNAIL_URL_CACHE_LIMIT = 256;

let sharedEnginePromise: null | Promise<PdfEngine> = null;
// Upstream never evicts opened documents, so a caller that walks many PDFs
// grows this without bound for the life of the renderer.
const pdfDocumentCache = new Map<string, Promise<PdfDocumentObject>>();
const thumbnailUrlCache = new Map<string, Promise<null | string>>();

export async function getPdfPageCount(url: string) {
  return (await loadPdfDocument(url)).pageCount;
}

export async function loadPdfDocument(url: string) {
  let documentPromise = pdfDocumentCache.get(url);

  if (!documentPromise) {
    documentPromise = loadSharedPdfEngine().then((engine) =>
      engine
        .openDocumentUrl(
          { id: url, url },
          // "auto" streams the document with HTTP range requests, which the
          // local asset server supports. Blob URLs cannot be ranged.
          { mode: url.startsWith("blob:") ? "full-fetch" : "auto" },
        )
        .toPromise(),
    );
    pdfDocumentCache.set(url, documentPromise);
  }

  return documentPromise;
}

export function loadSharedPdfEngine() {
  sharedEnginePromise ??= import("@embedpdf/engines/pdfium-worker-engine").then(
    ({ createPdfiumEngine }) => createPdfiumEngine(PDFIUM_WASM_URL, {}),
  );

  return sharedEnginePromise;
}

export function renderPdfThumbnailUrl({
  dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
  pageIndex,
  url,
  width,
}: {
  dpr?: number;
  pageIndex: number;
  url: string;
  width: number;
}) {
  const cacheKey = `${url}#${pageIndex}@${width}x${dpr}`;
  let thumbnailPromise = thumbnailUrlCache.get(cacheKey);

  if (thumbnailPromise) {
    // Re-insert so eviction order stays least-recently-used.
    thumbnailUrlCache.delete(cacheKey);
    thumbnailUrlCache.set(cacheKey, thumbnailPromise);

    return thumbnailPromise;
  }

  thumbnailPromise = (async () => {
    const [engine, document] = await Promise.all([
      loadSharedPdfEngine(),
      loadPdfDocument(url),
    ]);
    const page = document.pages[pageIndex];

    if (!page) return null;

    const blob = await engine
      .renderThumbnail(document, page, {
        dpr,
        imageType: "image/png",
        scaleFactor: width / page.size.width,
        withAnnotations: true,
      })
      .toPromise();

    return URL.createObjectURL(blob);
  })();
  thumbnailUrlCache.set(cacheKey, thumbnailPromise);
  evictOverflowingThumbnails();

  return thumbnailPromise;
}

function evictOverflowingThumbnails() {
  while (thumbnailUrlCache.size > THUMBNAIL_URL_CACHE_LIMIT) {
    const oldestKey = thumbnailUrlCache.keys().next().value;

    if (oldestKey === undefined) return;

    const evicted = thumbnailUrlCache.get(oldestKey);

    thumbnailUrlCache.delete(oldestKey);
    void evicted?.then(
      (objectUrl) => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      },
      () => {},
    );
  }
}
