import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';

type WaveformProps = {
  channel: Float32Array;
  duration: number;
  end: number;
  onChange: (start: number, end: number) => void;
  start: number;
};

type TrimHandle = 'start' | 'end';

const FINE_STEP_SECONDS = 0.01;
const COARSE_STEP_SECONDS = 0.1;

// eslint-disable-next-line react-refresh/only-export-components
export function moveTrimHandle(
  handle: TrimHandle,
  direction: -1 | 1,
  coarse: boolean,
  start: number,
  end: number,
  duration: number,
): [start: number, end: number] {
  const minimum = Math.min(0.05, duration / 2);
  const delta = direction * (coarse ? COARSE_STEP_SECONDS : FINE_STEP_SECONDS);

  if (handle === 'start') {
    return [Math.max(0, Math.min(start + delta, end - minimum)), end];
  }

  return [start, Math.min(duration, Math.max(end + delta, start + minimum))];
}

function formatSeconds(value: number) {
  return `${value.toFixed(2)} seconds`;
}

export function Waveform({ channel, duration, end, onChange, start }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const instructionsId = useId();
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scale = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext('2d');
    if (!context) return;
    context.scale(scale, scale);
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#0d1e1a';
    context.fillRect(0, 0, width, height);

    const columns = Math.max(1, Math.floor(width));
    const stride = Math.max(1, Math.floor(channel.length / columns));
    context.strokeStyle = '#34d399';
    context.lineWidth = 1;
    context.beginPath();
    for (let x = 0; x < columns; x += 1) {
      let peak = 0;
      const offset = x * stride;
      for (let index = offset; index < Math.min(channel.length, offset + stride); index += 1) {
        peak = Math.max(peak, Math.abs(channel[index] ?? 0));
      }
      context.moveTo(x + 0.5, height / 2 - peak * height * 0.42);
      context.lineTo(x + 0.5, height / 2 + peak * height * 0.42);
    }
    context.stroke();

    const startX = (start / duration) * width;
    const endX = (end / duration) * width;
    context.fillStyle = 'rgba(2, 6, 5, 0.62)';
    context.fillRect(0, 0, startX, height);
    context.fillRect(endX, 0, width - endX, height);
    context.fillStyle = '#fbbf24';
    context.fillRect(startX - 2, 0, 4, height);
    context.fillRect(endX - 2, 0, 4, height);
  }, [channel, duration, end, start]);

  function moveHandle(event: PointerEvent<HTMLCanvasElement>) {
    if (!canvasRef.current) return;
    const bounds = canvasRef.current.getBoundingClientRect();
    const position = Math.max(
      0,
      Math.min(duration, ((event.clientX - bounds.left) / bounds.width) * duration),
    );
    const nearestStart = Math.abs(position - start) <= Math.abs(position - end);
    const minimum = Math.min(0.05, duration / 2);
    if (nearestStart) onChange(Math.min(position, end - minimum), end);
    else onChange(start, Math.max(position, start + minimum));
  }

  function moveHandleWithKeyboard(handle: TrimHandle, event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const [nextStart, nextEnd] = moveTrimHandle(
      handle,
      event.key === 'ArrowLeft' ? -1 : 1,
      event.shiftKey,
      start,
      end,
      duration,
    );
    onChange(nextStart, nextEnd);
    const label = handle === 'start' ? 'In point' : 'Out point';
    setAnnouncement(`${label} ${formatSeconds(handle === 'start' ? nextStart : nextEnd)}`);
  }

  const minimum = Math.min(0.05, duration / 2);
  const handles = [
    { label: 'In point', position: start, type: 'start' as const, min: 0, max: end - minimum },
    {
      label: 'Out point',
      position: end,
      type: 'end' as const,
      min: start + minimum,
      max: duration,
    },
  ];

  return (
    <div>
      <div className="relative">
        <canvas
          ref={canvasRef}
          aria-label="Audio waveform. Drag the gold trim handles."
          className="h-56 w-full touch-none rounded-2xl border border-white/10"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            moveHandle(event);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) moveHandle(event);
          }}
        />
        {handles.map((handle) => (
          <div
            key={handle.type}
            role="slider"
            tabIndex={0}
            aria-describedby={instructionsId}
            aria-label={handle.label}
            aria-orientation="horizontal"
            aria-valuemax={handle.max}
            aria-valuemin={handle.min}
            aria-valuenow={handle.position}
            aria-valuetext={formatSeconds(handle.position)}
            className="pointer-events-none absolute inset-y-0 w-11 -translate-x-1/2 rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200 motion-reduce:transition-none"
            style={{ left: `${(handle.position / duration) * 100}%` }}
            onKeyDown={(event) => moveHandleWithKeyboard(handle.type, event)}
          >
            <span
              aria-hidden="true"
              className="absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 bg-amber-400"
            />
          </div>
        ))}
      </div>
      <p id={instructionsId} className="mt-2 text-sm text-emerald-100/70">
        Focus an In or Out point. Use Left and Right Arrow keys for 0.01 second steps; hold
        Shift for 0.1 second steps.
      </p>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
