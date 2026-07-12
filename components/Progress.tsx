export function Progress({ value }: { value: number }) {
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div
      aria-label={`Export ${percent}% complete`}
      className="h-2 overflow-hidden rounded-full bg-white/10"
      role="progressbar"
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={percent}
    >
      <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${percent}%` }} />
    </div>
  );
}
