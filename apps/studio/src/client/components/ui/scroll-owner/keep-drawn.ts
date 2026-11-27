import { type FarRows } from "./far-rows";

/** How many frames a turn has to be drawn before a wait for it gives up. */
const DRAW_WAIT_FRAMES = 120;

/** The rows of the turn `id`. */
export function turnSelector(id: string) {
  return `[data-turn-id="${CSS.escape(id)}"]`;
}

/**
 * Keeps `turns` drawn for `by`, in place of what it kept before, and waits
 * until they are: how the find, a quote or a link reaches a turn drawn as a
 * box.
 */
export async function keepDrawn(
  farRows: FarRows,
  content: Element,
  by: string,
  turns: ReadonlySet<string>,
) {
  farRows.keep(by, turns);
  await drawn(() => [...turns].every((turn) => isTurnDrawn(content, turn)));
}

/** Waits for `isDrawn`, a frame at a time. */
export async function drawn(isDrawn: () => boolean) {
  for (let frame = 0; frame < DRAW_WAIT_FRAMES; frame++) {
    if (isDrawn()) {
      return;
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
}

/** Whether the rows of the turn `id` are drawn rather than boxes. */
function isTurnDrawn(content: Element, id: string) {
  return [...content.querySelectorAll(turnSelector(id))].every(
    (row) => !row.hasAttribute("data-placeholder"),
  );
}
