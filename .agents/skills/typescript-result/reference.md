# typescript-result API Reference

## Error Classes

Always tag custom errors with a `readonly type` discriminant. Without it, TypeScript's structural typing will collapse `ErrorA | ErrorB` into a single type.

```ts
class IOError extends Error {
  readonly type = "io-error";
}
class ParseError extends Error {
  readonly type = "parse-error";
}
```

Use `Error` subclasses (not plain objects/strings) for stack traces and familiarity.

**Expected vs unexpected errors:** Use `Result` for expected/domain errors (validation, not found, etc). Throw for unexpected errors (bugs, system failures). Register a global handler to catch those.

---

## Creating Results

### `Result.ok(value?)` / `Result.error(error)`

```ts
Result.ok(42); // Result<number, never>
Result.ok(); // Result<void, never>
Result.error(new Err()); // Result<never, Err>
```

Let TypeScript infer the return type rather than annotating explicitly.

### `Result.try(fn, transform?)`

Executes `fn` immediately. Catches throws and wraps in `Result.error`. Optional second arg transforms the caught error.

```ts
const result = Result.try(
  () => JSON.parse(str),
  (err) => new ParseError("bad json", { cause: err }),
); // Result<unknown, ParseError>
```

Works with async functions - returns `AsyncResult`.

### `Result.wrap(fn, transform?)`

Like `Result.try` but returns a new function instead of executing immediately.

```ts
const safeRead = Result.wrap(
  (path: string) => fs.readFileSync(path, "utf-8"),
  (err) => new IOError("read failed", { cause: err }),
);

const result = safeRead("file.txt"); // Result<string, IOError>
```

### `Result.fromAsync(fn | promise)`

Converts a `Promise<Result<T,E>>` or async function returning `Result` into `AsyncResult<T,E>`. Prefer this over `async function` returning `Promise<Result<...>>` for better chaining and generator compatibility.

```ts
function getUser(id: string) {
  return Result.fromAsync(async () =>
    id ? Result.ok({ id }) : Result.error(new NotFoundError()),
  );
} // returns AsyncResult<User, NotFoundError>
```

`Result.fromAsyncCatching(fn, transform?)` - same but catches throws.

### `Result.gen(fn | generator)`

Runs a generator function. Use `yield*` to unwrap `Result`/`AsyncResult` - short-circuits on first error.

```ts
const result = await Result.gen(async function* () {
  const user = yield* fetchUser(id); // unwraps or short-circuits
  const prefs = yield* fetchPrefs(user.id);
  return { ...user, prefs };
}); // AsyncResult<{ prefs: Prefs } & User, FetchError>
```

Pass `this` as first arg for class method context: `Result.gen(this, function* () { ... })`.

`Result.genCatching(fn, transform?)` - same but catches throws in the generator body.

### `Result.all(...args)`

Returns a tuple of values if all succeed, or the first error. Auto-detects sync vs async.

```ts
const result = Result.all(
  fetchUser(id), // AsyncResult<User, FetchError>
  fetchPrefs(id), // AsyncResult<Prefs, FetchError>
);

result.map(([user, prefs]) => ({ ...user, prefs }));
// AsyncResult<[User, Prefs], FetchError>
```

Accepts: values, promises, Results, AsyncResults, functions returning any of the above, generators.

`Result.allCatching(...args)` - same but catches throws.

---

## Instance Methods

All methods are available on both `Result<T,E>` and `AsyncResult<T,E>`.

### `.map(fn)`

Transforms the success value. No-ops on failure (error passes through). Polymorphic return: plain value, `Result`, `AsyncResult`, `Promise`, or generator.

```ts
result
  .map((v) => v * 2) // plain value
  .map((v) => Result.ok(v)) // Result
  .map(async (v) => v) // AsyncResult
  .map(function* (v) {
    return yield* op(v);
  }); // generator
```

### `.mapCatching(fn, transform?)`

Like `.map` but catches throws from `fn`.

```ts
result.mapCatching(
  (str) => JSON.parse(str),
  (err) => new ParseError("...", { cause: err }),
);
```

