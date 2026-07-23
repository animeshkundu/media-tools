import { amplitudeToDbfs, peakState } from './volumeFades';

function formatDbfs(amplitude: number): string {
  const value = amplitudeToDbfs(amplitude);
  return Number.isFinite(value) ? `${value.toFixed(1)} dBFS` : '-∞ dBFS';
}

export function PeakReadout({ amplitude }: { amplitude: number }) {
  const state = peakState(amplitude);
  return (
    <span aria-atomic="true" aria-live="polite" role="status">
      <strong
        className={`font-mono text-lg ${
          state === 'clipping'
            ? 'text-red-300'
            : state === 'warning'
              ? 'text-amber-300'
              : 'text-emerald-200'
        }`}
      >
        {formatDbfs(amplitude)}
      </strong>
      <span className="sr-only">
        {' '}
        Peak state: {state === 'clipping' ? 'potential clipping' : state}.
      </span>
    </span>
  );
}
