import { APICallError } from "ai";
import { describe, expect, it } from "vitest";

import { describeErrorCause } from "./describe-error-cause";

describe("describeErrorCause", () => {
  it("names each link of a dropped stream's chain", () => {
    const socket = Object.assign(new Error("other side closed"), {
      code: "UND_ERR_SOCKET",
      name: "SocketError",
    });
    const error = new APICallError({
      cause: new TypeError("terminated", { cause: socket }),
      message: "Failed to process successful response",
      requestBodyValues: {},
      statusCode: 200,
      url: "http://127.0.0.1:48100/ai-gateway/providers/instrument/chat/completions",
    });

    expect(describeErrorCause(error)).toMatchInlineSnapshot(`"TypeError: terminated, caused by SocketError: other side closed (UND_ERR_SOCKET)"`);
  });

  it.each([
    ["no cause", new Error("plain")],
    ["not an error", "a string"],
  ])("is undefined for %s", (_label, error) => {
    expect(describeErrorCause(error)).toBeUndefined();
  });

  it("keeps a cause that is not an error", () => {
    expect(
      describeErrorCause(new Error("outer", { cause: { status: 499 } })),
    ).toMatchInlineSnapshot(`"{"status":499}"`);
  });

  it("stops after five links", () => {
    let error = new Error("link 7");
    for (let index = 6; index >= 0; index--) {
      error = new Error(`link ${index}`, { cause: error });
    }
    expect(describeErrorCause(error)).toMatchInlineSnapshot(`"Error: link 1, caused by Error: link 2, caused by Error: link 3, caused by Error: link 4, caused by Error: link 5"`);
  });
});
