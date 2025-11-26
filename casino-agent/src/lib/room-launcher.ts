import { resolve } from 'node:path';

type LaunchResult = {
  port: number;
  baseUrl: string;
  cardUrl: string;
  stop: () => void;
};

type RoomLauncherOptions = {
  workdir: string;
  bin: string;
  args: string[];
  portRangeStart: number;
  portRangeEnd: number;
};

const wait = (ms: number) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

export class RoomLauncher {
  private readonly workdir: string;
  private readonly bin: string;
  private readonly args: string[];
  private readonly portStart: number;
  private readonly portEnd: number;
  private nextPort: number;
  private readonly activePorts = new Set<number>();

  constructor(options: RoomLauncherOptions) {
    this.workdir = resolve(options.workdir);
    this.bin = options.bin;
    this.args = options.args;
    this.portStart = options.portRangeStart;
    this.portEnd = options.portRangeEnd;
    this.nextPort = this.portStart;
  }

  public async launch(roomId: string, overrides?: { port?: number }): Promise<LaunchResult> {
    const port = overrides?.port ?? this.allocatePort();
    const env = {
      ...process.env,
      PORT: String(port),
      ROOM_ID: roomId,
      ROOM_AGENT_NAME: `${roomId}`,
    };

    const child = Bun.spawn({
      cmd: [this.bin, ...this.args],
      cwd: this.workdir,
      stdout: 'inherit',
      stderr: 'inherit',
      env,
    });

    try {
      await this.waitForReady(port);
    } catch (error) {
      child.kill();
      this.releasePort(port);
      throw error;
    }

    const baseUrl = `http://127.0.0.1:${port}`;
    const cardUrl = `${baseUrl}/.well-known/agent-card.json`;

    const stop = () => {
      if (!child.killed) {
        child.kill();
      }
      this.releasePort(port);
    };

    return {
      port,
      baseUrl,
      cardUrl,
      stop,
    };
  }

  private allocatePort(): number {
    let attempts = 0;
    let candidate = this.nextPort;
    while (this.activePorts.has(candidate)) {
      candidate += 1;
      attempts += 1;
      if (candidate > this.portEnd) {
        candidate = this.portStart;
      }
      if (attempts > this.portEnd - this.portStart + 1) {
        throw new Error('No free ports available for poker room agents.');
      }
    }
    this.activePorts.add(candidate);
    this.nextPort = candidate + 1 > this.portEnd ? this.portStart : candidate + 1;
    return candidate;
  }

  private releasePort(port: number): void {
    this.activePorts.delete(port);
    if (this.nextPort === port) {
      this.nextPort = port + 1 > this.portEnd ? this.portStart : port + 1;
    }
  }

  private async waitForReady(port: number): Promise<void> {
    const cardUrl = `http://127.0.0.1:${port}/.well-known/agent-card.json`;
    const maxAttempts = 50;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await wait(200);
      try {
        const response = await fetch(cardUrl, { method: 'GET' });
        if (response.ok) {
          return;
        }
      } catch {
        // swallow until timeout
      }
    }
    throw new Error(`Room agent at port ${port} failed to start.`);
  }
}
