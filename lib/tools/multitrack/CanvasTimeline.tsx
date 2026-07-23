import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
} from 'react';
import type { PeakPyramid } from './peaks';
import { selectPeakLevel } from './peaks';
import type {
  AudioClip,
  AudioClipId,
  AudioTrack,
  AudioTrackId,
  TimelineState,
} from './schema';
import {
  collectSnapPoints,
  moveClip,
  projectDuration,
  snapTime,
  trimClipEnd,
  trimClipStart,
} from './timeline';

const ROW_HEIGHT = 88;
const RULER_HEIGHT = 30;
const HANDLE_PIXELS = 9;
const MIN_VIEWPORT_HEIGHT = 280;

type DragMode = 'move' | 'trim-start' | 'trim-end';

type DragState = {
  readonly clipId: AudioClipId;
  readonly trackId: AudioTrackId;
  readonly mode: DragMode;
  readonly pointerTime: number;
  readonly state: TimelineState;
};

export interface CanvasTimelineProps {
  readonly state: TimelineState;
  readonly peaksByAssetId: Readonly<Record<string, PeakPyramid>>;
  readonly onChange: (state: TimelineState) => void;
  readonly onTransientChange: (state: TimelineState) => void;
  readonly onSeek: (time: number) => void;
}

function roleColor(role: AudioTrack['role']): string {
  if (role === 'dialogue') return '#6ee7b7';
  if (role === 'music') return '#93c5fd';
  return '#fbbf24';
}

function clipAtTime(track: AudioTrack, time: number): AudioClip | undefined {
  return [...track.clips]
    .reverse()
    .find((clip) => time >= clip.startTime && time <= clip.startTime + clip.duration);
}

