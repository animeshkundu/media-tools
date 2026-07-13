import { useRef, useState, type DragEvent } from 'react';
import { Button } from '@/components/Button';
import { Progress } from '@/components/Progress';
import { downloadBlob } from '@/lib/core/download';
import { formatBytes, formatDuration, outputName } from '@/lib/core/format';
import { MAX_PCM_ENCODE_BYTES, startDecodeFile, type AudioJob, type EncodeFormat } from '@/lib/core/worker';
import { startJoinedEncode, type DecodedPcmTrack } from '@/lib/tools/join/join';

type JoinTrack = DecodedPcmTrack & {
  duration: number;
  file: File;
};

const ACCEPTED_AUDIO = 'audio/wav,audio/mpeg,.wav,.mp3';
export const AGGREGATE_PCM_LIMIT_MESSAGE =
  'Decoded audio size is invalid or exceeds the 256 MB processing limit. Remove tracks before adding more.';

type TrackWithChannelData = {
  channelData: Float32Array[];
};

export function decodedPcmBytesForTrack(track: TrackWithChannelData): number {
  let totalBytes = 0;
  for (const channel of track.channelData) {
    totalBytes += channel.byteLength;
    if (!Number.isSafeInteger(totalBytes)) throw new Error(AGGREGATE_PCM_LIMIT_MESSAGE);
  }
  return totalBytes;
}

export function decodedPcmBytesForTracks(tracks: readonly TrackWithChannelData[]): number {
  let totalBytes = 0;
  for (const track of tracks) {
    totalBytes += decodedPcmBytesForTrack(track);
    if (!Number.isSafeInteger(totalBytes)) throw new Error(AGGREGATE_PCM_LIMIT_MESSAGE);
  }
  return totalBytes;
}

export function tryRetainDecodedTrack(
  retainedBytes: number,
  track: TrackWithChannelData,
): { ok: true; retainedBytes: number } | { ok: false; validation: string } {
  const trackBytes = decodedPcmBytesForTrack(track);
  const projected = retainedBytes + trackBytes;
  if (!Number.isSafeInteger(projected) || projected > MAX_PCM_ENCODE_BYTES) {
    return { ok: false, validation: AGGREGATE_PCM_LIMIT_MESSAGE };
  }
  return { ok: true, retainedBytes: projected };
}

