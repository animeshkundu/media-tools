import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { Progress } from '@/components/Progress';
import { downloadBlob } from '@/lib/core/download';
import { Dropzone } from '@/lib/core/dropzone';
import { formatBytes, formatDuration, outputName } from '@/lib/core/format';
import {
  startAnalyze,
  type AudioJob,
  type EncodeFormat,
} from '@/lib/core/worker';
import { startVolumeFadesEncode } from '@/lib/tools/volume-fades/startVolumeFades';
import { PeakReadout } from '@/lib/tools/volume-fades/PeakReadout';
import {
  amplitudeToDbfs,
  peakState,
  previewBinnedVolumeFades,
  type FadeCurve,
  type VolumeFadeOptions,
} from '@/lib/tools/volume-fades/volumeFades';

const ACCEPTED_AUDIO = 'audio/wav,audio/mpeg,.wav,.mp3';
const DISPLAY_BARS = 96;

type LoadedTrack = {
  duration: number;
  file: File;
  sampleRate: number;
  waveform: Float32Array;
};

function formatDbfs(amplitude: number): string {
  const value = amplitudeToDbfs(amplitude);
  return Number.isFinite(value) ? `${value.toFixed(1)} dBFS` : '-∞ dBFS';
}

function compactWaveform(waveform: Float32Array): number[] {
  const bars = Math.min(DISPLAY_BARS, waveform.length);
  return Array.from({ length: bars }, (_, bar) => {
    const start = Math.floor((bar * waveform.length) / bars);
    const end = Math.max(start + 1, Math.floor(((bar + 1) * waveform.length) / bars));
    let peak = 0;
    for (let index = start; index < end; index += 1) peak = Math.max(peak, waveform[index] ?? 0);
    return peak;
  });
}

