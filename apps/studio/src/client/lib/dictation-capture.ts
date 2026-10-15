/** What the recorder writes, and what the API is told it is getting. */
const RECORDING_MIME_TYPE = "audio/webm;codecs=opus";
/** The rate the API estimates a recording's length by, and caps its size from. */
const RECORDING_BITS_PER_SECOND = 32_000;

/** Why the microphone could not be opened, in the terms a toast speaks. */
export class MicrophoneError extends Error {
  readonly kind:
    | "capture-failed"
    | "microphone-busy"
    | "microphone-refused"
    | "no-microphone";

  constructor(kind: MicrophoneError["kind"], options?: ErrorOptions) {
    super(kind, options);
    this.kind = kind;
  }
}

function microphoneErrorOf(error: unknown): MicrophoneError {
  const name = error instanceof DOMException ? error.name : undefined;
  switch (name) {
    case "NotAllowedError":
    case "SecurityError": {
      return new MicrophoneError("microphone-refused", { cause: error });
    }
    case "NotFoundError":
    case "OverconstrainedError": {
      return new MicrophoneError("no-microphone", { cause: error });
    }
    case "AbortError":
    case "NotReadableError": {
      return new MicrophoneError("microphone-busy", { cause: error });
    }
    default: {
      return new MicrophoneError("capture-failed", { cause: error });
    }
  }
}

/**
 * One recording from the microphone: a MediaRecorder writing the whole take.
 * Each chunk goes to
 * {@link MicCapture.onChunk} as it is written, for a live stream, and the
 * whole take is kept for an upload once it stops. Only the first chunk
 * carries the container's header, so chunks only make sense in order and
 * from the start.
 */
export class MicCapture {
  private readonly chunks: Blob[] = [];
  private chunkListener: ((chunk: Blob) => void) | undefined;
  private startedAt: number | undefined;
  /**
   * Settles on the recorder's own `stop`, which comes after its last chunk.
   * A recorder can stop by itself, when its track ends, so waiting on its
   * state is not enough: it reads inactive before the last chunk arrives.
   */
  private readonly stopped: Promise<void>;

  private constructor(
    /** The microphone's stream, for anything that wants to listen along. */
    readonly stream: MediaStream,
    private readonly recorder: MediaRecorder,
  ) {
    this.stopped = new Promise((resolve) => {
      recorder.addEventListener(
        "stop",
        () => {
          resolve();
        },
        { once: true },
      );
    });
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
        this.chunkListener?.(event.data);
      }
    });
  }

  /** Opens the microphone (the default when `deviceId` is not given) and starts recording. */
  static async open(deviceId?: string): Promise<MicCapture> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          ...(deviceId && { deviceId: { exact: deviceId } }),
        },
      });
    } catch (error) {
      throw microphoneErrorOf(error);
    }

    try {
      const recorder = new MediaRecorder(stream, {
        audioBitsPerSecond: RECORDING_BITS_PER_SECOND,
        mimeType: MediaRecorder.isTypeSupported(RECORDING_MIME_TYPE)
          ? RECORDING_MIME_TYPE
          : undefined,
      });
      const capture = new MicCapture(stream, recorder);
      await new Promise<void>((resolve, reject) => {
        recorder.addEventListener(
          "start",
          () => {
            capture.startedAt = performance.now();
            resolve();
          },
          { once: true },
        );
        recorder.addEventListener("error", reject, { once: true });
        // A timeslice, so a live stream hears the take a quarter second at
        // a time, and a long take is held as chunks rather than one buffer
        // that grows until the end.
        recorder.start(250);
      });
      return capture;
    } catch (error) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      throw microphoneErrorOf(error);
    }
  }

  /** Time since audio started being written. */
  elapsedMs(): number {
    return this.startedAt === undefined
      ? 0
      : performance.now() - this.startedAt;
  }

  /**
   * Hands each chunk to `listener` as it is written, starting with the ones
   * already written, so it hears the take whole and in order.
   */
  onChunk(listener: (chunk: Blob) => void): void {
    for (const chunk of this.chunks) {
      listener(chunk);
    }
    this.chunkListener = listener;
  }

  /** Calls back once if the microphone goes away mid-take (unplugged, taken by the system). */
  onEnded(callback: () => void): void {
    for (const track of this.stream.getAudioTracks()) {
      track.addEventListener("ended", callback, { once: true });
    }
  }

  /** Stops recording and hands back the whole take. */
  async stop(): Promise<Blob> {
    if (this.recorder.state !== "inactive") {
      this.recorder.stop();
    }
    await this.stopped;
    this.release();
    return new Blob(this.chunks, {
      type: this.recorder.mimeType || RECORDING_MIME_TYPE,
    });
  }

  /** Stops recording and throws the take away. */
  cancel(): void {
    if (this.recorder.state !== "inactive") {
      this.recorder.stop();
    }
    this.chunks.length = 0;
    this.release();
  }

  private release(): void {
    for (const track of this.stream.getTracks()) {
      track.stop();
    }
  }
}