export function JoinMergeTool() {
  const [tracks, setTracks] = useState<JoinTrack[]>([]);
  const [format, setFormat] = useState<EncodeFormat>('wav');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Select at least two audio files to merge.');
  const [validation, setValidation] = useState<string>();
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const jobRef = useRef<AudioJob<unknown> | undefined>(undefined);

  async function addFiles(fileList: FileList | File[]) {
    const selected = Array.from(fileList);
    if (selected.length === 0 || busy) return;
    setValidation(undefined);
    setBusy(true);
    setProgress(0);
    setStatus(`Reading ${selected.length} file${selected.length === 1 ? '' : 's'} on this device…`);

    try {
      let retainedBytes = decodedPcmBytesForTracks(tracks);
      let rejectedByLimit = false;
      const loaded: JoinTrack[] = [];
      for (let fileIndex = 0; fileIndex < selected.length; fileIndex += 1) {
        const file = selected[fileIndex]!;
        if (selected.length > 1) {
          setStatus(`Reading file ${fileIndex + 1} of ${selected.length} on this device…`);
        }
        const job = startDecodeFile(file, (p) => {
          setProgress((fileIndex + p) / selected.length);
        });
        jobRef.current = job;
        const decoded = await job.result;
        if (decoded.channelData.length === 0) throw new Error('The audio file contains no decodable audio channels.');
        const track: JoinTrack = {
          duration: decoded.channelData[0]!.length / decoded.sampleRate,
          file,
          sampleRate: decoded.sampleRate,
          channelData: decoded.channelData,
        };
        const retained = tryRetainDecodedTrack(retainedBytes, track);
        if (!retained.ok) {
          setValidation(retained.validation);
          rejectedByLimit = true;
          break;
        }
        retainedBytes = retained.retainedBytes;
        loaded.push(track);
      }
      if (loaded.length === 0) {
        setStatus(
          rejectedByLimit
            ? 'No tracks were added because decoded audio would exceed the 256 MB processing limit.'
            : 'No tracks were added.',
        );
        return;
      }
      setTracks((current) => current.concat(loaded));
      setStatus(
        rejectedByLimit
          ? `Ready. ${loaded.length} track${loaded.length === 1 ? '' : 's'} added before reaching the 256 MB processing limit.`
          : `Ready. ${loaded.length} track${loaded.length === 1 ? '' : 's'} added.`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'These audio files could not be read.');
    } finally {
      jobRef.current = undefined;
      setBusy(false);
      setProgress(0);
    }
  }

  function moveTrack(index: number, step: -1 | 1) {
    setTracks((current) => {
      const target = index + step;
      if (target < 0 || target >= current.length) return current;
      const next = current.slice();
      const item = next[index];
      next[index] = next[target]!;
      next[target] = item!;
      return next;
    });
  }

  async function exportJoin() {
    if (tracks.length < 2) {
      setValidation('Select at least two audio files before exporting.');
      return;
    }

    setValidation(undefined);
    setBusy(true);
    setProgress(0);
    setStatus(`Joining ${tracks.length} tracks in a worker…`);
    const job = startJoinedEncode(
      tracks.map((track) => ({
        channelData: track.channelData,
        sampleRate: track.sampleRate,
      })),
      format,
      setProgress,
    );
    jobRef.current = job;
    try {
      const blob = await job.result;
      downloadBlob(blob, outputName('joined-audio', format));
      setProgress(1);
      setStatus('Done. Your merged download was created without uploading files.');
    } catch (error) {
      setProgress(0);
      setStatus(error instanceof Error ? error.message : 'Join export failed.');
    } finally {
      jobRef.current = undefined;
      setBusy(false);
    }
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-black/20 p-5 shadow-2xl shadow-black/30 sm:p-8">
      <div
        className={`rounded-3xl border border-dashed p-8 text-center transition motion-reduce:transition-none ${
          busy
            ? 'cursor-not-allowed border-white/20 bg-white/[0.03] opacity-50'
            : 'cursor-pointer border-white/20 bg-white/[0.03] hover:border-emerald-400/70'
        }`}
        onClick={() => !busy && inputRef.current?.click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event: DragEvent<HTMLDivElement>) => {
          event.preventDefault();
          void addFiles(event.dataTransfer.files);
        }}
        onKeyDown={(event) => {
          if (!busy && (event.key === 'Enter' || event.key === ' ')) inputRef.current?.click();
        }}
        role="button"
        tabIndex={busy ? -1 : 0}
      >
        <input
          ref={inputRef}
          accept={ACCEPTED_AUDIO}
          className="hidden"
          disabled={busy}
          multiple
          type="file"
          onChange={(event) => {
            void addFiles(event.target.files ?? []);
            event.target.value = '';
          }}
        />
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-emerald-400 text-2xl text-emerald-950">
          ⇉
        </div>
        <p className="text-xl font-semibold">Drop WAV or MP3 files to merge</p>
        <p className="mt-2 text-emerald-100/60">or click to choose multiple files from this device</p>
      </div>

      {tracks.length > 0 && (
        <div className="mt-6 space-y-3">
          {tracks.map((track, index) => (
            <div
              key={`${track.file.name}-${track.file.size}-${track.file.lastModified}-${index}`}
              className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{index + 1}. {track.file.name}</p>
                  <p className="text-xs text-emerald-100/60">
                    {formatBytes(track.file.size)} · {formatDuration(track.duration)} ·{' '}
                    {track.sampleRate.toLocaleString()} Hz
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    className="rounded-xl border border-white/15 px-3 py-2 text-xs hover:bg-white/5 disabled:opacity-50"
                    disabled={busy || index === 0}
                    onClick={() => moveTrack(index, -1)}
                  >
                    Move up
                  </button>
                  <button
                    className="rounded-xl border border-white/15 px-3 py-2 text-xs hover:bg-white/5 disabled:opacity-50"
                    disabled={busy || index === tracks.length - 1}
                    onClick={() => moveTrack(index, 1)}
                  >
                    Move down
                  </button>
                  <button
                    className="rounded-xl border border-red-300/30 px-3 py-2 text-xs text-red-200 hover:bg-red-300/10 disabled:opacity-50"
                    disabled={busy}
                    onClick={() =>
                      setTracks((current) => current.filter((_, currentIndex) => currentIndex !== index))
                    }
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tracks.length > 0 && (
      <div className="mt-8 grid gap-5 border-t border-white/10 pt-6 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="text-sm font-medium text-emerald-100/70">
          Export format
          <select
            className="mt-2 block w-full rounded-xl border border-white/15 bg-[#0d1e1a] px-4 py-3 text-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
            disabled={busy}
            value={format}
            onChange={(event) => setFormat(event.target.value as EncodeFormat)}
          >
            <option value="wav">WAV — lossless PCM</option>
            <option value="mp3">MP3 — 192 kbps</option>
          </select>
        </label>
        <div className="flex gap-3">
          {busy && (
            <button
              className="rounded-xl border border-red-300/30 px-5 py-3 font-semibold text-red-200 hover:bg-red-300/10"
              onClick={() => {
                setStatus('Cancelling merge…');
                jobRef.current?.cancel();
              }}
            >
              Cancel
            </button>
          )}
          <Button disabled={busy || tracks.length < 2} onClick={exportJoin}>
            Join & download
          </Button>
        </div>
      </div>
      )}

      {validation && (
        <p role="alert" className="mt-4 rounded-xl border border-red-300/30 bg-red-300/10 px-4 py-3 text-sm text-red-200">
          {validation}
        </p>
      )}
      {busy && (
        <div className="mt-5">
          <Progress value={progress} />
        </div>
      )}
      <p aria-live="polite" className="mt-5 text-center text-sm text-emerald-100/60">
        {status}
      </p>
    </section>
  );
}
