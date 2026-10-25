/**
 * -------------------------------------------------------------------------
 * @file   request-socket.ts
 * @brief  Connects node-postgres to Hyperdrive over a Cloudflare socket that
 *         can be given up on.
 *
 * @description
 *  RequestSocket is the stream node-postgres drives inside the Worker. It
 *  opens a `cloudflare:sockets` connection, pumps received bytes to pg as
 *  `data` events, writes pg's bytes to the socket, and performs the
 *  STARTTLS upgrade pg asks for when the connection string requires TLS.
 *  Ending or destroying it tears the socket down in the background and
 *  tells pg at once, so pg's connect timeout, pg-pool's connect timeout,
 *  and a request's pool close all finish on their own timers.
 *
 * @remarks
 *  pg ships pg-cloudflare for this job, but its destroy only resolves after
 *  the Cloudflare socket confirms it closed, and a socket that Hyperdrive
 *  never answers never confirms. pg reports a connect timeout through that
 *  close, so with pg-cloudflare the 10-second timeout fired in Production
 *  and nothing happened: the page hung until the browser gave up, and no
 *  tracer.request line said why. Cancelling the reader on end also lets
 *  the read loop finish cleanly instead of rejecting after the pool
 *  closed, which pg-cloudflare logged as an unhandled rejection on every
 *  request. The connect function is injected so a contract test can hand
 *  the pool a socket that never answers without a Worker runtime.
 *
 * @see
 *  data/tracer-runtime.ts
 *  tests/contracts/request-pool.test.ts
 *  node_modules/pg/lib/connection.js
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";

/** The part of a Cloudflare socket this adapter drives. */
export interface StuckSocket {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  closed: Promise<void>;
  close(): Promise<void>;
  startTls(options?: { expectedServerHostname?: string }): StuckSocket;
}

export type SocketConnect = (address: string, options?: { secureTransport?: "starttls" }) => StuckSocket;
/** Resolves the connect function once per pool, so `cloudflare:sockets` loads only inside a Worker. */
export type SocketLoader = () => Promise<SocketConnect>;

export const loadCloudflareSockets: SocketLoader = async () => {
  const { connect } = await import("cloudflare:sockets");
  return (address, options) => connect(address, { allowHalfOpen: false, ...options }) as unknown as StuckSocket;
};

type WriteCallback = (error?: unknown) => void;

const ignore = () => undefined;

export class RequestSocket extends EventEmitter {
  writable = false;
  destroyed = false;
  private socket: StuckSocket | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private upgrading = false;
  private upgraded = false;
  private closed = false;

  constructor(
    readonly ssl: boolean,
    private readonly load: SocketLoader,
  ) {
    super();
  }

  setNoDelay(): this {
    return this;
  }

  setKeepAlive(): this {
    return this;
  }

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }

  connect(port: number, host: string): this {
    this.load()
      .then((connect) => {
        if (this.destroyed) return;
        this.attach(connect(`${host}:${port}`, this.ssl ? { secureTransport: "starttls" } : undefined));
        return this.writer?.ready;
      })
      .then(() => {
        if (this.destroyed || this.closed) return;
        this.writable = true;
        this.emit("connect");
      })
      .catch((error: unknown) => this.fail(error));
    return this;
  }

  write(data: Uint8Array | string, encodingOrCallback?: BufferEncoding | WriteCallback, callback?: WriteCallback): boolean {
    const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
    const encoding = typeof encodingOrCallback === "string" ? encodingOrCallback : "utf8";
    const bytes = typeof data === "string" ? Buffer.from(data, encoding) : data;
    if (bytes.length === 0) {
      done?.();
      return true;
    }
    const writer = this.writer;
    if (!writer || this.closed) {
      const error = new Error("Cloudflare socket is not writable");
      if (done) done(error);
      else this.fail(error);
      return false;
    }
    writer.write(bytes).then(
      () => done?.(),
      (error: unknown) => (done ? done(error) : this.fail(error)),
    );
    return true;
  }

  end(data?: Uint8Array | string, encoding?: BufferEncoding, callback?: WriteCallback): this {
    if (data && data.length > 0) {
      this.write(data, encoding, () => this.teardown());
    } else {
      this.teardown();
    }
    callback?.();
    return this;
  }

  destroy(reason?: unknown): this {
    this.destroyed = true;
    this.teardown(reason);
    return this;
  }

  startTls(options: { host?: string }): void {
    const socket = this.socket;
    if (!socket || this.upgraded) {
      this.fail(new Error("Cloudflare socket cannot start TLS"));
      return;
    }
    this.reader?.releaseLock();
    this.writer?.releaseLock();
    this.upgrading = true;
    this.attach(socket.startTls(options.host ? { expectedServerHostname: options.host } : undefined));
  }

  private attach(socket: StuckSocket): void {
    this.socket = socket;
    this.writer = socket.writable.getWriter();
    this.reader = socket.readable.getReader();
    socket.closed.then(
      () => {
        if (this.upgrading) {
          this.upgrading = false;
          this.upgraded = true;
          return;
        }
        if (this.socket === socket) this.teardown();
      },
      (error: unknown) => {
        if (this.socket === socket) this.fail(error);
      },
    );
    void this.pump(this.reader, this.ssl && !this.upgrading);
  }

  private async pump(reader: ReadableStreamDefaultReader<Uint8Array>, once: boolean): Promise<void> {
    try {
      do {
        const { done, value } = await reader.read();
        if (done) return;
        this.emit("data", Buffer.from(value));
      } while (!once);
    } catch (error) {
      if (this.reader === reader && !this.closed) this.fail(error);
    }
  }

  private fail(error: unknown): void {
    if (this.closed) return;
    this.teardown(error instanceof Error ? error : new Error(String(error)));
  }

  /** Releases the socket in the background and tells pg now, once. */
  private teardown(error?: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.writable = false;
    const { reader, writer, socket } = this;
    this.reader = null;
    this.writer = null;
    this.socket = null;
    reader?.cancel().catch(ignore);
    writer?.abort().catch(ignore);
    socket?.close().catch(ignore);
    queueMicrotask(() => {
      if (error !== undefined) this.emit("error", error);
      this.emit("close");
    });
  }
}

/** True inside a Cloudflare Worker, where pg must use RequestSocket instead of a Node socket. */
export function isCloudflareWorker(): boolean {
  return typeof navigator === "object" && navigator !== null && navigator.userAgent === "Cloudflare-Workers";
}
