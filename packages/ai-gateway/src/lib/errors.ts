export namespace TypedError {
  const PREFIX = "gateway";
  export type Type =
    | Fetch
    | NotFound
    | NotListed
    | Parse
    | Unknown
    | VerificationFailed;

  export class Fetch extends Error {
    /** HTTP status code, when the failure was a non-ok response. */
    readonly status?: number;
    readonly type = `${PREFIX}-fetch-error`;

    constructor(message: string, options?: ErrorOptions & { status?: number }) {
      super(message, options);
      this.status = options?.status;
    }
  }

  export class Parse extends Error {
    readonly type = `${PREFIX}-parse-error`;
  }

  export class NotFound extends Error {
    readonly type = `${PREFIX}-not-found-error`;
  }

  /**
   * The provider answered with its catalog and the model was not on it. Kept
   * apart from `NotFound`, which covers a removed provider config or a
   * malformed URI, because this miss can clear on its own: a ChatGPT plan's
   * catalog has been seen leaving out a model it lists again seconds later.
   */
  export class NotListed extends Error {
    readonly type = `${PREFIX}-not-listed-error`;
  }

  export class VerificationFailed extends Error {
    readonly type = `${PREFIX}-verification-failed-error`;
  }

  export class Unknown extends Error {
    readonly type = `${PREFIX}-unknown-error`;
  }
}
