import { type ExceptionProcess, type SerializedError } from "./schema";

/**
 * An exception another thread or process already serialized, handed to the
 * main process's capture function in place of the error it came from. The
 * event built from it says which process threw it.
 */
export class ForwardedException {
  readonly process: ExceptionProcess;
  readonly serialized: SerializedError;

  constructor(serialized: SerializedError, process: ExceptionProcess) {
    this.serialized = serialized;
    this.process = process;
  }
}
