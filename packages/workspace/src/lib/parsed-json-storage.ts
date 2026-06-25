import { err, errAsync, ok } from "neverthrow";
import { z } from "zod";

import { TypedError } from "./errors";
import { type WrappedStorage } from "./wrap-storage";

// Plain-JSON codec (no superjson). Dates round-trip via `z.coerce.date()`.
export function getParsedJsonStorageItem<T>(
  key: string,
  schema: z.ZodType<T>,
  storage: WrappedStorage,
  { signal }: { signal?: AbortSignal } = {},
) {
  return storage.getItemRaw(key, { signal }).andThen((rawItem) => {
    if (!rawItem) {
      return err(new TypedError.NotFound(`Item ${key} not found`));
    }

    let jsonString: string;

    if (typeof rawItem === "string") {
      jsonString = rawItem;
    } else if (Buffer.isBuffer(rawItem)) {
      jsonString = rawItem.toString();
    } else {
      return err(new TypedError.Parse(`Item ${key} is not a string or buffer`));
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonString);
    } catch (error) {
      return err(
        new TypedError.Parse("Failed to parse JSON", { cause: error }),
      );
    }

    const result = schema.safeParse(parsed);
    if (!result.success) {
      return err(
        new TypedError.Parse(z.prettifyError(result.error), {
          cause: result.error,
        }),
      );
    }

    return ok(result.data);
  });
}

export function setParsedJsonStorageItem<T>(
  key: string,
  value: T,
  schema: z.ZodType<T>,
  storage: WrappedStorage,
  { signal }: { signal?: AbortSignal } = {},
) {
  const result = schema.safeParse(value);
  if (!result.success) {
    return errAsync(
      new TypedError.Parse(z.prettifyError(result.error), {
        cause: result.error,
      }),
    );
  }

  const serialized = JSON.stringify(result.data);

  return storage.setItemRaw(key, serialized, { signal }).map(() => result.data);
}