export function VolumeFadesTool() {
  const [track, setTrack] = useState<LoadedTrack>();
  const [gainPercent, setGainPercent] = useState(100);
  const [fadeInSeconds, setFadeInSeconds] = useState(0);
  const [fadeOutSeconds, setFadeOutSeconds] = useState(0);
  const [curve, setCurve] = useState<FadeCurve>('linear');
  const [normalize, setNormalize] = useState(false);
  const [format, setFormat] = useState<EncodeFormat>('wav');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Drop an audio file to adjust its volume and fades.');
  const [validation, setValidation] = useState<string>();
  const [busy, setBusy] = useState(false);
  const jobRef = useRef<AudioJob<unknown> | null>(null);

  useEffect(
    () => () => {
      jobRef.current?.cancel();
    },
    [],
  );

  const options: VolumeFadeOptions = useMemo(
    () => ({
      curve,
      fadeInSeconds,
      fadeOutSeconds,
      gainPercent,
      normalize,
    }),
    [curve, fadeInSeconds, fadeOutSeconds, gainPercent, normalize],
  );

  const preview = useMemo(() => {
    if (!track) return undefined;
    const result = previewBinnedVolumeFades(track.waveform, track.duration, options);
    return { analysis: result.analysis, bars: compactWaveform(result.waveform) };
  }, [options, track]);

  async function loadFile(file: File) {
    setBusy(true);
    setProgress(0);
    setValidation(undefined);
    setStatus('Analyzing audio in a worker…');
    try {
      const job = startAnalyze(file, setProgress);
      jobRef.current = job;
      const analysis = await job.result;
      setTrack({ ...analysis, file });
      setGainPercent(100);
      setFadeInSeconds(0);
      setFadeOutSeconds(0);
      setNormalize(false);
      setStatus('Set gain and fades, then export a new file.');
    } catch (error) {
      setTrack(undefined);
      if (error instanceof Error && error.message.includes('cancel')) {
        setStatus('Analysis cancelled. No file was loaded.');
      } else {
        setValidation(error instanceof Error ? error.message : 'This audio file could not be read.');
        setStatus('Loading failed.');
      }
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
    setStatus(`Applying volume and fades, then encoding ${format.toUpperCase()} in a worker…`);
    try {
      const job = startVolumeFadesEncode(track.file, options, format, setProgress);
      jobRef.current = job;
      const blob = await job.result;
      downloadBlob(blob, outputName(track.file.name, format));
      setProgress(1);
      setStatus('Done. Your adjusted audio was created without uploading the file.');
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

  const gainDb = gainPercent === 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(gainPercent / 100);
  const projectedState = preview ? peakState(preview.analysis.outputPeak) : 'safe';
  const fadeStep = track ? Math.max(0.01, track.duration / 1_000) : 0.01;

  return (
    <section className="rounded-[2rem] border border-white/10 bg-black/20 p-2 shadow-[0_32px_100px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:p-3">
      {!track ? (
        <>
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
                <path d="M4 12h3l2-6 4 12 2-6h5M5 21h14" />
              </svg>
            </div>
            <p className="text-2xl font-black tracking-[-0.03em] text-white sm:text-3xl">
              Drop a WAV or MP3 file here
            </p>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-emerald-100/55">
              Apply export-only gain, fades, or peak normalization without changing live playback.
            </p>
          </Dropzone>
          {busy && (
            <div className="mt-4 flex justify-center">
              <button
                className="rounded-xl border border-red-300/30 px-5 py-3 font-semibold text-red-200 hover:bg-red-300/10"
                type="button"
                onClick={() => {
                  setStatus('Cancelling analysis…');
                  jobRef.current?.cancel();
                }}
              >
                Cancel analysis
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="p-4 sm:p-6">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-white/8 pb-5">
            <div className="min-w-0">
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
              type="button"
              onClick={() => {
                setTrack(undefined);
                setValidation(undefined);
                setStatus('Drop an audio file to adjust its volume and fades.');
              }}
            >
              Choose another
            </button>
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.75fr)]">
            <div className="rounded-3xl border border-white/8 bg-white/[0.025] p-5 sm:p-6">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-[0.65rem] font-bold uppercase tracking-[0.13em] text-emerald-100/55">
                    Export waveform
                  </p>
                  <p className="mt-1 text-sm text-emerald-100/55">                  Conservative peak estimate after gain and fades.</p>
                </div>
                <PeakReadout amplitude={preview?.analysis.outputPeak ?? 0} />
              </div>
              <div
                aria-label={`Estimated output peak ${preview ? formatDbfs(preview.analysis.outputPeak) : '-∞ dBFS'}`}
                className="mt-5 flex h-44 items-center gap-px overflow-hidden rounded-2xl border border-white/8 bg-black/15 px-3"
                role="img"
              >
                {preview?.bars.map((amplitude, index) => {
                  const state = peakState(amplitude);
                  return (
                    <span
                      key={index}
                      className={`min-w-px flex-1 rounded-full ${
                        state === 'clipping'
                          ? 'bg-red-400'
                          : state === 'warning'
                            ? 'bg-amber-300'
                            : 'bg-emerald-300/80'
                      }`}
                      style={{ height: `${Math.max(2, Math.min(100, amplitude * 100))}%` }}
                    />
                  );
                })}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                <p className="rounded-xl border border-white/8 bg-black/10 p-3 text-emerald-100/55">
                  <span className="block text-[0.6rem] font-bold uppercase tracking-[0.1em]">Source peak</span>
                  <strong className="mt-1 block font-mono text-sm text-white">
                    {preview ? formatDbfs(preview.analysis.sourcePeak) : '-∞ dBFS'}
                  </strong>
                </p>
                <p
                  className={`rounded-xl border p-3 ${
                    projectedState === 'clipping'
                      ? 'border-red-300/30 bg-red-300/10 text-red-200'
                      : projectedState === 'warning'
                        ? 'border-amber-300/30 bg-amber-300/10 text-amber-200'
                        : 'border-emerald-300/15 bg-emerald-300/[0.05] text-emerald-100/55'
                  }`}
                >
                  <span className="block text-[0.6rem] font-bold uppercase tracking-[0.1em]">Peak state</span>
                  <strong className="mt-1 block text-sm capitalize">
                    {projectedState === 'clipping' ? 'potential clipping' : projectedState}
                  </strong>
                </p>
              </div>
              {projectedState === 'clipping' && (
                <p className="mt-4 text-xs leading-relaxed text-red-200">
                  Peaks may exceed 0 dBFS and clip during WAV or MP3 encoding. Lower the gain or normalize.
                </p>
              )}
            </div>

            <div className="space-y-4 rounded-3xl border border-white/8 bg-white/[0.025] p-5 sm:p-6">
              <label className="block text-xs font-bold uppercase tracking-[0.1em] text-emerald-100/55">
                Volume
                <span className="float-right font-mono text-emerald-200">
                  {gainPercent}% · {Number.isFinite(gainDb) ? `${gainDb.toFixed(1)} dB` : '-∞ dB'}
                </span>
                <input
                  aria-label="Volume percentage"
                  className="mt-3 h-2 w-full cursor-pointer appearance-none rounded-full accent-emerald-300 disabled:opacity-50"
                  disabled={busy || normalize}
                  max={500}
                  min={0}
                  step={1}
                  type="range"
                  value={gainPercent}
                  onChange={(event) => setGainPercent(Number(event.target.value))}
                />
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.05] p-4">
                <input
                  checked={normalize}
                  className="mt-0.5 h-4 w-4 accent-emerald-300"
                  disabled={busy}
                  type="checkbox"
                  onChange={(event) => setNormalize(event.target.checked)}
                />
                <span>
                  <strong className="block text-sm text-emerald-50">Normalize to -1 dBFS</strong>
                  <span className="mt-1 block text-xs leading-relaxed text-emerald-100/55">
                    Preserves dynamics and overrides manual volume for this export.
                  </span>
                </span>
              </label>

              <label className="block text-xs font-bold uppercase tracking-[0.1em] text-emerald-100/55">
                Fade in
                <span className="float-right font-mono text-emerald-200">{fadeInSeconds.toFixed(2)}s</span>
                <input
                  aria-label="Fade in duration"
                  className="mt-3 h-2 w-full cursor-pointer appearance-none rounded-full accent-emerald-300 disabled:opacity-50"
                  disabled={busy}
                  max={track.duration}
                  min={0}
                  step={fadeStep}
                  type="range"
                  value={fadeInSeconds}
                  onChange={(event) => setFadeInSeconds(Number(event.target.value))}
                />
              </label>

              <label className="block text-xs font-bold uppercase tracking-[0.1em] text-emerald-100/55">
                Fade out
                <span className="float-right font-mono text-emerald-200">{fadeOutSeconds.toFixed(2)}s</span>
                <input
                  aria-label="Fade out duration"
                  className="mt-3 h-2 w-full cursor-pointer appearance-none rounded-full accent-emerald-300 disabled:opacity-50"
                  disabled={busy}
                  max={track.duration}
                  min={0}
                  step={fadeStep}
                  type="range"
                  value={fadeOutSeconds}
                  onChange={(event) => setFadeOutSeconds(Number(event.target.value))}
                />
              </label>

              <label className="block text-xs font-bold uppercase tracking-[0.1em] text-emerald-100/55">
                Fade curve
                <select
                  className="mt-2 block w-full rounded-xl border border-white/12 bg-[#0a1a16] px-4 py-3 text-sm font-semibold normal-case tracking-normal text-emerald-50"
                  disabled={busy}
                  value={curve}
                  onChange={(event) => setCurve(event.target.value as FadeCurve)}
                >
                  <option value="linear">Linear amplitude</option>
                  <option value="logarithmic">Logarithmic · -60 dB ramp</option>
                </select>
              </label>
            </div>
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
                  type="button"
                  onClick={() => {
                    setStatus('Cancelling…');
                    jobRef.current?.cancel();
                  }}
                >
                  Cancel
                </button>
              )}
              <Button disabled={busy} onClick={exportAudio}>
                Apply & download
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
