import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { Progress } from '@/components/Progress';
import { downloadBlob } from '@/lib/core/download';
import { Dropzone } from '../../lib/core/dropzone';
import { formatBytes, formatDuration, outputName } from '@/lib/core/format';
import { startDecodeFile, type AudioJob, type EncodeFormat } from '@/lib/core/worker';
import { startChangeSpeedEncode } from '@/lib/tools/change-speed/changeSpeed';

const ACCEPTED_AUDIO = 'audio/wav,audio/mpeg,.wav,.mp3';

type LoadedTrack = {
  channelData: Float32Array[];
  duration: number;
  file: File;
  sampleRate: number;
};

export async function decodeFileForChangeSpeed(
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

export function ChangeSpeedTool() {
  const [track, setTrack] = useState<LoadedTrack>();
  const [speedFactor, setSpeedFactor] = useState(1);
  const [format, setFormat] = useState<EncodeFormat>('wav');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Drop an audio file to adjust its speed.');
  const [validation, setValidation] = useState<string>();
  const [busy, setBusy] = useState(false);
  const jobRef = useRef<AudioJob<unknown> | null>(null);

  useEffect(
    () => () => {
      jobRef.current?.cancel();
    },
    [],
  );

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
      setStatus('Set the speed factor and export.');
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

    const job = startChangeSpeedEncode(
      { channelData: track.channelData, sampleRate: track.sampleRate },
      speedFactor,
      format,
      setProgress,
    );
    jobRef.current = job;
    setBusy(true);
    setProgress(0);
    setStatus(`Encoding ${format.toUpperCase()} at ${speedFactor}× in a worker…`);
    try {
      const blob = await job.result;
      downloadBlob(blob, outputName(track.file.name, format));
      setProgress(1);
      setStatus('Done. Your download was created without uploading the file.');
    } catch (error) {
      setProgress(0);
      if (error instanceof Error && error.message.includes('cancel')) {
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

  const outputDuration = track ? track.duration / speedFactor : 0;

  return (
    <section className="rounded-[2rem] border border-white/10 bg-black/20 p-2 shadow-[0_32px_100px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:p-3">
      {!track ? (
        <Dropzone accept={ACCEPTED_AUDIO} disabled={busy} onFile={loadFile}>
          <div className="mx-auto mb-6 grid h-16 w-16 place-items-center rounded-2xl bg-emerald-300 text-emerald-950 shadow-[0_12px_35px_rgba(52,211,153,0.18)]">
            <svg
              aria-hidden="true"
              className="h-7 w-7"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.8"
            >
              <path d="M4 15a8 8 0 1 1 16 0M12 15l4-5M7 18h10" />
            </svg>
          </div>
          <p className="text-2xl font-black tracking-[-0.03em] text-white sm:text-3xl">
            Drop a WAV or MP3 file here
          </p>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-emerald-100/55">
            Choose a local file, set the pace, and hear the difference in the exported track.
          </p>
        </Dropzone>
      ) : (
        <div className="p-4 sm:p-6">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-white/8 pb-5">
            <div>
              <p className="text-[0.65rem] font-bold uppercase tracking-[0.13em] text-emerald-300">
                Source track
              </p>
              <h2 className="mt-1 max-w-xl truncate text-xl font-bold text-white">{track.file.name}</h2>
              <p className="mt-1.5 text-xs text-emerald-100/55">
                {formatBytes(track.file.size)} · {formatDuration(track.duration)} ·{' '}
                {track.sampleRate.toLocaleString()} Hz
              </p>
            </div>
            <button
              className="rounded-xl border border-white/12 px-4 py-2.5 text-xs font-bold text-emerald-100/65 hover:bg-white/5 disabled:opacity-50"
              disabled={busy}
              onClick={() => {
                setTrack(undefined);
                setStatus('Drop an audio file to adjust its speed.');
                setValidation(undefined);
              }}
            >
              Choose another
            </button>
          </div>

          <div className="rounded-3xl border border-white/8 bg-white/[0.025] p-5 sm:p-7">
            <div className="mb-5 flex items-end justify-between gap-4">
              <div>
                <p className="text-[0.65rem] font-bold uppercase tracking-[0.13em] text-emerald-100/55">
                  Pace control
                </p>
                <p className="mt-1 text-sm text-emerald-100/55">Speed and pitch move together.</p>
              </div>
              <strong className="font-mono text-3xl tracking-tight text-emerald-200">
                {speedFactor.toFixed(2)}×
              </strong>
            </div>
            <label className="block text-xs font-bold uppercase tracking-[0.1em] text-emerald-100/55">
              Speed factor
              <div className="mt-3 flex items-center gap-4">
                <input
                  aria-label="Speed factor"
                  className="h-2 w-full cursor-pointer appearance-none rounded-full accent-emerald-300 disabled:opacity-50 motion-reduce:transition-none"
                  disabled={busy}
                  max={4}
                  min={0.25}
                  step={0.05}
                  type="range"
                  value={speedFactor}
                  onChange={(event) => setSpeedFactor(Number(event.target.value))}
                />
              </div>
            </label>
            <div className="mt-5 grid grid-cols-2 gap-3 text-xs">
              <p className="rounded-xl border border-white/8 bg-black/10 p-3 text-emerald-100/55">
                <span className="block text-[0.6rem] font-bold uppercase tracking-[0.1em]">Input</span>
                <strong className="mt-1 block font-mono text-sm text-white">{formatDuration(track.duration)}</strong>
              </p>
              <p className="rounded-xl border border-emerald-300/15 bg-emerald-300/[0.05] p-3 text-emerald-100/55">
                <span className="block text-[0.6rem] font-bold uppercase tracking-[0.1em]">Estimate</span>
                <strong className="mt-1 block font-mono text-sm text-emerald-200">~{formatDuration(outputDuration)}</strong>
              </p>
            </div>
            <p className="mt-4 text-xs text-emerald-100/55">
              Input: {formatDuration(track.duration)} → Output: ~{formatDuration(outputDuration)}
              {speedFactor < 1 && (
                <span className="ml-2 text-amber-300/80">(slower, longer)</span>
              )}
              {speedFactor > 1 && (
                <span className="ml-2 text-amber-300/80">(faster, shorter)</span>
              )}
            </p>
          </div>

          <div className="mt-6 grid gap-5 border-t border-white/8 pt-5 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="text-xs font-bold uppercase tracking-[0.1em] text-emerald-100/55">
              Export format
              <select
                className="mt-2 block w-full rounded-xl border border-white/12 bg-[#0a1a16] px-4 py-3.5 text-sm font-semibold normal-case tracking-normal text-emerald-50"
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
                    setStatus('Cancelling…');
                    jobRef.current?.cancel();
                  }}
                >
                  Cancel
                </button>
              )}
              <Button disabled={busy} onClick={exportAudio}>
                Change speed & download
              </Button>
            </div>
          </div>
        </div>
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
      <p aria-live="polite" className="mt-5 pb-3 text-center text-xs font-medium text-emerald-100/55">
        {status}
      </p>
    </section>
  );
}
