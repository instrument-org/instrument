// A chat answered by the stand-in model: sends args.prompt (or "Say hello")
// in a new tab and returns what the window shows once the agent stops.
// args.replies scripts the answers: text, or { tool, input } for a tool call.
const stub = await model.replies(args.replies ?? ["Hello from the stand-in."]);
await press("Meta+t");
await composer.send(args.prompt ?? "Say hello");
await chat().idle();
return { asked: stub.requests.filter((each) => each.kind === "turn").length, state: await state() };
