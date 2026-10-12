import { renderInBrowser } from "@/tests/render-browser";
import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { Command, CommandList } from "./command";

describe("CommandList", () => {
  it("gives a list of a fixed height to a scroller inside it", async () => {
    await renderInBrowser(
      <Command>
        <CommandList className="h-96 max-h-none! overflow-hidden!">
          <div className="h-full overflow-y-auto" data-testid="scroller">
            {Array.from({ length: 50 }, (_, index) => (
              <div className="h-9" key={index}>
                Row {index}
              </div>
            ))}
          </div>
        </CommandList>
      </Command>,
    );

    const scroller = page.getByTestId("scroller").element();
    expect(scroller.clientHeight).toBe(384);
    expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
  });
});
