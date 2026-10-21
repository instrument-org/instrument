export namespace TypedError {
  const PREFIX = "workspace";
  export type Type =
    | APICall
    | Conflict
    | FileSystem
    | InvalidInput
    | NotFound
    | Parse
    | ProviderLimitation
    | Storage
    | Unknown;

  export class APICall extends Error {
    readonly responseBody: string | undefined;
    readonly type = `${PREFIX}-api-call-error`;

    constructor(
      message: string,
      options?: { cause?: unknown; responseBody?: string },
    ) {
      super(message, { cause: options?.cause });
      this.responseBody = options?.responseBody;
    }
  }

  export class Conflict extends Error {
    readonly type = `${PREFIX}-conflict-error`;
  }

  export class FileSystem extends Error {
    readonly type = `${PREFIX}-filesystem-error`;
  }

  /**
   * Something the person typed that the app refuses, like a project name with a
   * character Windows forbids in a file name. The UI shows the message where
   * they typed it, so it is theirs to fix rather than a failure to report.
   */
  export class InvalidInput extends Error {
    readonly type = `${PREFIX}-invalid-input-error`;
  }

  export class NotFound extends Error {
    readonly type = `${PREFIX}-not-found-error`;
  }

  export class Parse extends Error {
    readonly type = `${PREFIX}-parse-error`;
  }

  export class ProviderLimitation extends Error {
    readonly type = `${PREFIX}-provider-limitation-error`;
  }

  export class Storage extends Error {
    readonly type = `${PREFIX}-storage-error`;
  }

  export class Unknown extends Error {
    readonly type = `${PREFIX}-unknown-error`;
  }
}
