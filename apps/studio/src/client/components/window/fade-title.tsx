import { cn } from "@/client/lib/utils";
import { type ComponentProps, useLayoutEffect, useRef } from "react";

/**
 * A name on one line that fades out at its end when it is too long for its
 * room, rather than ending in an ellipsis or cut through a letter: a tab's in
 * a strip, a row's in the sidebar. A name that fits shows whole, unfaded.
 * `--title-fade-clear` keeps the fade clear of that much of its end, for a
 * name with something standing over its end (a tab's X).
 */
export function FadeTitle({ className, ...props }: ComponentProps<"span">) {
  const ref = useRef<HTMLSpanElement>(null);
  const measure = () => {
    const element = ref.current;
    element?.toggleAttribute(
      "data-overflows",
      element.scrollWidth > element.clientWidth,
    );
  };
  // Its words change without its box changing, and its box without them.
  // Measuring reads layout, which mid-commit makes the browser lay out the
  // whole window early, so a render that leaves its words and look as they
  // were skips it. The observer's first call measures it as it mounts, once
  // the frame is laid out.
  const measured = useRef<string>(undefined);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const drawn = `${element.className}\n${element.textContent}`;
    if (measured.current !== undefined && measured.current !== drawn) {
      measure();
    }
    measured.current = drawn;
  });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  return <span className={cn("title-fade", className)} ref={ref} {...props} />;
}
