import { useRef, useState, type DragEvent } from 'react';
import { Button } from '@/components/Button';
import { Progress } from '@/components/Progress';
import { downloadBlob } from '@/lib/core/download';
import { formatBytes, formatDuration, outputName } from '@/lib/core/format';
import { startDecodeFile, type AudioJob, type EncodeFormat } from '@/lib/core/worker';
import { startConversion } from '@/lib/tools/convert/convert';

const ACCEPTED_AUDIO = 'audio/wav,audio/mpeg,.wav,.mp3';

type LoadedTrack = {
  channelData: Float32Array[];
  duration: number;
  file: File;
  sampleRate: number;
};

export async function decodeFileForConvert(
  file: File,
  onProgress: (p: number) => void,
): Promise<{ channelData: Float32Array[]; duration: number; sampleRate: number }> {
  const job = startDecodeFile(file, onProgress);
  const decoded = await job.result;
  if (decoded.channelData.length === 0) throw new Error('The audio file contains no decodable audio channels.');
  return {
    channelData: decoded.channelData,
    duration: decoded.channelData[0]!.length / decoded.sampleRate,
    sampleRate: decoded.sampleRate,
  };
}

export function ConvertTool() {
  const [track, setTrack] = useState<LoadedTrack>();
  const [format, setFormat] = useState<EncodeFormat>('wav');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Drop an audio file to convert to WAV or MP3.');
  const [validation, setValidation] = useState<string>();
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const jobRef = useRef<AudioJob<unknown> | null>(null);

  async function loadFile(file: File) {
    setBusy(true);
    setProgress(0);
    setValidation(undefined);
    setStatus('Reading audio on this device…');
    try {
      const job = startDecodeFile(file, setProgress);
      jobRef.current = job;
      const decoded = await job.result;
      if (decoded.channelData.length === 0) throw new Error('The audio file contains no decodable audio channels.');
      setTrack({
        channelData: decoded.channelData,
        duration: decoded.channelData[0]!.length / decoded.sampleRate,
        file,
        sampleRate: decoded.sampleRate,
      });
      setStatus('Choose WAV or MP3, then export.');
    } catch (error) {
      setTrack(undefined);
      setValidation(error instanceof Error ? error.message : 'This audio file could not be read.');
      setStatus('Loading failed.');
    } finally {
      jobRef.current = null;
      setBusy(false);
      setProgress(0);
    }
  }

  async function exportAudio() {
    if (!track) return;
    setValidation(undefined);
    setBusy(true);
    setProgress(0);
    setStatus(`Encoding ${format.toUpperCase()}…`);

    const job = startConversion(
      { channelData: track.channelData, sampleRate: track.sampleRate },
      format,
      setProgress,
    );
    jobRef.current = job;

    try {
      const blob = await job.result;
      downloadBlob(blob, outputName(track.file.name, format));
      setProgress(1);
      setStatus('Done. Your download was created without uploading the file.');
    } catch (error) {
      setProgress(0);
      if (error instanceof Error && error.message.toLowerCase().includes('cancel')) {
        setStatus('Export cancelled. No file was downloaded.');
      } else {
        setValidation(error instanceof Error ? error.message : 'Export failed.');
        setStatus('Export failed.');
      }
    } finally {
      jobRef.current = null;
      setBusy(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) void loadFile(file);
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-black/20 p-5 shadow-2xl shadow-black/30 sm:p-8">
      {!track ? (
        <div
          className={`rounded-3xl border border-dashed p-8 text-center transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 motion-reduce:transition-none ${
            busy
              ? 'cursor-not-allowed border-white/20 bg-white/[0.03] opacity-50'
              : 'cursor-pointer border-white/20 bg-white/[0.03] hover:border-emerald-400/70'
          }`}
          onClick={() => !busy && inputRef.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
          onKeyDown={(event) => {
            if (!busy && (event.key === 'Enter' || event.key === ' ')) inputRef.current?.click();
          }}
          role="button"
          tabIndex={busy ? -1 : 0}
          aria-label="Drop an audio file or press Enter to choose"
        >
          <input
            ref={inputRef}
            accept={ACCEPTED_AUDIO}
            className="hidden"
            disabled={busy}
            type="file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void loadFile(file);
              event.target.value = '';
            }}
          />
          <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-emerald-400 text-2xl text-emerald-950">
            ↻
          </div>
          <p className="text-xl font-semibold">Drop a WAV or MP3 file here</p>
          <p className="mt-2 text-emerald-100/60">or click to choose a file from this device</p>
        </div>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="max-w-xl truncate text-xl font-semibold">{track.file.name}</h2>
              <p className="mt-1 text-sm text-emerald-100/60">
                {formatBytes(track.file.size)} · {formatDuration(track.duration)} ·{' '}
                {track.sampleRate.toLocaleString()} Hz
              </p>
            </div>
            <button
              className="rounded-xl border border-white/15 px-4 py-2 text-sm hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 disabled:opacity-50"
              disabled={busy}
              onClick={() => {
                setTrack(undefined);
                setStatus('Drop an audio file to convert to WAV or MP3.');
                setValidation(undefined);
              }}
            >
              Choose another
            </button>
          </div>

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
                  className="rounded-xl border border-red-300/30 px-5 py-3 font-semibold text-red-200 hover:bg-red-300/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
                  onClick={() => {
                    setStatus('Cancelling…');
                    jobRef.current?.cancel();
                  }}
                >
                  Cancel
                </button>
              )}
              <Button
                className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
                disabled={busy}
                onClick={exportAudio}
              >
                Convert & download
              </Button>
            </div>
          </div>
        </>
      )}

      {validation && (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-red-300/30 bg-red-300/10 px-4 py-3 text-sm text-red-200"
        >
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
