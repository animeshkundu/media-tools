import { formatDuration } from '../../lib/core/format';

export type TrimValidation = {
  field: 'start' | 'end';
  message: string;
};

type TrimTimeFieldsProps = {
  disabled: boolean;
  duration: number;
  end: number;
  onChange: (start: number, end: number) => void;
  onValidationChange: (validation?: TrimValidation) => void;
  start: number;
  validation?: TrimValidation;
};

const INPUT_CLASSNAME =
  'mt-2 block w-full rounded-xl border border-white/15 bg-[#0d1e1a] px-4 py-3 text-emerald-50 disabled:cursor-not-allowed disabled:opacity-50';

export function TrimTimeFields({
  disabled,
  duration,
  end,
  onChange,
  onValidationChange,
  start,
  validation,
}: TrimTimeFieldsProps) {
  function updateRange(field: 'start' | 'end', rawValue: string) {
    if (![start, end, duration].every(Number.isFinite)) {
      onValidationChange({
        field,
        message: `${field === 'start' ? 'In' : 'Out'} could not be read. Reload the audio and try again.`,
      });
      return;
    }

    const trimmed = rawValue.trim();
    const nextValue = trimmed === '' ? Number.NaN : Number(trimmed);

    if (!Number.isFinite(nextValue)) {
      onValidationChange({
        field,
        message: `${field === 'start' ? 'In' : 'Out'} must be a valid number of seconds (for example 2.50).`,
      });
      return;
    }

    if (nextValue < 0 || nextValue > duration) {
      onValidationChange({
        field,
        message: `${field === 'start' ? 'In' : 'Out'} must stay between 0.00 and ${duration.toFixed(2)} seconds.`,
      });
      return;
    }

    const nextStart = field === 'start' ? nextValue : start;
    const nextEnd = field === 'end' ? nextValue : end;

    if (nextStart >= nextEnd) {
      onValidationChange({
        field,
        message:
          field === 'start'
            ? 'In must be earlier than Out.'
            : 'Out must be later than In.',
      });
      return;
    }

    onValidationChange(undefined);
    onChange(nextStart, nextEnd);
  }

  return (
    <div className="mt-5 grid gap-4 sm:grid-cols-2">
      <label className="text-sm font-medium text-emerald-100/70">
        In
        <input
          aria-describedby="trim-time-fields-help"
          aria-invalid={validation?.field === 'start'}
          className={INPUT_CLASSNAME}
          disabled={disabled}
          inputMode="decimal"
          max={Math.max(0, end - 0.01)}
          min={0}
          step={0.01}
          type="number"
          value={start.toFixed(2)}
          onChange={(event) => updateRange('start', event.target.value)}
        />
        <span className="mt-2 block font-mono text-xs text-amber-200">{formatDuration(start)}</span>
      </label>

      <label className="text-sm font-medium text-emerald-100/70">
        Out
        <input
          aria-describedby="trim-time-fields-help"
          aria-invalid={validation?.field === 'end'}
          className={INPUT_CLASSNAME}
          disabled={disabled}
          inputMode="decimal"
          max={duration}
          min={Math.min(duration, start + 0.01)}
          step={0.01}
          type="number"
          value={end.toFixed(2)}
          onChange={(event) => updateRange('end', event.target.value)}
        />
        <span className="mt-2 block font-mono text-xs text-amber-200">{formatDuration(end)}</span>
      </label>

      <p className="sm:col-span-2 text-xs text-emerald-100/60" id="trim-time-fields-help">
        Enter exact trim points in seconds. Dragging the waveform keeps these values in sync.
      </p>
      {validation && (
        <p className="sm:col-span-2 text-sm text-red-200" role="alert">
          {validation.message}
        </p>
      )}
    </div>
  );
}
