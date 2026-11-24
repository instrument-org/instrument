import { installKeyboardHome, setHomeFocus } from "@/client/lib/keyboard-home";
import { renderInBrowser } from "@/tests/render-browser";
import { useEffect, useRef, useState } from "react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import { useSideCaret } from "./use-side-caret";

// A page's guest, drawn on the body away from the tab that shows it.
let guest: HTMLElement;
let uninstall: () => void;

beforeEach(() => {
  uninstall = installKeyboardHome();
  guest = document.createElement("webview");
  guest.tabIndex = -1;
  guest.textContent = "Wireframe";
  document.body.append(guest);
});

afterEach(() => {
  uninstall();
  guest.remove();
});

const frames = (count: number) =>
  new Promise<void>((resolve) => {
    const step = (left: number) => {
      if (left === 0) {
        resolve();
      } else {
        requestAnimationFrame(() => {
          step(left - 1);
        });
      }
    };
    step(count);
  });

function PageHome({ delay = 0 }: { delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let stop: (() => void) | undefined;
    const timer = setTimeout(() => {
      stop =
        ref.current === null
          ? undefined
          : setHomeFocus(ref.current, {
              focus: () => {
                guest.focus();
              },
              holds: () => document.activeElement === guest,
            });
    }, delay);
    return () => {
      clearTimeout(timer);
      stop?.();
    };
  }, [delay]);
  return <div data-keyboard-home="2" ref={ref} style={{ height: 20 }} />;
}

function Content({ group }: { group: string }) {
  if (group === "chat") {
    return (
      <div data-keyboard-home="1">
        <div
          aria-label="Reply"
          contentEditable
          suppressContentEditableWarning
        />
      </div>
    );
  }
  return (
    <>
      {group === "folder" && (
        <div data-keyboard-home="1">
          <div aria-label="Row" aria-selected role="option" tabIndex={0}>
            file.html
          </div>
        </div>
      )}
      {group === "stuck" && (
        <div data-keyboard-home="1">
          <div aria-disabled aria-selected role="option">
            cannot take it
          </div>
        </div>
      )}
      <PageHome delay={group === "slow" ? 700 : 0} />
    </>
  );
}

function Window({ first, prefix }: { first: string; prefix: string }) {
  const [group, setGroup] = useState(first);
  const cardRef = useRef<HTMLDivElement>(null);
  const isPressed = useRef(false);
  useSideCaret({
    cardRef,
    hasKeyboard: true,
    isCaretOnNothing: () =>
      document.activeElement === null ||
      document.activeElement === document.body ||
      // The page of the group that left, parked.
      (document.activeElement === guest && group === "chat"),
    isCaretOnOtherSide: () => false,
    isPressed,
    shown: group,
  });
  return (
    <div data-app-tab-active="">
      {["folder", "page", "chat", "slow", "stuck"].map((each) => (
        <div
          aria-label={each}
          key={each}
          onClick={() => {
            setGroup(each);
          }}
          role="button"
        >
          {each}
        </div>
      ))}
      <input aria-label="Address" />
      <div
        data-group-side="0"
        data-keyboard=""
        data-tab-up={`${prefix}-${group}`}
        ref={cardRef}
      >
        <Content group={group} key={group} />
      </div>
    </div>
  );
}

const go = async (group: string) => {
  const row = document.querySelector<HTMLElement>(
    `[role="button"][aria-label="${group}"]`,
  );
  if (!row) {
    throw new Error("no row");
  }
  await userEvent.click(row);
  await frames(4);
};
const at = () =>
  document.activeElement === guest
    ? "page"
    : (document.activeElement?.getAttribute("aria-label") ?? "nothing");

it("puts the keyboard back in a page that is all a group shows", async () => {
  await renderInBrowser(<Window first="page" prefix="alone" />);
  await go("chat");
  expect(at()).toBe("Reply");
  await go("page");
  expect(at()).toBe("page");
  await go("chat");
  await go("page");
  expect(at()).toBe("page");
});

it("goes back to the folder or the page, whichever the tab was last worked from", async () => {
  await renderInBrowser(<Window first="folder" prefix="beside" />);
  await frames(4);
  expect(at()).toBe("Row");
  await go("chat");
  await go("folder");
  expect(at()).toBe("Row");
  guest.focus();
  await go("chat");
  await go("folder");
  expect(at()).toBe("page");
  document.querySelector<HTMLElement>('[aria-label="Row"]')?.focus();
  await go("chat");
  await go("folder");
  expect(at()).toBe("Row");
});

it("goes back to a page that was pressed, which only blurs the window", async () => {
  await renderInBrowser(<Window first="folder" prefix="pressed" />);
  await frames(4);
  expect(at()).toBe("Row");
  // A real guest takes a press in another process: no `focusin` here.
  const swallow = (event: Event) => {
    event.stopImmediatePropagation();
  };
  window.addEventListener("focusin", swallow, { capture: true });
  guest.focus();
  window.removeEventListener("focusin", swallow, { capture: true });
  window.dispatchEvent(new Event("blur"));
  await go("chat");
  await go("folder");
  expect(at()).toBe("page");
});

it("waits for a page that is still loading, unless the keyboard goes elsewhere", async () => {
  await renderInBrowser(<Window first="chat" prefix="slow" />);
  await go("slow");
  expect(at()).toBe("nothing");
  await expect.poll(at, { timeout: 3000 }).toBe("page");

  await go("chat");
  await go("slow");
  document.querySelector<HTMLElement>('[aria-label="Address"]')?.focus();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  expect(at()).toBe("Address");
});

it("leaves a home whose target refuses the keyboard for one that takes it", async () => {
  await renderInBrowser(<Window first="chat" prefix="stuck" />);
  await go("stuck");
  await expect.poll(at, { timeout: 2000 }).toBe("page");
});

it("follows a group that comes up with no press, as a link or a chord brings one up", async () => {
  await renderInBrowser(<Window first="chat" prefix="link" />);
  await frames(4);
  expect(at()).toBe("Reply");
  // A click with no press before it, which the window's press rules ignore.
  document
    .querySelector<HTMLElement>('[role="button"][aria-label="page"]')
    ?.click();
  await expect.poll(at, { timeout: 1000 }).toBe("page");
  document
    .querySelector<HTMLElement>('[role="button"][aria-label="folder"]')
    ?.click();
  await frames(4);
  guest.blur();
  document
    .querySelector<HTMLElement>('[role="button"][aria-label="chat"]')
    ?.click();
  await frames(4);
  expect(at()).toBe("Reply");
});

it("keeps the keyboard when the row of the group already up is pressed", async () => {
  await renderInBrowser(<Window first="folder" prefix="same" />);
  await frames(4);
  await go("folder");
  expect(at()).toBe("Row");
});
