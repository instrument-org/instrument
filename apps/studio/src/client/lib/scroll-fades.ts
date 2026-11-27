/**
 * Marks every `scroll-fade-y` and `scroll-fade-x` scroller with
 * `data-overflow-y` / `data-overflow-x` while it has something to scroll to on
 * that axis, and the stylesheet draws the fade only while the mark is there
 * (`globals.css`). The fade is a scroll-driven animation, and Chromium holds
 * one at its last value once its scroller stops overflowing, so a list
 * narrowed by a filter or a draft cleared after scrolling would keep a fade
 * over nothing. Taking the mark off is what retires the animation.
 *
 * Read from the document rather than measured by each scroller, so the
 * utility class alone is the whole of a fade and no component has to know.
 * A scroller is measured when it or a direct child changes size, when a child
 * comes or goes, and when text directly inside it changes, which together are
 * what move its scroll size.
 */
const FADED = ".scroll-fade-y, .scroll-fade-x";

export function watchScrollFades(root: Element = document.documentElement) {
  const watched = new WeakSet<Element>();

  const measure = (scroller: Element) => {
    if (!scroller.isConnected) {
      unwatch(scroller);
      return;
    }
    const { classList } = scroller;
    scroller.toggleAttribute(
      "data-overflow-y",
      classList.contains("scroll-fade-y") &&
        scroller.scrollHeight > scroller.clientHeight,
    );
    scroller.toggleAttribute(
      "data-overflow-x",
      classList.contains("scroll-fade-x") &&
        scroller.scrollWidth > scroller.clientWidth,
    );
  };

  const sizes = new ResizeObserver((entries) => {
    const touched = new Set<Element>();
    for (const { target } of entries) {
      if (watched.has(target)) {
        touched.add(target);
      } else if (target.parentElement && watched.has(target.parentElement)) {
        touched.add(target.parentElement);
      }
    }
    for (const scroller of touched) {
      measure(scroller);
    }
  });

  const watch = (scroller: Element) => {
    if (watched.has(scroller)) {
      return;
    }
    watched.add(scroller);
    sizes.observe(scroller);
    for (const child of scroller.children) {
      sizes.observe(child);
    }
    measure(scroller);
  };

  function unwatch(scroller: Element) {
    if (!watched.has(scroller)) {
      return;
    }
    watched.delete(scroller);
    sizes.unobserve(scroller);
    for (const child of scroller.children) {
      sizes.unobserve(child);
    }
    scroller.removeAttribute("data-overflow-y");
    scroller.removeAttribute("data-overflow-x");
  }

  const watchWithin = (node: Element) => {
    if (node.matches(FADED)) {
      watch(node);
    }
    for (const scroller of node.querySelectorAll(FADED)) {
      watch(scroller);
    }
  };

  const unwatchWithin = (node: Element) => {
    unwatch(node);
    for (const scroller of node.querySelectorAll(FADED)) {
      unwatch(scroller);
    }
  };

  const observer = new MutationObserver((records) => {
    const touched = new Set<Element>();
    for (const record of records) {
      const { target } = record;
      if (record.type === "attributes") {
        if (target instanceof Element) {
          if (target.matches(FADED)) {
            watch(target);
            touched.add(target);
          } else {
            unwatch(target);
          }
        }
        continue;
      }
      if (record.type === "characterData") {
        const parent = target.parentElement;
        if (parent && watched.has(parent)) {
          touched.add(parent);
        }
        continue;
      }
      // A child of a scroller arriving or leaving moves its scroll size; a
      // subtree arriving or leaving may carry scrollers of its own.
      const isScroller = target instanceof Element && watched.has(target);
      if (isScroller) {
        touched.add(target);
      }
      for (const node of record.addedNodes) {
        if (node instanceof Element) {
          if (isScroller) {
            sizes.observe(node);
          }
          watchWithin(node);
        }
      }
      for (const node of record.removedNodes) {
        if (node instanceof Element) {
          if (isScroller) {
            sizes.unobserve(node);
          }
          unwatchWithin(node);
        }
      }
    }
    for (const scroller of touched) {
      measure(scroller);
    }
  });

  observer.observe(root, {
    attributeFilter: ["class"],
    characterData: true,
    childList: true,
    subtree: true,
  });
  watchWithin(root);

  return () => {
    observer.disconnect();
    sizes.disconnect();
  };
}
