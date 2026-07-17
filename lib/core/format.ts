export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.0';
  const totalTenths = Math.round(seconds * 10);
  const hours = Math.floor(totalTenths / 36_000);
  const minutes = Math.floor((totalTenths % 36_000) / 600);
  const secondTenths = totalTenths % 600;
  const formattedSeconds = (secondTenths / 10).toFixed(1).padStart(4, '0');

  if (hours >= 1) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${formattedSeconds}`;
  }

  return `${minutes}:${formattedSeconds}`;
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