### `.mapError(fn)`

Transforms the error value. No-ops on success. Useful for re-typing or adding context.

```ts
result.mapError((err) => new WrappedError("context", { cause: err }));

// Conditional targeting
result.mapError((err) => {
  if (err.type === "not-found") {
    return new ForbiddenError();
  }
  return err;
});
```

### `.recover(fn)`

Transforms a failure into a new `Result`. Previous errors are forgotten after recovery. Polymorphic like `.map`.

```ts
persistInDB(item).recover(() => persistLocally(item));
// Result<void, IOError>  (DbError is gone)

// Conditional recovery
result.recover((err) => {
  if (err.type === "db-error") {
    return fallback();
  }
  return err; // pass through other errors
});
```

### `.recoverCatching(fn, transform?)`

Like `.recover` but catches throws.

### `.match()` _(failure only)_

Must call after narrowing to failure (`if (!result.ok)`). Chainable `.when(ErrorClass, handler)`. Call `.run()` to execute. Exhaustive - TS errors if a case is missing.

```ts
if (!result.ok) {
  const response = result
    .match()
    .when(NotFoundError, () => ({ status: 404 }))
    .when(IOError, ParseError, () => ({ status: 500 })) // group errors
    .else((err) => ({ status: 500, body: err.message })) // optional fallback
    .run();
}
```

`.when` accepts class constructors or literal values (for non-class errors). Last arg is always the handler. `.else()` can only be used once; TS errors if all cases already handled.

If any handler is async, `.run()` returns a `Promise`.

### `.fold(onSuccess, onFailure)`

Collapses a `Result` into a single value regardless of outcome.

```ts
result.fold(
  (value) => ({ status: 200, body: value }),
  (error) => ({ status: 500, body: error.message }),
);
```

Handlers can be async.

### `.toTuple()`

Returns `[value, error]` tuple. One will always be `undefined`.

```ts
const [value, error] = result.toTuple();
if (error) {
  /* handle */
}
```

### `.onSuccess(fn)` / `.onFailure(fn)`

Side effects only - return value of `fn` is ignored, original result passes through. Does NOT catch throws (use `.mapCatching` if you need that).

```ts
result
  .onSuccess((v) => logger.info("ok", v))
  .onFailure((e) => logger.error("fail", e));
```

### `.getOrNull()`

Returns value or `null` on failure.

### `.getOrDefault(fallback)`

Returns value or the provided default.

### `.getOrElse(fn)`

Returns value or the result of calling `fn(error)`. Can be async.

```ts
result.getOrElse((err) => computeFallback(err)); // T
```

### `.getOrThrow()`

Returns value or throws the error. **Avoid in production** - defeats the purpose of Result.

---

## `assertUnreachable(value)`

Utility for exhaustive `switch`/`if-else`. Throws at runtime if called; causes TS compile error if a case was missed.

```ts
import { assertUnreachable } from "typescript-result";

switch (error.type) {
  case "io-error":
    return handleIO();
  case "parse-error":
    return handleParse();
  default:
    assertUnreachable(error); // compile error if new type added
}
```

---

## Chaining vs Generator Style

**Use chaining** for simple linear transformations.

**Use generators** when you have:

- Complex control flow (conditionals, loops)
- Multiple references to earlier values
- Deeply nested chains

```ts
// Chaining
function process(id: string) {
  return fetchUser(id)
    .map((user) => fetchPrefs(user.id).map((prefs) => ({ ...user, prefs })))
    .map((data) => format(data));
}

// Generator (cleaner when referencing multiple earlier values)
function* process(id: string) {
  const user = yield* fetchUser(id);
  const prefs = yield* fetchPrefs(user.id);
  return format({ ...user, prefs });
}
const result = Result.gen(process(id));
```

Use `yield*` (not `yield`) for every `Result`/`AsyncResult`. For async ops inside a generator, use `async function*`.

You can mix styles - generators work inside `.map`:

```ts
result.map(function* (value) {
  const a = yield* opA(value);
  const b = yield* opB(a);
  return b;
});
```
