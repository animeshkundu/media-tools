import { useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { Progress } from '@/components/Progress';
import { downloadBlob } from '@/lib/core/download';
import { Dropzone } from '@/lib/core/dropzone';
import { formatBytes, formatDuration, outputName } from '@/lib/core/format';
import {
  startAnalyze,
  startFileEncode,
  type AudioJob,
  type EncodeFormat,
} from '@/lib/core/worker';
import { Waveform } from '@/lib/tools/audio-cutter/Waveform';

type LoadedAudio = {
  duration: number;
  file: File;
  sampleRate: number;
  waveform: Float32Array;
};

export default function App() {
  const [audio, setAudio] = useState<LoadedAudio>();
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [format, setFormat] = useState<EncodeFormat>('wav');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Drop an audio file to begin.');
  const [busy, setBusy] = useState(false);
  const jobRef = useRef<AudioJob<unknown> | undefined>(undefined);

  async function load(file: File) {
    setBusy(true);
    setProgress(0);
    setStatus('Reading audio in a worker…');
    try {
      const job = startAnalyze(file, setProgress);
      jobRef.current = job;
      const analysis = await job.result;
      setAudio({ ...analysis, file });
      setStart(0);
      setEnd(analysis.duration);
      setStatus('Drag the gold handles to choose the part you want.');
    } catch (error) {
      setAudio(undefined);
      setStatus(error instanceof Error ? error.message : 'This audio file could not be read.');
    } finally {
      jobRef.current = undefined;
      setBusy(false);
    }
  }

  async function exportAudio() {
    if (!audio) return;
    setBusy(true);
    setProgress(0);
    setStatus(`Encoding ${format.toUpperCase()} in a worker…`);
    const job = startFileEncode(
      {
        file: audio.file,
        startSeconds: start,
        endSeconds: end,
        format,
      },
      setProgress,
    );
    jobRef.current = job;
    try {
      const blob = await job.result;
      downloadBlob(blob, outputName(audio.file.name, format));
      setProgress(1);
      setStatus('Done. Your download was created without uploading the file.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Export failed.');
    } finally {
      jobRef.current = undefined;
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#123b31_0,#07110f_42rem)] px-5 py-10 text-emerald-50">
      <div className="mx-auto max-w-5xl">
        <header className="mb-10 flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.22em] text-emerald-300">
              Media Tools
            </p>
            <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">Audio Cutter</h1>
            <p className="mt-4 max-w-2xl text-lg text-emerald-100/70">
              Trim audio in your browser. No upload, no account, and no network required.
            </p>
          </div>
          <div className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-4 py-2 text-sm text-emerald-200">
            100% offline
          </div>
        </header>

        {!audio ? (
          <>
            <Dropzone accept="audio/wav,audio/mpeg,.wav,.mp3" disabled={busy} onFile={load}>
              <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-emerald-400 text-2xl text-emerald-950">
                ♪
              </div>
              <p className="text-xl font-semibold">Drop a WAV or MP3 file here</p>
              <p className="mt-2 text-emerald-100/60">or click to choose a file from this device</p>
            </Dropzone>
            {busy && (
              <div className="mt-5">
                <Progress value={progress} />
                <button
                  className="mx-auto mt-4 block rounded-xl border border-red-300/30 px-5 py-3 font-semibold text-red-200 hover:bg-red-300/10"
                  onClick={() => jobRef.current?.cancel()}
                >
                  Cancel
                </button>
              </div>
            )}
          </>
        ) : (
          <section className="rounded-3xl border border-white/10 bg-black/20 p-5 shadow-2xl shadow-black/30 sm:p-8">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="max-w-xl truncate text-xl font-semibold">{audio.file.name}</h2>
                <p className="mt-1 text-sm text-emerald-100/60">
                  {formatBytes(audio.file.size)} · {formatDuration(audio.duration)} ·{' '}
                  {audio.sampleRate.toLocaleString()} Hz
                </p>
              </div>
              <button
                className="rounded-xl border border-white/15 px-4 py-2 text-sm hover:bg-white/5 disabled:opacity-50"
                disabled={busy}
                onClick={() => setAudio(undefined)}
              >
                Choose another
              </button>
            </div>

            <Waveform
              channel={audio.waveform}
              duration={audio.duration}
              start={start}
              end={end}
              onChange={(nextStart, nextEnd) => {
                setStart(nextStart);
                setEnd(nextEnd);
              }}
            />
            <div className="mt-3 flex justify-between font-mono text-sm text-amber-200">
              <span>In {formatDuration(start)}</span>
              <span>{formatDuration(end - start)} selected</span>
              <span>Out {formatDuration(end)}</span>
            </div>

            <div className="mt-8 grid gap-5 border-t border-white/10 pt-6 sm:grid-cols-[1fr_auto] sm:items-end">
              <label className="text-sm font-medium text-emerald-100/70">
                Export format
                <select
                  className="mt-2 block w-full rounded-xl border border-white/15 bg-[#0d1e1a] px-4 py-3 text-emerald-50"
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
                    onClick={() => jobRef.current?.cancel()}
                  >
                    Cancel
                  </button>
                )}
                <Button disabled={busy || end <= start} onClick={exportAudio}>
                  Cut & download
                </Button>
              </div>
            </div>
            {busy && (
              <div className="mt-5">
                <Progress value={progress} />
              </div>
            )}
          </section>
        )}
        <p aria-live="polite" className="mt-5 text-center text-sm text-emerald-100/60">
          {status}
        </p>
      </div>
    </main>
  );
}
