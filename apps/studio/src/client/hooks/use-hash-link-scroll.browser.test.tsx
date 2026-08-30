import { renderInBrowser } from "@/tests/render-browser";
import { describe, expect, it, vi } from "vitest";

import { TranscriptScrollContext } from "../components/transcript-scroll-context";
import { useHashLinkScroll } from "./use-hash-link-scroll";

const HashLink = ({ href }: { href: string }) => {
  const handleHashLinkClick = useHashLinkScroll();
  return (
    <a href={href} onClick={handleHashLinkClick}>
      jump
    </a>
  );
};

describe("useHashLinkScroll", () => {
  // The scroll this hook starts is programmatic, so the scroller never counts
  // it as the reader taking over -- and while it follows the live end, the next
  // content growth pulls the view back to the bottom instead of leaving it at
  // the heading the reader clicked. `TranscriptScrollContext` is the contract:
  // hand scrolling back before moving the view.
  it("hands scrolling back to the reader before scrolling to the target", async () => {
    const releaseAutoScroll = vi.fn();
    const screen = await renderInBrowser(
      <TranscriptScrollContext value={releaseAutoScroll}>
        <div style={{ height: 200, overflowY: "auto" }}>
          <HashLink href="#target" />
          <div style={{ height: 1000 }} />
          <h2 id="target">Target</h2>
        </div>
      </TranscriptScrollContext>,
    );

    await screen.getByRole("link", { name: "jump" }).click();

    expect(releaseAutoScroll).toHaveBeenCalledOnce();
  });

  it("keeps the scroller when the fragment names nothing", async () => {
    const releaseAutoScroll = vi.fn();
    const screen = await renderInBrowser(
      <TranscriptScrollContext value={releaseAutoScroll}>
        <div style={{ height: 200, overflowY: "auto" }}>
          <HashLink href="#missing" />
        </div>
      </TranscriptScrollContext>,
    );

    await screen.getByRole("link", { name: "jump" }).click();

    expect(releaseAutoScroll).not.toHaveBeenCalled();
  });
});
