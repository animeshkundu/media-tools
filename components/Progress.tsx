export function Progress({ value }: { value: number }) {
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div
      aria-label={`Export ${percent}% complete`}
      className="h-2 overflow-hidden rounded-full bg-white/8"
      role="progressbar"
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={percent}
    >
      <div
        className="h-full rounded-full bg-emerald-300 shadow-[0_0_14px_rgba(110,231,183,0.45)] transition-all motion-reduce:transition-none"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
