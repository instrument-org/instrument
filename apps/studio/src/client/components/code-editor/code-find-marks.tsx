import { type EditorView } from "@codemirror/view";
import { useLayoutEffect, useState } from "react";

import { dedupe, FindScrollMarks } from "../find-scroll-marks";
import { type CodeFind } from "./code-find";

/**
 * The editor's find matches as ticks over its scrollbar, placed by the
 * height of each match's line in the whole file, which the editor knows
 * (or estimates) for lines it has not drawn. Rendered into the editor's own
 * box, beside the panel the find card sits in.
 */
export function CodeFindMarks({
  find,
  view,
}: {
  find: CodeFind;
  view: EditorView;
}) {
  const [box, setBox] = useState({ height: 0, top: 0 });
  useLayoutEffect(() => {
    const scroller = view.scrollDOM;
    const read = () => {
      setBox({ height: scroller.clientHeight, top: scroller.offsetTop });
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(scroller);
    observer.observe(view.contentDOM);
    return () => {
      observer.disconnect();
    };
  }, [view]);
  const total = view.contentHeight;
  const marks =
    total > 0 && box.height > 0
      ? dedupe(
          find.starts.map((start, index) => {
            const line = view.lineBlockAt(start);
            return {
              at: Math.min(1, (line.top + line.height / 2) / total),
              isActive: index === find.active - 1,
            };
          }),
          box.height,
        )
      : [];
  return (
    <div
      className="pointer-events-none absolute right-0 left-0"
      style={{ height: box.height, top: box.top }}
    >
      <FindScrollMarks marks={marks} />
    </div>
  );
}
