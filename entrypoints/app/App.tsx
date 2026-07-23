import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
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
import { ChangeSpeedTool } from './ChangeSpeedTool';
import { ConvertTool } from './ConvertTool';
import { JoinMergeTool } from './JoinMergeTool';
import { MultitrackTool } from '../../lib/tools/multitrack/MultitrackTool';
import { TrimTimeFields, type TrimValidation } from './TrimTimeFields';
import { VolumeFadesTool } from './VolumeFadesTool';

type LoadedAudio = {
  duration: number;
  file: File;
  sampleRate: number;
  waveform: Float32Array;
};

type ToolId = 'cut' | 'join' | 'multitrack' | 'speed' | 'volume' | 'convert';

type AppProps = {
  surface?: 'extension' | 'web';
};

const TOOLS: {
  description: string;
  id: ToolId;
  intro: string;
  label: string;
  shortLabel: string;
}[] = [
  {
    id: 'cut',
    label: 'Audio Cutter',
    shortLabel: 'Cut audio',
    description: 'Frame the exact moment you want.',
    intro: 'Find the moment. Set the edges. Export a clean cut without sending your audio anywhere.',
  },
  {
    id: 'join',
    label: 'Audio Join / Merge',
    shortLabel: 'Join / merge',
    description: 'Arrange tracks into one clean file.',
    intro: 'Build one continuous track from WAV and MP3 files, in exactly the order you choose.',
  },
  {
    id: 'multitrack',
    label: 'Multitrack Studio',
    shortLabel: 'Multitrack studio',
    description: 'Arrange dialogue, music, and effects.',
    intro:
      'Build a non-destructive mix with magnetic edits, local preview, automatic ducking, and worker-rendered WAV export.',
  },
  {
    id: 'speed',
    label: 'Change Speed',
    shortLabel: 'Change speed',
    description: 'Slow down or race from 0.25x to 4x.',
    intro: 'Shift the pace from a slow study pass to a fast listen. Speed and pitch move together.',
  },
  {
    id: 'volume',
    label: 'Volume & Fades',
    shortLabel: 'Volume & fades',
    description: 'Set gain, fades, and peak normalization.',
    intro: 'Shape gain and fade boundaries, or normalize the final peak to -1 dBFS, entirely offline.',
  },
  {
    id: 'convert',
    label: 'Convert WAV / MP3',
    shortLabel: 'Convert WAV / MP3',
    description: 'Move between WAV and MP3 locally.',
    intro: 'Turn WAV into a compact MP3 or recover a lossless PCM WAV, entirely on this device.',
  },
];

function ToolGlyph({ id }: { id: ToolId }) {
  const paths: Record<ToolId, string> = {
    cut: 'M6 7.5 18 16.5M6 16.5 18 7.5M5.5 5.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0 9a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
    join: 'M5 7h5a3 3 0 0 1 3 3v4a3 3 0 0 0 3 3h3M16 14l3 3-3 3M5 17h4',
    multitrack: 'M4 6h16M4 12h16M4 18h16M8 4v4m8 2v4M10 16v4',
    speed: 'M4 15a8 8 0 1 1 16 0M12 15l4-5M7 17h10',
    volume: 'M4 12h3l2-6 4 12 2-6h5M5 21h14',
    convert: 'M5 8h13m-3-3 3 3-3 3M19 16H6m3 3-3-3 3-3',
  };

  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    >
      <path d={paths[id]} />
    </svg>
  );
}

