---
name: typescript-result
description: Use the `typescript-result` library for type-safe error handling in TypeScript. Replaces try/catch with Result<T, E> and AsyncResult<T, E> types, enabling compile-time error tracking, chaining, and generator-style composition. Use when writing functions that can fail, wrapping async operations, handling errors exhaustively, or when the user mentions Result types, error handling patterns, or typescript-result.
---

# typescript-result

Package: `typescript-result` | Import: `import { Result, AsyncResult, assertUnreachable } from "typescript-result"`

## Core Concepts

- `Result<T, E>` - synchronous result, either `{ ok: true, value: T }` or `{ ok: false, error: E }`
- `AsyncResult<T, E>` - a `Promise<Result<T, E>>` with the same chaining methods
- Errors should be typed class instances (ideally with a `readonly type` discriminant for narrowing)

```ts
class IOError extends Error {
  readonly type = "io-error";
}
```

## Creating Results

```ts
Result.ok(value); // Result<T, never>
Result.ok(); // Result<void, never>
Result.error(new Err()); // Result<never, Err>

// Wrap a throwing function (executes immediately)
Result.try(
  () => JSON.parse(str),
  (err) => new ParseError("bad json", { cause: err }),
);

// Wrap a function, returning a new function (deferred)
const safeRead = Result.wrap(
  (path: string) => fs.readFileSync(path, "utf-8"),
  (err) => new IOError("read failed", { cause: err }),
);

// Async - returns AsyncResult
Result.fromAsync(async () =>
  Math.random() > 0.5 ? Result.ok("yes") : Result.error(new Err()),
);
```

## Transforming: `map` / `mapCatching`

`map` runs only on success; errors pass through unchanged. Polymorphic: return a plain value, `Result`, `AsyncResult`, `Promise`, or generator.

```ts
const result = readFile(path)
  .map((contents) => parseJSON(contents)) // can return Result
  .map((json) => validate(json)) // chaining
  .mapCatching(
    (data) => riskyTransform(data),
    (err) => new TransformError("...", { cause: err }),
  );
```

## Generator Style

Use `yield*` inside `Result.gen` to unwrap results imperatively. Short-circuits on first error.

```ts
const result = await Result.gen(async function* () {
  const contents = yield* readFile(path); // unwraps or short-circuits
  const json = yield* Result.try(
    () => JSON.parse(contents),
    (err) => new ParseError("bad json", { cause: err }),
  );
  return validate(json);
});
```

**When to use generators vs chaining:**

- Generators: complex control flow, loops, conditionals, multiple references to earlier values
- Chaining: simple linear transformations

## Combining Multiple Results

```ts
// Returns first error if any fail; otherwise tuple of values
const result = Result.all(
  fetchUser(id), // AsyncResult<User, FetchError>
  fetchDetails(id), // AsyncResult<UserDetails, FetchError>
);

result.map(([user, details]) => ({ ...user, details }));
```

## Unwrapping

```ts
// Narrow with .ok
if (result.ok) {
  result.value; // T
} else {
  result.error; // E
}

// Tuple destructuring
const [value, error] = result.toTuple();
if (error) {
  /* handle */
}

// Fold (success + failure handlers)
result.fold(
  (value) => ({ status: 200, body: value }),
  (error) => ({ status: 500, body: error.message }),
);

// Getters
result.getOrNull(); // T | null
result.getOrDefault(fallback); // T
result.getOrElse(() => fb); // T (callback, can be async)
result.getOrThrow(); // T or throws — avoid in production
```

## Error Handling

```ts
if (!result.ok) {
  result
    .match()
    .when(IOError, (err) => handleIO(err))
    .when(ParseError, ValidationError, () => handleBoth()) // group errors
    .else((err) => handleUnknown(err)) // optional fallback
    .run(); // exhaustive: TS errors if a case is missing
}
```

Use `assertUnreachable` for exhaustive switch/if-else:

```ts
import { assertUnreachable } from "typescript-result";

switch (error.type) {
  case "io-error":
    return handleIO();
  case "parse-error":
    return handleParse();
  default:
    assertUnreachable(error); // compile error if cases missed
}
```

## Typical Patterns

**Wrap external APIs at the boundary:**

```ts
const fetchUser = Result.wrap(
  (id: string) => fetch(`/users/${id}`).then((r) => r.json()),
  (err) => new FetchError("fetch failed", { cause: err }),
);
```

**Async route handler:**

```ts
async function handler(id: string) {
  const result = await fetchUser(id).map(validate);
  return result.fold(
    (user) => ({ status: 200, body: user }) as const,
    (err) =>
      err
        .match()
        .when(FetchError, () => ({ status: 503, body: "unavailable" }) as const)
        .when(
          ValidationError,
          () => ({ status: 400, body: "invalid" }) as const,
        )
        .run(),
  );
}
```

**Prefer `Result.fromAsync` over `async` functions returning `Result`** to keep `AsyncResult` as the return type (plays better with generators and chaining):

```ts
// prefer this
function getUser(id: string) {
  return Result.fromAsync(async () => ...);
}

// over this
async function getUser(id: string): Promise<Result<...>> { ... }
```

## Catching variants

Every creation and composition API has a `*Catching` sibling that catches thrown exceptions and wraps them into a failed result. Use the catching variant at trust boundaries (external libraries, code you don't control, legacy code):

| Safe (no throw protection) | Catching (wraps throws)     |
| -------------------------- | --------------------------- |
| `Result.gen`               | `Result.genCatching`        |
| `Result.try`               | _(try is already catching)_ |
| `Result.fromAsync`         | `Result.fromAsyncCatching`  |
| `result.map`               | `result.mapCatching`        |

**`Result.gen` does NOT catch thrown exceptions.** If any called function can throw (rather than returning a `Result.error`), use `Result.genCatching` or wrap the whole block in `Result.fromAsyncCatching` instead.

```ts
// WRONG if fetchUser can throw internally
Result.gen(async function* () {
  const user = yield* fetchUser(id); // only catches Result errors, not thrown exceptions
});

// RIGHT
Result.genCatching(
  async function* () {
    const user = yield* fetchUser(id);
  },
  (err) => new FetchError("...", { cause: err }),
);
```

## `fromAsyncCatching` unwraps `AsyncResult` returns automatically

When the async callback passed to `Result.fromAsyncCatching` returns an `AsyncResult` (or `Result`), the library automatically unwraps it — you don't end up with `Result<Result<T, E>, E>`. This means you can safely `return` an `AsyncResult` from inside a `fromAsyncCatching` block and it resolves to the inner value:

```ts
// This is correct — the AsyncResult returned by fetchUser is unwrapped automatically
Result.fromAsyncCatching(
  async () => fetchUser(id), // returns AsyncResult<User, FetchError>
  (err) => new UnknownError("...", { cause: err }),
);
// yields AsyncResult<User, FetchError | UnknownError>
```

This is the pattern used in `fetchModelsForProvider`: each `case` branch returns an `AsyncResult`, which `fromAsyncCatching` flattens. **Don't try to convert this to `Result.gen` — that would drop the exception-catching safety net**, and any underlying function that throws (rather than returning `Result.error`) would bubble up uncaught.

## Full API Reference

For complete method signatures, edge cases, and additional examples, see [reference.md](reference.md).
