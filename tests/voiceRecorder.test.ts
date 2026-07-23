import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  concatenateRecordedChunks,
  MAX_VOICE_OVER_SECONDS,
  recordingFrameLimit,
} from '../lib/tools/multitrack/voiceRecorder';

describe('voice-over capture bounds', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('limits capture by available PCM bytes and the five-minute ceiling', () => {
    expect(recordingFrameLimit(48_000, 48_000 * 4)).toBe(48_000);
    expect(recordingFrameLimit(48_000, 512 * 1024 * 1024)).toBe(
      48_000 * MAX_VOICE_OVER_SECONDS,
    );
    expect(() => recordingFrameLimit(48_000, 0)).toThrow('not enough project memory');
  });

  it('joins validated microphone chunks without retaining extra capacity', () => {
    const joined = concatenateRecordedChunks(
      [new Float32Array([0.1, 0.2]), new Float32Array([0.3])],
      3,
    );
    expect(joined[0]).toBeCloseTo(0.1);
    expect(joined[1]).toBeCloseTo(0.2);
    expect(joined[2]).toBeCloseTo(0.3);
    expect(() => concatenateRecordedChunks([new Float32Array([1])], 2)).toThrow(
      'incomplete',
    );
  });

  it('stops a stream that arrives after pending microphone permission is cancelled', async () => {
    let resolveStream: (stream: MediaStream) => void = () => undefined;
    const streamPromise = new Promise<MediaStream>((resolve) => {
      resolveStream = resolve;
    });
    const stop = vi.fn();
    const stream = {
      getTracks: () => [{ stop }],
    } as unknown as MediaStream;
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: () => streamPromise },
    });
    vi.stubGlobal('AudioContext', function MockAudioContext() {
      return undefined;
    });

    const { VoiceOverRecorder } = await import(
      '../lib/tools/multitrack/voiceRecorder'
    );
    const recorder = new VoiceOverRecorder();
    const start = recorder.start(() => 48_000);
    await recorder.cancel();
    expect(recorder.hasStarted).toBe(false);
    resolveStream(stream);

    await expect(start).rejects.toThrow('cancelled');
    expect(stop).toHaveBeenCalledOnce();
    expect(recorder.isRecording).toBe(false);
  });

  it('stops a granted stream when AudioContext construction fails', async () => {
    const stop = vi.fn();
    const stream = {
      getTracks: () => [{ stop }],
    } as unknown as MediaStream;
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: async () => stream },
    });
    vi.stubGlobal('AudioContext', function BrokenAudioContext() {
      throw new Error('Audio context unavailable');
    });

    const { VoiceOverRecorder } = await import(
      '../lib/tools/multitrack/voiceRecorder'
    );
    const recorder = new VoiceOverRecorder();
    await expect(recorder.start(() => 48_000)).rejects.toThrow(
      'Audio context unavailable',
    );
    expect(stop).toHaveBeenCalledOnce();
  });
});