export default function App({ surface = 'extension' }: AppProps) {
  const [tool, setTool] = useState<ToolId>('cut');
  const [audio, setAudio] = useState<LoadedAudio>();
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [format, setFormat] = useState<EncodeFormat>('wav');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Drop an audio file to begin.');
  const [busy, setBusy] = useState(false);
  const [trimValidation, setTrimValidation] = useState<TrimValidation>();
  const previewRef = useRef<HTMLAudioElement>(null);
  const jobRef = useRef<AudioJob<unknown> | undefined>(undefined);
  const activeTool = TOOLS.find((item) => item.id === tool)!;

  useEffect(() => {
    if (tool !== 'cut' || !audio || !previewRef.current) return;
    const url = URL.createObjectURL(audio.file);
    previewRef.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [audio, tool]);

  useEffect(
    () => () => {
      jobRef.current?.cancel();
    },
    [],
  );

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
      setTrimValidation(undefined);
      setStatus('Drag the gold handles to choose the part you want.');
    } catch (error) {
      setAudio(undefined);
      setTrimValidation(undefined);
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

  function selectTool(nextTool: ToolId) {
    if (nextTool === tool) return;
    jobRef.current?.cancel();
    setTool(nextTool);
  }

  function handleToolKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (index + 1) % TOOLS.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + TOOLS.length) % TOOLS.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = TOOLS.length - 1;
    }
    if (nextIndex === undefined) return;

    event.preventDefault();
    const nextTool = TOOLS[nextIndex];
    selectTool(nextTool.id);
    document.getElementById(`tool-tab-${nextTool.id}`)?.focus();
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#06100e] text-emerald-50">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_70%_-10%,rgba(52,211,153,0.19),transparent_34rem),radial-gradient(circle_at_0%_100%,rgba(245,158,11,0.08),transparent_28rem),linear-gradient(135deg,#06100e_0%,#081814_54%,#06100e_100%)]"
      />
      {surface === 'extension' && (
        <a
          className="fixed left-4 top-[-5rem] z-50 rounded-xl bg-amber-300 px-4 py-3 font-bold text-emerald-950 focus:top-4"
          href="#tool-workspace"
        >
          Skip to editor
        </a>
      )}

      <div className="relative grid min-h-screen grid-cols-[minmax(0,1fr)] lg:grid-cols-[20rem_minmax(0,1fr)]">
        <aside className="border-b border-white/10 bg-black/10 px-4 py-5 backdrop-blur-2xl sm:px-6 lg:border-b-0 lg:border-r lg:px-5 lg:py-7">
          <div className="lg:sticky lg:top-7">
            <div className="flex items-center justify-between gap-3">
              {surface === 'web' ? (
                <a
                  className="group flex items-center gap-3 text-white no-underline"
                  href="/media-tools/"
                >
                  <span className="grid h-10 w-10 place-items-center rounded-2xl border border-emerald-300/25 bg-emerald-300/10 text-emerald-300 transition group-hover:rotate-3 group-hover:bg-emerald-300/20 motion-reduce:transition-none">
                    <svg
                      aria-hidden="true"
                      className="h-5 w-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeWidth="2"
                    >
                      <path d="M4 8c2.3-4 4.7 4 7 0s4.7 4 9 0M4 16c2.3-4 4.7 4 7 0s4.7 4 9 0" />
                    </svg>
                  </span>
                  <span>
                    <strong className="block text-[0.93rem] leading-none">Audio Cutter</strong>
                    <small className="mt-1 block text-[0.64rem] font-semibold uppercase tracking-[0.16em] text-emerald-100/55">
                      Studio
                    </small>
                  </span>
                </a>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-2xl border border-emerald-300/25 bg-emerald-300/10 text-emerald-300">
                    <svg
                      aria-hidden="true"
                      className="h-5 w-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeWidth="2"
                    >
                      <path d="M4 8c2.3-4 4.7 4 7 0s4.7 4 9 0M4 16c2.3-4 4.7 4 7 0s4.7 4 9 0" />
                    </svg>
                  </span>
                  <span>
                    <strong className="block text-[0.93rem] leading-none">Audio Cutter</strong>
                    <small className="mt-1 block text-[0.64rem] font-semibold uppercase tracking-[0.16em] text-emerald-100/55">
                      Extension
                    </small>
                  </span>
                </div>
              )}
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[0.65rem] font-bold uppercase tracking-[0.12em] text-emerald-100/55 lg:hidden">
                {TOOLS.length} tools
              </span>
            </div>

            <div className="mt-5 flex gap-2 overflow-x-auto pb-2 lg:mt-10 lg:grid lg:overflow-visible lg:pb-0" role="tablist" aria-label="Audio tools">
              {TOOLS.map((item, index) => {
                const selected = item.id === tool;
                return (
                  <button
                    key={item.id}
                    aria-controls="tool-workspace"
                    aria-selected={selected}
                    className={`group min-w-[10.5rem] rounded-2xl border p-3 text-left transition motion-reduce:transition-none lg:min-w-0 lg:p-3.5 ${
                      selected
                        ? 'border-emerald-300/35 bg-emerald-300/[0.11] text-white shadow-[0_16px_42px_rgba(0,0,0,0.22)]'
                        : 'border-transparent text-emerald-100/58 hover:border-white/10 hover:bg-white/[0.035] hover:text-emerald-50'
                    }`}
                    id={`tool-tab-${item.id}`}
                    role="tab"
                    tabIndex={selected ? 0 : -1}
                    title={item.description}
                    type="button"
                    onClick={() => selectTool(item.id)}
                    onKeyDown={(event) => handleToolKeyDown(event, index)}
                  >
                    <span className="flex items-center gap-3">
                      <span
                        className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border ${
                          selected
                            ? 'border-emerald-300/25 bg-emerald-300 text-emerald-950'
                            : 'border-white/10 bg-white/[0.035] text-emerald-100/55 group-hover:text-emerald-300'
                        }`}
                      >
                        <ToolGlyph id={item.id} />
                      </span>
                      <span className="min-w-0 text-[0.82rem] font-bold">{item.shortLabel}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-8 hidden rounded-3xl border border-white/10 bg-white/[0.025] p-4 lg:block">
              <div className="flex items-center gap-2 text-xs font-bold text-emerald-200">
                <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_0_5px_rgba(52,211,153,0.1)]" />
                {surface === 'extension' ? 'Locked down locally' : 'Local in this tab'}
              </div>
              <p className="mt-3 text-[0.7rem] leading-relaxed text-emerald-100/55">
                {surface === 'extension'
                  ? 'Zero permissions and a no-egress extension policy keep processing offline.'
                  : 'Your audio is processed in this browser tab. Files are not uploaded and there is no telemetry.'}
              </p>
              <div className="mt-4 flex gap-2 border-t border-white/8 pt-3 text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-emerald-100/55">
                <span>64 MB input</span>
                <span aria-hidden="true">/</span>
                <span>WAV + MP3</span>
              </div>
            </div>
          </div>
        </aside>

        <main className="min-w-0 px-4 py-8 sm:px-7 sm:py-10 xl:px-12 xl:py-12" id="editor">
          <div className={`mx-auto ${tool === 'multitrack' ? 'max-w-[96rem]' : 'max-w-[74rem]'}`}>
            <header className="mb-7 flex flex-wrap items-start justify-between gap-5 sm:mb-9">
              <div>
                <p className="mb-3 flex items-center gap-2 text-[0.68rem] font-bold uppercase tracking-[0.2em] text-emerald-300">
                  <span>{activeTool.id === 'cut' ? 'Precision edit' : 'Audio workbench'}</span>
                  <span className="h-px w-8 bg-emerald-300/35" aria-hidden="true" />
                  <span className="text-emerald-100/55">0{TOOLS.indexOf(activeTool) + 1}</span>
                </p>
                <h1 className="m-0 max-w-none text-4xl font-black tracking-[-0.055em] text-white sm:text-6xl xl:text-7xl">
                  {activeTool.label}
                </h1>
                <p className="mt-4 max-w-2xl text-base leading-relaxed text-emerald-100/58 sm:text-lg">
                  {activeTool.intro}
                </p>
              </div>
              <div className="flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/[0.08] px-4 py-2 text-xs font-bold text-emerald-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" aria-hidden="true" />
                {surface === 'extension' ? 'Works offline' : 'No file upload'}
              </div>
            </header>

            <div
              aria-labelledby={`tool-tab-${tool}`}
              className="relative"
              id="tool-workspace"
              role="tabpanel"
            >
              {tool === 'join' ? (
                <JoinMergeTool />
              ) : tool === 'multitrack' ? (
                <MultitrackTool />
              ) : tool === 'speed' ? (
                <ChangeSpeedTool />
              ) : tool === 'volume' ? (
                <VolumeFadesTool />
              ) : tool === 'convert' ? (
                <ConvertTool />
              ) : !audio ? (
                <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-black/20 p-2 shadow-[0_32px_100px_rgba(0,0,0,0.28)] backdrop-blur-xl">
                  <Dropzone accept="audio/wav,audio/mpeg,.wav,.mp3" disabled={busy} onFile={load}>
                    <div className="mx-auto mb-6 grid h-16 w-16 place-items-center rounded-2xl border border-emerald-300/20 bg-emerald-300 text-emerald-950 shadow-[0_12px_35px_rgba(52,211,153,0.18)]">
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
                        <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14" />
                      </svg>
                    </div>
                    <p className="text-2xl font-black tracking-[-0.03em] text-white sm:text-3xl">
                      Drop a WAV or MP3 file here
                    </p>
                    <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-emerald-100/55">
                      Or choose a file from this device. It opens directly in the editor and is never uploaded.
                    </p>
                    <div className="mt-7 flex flex-wrap justify-center gap-2 text-[0.65rem] font-bold uppercase tracking-[0.12em] text-emerald-100/55">
                      <span className="rounded-full border border-white/10 px-3 py-1.5">WAV</span>
                      <span className="rounded-full border border-white/10 px-3 py-1.5">MP3</span>
                      <span className="rounded-full border border-white/10 px-3 py-1.5">Up to 64 MB</span>
                    </div>
                  </Dropzone>
                  {busy && (
                    <div className="px-5 pb-5 pt-4 sm:px-8">
                      <Progress value={progress} />
                      <button
                        className="mx-auto mt-4 block rounded-xl border border-red-300/30 px-5 py-3 font-semibold text-red-200 hover:bg-red-300/10"
                        type="button"
                        onClick={() => jobRef.current?.cancel()}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </section>
              ) : (
                <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-black/20 shadow-[0_32px_100px_rgba(0,0,0,0.28)] backdrop-blur-xl">
                  <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/8 px-5 py-5 sm:px-7">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 shrink-0 rounded-full bg-amber-300" aria-hidden="true" />
                        <h2 className="m-0 max-w-xl truncate text-lg font-bold tracking-tight text-white">
                          {audio.file.name}
                        </h2>
                      </div>
                      <p className="mt-1.5 text-xs font-medium text-emerald-100/55">
                        {formatBytes(audio.file.size)} <span className="px-1.5">/</span>{' '}
                        {formatDuration(audio.duration)} <span className="px-1.5">/</span>{' '}
                        {audio.sampleRate.toLocaleString()} Hz
                      </p>
                    </div>
                    <button
                      className="rounded-xl border border-white/12 bg-white/[0.025] px-4 py-2.5 text-xs font-bold text-emerald-100/65 transition hover:border-white/20 hover:bg-white/[0.06] hover:text-white disabled:opacity-50 motion-reduce:transition-none"
                      disabled={busy}
                      type="button"
                      onClick={() => {
                        setAudio(undefined);
                        setTrimValidation(undefined);
                      }}
                    >
                      Choose another
                    </button>
                  </div>

                  <div className="grid gap-6 p-5 sm:p-7 xl:grid-cols-[minmax(0,1fr)_16rem]">
                    <div className="min-w-0">
                      <Waveform
                        channel={audio.waveform}
                        duration={audio.duration}
                        start={start}
                        end={end}
                        onChange={(nextStart, nextEnd) => {
                          setTrimValidation(undefined);
                          setStart(nextStart);
                          setEnd(nextEnd);
                        }}
                      />
                      <div className="mt-4 grid grid-cols-3 gap-2 font-mono text-[0.68rem] font-bold uppercase tracking-[0.08em] text-amber-200">
                        <span>In {formatDuration(start)}</span>
                        <span className="text-center text-emerald-100/55">
                          {formatDuration(end - start)} selected
                        </span>
                        <span className="text-right">Out {formatDuration(end)}</span>
                      </div>
                    </div>

                    <aside className="rounded-2xl border border-white/8 bg-white/[0.025] p-4">
                      <p className="text-[0.66rem] font-bold uppercase tracking-[0.14em] text-emerald-100/55">
                        Local preview
                      </p>
                      <div className="mt-3 grid h-16 place-items-center rounded-xl bg-emerald-300/[0.07] text-emerald-300">
                        <svg
                          aria-hidden="true"
                          className="h-7 w-7"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeWidth="1.6"
                        >
                          <path d="M4 14h3l2-5 4 10 2-5h5" />
                        </svg>
                      </div>
                      <audio ref={previewRef} className="mt-4 h-9 w-full" controls preload="metadata">
                        Your browser does not support local audio preview.
                      </audio>
                      <p className="mt-3 text-[0.68rem] leading-relaxed text-emerald-100/55">
                        Preview the source here, then use the gold handles for the exact cut.
                      </p>
                    </aside>
                  </div>

                  <div className="border-t border-white/8 px-5 py-5 sm:px-7">
                    <TrimTimeFields
                      disabled={busy}
                      duration={audio.duration}
                      end={end}
                      start={start}
                      validation={trimValidation}
                      onChange={(nextStart, nextEnd) => {
                        setStart(nextStart);
                        setEnd(nextEnd);
                      }}
                      onValidationChange={setTrimValidation}
                    />

                    <div className="mt-6 grid gap-5 border-t border-white/8 pt-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                      <label className="text-xs font-bold uppercase tracking-[0.1em] text-emerald-100/55">
                        Export format
                        <select
                          className="mt-2 block w-full rounded-xl border border-white/12 bg-[#0a1a16] px-4 py-3.5 text-sm font-semibold normal-case tracking-normal text-emerald-50"
                          disabled={busy}
                          value={format}
                          onChange={(event) => setFormat(event.target.value as EncodeFormat)}
                        >
                          <option value="wav">WAV - lossless PCM</option>
                          <option value="mp3">MP3 - 192 kbps</option>
                        </select>
                      </label>
                      <div className="flex flex-wrap gap-3 sm:justify-end">
                        {busy && (
                          <button
                            className="rounded-xl border border-red-300/30 px-5 py-3.5 text-sm font-bold text-red-200 hover:bg-red-300/10"
                            type="button"
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
                  </div>
                </section>
              )}
              {tool === 'cut' && (
                <p
                  aria-live="polite"
                  className="mt-5 text-center text-xs font-medium text-emerald-100/55"
                >
                  {status}
                </p>
              )}
            </div>

            <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-white/8 pt-5 text-[0.64rem] font-semibold uppercase tracking-[0.12em] text-emerald-100/55">
              <span>Local processing / No account / No telemetry</span>
              <span>WAV + MP3 / Worker powered</span>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}
