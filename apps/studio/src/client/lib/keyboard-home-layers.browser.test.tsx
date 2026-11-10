import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/client/components/ui/context-menu";
import { renderInBrowser } from "@/tests/render-browser";
import { useEffect, useRef, useState } from "react";
import { expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";

import { focusOnceLayersClose } from "./keyboard-home";

/** What a menu or dialog opens, taking the keyboard the way a draft's window does. */
function Opened() {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(
    () =>
      focusOnceLayersClose({
        focus: () => {
          ref.current?.focus();
        },
        holds: () => document.activeElement === ref.current,
      }),
    [],
  );
  return <textarea aria-label="Prompt" ref={ref} />;
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 100));
const prompt = () => page.getByRole("textbox", { name: "Prompt" }).element();

it("takes the keyboard from a context menu that opened it", async () => {
  function Place() {
    const [asked, setAsked] = useState(false);
    return (
      <>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button type="button">Documents</button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              onClick={() => {
                setAsked(true);
              }}
            >
              Ask
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        {asked ? <Opened /> : null}
      </>
    );
  }
  await renderInBrowser(<Place />);

  await userEvent.click(page.getByRole("button", { name: "Documents" }), {
    button: "right",
  });
  await userEvent.click(page.getByRole("menuitem", { name: "Ask" }));
  await settled();

  expect(document.activeElement).toBe(prompt());
});
