import {
  startFileTransform,
  type EncodeFormat,
  type EncodeJob,
} from '../../core/worker';
import {
  validateVolumeFadeOptions,
  type VolumeFadeOptions,
} from './volumeFades';

export function startVolumeFadesEncode(
  file: File,
  options: VolumeFadeOptions,
  format: EncodeFormat,
  onProgress: (value: number) => void,
): EncodeJob {
  validateVolumeFadeOptions(options);
  return startFileTransform(
    file,
    { type: 'volume-fades', format, options },
    onProgress,
    'Export cancelled.',
  );
}