export function CanvasTimeline({
  state,
  peaksByAssetId,
  onChange,
  onTransientChange,
  onSeek,
}: CanvasTimelineProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | undefined>(undefined);
  const latestDragStateRef = useRef<TimelineState | undefined>(undefined);
  const frameRef = useRef<number | undefined>(undefined);
  const [viewportSize, setViewportSize] = useState({
    width: 800,
    height: MIN_VIEWPORT_HEIGHT,
  });
  const [scroll, setScroll] = useState({ left: 0, top: 0 });
  const [snapGuide, setSnapGuide] = useState<number>();

  const timelineDuration = Math.max(10, projectDuration(state) + 2);
  const contentWidth = Math.max(viewportSize.width, timelineDuration * state.viewport.pixelsPerSecond);
  const contentHeight = RULER_HEIGHT + state.tracks.length * ROW_HEIGHT;

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () => {
      setViewportSize({
        width: Math.max(320, viewport.clientWidth),
        height: Math.max(
          MIN_VIEWPORT_HEIGHT,
          Math.min(520, viewport.clientHeight || contentHeight),
        ),
      });
    };
    measure();
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(measure);
      observer.observe(viewport);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [contentHeight]);

  useEffect(() => {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    if (!viewport || !canvas || typeof canvas.getContext !== 'function') return;

    const draw = () => {
      frameRef.current = undefined;
      const context = canvas.getContext('2d');
      if (!context) return;
      const scale = window.devicePixelRatio || 1;
      const width = viewportSize.width;
      const height = viewportSize.height;
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.fillStyle = '#07130f';
      context.fillRect(0, 0, width, height);

      const pixelsPerSecond = state.viewport.pixelsPerSecond;
      const visibleStart = scroll.left / pixelsPerSecond;
      const visibleEnd = (scroll.left + width) / pixelsPerSecond;
      const firstTrack = Math.max(0, Math.floor((scroll.top - RULER_HEIGHT) / ROW_HEIGHT));
      const lastTrack = Math.min(
        state.tracks.length - 1,
        Math.ceil((scroll.top + height - RULER_HEIGHT) / ROW_HEIGHT),
      );
      const beatSeconds = 60 / state.tempo;
      const firstBeat = Math.floor(visibleStart / beatSeconds);
      context.lineWidth = 1;
      context.font = '11px ui-monospace, monospace';
      context.textBaseline = 'middle';

      context.fillStyle = '#0a1a16';
      context.fillRect(0, 0, width, RULER_HEIGHT);
      if (Number.isFinite(beatSeconds) && beatSeconds > 0) {
        for (
          let beat = firstBeat;
          beat * beatSeconds <= visibleEnd + beatSeconds;
          beat += 1
        ) {
          const time = beat * beatSeconds;
          const x = time * pixelsPerSecond - scroll.left;
          context.strokeStyle =
            beat % 4 === 0 ? 'rgba(110,231,183,0.23)' : 'rgba(255,255,255,0.07)';
          context.beginPath();
          context.moveTo(Math.round(x) + 0.5, 0);
          context.lineTo(Math.round(x) + 0.5, height);
          context.stroke();
          if (beat % 4 === 0) {
            context.fillStyle = 'rgba(209,250,229,0.62)';
            context.fillText(`${time.toFixed(1)}s`, x + 5, RULER_HEIGHT / 2);
          }
        }
      }

      for (let trackIndex = firstTrack; trackIndex <= lastTrack; trackIndex += 1) {
        const track = state.tracks[trackIndex];
        if (!track) continue;
        const y = RULER_HEIGHT + trackIndex * ROW_HEIGHT - scroll.top;
        context.fillStyle =
          trackIndex % 2 === 0 ? 'rgba(255,255,255,0.018)' : 'rgba(255,255,255,0.032)';
        context.fillRect(0, y, width, ROW_HEIGHT);
        context.strokeStyle = 'rgba(255,255,255,0.07)';
        context.beginPath();
        context.moveTo(0, y + ROW_HEIGHT - 0.5);
        context.lineTo(width, y + ROW_HEIGHT - 0.5);
        context.stroke();

        for (const clip of track.clips) {
          const clipEnd = clip.startTime + clip.duration;
          if (clipEnd < visibleStart || clip.startTime > visibleEnd) continue;
          const x = clip.startTime * pixelsPerSecond - scroll.left;
          const clipWidth = Math.max(2, clip.duration * pixelsPerSecond);
          const selected = state.selection.clipId === clip.id;
          const color = roleColor(track.role);
          context.fillStyle = selected ? `${color}35` : `${color}22`;
          context.strokeStyle = selected ? color : `${color}88`;
          context.lineWidth = selected ? 2 : 1;
          context.beginPath();
          context.roundRect(x, y + 8, clipWidth, ROW_HEIGHT - 16, 8);
          context.fill();
          context.stroke();

          const pyramid = peaksByAssetId[clip.assetId];
          const asset = state.assets[clip.assetId];
          if (pyramid && asset && clipWidth > 4) {
            const level = selectPeakLevel(
              pyramid,
              asset.sampleRate / pixelsPerSecond,
            );
            const startX = Math.max(0, Math.floor(x + 2));
            const endX = Math.min(width, Math.ceil(x + clipWidth - 2));
            context.strokeStyle = color;
            context.lineWidth = 1;
            context.beginPath();
            for (let pixel = startX; pixel < endX; pixel += 1) {
              const timelineTime = (pixel + scroll.left) / pixelsPerSecond;
              const sourceSample =
                (clip.trimStart + timelineTime - clip.startTime) * asset.sampleRate;
              const bin = Math.max(
                0,
                Math.min(
                  level.minimum.length - 1,
                  Math.floor(sourceSample / level.samplesPerBin),
                ),
              );
              const low = level.minimum[bin] ?? 0;
              const high = level.maximum[bin] ?? 0;
              const center = y + ROW_HEIGHT / 2;
              const amplitude = (ROW_HEIGHT - 26) / 2;
              context.moveTo(pixel + 0.5, center - high * amplitude);
              context.lineTo(pixel + 0.5, center - low * amplitude);
            }
            context.stroke();
          }

          context.fillStyle = '#f3fff9';
          context.font = 'bold 11px ui-sans-serif, system-ui';
          context.fillText(
            state.assets[clip.assetId]?.name ?? 'Audio clip',
            x + 9,
            y + 20,
            Math.max(0, clipWidth - 18),
          );
          if (selected) {
            context.fillStyle = '#fbbf24';
            context.fillRect(x - 1, y + 8, 3, ROW_HEIGHT - 16);
            context.fillRect(x + clipWidth - 2, y + 8, 3, ROW_HEIGHT - 16);
          }
        }
      }

      if (snapGuide !== undefined) {
        const x = snapGuide * pixelsPerSecond - scroll.left;
        context.strokeStyle = '#fbbf24';
        context.setLineDash([4, 4]);
        context.beginPath();
        context.moveTo(x + 0.5, 0);
        context.lineTo(x + 0.5, height);
        context.stroke();
        context.setLineDash([]);
      }
      const playheadX = state.playhead * pixelsPerSecond - scroll.left;
      context.strokeStyle = '#fb7185';
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(playheadX, 0);
      context.lineTo(playheadX, height);
      context.stroke();
      context.fillStyle = '#fb7185';
      context.beginPath();
      context.moveTo(playheadX - 5, 0);
      context.lineTo(playheadX + 5, 0);
      context.lineTo(playheadX, 7);
      context.closePath();
      context.fill();
    };

    if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(draw);
    return () => {
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
    };
  }, [peaksByAssetId, scroll, snapGuide, state, viewportSize]);

  function pointerPosition(event: PointerEvent<HTMLCanvasElement>): {
    time: number;
    trackIndex: number;
    x: number;
  } {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    return {
      x,
      time: Math.max(0, (x + scroll.left) / state.viewport.pixelsPerSecond),
      trackIndex: Math.floor((y + scroll.top - RULER_HEIGHT) / ROW_HEIGHT),
    };
  }

  function beginDrag(event: PointerEvent<HTMLCanvasElement>): void {
    const position = pointerPosition(event);
    if (position.trackIndex < 0) {
      onSeek(position.time);
      return;
    }
    const track = state.tracks[position.trackIndex];
    const clip = track && clipAtTime(track, position.time);
    if (!track || !clip) {
      onSeek(position.time);
      return;
    }
    const clipStartX = clip.startTime * state.viewport.pixelsPerSecond - scroll.left;
    const clipEndX =
      (clip.startTime + clip.duration) * state.viewport.pixelsPerSecond - scroll.left;
    const mode: DragMode =
      Math.abs(position.x - clipStartX) <= HANDLE_PIXELS
        ? 'trim-start'
        : Math.abs(position.x - clipEndX) <= HANDLE_PIXELS
          ? 'trim-end'
          : 'move';
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      clipId: clip.id,
      trackId: track.id,
      mode,
      pointerTime: position.time,
      state,
    };
    const selected = { ...state, selection: { trackId: track.id, clipId: clip.id } };
    latestDragStateRef.current = selected;
    onTransientChange(selected);
  }

  function continueDrag(event: PointerEvent<HTMLCanvasElement>): void {
    const drag = dragRef.current;
    if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const position = pointerPosition(event);
    const sourceTrack = drag.state.tracks.find((track) => track.id === drag.trackId);
    const sourceClip = sourceTrack?.clips.find((clip) => clip.id === drag.clipId);
    if (!sourceClip) return;
    const delta = position.time - drag.pointerTime;
    const candidate =
      drag.mode === 'trim-start'
        ? sourceClip.startTime + delta
        : drag.mode === 'trim-end'
          ? sourceClip.startTime + sourceClip.duration + delta
          : sourceClip.startTime + delta;
    const snapped = drag.state.snapEnabled
      ? snapTime(
          candidate,
          collectSnapPoints(drag.state, drag.clipId),
          drag.state.viewport.pixelsPerSecond,
        )
      : { time: Math.max(0, candidate) };
    setSnapGuide(snapped.target);
    const next =
      drag.mode === 'trim-start'
        ? trimClipStart(drag.state, drag.trackId, drag.clipId, snapped.time)
        : drag.mode === 'trim-end'
          ? trimClipEnd(drag.state, drag.trackId, drag.clipId, snapped.time)
          : moveClip(drag.state, drag.trackId, drag.clipId, snapped.time);
    const selected = {
      ...next,
      selection: { trackId: drag.trackId, clipId: drag.clipId },
    };
    latestDragStateRef.current = selected;
    onTransientChange(selected);
  }

  function endDrag(): void {
    const latest = latestDragStateRef.current;
    if (latest) onChange(latest);
    dragRef.current = undefined;
    latestDragStateRef.current = undefined;
    setSnapGuide(undefined);
  }

  function updateTrack(trackId: AudioTrackId, patch: Partial<AudioTrack>): void {
    onChange({
      ...state,
      tracks: state.tracks.map((track) =>
        track.id === trackId ? { ...track, ...patch } : track,
      ),
    });
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
      <div className="grid grid-cols-[10.5rem_minmax(0,1fr)]">
        <div
          aria-label="Track controls"
          className="relative z-10 overflow-hidden border-r border-white/10 bg-[#081510]"
          style={{ height: viewportSize.height }}
        >
          <div className="h-[30px] border-b border-white/8 px-3 py-2 text-[0.6rem] font-bold uppercase tracking-[0.13em] text-emerald-100/45">
            Tracks
          </div>
          <div style={{ transform: `translateY(${-scroll.top}px)` }}>
            {state.tracks.map((track) => (
              <div
                key={track.id}
                className="h-[88px] border-b border-white/8 px-3 py-2"
              >
                <button
                  className="block w-full truncate text-left text-xs font-bold text-white"
                  type="button"
                  onClick={() =>
                    onTransientChange({ ...state, selection: { trackId: track.id } })
                  }
                >
                  {track.name}
                </button>
                <span className="mt-0.5 block text-[0.6rem] uppercase tracking-[0.1em] text-emerald-100/45">
                  {track.role}
                </span>
                <div className="mt-2 flex gap-1.5">
                  <button
                    aria-pressed={track.muted}
                    className={`rounded-md border px-2 py-1 text-[0.62rem] font-bold ${
                      track.muted
                        ? 'border-red-300/40 bg-red-300/10 text-red-200'
                        : 'border-white/12 text-emerald-100/65'
                    }`}
                    type="button"
                    onClick={() => updateTrack(track.id, { muted: !track.muted })}
                  >
                    Mute
                  </button>
                  <button
                    aria-pressed={track.solo}
                    className={`rounded-md border px-2 py-1 text-[0.62rem] font-bold ${
                      track.solo
                        ? 'border-amber-300/40 bg-amber-300/10 text-amber-200'
                        : 'border-white/12 text-emerald-100/65'
                    }`}
                    type="button"
                    onClick={() => updateTrack(track.id, { solo: !track.solo })}
                  >
                    Solo
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          ref={viewportRef}
          aria-label="Multitrack timeline viewport"
          className="relative overflow-auto"
          style={{
            height: viewportSize.height,
            scrollbarColor: '#245044 #07130f',
            scrollbarWidth: 'thin',
          }}
          onScroll={(event) => {
            const next = {
              left: event.currentTarget.scrollLeft,
              top: event.currentTarget.scrollTop,
            };
            setScroll(next);
          }}
        >
          <div className="relative" style={{ width: contentWidth, height: contentHeight }}>
            <canvas
              ref={canvasRef}
              aria-label="Multitrack waveform timeline. Select clips, drag their body to move, or drag gold edges to trim."
              className="sticky left-0 top-0 touch-none"
              tabIndex={0}
              onPointerDown={beginDrag}
              onPointerMove={continueDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            />
          </div>
        </div>
      </div>
      <div className="sr-only" aria-label="Timeline clips">
        {state.tracks.flatMap((track) =>
          track.clips.map((clip) => (
            <button
              key={clip.id}
              type="button"
              onClick={() =>
                onTransientChange({
                  ...state,
                  selection: { trackId: track.id, clipId: clip.id },
                })
              }
            >
              Select {state.assets[clip.assetId]?.name ?? 'audio clip'} on {track.name} at{' '}
              {clip.startTime.toFixed(2)} seconds
            </button>
          )),
        )}
      </div>
    </div>
  );
}
