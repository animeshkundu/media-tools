import { MAX_INPUT_BYTES } from '../../core/worker';
import { MAX_OPFS_SLICE_BYTES, validateOPFSAssetKey, validateOPFSSlice } from './opfs';

export type OPFSWorkerRequest =
  | {
      readonly type: 'store';
      readonly requestId: number;
      readonly sessionId: string;
      readonly key: string;
      readonly file: File;
    }
  | {
      readonly type: 'read-slice';
      readonly requestId: number;
      readonly sessionId: string;
      readonly key: string;
      readonly start: number;
      readonly length: number;
    }
  | {
      readonly type: 'remove';
      readonly requestId: number;
      readonly sessionId: string;
      readonly key: string;
    }
  | {
      readonly type: 'cleanup-stale';
      readonly requestId: number;
      readonly sessionId: string;
      readonly cutoffTimestamp: number;
    }
  | { readonly type: 'clear-session'; readonly requestId: number; readonly sessionId: string }
  | { readonly type: 'cancel'; readonly requestId: number };

export type OPFSWorkerReply =
  | { readonly type: 'stored'; readonly requestId: number; readonly path: string }
  | { readonly type: 'slice'; readonly requestId: number; readonly buffer: ArrayBuffer }
  | { readonly type: 'removed'; readonly requestId: number }
  | { readonly type: 'cleaned'; readonly requestId: number }
  | { readonly type: 'cleared'; readonly requestId: number }
  | { readonly type: 'error'; readonly requestId: number; readonly message: string };

type SendReply = (reply: OPFSWorkerReply, transfer?: Transferable[]) => void;

const cancelled = new Set<number>();
const active = new Set<number>();

function throwIfCancelled(requestId: number): void {
  if (cancelled.has(requestId)) throw new Error('OPFS operation cancelled.');
}

async function assetRoot(): Promise<FileSystemDirectoryHandle> {
  if (typeof navigator.storage.getDirectory !== 'function') {
    throw new Error('OPFS is not available in this browser context.');
  }
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('multitrack-assets', { create: true });
}

async function assetDirectory(sessionId: string): Promise<FileSystemDirectoryHandle> {
  validateOPFSAssetKey(sessionId);
  const root = await assetRoot();
  return root.getDirectoryHandle(sessionId, { create: true });
}

async function removeEntryIfExists(
  directory: FileSystemDirectoryHandle,
  key: string,
): Promise<void> {
  try {
    await directory.removeEntry(key);
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
  }
}

async function storeFile(
  request: Extract<OPFSWorkerRequest, { type: 'store' }>,
): Promise<string> {
  validateOPFSAssetKey(request.key);
  if (request.file.size < 1 || request.file.size > MAX_INPUT_BYTES) {
    throw new Error('OPFS assets must be non-empty and no larger than 64 MB.');
  }
  const directory = await assetDirectory(request.sessionId);
  let writable: FileSystemWritableFileStream | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>> | undefined;
  let written = 0;
  try {
    throwIfCancelled(request.requestId);
    const handle = await directory.getFileHandle(request.key, { create: true });
    throwIfCancelled(request.requestId);
    writable = await handle.createWritable();
    throwIfCancelled(request.requestId);
    reader = request.file.stream().getReader();
    while (true) {
      throwIfCancelled(request.requestId);
      const chunk = await reader.read();
      throwIfCancelled(request.requestId);
      if (chunk.done) break;
      written += chunk.value.byteLength;
      if (!Number.isSafeInteger(written) || written > MAX_INPUT_BYTES) {
        throw new Error('OPFS asset exceeded the 64 MB limit while streaming.');
      }
      await writable.write(chunk.value);
      throwIfCancelled(request.requestId);
    }
    throwIfCancelled(request.requestId);
    await writable.close();
    throwIfCancelled(request.requestId);
    return `multitrack-assets/${request.sessionId}/${request.key}`;
  } catch (error) {
    try {
      await reader?.cancel();
    } catch {
      // Removing the entry below is the authoritative cleanup.
    }
    try {
      await writable?.abort();
    } catch {
      // A closed stream cannot be aborted; removing its entry still cleans the cache.
    }
    let cleanupError: Error | undefined;
    try {
      await removeEntryIfExists(directory, request.key);
    } catch (removeError) {
      cleanupError =
        removeError instanceof Error
          ? removeError
          : new Error('Could not remove the partial OPFS asset.');
    }
    const message = error instanceof Error ? error.message : 'OPFS write failed.';
    throw cleanupError
      ? new Error(`${message} Partial-file cleanup also failed: ${cleanupError.message}`)
      : new Error(message);
  } finally {
    reader?.releaseLock();
  }
}

