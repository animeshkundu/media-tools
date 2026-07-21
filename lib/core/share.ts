export const PRODUCT_URL = 'https://animesh.kundus.in/media-tools/';

const PREVIEW_COLUMNS = 96;
const SAMPLES_PER_COLUMN = 16;
const THUMBNAIL_WIDTH = 640;
const THUMBNAIL_HEIGHT = 200;

function escapeMarkdownText(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('`', '\\`')
    .replaceAll('*', '\\*')
    .replaceAll('_', '\\_')
    .replaceAll('[', '\\[')
    .replaceAll(']', '\\]');
}

export function buildShareMarkdown(
  title: string,
  summary: string,
  productUrl = PRODUCT_URL,
): string {
  return `**${escapeMarkdownText(title)}**\n\n${escapeMarkdownText(summary)}\n\n[Try Media Tools](${productUrl})`;
}

function copyWithExecCommand(text: string): boolean {
  if (
    typeof document === 'undefined' ||
    typeof document.execCommand !== 'function' ||
    !document.body
  ) {
    return false;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.inset = '0 auto auto 0';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.append(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, text.length);

  try {
    return document.execCommand('copy');
  } finally {
    textarea.remove();
  }
}

export async function copyText(text: string): Promise<void> {
  let clipboardFailure: unknown;
  if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      clipboardFailure = error;
    }
  }

  if (copyWithExecCommand(text)) return;

  throw new Error('Clipboard access is unavailable in this browser.', {
    cause: clipboardFailure,
  });
}

function boundedColumnCount(columns: number): number {
  if (!Number.isFinite(columns)) return PREVIEW_COLUMNS;
  return Math.max(1, Math.min(256, Math.floor(columns)));
}

export function sampleWaveform(
  sources: readonly Float32Array[],
  columns = PREVIEW_COLUMNS,
): Float32Array {
  const columnCount = boundedColumnCount(columns);
  const peaks = new Float32Array(columnCount);
  const populatedSources = sources.filter((source) => source.length > 0);
  if (populatedSources.length === 0) return peaks;

  const offsets: number[] = [];
  let totalSamples = 0;
  for (const source of populatedSources) {
    offsets.push(totalSamples);
    totalSamples += source.length;
    if (!Number.isSafeInteger(totalSamples)) {
      throw new Error('The audio is too large to create a result preview.');
    }
  }

  function sampleAt(globalIndex: number): number {
    for (let sourceIndex = populatedSources.length - 1; sourceIndex >= 0; sourceIndex -= 1) {
      const offset = offsets[sourceIndex]!;
      if (globalIndex >= offset) {
        return populatedSources[sourceIndex]![globalIndex - offset] ?? 0;
      }
    }
    return 0;
  }

  let maximumPeak = 0;
  for (let column = 0; column < columnCount; column += 1) {
    const start = Math.floor((column * totalSamples) / columnCount);
    const end = Math.max(start + 1, Math.floor(((column + 1) * totalSamples) / columnCount));
    const segmentLength = end - start;
    const sampleCount = Math.min(SAMPLES_PER_COLUMN, segmentLength);
    let peak = 0;

    for (let sample = 0; sample < sampleCount; sample += 1) {
      const globalIndex = Math.min(
        totalSamples - 1,
        start + Math.floor(((sample + 0.5) * segmentLength) / sampleCount),
      );
      const value = Math.abs(sampleAt(globalIndex));
      if (Number.isFinite(value)) peak = Math.max(peak, value);
    }

    peaks[column] = peak;
    maximumPeak = Math.max(maximumPeak, peak);
  }

  if (maximumPeak > 0) {
    for (let column = 0; column < peaks.length; column += 1) {
      peaks[column] = Math.min(1, peaks[column]! / maximumPeak);
    }
  }

  return peaks;
}

function waveformSvgDataUrl(peaks: Float32Array): string {
  const barWidth = THUMBNAIL_WIDTH / peaks.length;
  const bars = Array.from(peaks, (peak, index) => {
    const height = Math.max(2, peak * THUMBNAIL_HEIGHT * 0.76);
    const x = (index + 0.5) * barWidth;
    const y = (THUMBNAIL_HEIGHT - height) / 2;
    return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="2" height="${height.toFixed(2)}" rx="1"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${THUMBNAIL_WIDTH}" height="${THUMBNAIL_HEIGHT}" viewBox="0 0 ${THUMBNAIL_WIDTH} ${THUMBNAIL_HEIGHT}"><rect width="100%" height="100%" fill="#0d1e1a"/><g fill="#34d399">${bars}</g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function createWaveformThumbnail(sources: readonly Float32Array[]): string {
  const peaks = sampleWaveform(sources);
  if (typeof document === 'undefined') return waveformSvgDataUrl(peaks);

  const canvas = document.createElement('canvas');
  canvas.width = THUMBNAIL_WIDTH;
  canvas.height = THUMBNAIL_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) return waveformSvgDataUrl(peaks);

  context.fillStyle = '#0d1e1a';
  context.fillRect(0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
  context.strokeStyle = 'rgba(110, 231, 183, 0.2)';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, THUMBNAIL_HEIGHT / 2 + 0.5);
  context.lineTo(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT / 2 + 0.5);
  context.stroke();

  context.strokeStyle = '#34d399';
  context.lineWidth = 2;
  context.beginPath();
  const columnWidth = THUMBNAIL_WIDTH / peaks.length;
  for (let column = 0; column < peaks.length; column += 1) {
    const x = (column + 0.5) * columnWidth;
    const halfHeight = Math.max(1, peaks[column]! * THUMBNAIL_HEIGHT * 0.38);
    context.moveTo(x, THUMBNAIL_HEIGHT / 2 - halfHeight);
    context.lineTo(x, THUMBNAIL_HEIGHT / 2 + halfHeight);
  }
  context.stroke();

  return canvas.toDataURL('image/png');
}
