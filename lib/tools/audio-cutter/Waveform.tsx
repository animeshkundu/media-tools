import { useEffect, useRef, type PointerEvent } from 'react';

type WaveformProps = {
  channel: Float32Array;
  duration: number;
  end: number;
  onChange: (start: number, end: number) => void;
  start: number;
};

export function Waveform({ channel, duration, end, onChange, start }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

  return (
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
  );
}
