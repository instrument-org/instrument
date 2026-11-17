import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFilesTogether } from "./files-together";

// The Finder hands a selection over one file at a time; the files that came
// together open together.
describe("createFilesTogether", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const gathered = () => {
    const opened: string[][] = [];
    const add = createFilesTogether((paths) => {
      opened.push(paths);
    });
    return { add, opened };
  };

  it("waits for the next file again as each one comes", () => {
    const { add, opened } = gathered();
    add("/a");
    vi.advanceTimersByTime(80);
    add("/b");
    vi.advanceTimersByTime(80);
    add("/c");
    vi.advanceTimersByTime(99);
    expect(opened).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(opened).toEqual([["/a", "/b", "/c"]]);
  });

  it("opens what came 300 ms after the first, however many keep coming", () => {
    const { add, opened } = gathered();
    for (let at = 0; at < 6; at++) {
      add(`/${at.toString()}`);
      vi.advanceTimersByTime(60);
    }
    expect(opened).toEqual([["/0", "/1", "/2", "/3", "/4"]]);
    vi.advanceTimersByTime(100);
    expect(opened).toEqual([["/0", "/1", "/2", "/3", "/4"], ["/5"]]);
  });

  it("opens files a pause apart as hand-overs of their own", () => {
    const { add, opened } = gathered();
    add("/a");
    vi.advanceTimersByTime(150);
    add("/b");
    vi.advanceTimersByTime(150);
    expect(opened).toEqual([["/a"], ["/b"]]);
  });
});
