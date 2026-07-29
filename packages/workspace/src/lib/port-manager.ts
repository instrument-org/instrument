import { detect } from "detect-port";

interface PortManagerOptions {
  basePort: number;
  maxAttempts: number;
}

class Semaphore {
  private counter = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.counter < this.max) {
      this.counter++;
      return;
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  release(): void {
    if (this.queue.length > 0) {
      const resolve = this.queue.shift();
      if (resolve) {
        resolve();
      }
    } else {
      this.counter--;
    }
  }
}

export class PortManager {
  private readonly basePort: number;
  private readonly maxAttempts: number;
  private readonly semaphore = new Semaphore(1);
  private readonly usedPorts = new Set<number>();

  constructor(options: PortManagerOptions) {
    this.basePort = options.basePort;
    this.maxAttempts = options.maxAttempts;
  }

  releasePort(port: number): void {
    this.usedPorts.delete(port);
  }

  async reservePort(): Promise<number> {
    await this.semaphore.acquire();

    try {
      // Start from the base port to reuse any released lower ports
      let port = this.basePort;
      const startingPort = port;
      let attempts = 0;

      while (attempts < this.maxAttempts) {
        // Ports we already handed out cost nothing to skip, so they don't spend
        // the probe budget the error message reports on.
        while (this.usedPorts.has(port)) {
          port++;
        }

        // Use detect to check if the port is actually available on the system
        const detectedPort = await detect(port);
        attempts++;

        if (detectedPort === port) {
          this.usedPorts.add(port);
          return port;
        }

        port++;
      }

      throw new Error(
        `Failed to find an available port after trying ${this.maxAttempts} ports starting from ${startingPort}`,
      );
    } finally {
      this.semaphore.release();
    }
  }
}
