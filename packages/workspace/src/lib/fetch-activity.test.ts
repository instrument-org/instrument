import { describe, expect, it, vi } from "vitest";

import { fetchWithActivity } from "./fetch-activity";

function streamOf(chunks: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe("fetchWithActivity", () => {
  it("counts keep-alive comments as activity and passes the body through", async () => {
    const onActivity = vi.fn();
    let time = 0;
    const fetch = fetchWithActivity(
      onActivity,
      () =>
        Promise.resolve(
          new Response(
            streamOf([": keep-alive\n\n", ": keep-alive\n\n", "data: {}\n\n"]),
            { headers: { "content-type": "text/event-stream" }, status: 200 },
          ),
        ),
      () => (time += 600),
    );

    const response = await fetch("https://example.com/v1/chat/completions");

    expect(await response.text()).toBe(
      ": keep-alive\n\n: keep-alive\n\ndata: {}\n\n",
    );
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    // At 600, 1200 and 1800: the second is too soon after the first.
    expect(onActivity).toHaveBeenCalledTimes(2);
  });

  it("leaves a response with no body as it is", async () => {
    const onActivity = vi.fn();
    const original = new Response(null, { status: 204 });
    const fetch = fetchWithActivity(onActivity, () =>
      Promise.resolve(original),
    );

    expect(await fetch("https://example.com")).toBe(original);
    expect(onActivity).not.toHaveBeenCalled();
  });
});
