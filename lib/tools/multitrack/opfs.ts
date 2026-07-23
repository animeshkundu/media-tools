import { MAX_INPUT_BYTES } from '../../core/worker';
import type { AudioJob } from '../../core/worker';
import type { OPFSAssetPointer } from './schema';
import type { OPFSWorkerReply, OPFSWorkerRequest } from './opfs.worker';

export const MAX_OPFS_SLICE_BYTES = 8 * 1024 * 1024;
const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function validateOPFSAssetKey(key: string): void {
  if (!ASSET_KEY_PATTERN.test(key)) {
    throw new Error('OPFS asset keys may contain only letters, numbers, underscores, and hyphens.');
  }
}

export function validateOPFSSlice(start: number, length: number): void {
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    !Number.isSafeInteger(length) ||
    length < 1 ||
    length > MAX_OPFS_SLICE_BYTES
  ) {
    throw new Error('OPFS slices must be positive, safe ranges no larger than 8 MB.');
  }
}

type WorkerLike = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror'>;
type WorkerFactory = () => WorkerLike;

export class OPFSOperationCancelledError extends Error {
  constructor(message = 'OPFS operation cancelled.') {
    super(message);
    this.name = 'OPFSOperationCancelledError';
  }
}

export class OPFSAssetManager {
  readonly #worker: WorkerLike;
  readonly #sessionId: string;
  readonly #pending = new Map<
    number,
    { resolve: (reply: OPFSWorkerReply) => void; reject: (error: Error) => void }
  >();
  #nextRequestId = 1;

  constructor(
    workerFactory: WorkerFactory = () =>
      new Worker(new URL('./opfs.worker.ts', import.meta.url)),
    sessionId = `${Date.now()}-${crypto.randomUUID()}`,
  ) {
    validateOPFSAssetKey(sessionId);
    this.#worker = workerFactory();
    this.#sessionId = sessionId;
    this.#worker.onmessage = (event: MessageEvent<OPFSWorkerReply>) => {
      const pending = this.#pending.get(event.data.requestId);
      if (!pending) return;
      this.#pending.delete(event.data.requestId);
      if (event.data.type === 'error') pending.reject(new Error(event.data.message));
      else pending.resolve(event.data);
    };
    this.#worker.onerror = () => {
      const error = new Error('The OPFS asset worker stopped unexpectedly.');
      for (const pending of this.#pending.values()) pending.reject(error);
      this.#pending.clear();
    };
  }

  static isSupported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      'storage' in navigator &&
      typeof navigator.storage.getDirectory === 'function'
    );
  }

  store(key: string, file: File): AudioJob<OPFSAssetPointer> {
    validateOPFSAssetKey(key);
    if (file.size < 1 || file.size > MAX_INPUT_BYTES) {
      throw new Error('OPFS assets must be non-empty and no larger than 64 MB.');
    }
    return this.#request(
      { type: 'store', requestId: 0, sessionId: this.#sessionId, key, file },
      (reply) => {
        if (reply.type !== 'stored') throw new Error('Unexpected OPFS store response.');
        return { kind: 'opfs', path: reply.path };
      },
      {
        request: { type: 'remove', requestId: 0, sessionId: this.#sessionId, key },
        read: (reply) => {
          if (reply.type !== 'removed') throw new Error('Unexpected OPFS cleanup response.');
        },
      },
    );
  }

  readSlice(key: string, start: number, length: number): AudioJob<ArrayBuffer> {
    validateOPFSAssetKey(key);
    validateOPFSSlice(start, length);
    return this.#request(
      {
        type: 'read-slice',
        requestId: 0,
        sessionId: this.#sessionId,
        key,
        start,
        length,
      },
      (reply) => {
        if (reply.type !== 'slice') throw new Error('Unexpected OPFS slice response.');
        return reply.buffer;
      },
    );
  }

  remove(key: string): Promise<void> {
    validateOPFSAssetKey(key);
    return this.#request(
      { type: 'remove', requestId: 0, sessionId: this.#sessionId, key },
      (reply) => {
        if (reply.type !== 'removed') throw new Error('Unexpected OPFS remove response.');
      },
    ).result;
  }

  cleanupStaleSessions(maximumAgeMs = 24 * 60 * 60 * 1_000): Promise<void> {
    if (!Number.isSafeInteger(maximumAgeMs) || maximumAgeMs < 60_000) {
      throw new Error('OPFS cleanup age must be at least one minute.');
    }
    return this.#request(
      {
        type: 'cleanup-stale',
        requestId: 0,
        sessionId: this.#sessionId,
        cutoffTimestamp: Date.now() - maximumAgeMs,
      },
      (reply) => {
        if (reply.type !== 'cleaned') throw new Error('Unexpected OPFS cleanup response.');
      },
    ).result;
  }

  clearSession(): Promise<void> {
    return this.#request(
      { type: 'clear-session', requestId: 0, sessionId: this.#sessionId },
      (reply) => {
        if (reply.type !== 'cleared') throw new Error('Unexpected OPFS clear response.');
      },
    ).result;
  }

  dispose(): void {
    this.#worker.terminate();
    const error = new Error('OPFS asset manager disposed.');
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }

  #request<T>(
    request: OPFSWorkerRequest,
    read: (reply: OPFSWorkerReply) => T,
    cleanupOnCancel?: {
      readonly request: OPFSWorkerRequest;
      readonly read: (reply: OPFSWorkerReply) => void;
    },
  ): AudioJob<T> {
    const requestId = this.#nextRequestId;
    this.#nextRequestId += 1;
    let settled = false;
    let rejectJob: (error: Error) => void = () => undefined;
    const message = { ...request, requestId } as OPFSWorkerRequest;
    const result = new Promise<T>((resolve, reject) => {
      rejectJob = reject;
      this.#pending.set(requestId, {
        resolve: (reply) => {
          settled = true;
          try {
            resolve(read(reply));
          } catch (error) {
            reject(error instanceof Error ? error : new Error('Invalid OPFS response.'));
          }
        },
        reject: (error) => {
          settled = true;
          reject(error);
        },
      });
      this.#worker.postMessage(message);
    });
    return {
      result,
      cancel: () => {
        if (settled) return;
        settled = true;
        this.#pending.delete(requestId);
        this.#worker.postMessage({ type: 'cancel', requestId } satisfies OPFSWorkerRequest);
        if (!cleanupOnCancel) {
          rejectJob(new OPFSOperationCancelledError());
          return;
        }
        const cleanup = this.#request(cleanupOnCancel.request, cleanupOnCancel.read);
        void cleanup.result.then(
          () => rejectJob(new OPFSOperationCancelledError()),
          (error: unknown) =>
            rejectJob(
              new OPFSOperationCancelledError(
                `OPFS operation cancelled, but cache cleanup failed: ${
                  error instanceof Error ? error.message : 'unknown cleanup error'
                }`,
              ),
            ),
        );
      },
    };
  }
}
