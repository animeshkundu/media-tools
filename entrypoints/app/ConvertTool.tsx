import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { Progress } from '@/components/Progress';
import { downloadBlob } from '@/lib/core/download';
import { Dropzone } from '../../lib/core/dropzone';
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
              <path d="M5 8h13m-3-3 3 3-3 3M19 16H6m3 3-3-3 3-3" />
            </svg>
          </div>
          <p className="text-2xl font-black tracking-[-0.03em] text-white sm:text-3xl">
            Drop a WAV or MP3 file here
          </p>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-emerald-100/55">
            Open one local track, choose its new format, and download the conversion.
          </p>
        </Dropzone>
      ) : (
        <div className="p-4 sm:p-6">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-white/8 pb-5">
            <div>
              <p className="text-[0.65rem] font-bold uppercase tracking-[0.13em] text-emerald-300">
                Ready to convert
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
                setStatus('Drop an audio file to convert to WAV or MP3.');
                setValidation(undefined);
              }}
            >
              Choose another
            </button>
          </div>

          <div className="grid gap-5 rounded-3xl border border-white/8 bg-white/[0.025] p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:p-7">
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
          <div className="mt-4 grid gap-2 text-[0.68rem] text-emerald-100/55 sm:grid-cols-3">
            <span className="rounded-xl border border-white/8 px-3 py-2">Lossless WAV PCM</span>
            <span className="rounded-xl border border-white/8 px-3 py-2">Compact 192 kbps MP3</span>
            <span className="rounded-xl border border-white/8 px-3 py-2">Worker encoded</span>
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
