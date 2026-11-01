// A player taken off the page can never sound again, and one player sounds
// at a time, whatever else still holds its element.
import { renderWithProviders } from "@/tests/render";
import { fireEvent } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";

import { AudioPlayer } from "./media-player";

const player = (src: string) => (
  <AudioPlayer autoPlay={false} name={src} onError={vi.fn()} src={src} />
);

describe("media player session", () => {
  let pause: MockInstance<HTMLMediaElement["pause"]>;
  beforeEach(() => {
    pause = vi
      .spyOn(HTMLMediaElement.prototype, "pause")
      .mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(
      () => undefined,
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pauses and empties its element once it leaves the page", () => {
    const view = renderWithProviders(player("file:///song-a.mp3"));
    const media = view.container.querySelector("audio");
    expect(media?.getAttribute("src")).toBe("file:///song-a.mp3");
    view.unmount();
    expect(media?.isConnected).toBe(false);
    expect(media?.hasAttribute("src")).toBe(false);
    expect(pause).toHaveBeenCalled();
  });

  it("pauses every other player when one starts", () => {
    const first = renderWithProviders(player("file:///song-a.mp3"));
    const second = renderWithProviders(player("file:///song-b.mp3"));
    const playing = first.container.querySelector("audio");
    const starting = second.container.querySelector("audio");
    if (!playing || !starting) {
      throw new Error("no audio element");
    }
    Object.defineProperty(playing, "paused", { value: false });
    fireEvent.play(starting);
    expect(pause.mock.contexts).toEqual([playing]);
  });
});