async function cleanupStaleSessions(
  request: Extract<OPFSWorkerRequest, { type: 'cleanup-stale' }>,
): Promise<void> {
  validateOPFSAssetKey(request.sessionId);
  if (!Number.isSafeInteger(request.cutoffTimestamp) || request.cutoffTimestamp < 0) {
    throw new Error('OPFS cleanup cutoff is invalid.');
  }
  const root = await assetRoot();
  for await (const name of root.keys()) {
    if (name === request.sessionId) continue;
    const separator = name.indexOf('-');
    const timestamp = Number(name.slice(0, separator));
    if (separator > 0 && Number.isSafeInteger(timestamp) && timestamp < request.cutoffTimestamp) {
      await root.removeEntry(name, { recursive: true });
    }
  }
}

async function clearSession(sessionId: string): Promise<void> {
  validateOPFSAssetKey(sessionId);
  const root = await assetRoot();
  try {
    await root.removeEntry(sessionId, { recursive: true });
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
  }
}

export async function processOPFSRequest(
  request: OPFSWorkerRequest,
  send: SendReply,
): Promise<void> {
  if (request.type === 'cancel') {
    if (active.has(request.requestId)) cancelled.add(request.requestId);
    return;
  }
  active.add(request.requestId);
  try {
    validateOPFSAssetKey(request.sessionId);
    if (request.type === 'cleanup-stale') {
      await cleanupStaleSessions(request);
      send({ type: 'cleaned', requestId: request.requestId });
      return;
    }
    if (request.type === 'clear-session') {
      await clearSession(request.sessionId);
      send({ type: 'cleared', requestId: request.requestId });
      return;
    }
    validateOPFSAssetKey(request.key);
    if (request.type === 'store') {
      const path = await storeFile(request);
      send({ type: 'stored', requestId: request.requestId, path });
      return;
    }
    const directory = await assetDirectory(request.sessionId);
    throwIfCancelled(request.requestId);
    if (request.type === 'remove') {
      await removeEntryIfExists(directory, request.key);
      send({ type: 'removed', requestId: request.requestId });
      return;
    }
    validateOPFSSlice(request.start, request.length);
    if (request.length > MAX_OPFS_SLICE_BYTES) throw new Error('OPFS slice exceeds 8 MB.');
    const handle = await directory.getFileHandle(request.key);
    throwIfCancelled(request.requestId);
    const file = await handle.getFile();
    throwIfCancelled(request.requestId);
    if (request.start > file.size || request.start + request.length > file.size) {
      throw new Error('OPFS slice extends beyond the stored asset.');
    }
    const buffer = await file
      .slice(request.start, request.start + request.length)
      .arrayBuffer();
    throwIfCancelled(request.requestId);
    send({ type: 'slice', requestId: request.requestId, buffer }, [buffer]);
  } catch (error) {
    send({
      type: 'error',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : 'OPFS operation failed.',
    });
  } finally {
    active.delete(request.requestId);
    cancelled.delete(request.requestId);
  }
}

if (typeof importScripts === 'function') {
  const workerScope = self as unknown as {
    postMessage(message: OPFSWorkerReply, transfer: Transferable[]): void;
  };
  self.onmessage = (event: MessageEvent<OPFSWorkerRequest>) => {
    void processOPFSRequest(event.data, (reply, transfer) =>
      workerScope.postMessage(reply, transfer ?? []),
    );
  };
}
