export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.0';
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${minutes}:${remainder.toFixed(1).padStart(4, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 'B';
  for (const next of units) {
    value /= 1024;
    unit = next;
    if (value < 1024) break;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

export function outputName(inputName: string, extension: 'wav' | 'mp3'): string {
  const base = inputName.replace(/\.[^.]+$/, '') || 'audio';
  return `${base}-trimmed.${extension}`;
}
