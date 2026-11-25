import assert from "node:assert/strict";
import { test } from "node:test";

import { startModelStub } from "./model-stub.mjs";

test("an agent turn takes the next reply, a side call does not", async () => {
  const stub = await startModelStub(["Hello there friend", { tool: "bash", input: { command: "ls" } }]);
  try {
    const models = await (await fetch(`${stub.baseURL}/models`)).json();
    assert.equal(models.data[0].id, stub.modelId);
    const ask = (tools) =>
      fetch(`${stub.baseURL}/chat/completions`, {
        body: JSON.stringify({ messages: [{ content: "hi", role: "user" }], stream: true, tools }),
        method: "POST",
      }).then((response) => response.text());
    const side = await ask([]);
    assert.match(side, /"content":"Hello /);
    const first = await ask([{ function: { name: "bash" }, type: "function" }]);
    assert.match(first, /"content":"friend"/);
    assert.match(first, /"finish_reason":"stop"/);
    const second = await ask([{ function: { name: "bash" }, type: "function" }]);
    assert.match(second, /"name":"bash"/);
    assert.match(second, /"finish_reason":"tool_calls"/);
    assert.deepEqual(stub.requests.map((each) => each.kind), ["side", "turn", "turn"]);
  } finally {
    await stub.close();
  }
});
