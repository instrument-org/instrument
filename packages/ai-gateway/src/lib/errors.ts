export namespace TypedError {
  const PREFIX = "gateway";
  export type Type = Fetch | NotFound | Parse | Unknown | VerificationFailed;

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

  export class VerificationFailed extends Error {
    readonly type = `${PREFIX}-verification-failed-error`;
  }

  export class Unknown extends Error {
    readonly type = `${PREFIX}-unknown-error`;
  }
}
