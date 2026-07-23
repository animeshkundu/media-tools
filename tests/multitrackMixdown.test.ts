import { describe, expect, it } from 'vitest';
import { buildDuckingEnvelope } from '../lib/tools/multitrack/ducking';
import { OfflineBiquad } from '../lib/tools/multitrack/eq';
import {
  assertDecodeFitsProject,
  maxVoiceOverFrames,
  mixTimeline,
  projectedMixWorkingBytes,
  projectedVoiceOverWorkingBytes,
  validateMixInput,
  type MultitrackMixInput,
} from '../lib/tools/multitrack/mixdown';
import { MAX_PCM_ENCODE_BYTES } from '../lib/core/worker';
import {
  createEmptyTimeline,
  type AudioAsset,
  type AudioClip,
  type TimelineState,
} from '../lib/tools/multitrack/schema';

const sampleRate = 8_000;

function makeAsset(id: string, roleName: string): AudioAsset {
  return {
    id,
    name: `${roleName}.wav`,
    mimeType: 'audio/wav',
    byteLength: 16_044,
    duration: 1,
    sampleRate,
    channels: 1,
    source: { kind: 'memory' },
  };
}

function makeClip(id: string, assetId: string): AudioClip {
  return {
    id,
    assetId,
    startTime: 0,
    trimStart: 0,
    duration: 1,
    playbackRate: 1,
    gain: 1,
    fadeIn: 0,
    fadeOut: 0,
    fadeCurve: 'logarithmic',
  };
}

function mixInput(ducking: boolean): MultitrackMixInput {
  const dialogueAsset = makeAsset('dialogue', 'dialogue');
  const musicAsset = makeAsset('music', 'music');
  const base = createEmptyTimeline('Ducking test');
  const state: TimelineState = {
    ...base,
    assets: { dialogue: dialogueAsset, music: musicAsset },
    tracks: base.tracks.map((track) => {
      if (track.role === 'dialogue') {
        return { ...track, eqPreset: 'flat', clips: [makeClip('dialogue-clip', 'dialogue')] };
      }
      if (track.role === 'music') {
        return { ...track, clips: [makeClip('music-clip', 'music')] };
      }
      return track;
    }),
    autoDucking: {
      ...base.autoDucking,
      enabled: ducking,
      thresholdDb: -30,
      reductionDb: -12,
      attackSeconds: 0.001,
      releaseSeconds: 0.01,
    },
  };
  return {
    state,
    pcmByAssetId: {
      dialogue: { sampleRate, channelData: [new Float32Array(sampleRate).fill(0.8)] },
      music: { sampleRate, channelData: [new Float32Array(sampleRate).fill(0.2)] },
    },
  };
}

describe('multitrack deterministic mixdown', () => {
  function measuredGain(type: 'lowshelf' | 'highshelf', frequency: number): number {
    const filter = new OfflineBiquad(
      { type, frequency: 1_000, gain: 12, q: 0.707 },
      48_000,
    );
    let inputEnergy = 0;
    let outputEnergy = 0;
    for (let frame = 0; frame < 96_000; frame += 1) {
      const input = Math.sin((2 * Math.PI * frequency * frame) / 48_000);
      const output = filter.process(input);
      if (frame >= 48_000) {
        inputEnergy += input * input;
        outputEnergy += output * output;
      }
    }
    return Math.sqrt(outputEnergy / inputEnergy);
  }

  it('matches native low-shelf and high-shelf direction at export', () => {
    expect(measuredGain('lowshelf', 40)).toBeCloseTo(10 ** (12 / 20), 1);
    expect(measuredGain('lowshelf', 12_000)).toBeCloseTo(1, 1);
    expect(measuredGain('highshelf', 40)).toBeCloseTo(1, 1);
    expect(measuredGain('highshelf', 12_000)).toBeCloseTo(10 ** (12 / 20), 1);
  });

  it('mixes immutable assets to stereo and applies dialogue-driven music ducking', () => {
    const plain = mixTimeline(mixInput(false));
    const ducked = mixTimeline(mixInput(true));
    const lateFrame = sampleRate - 1;

    expect(plain.sampleRate).toBe(sampleRate);
    expect(plain.channelData[0]).toHaveLength(sampleRate);
    expect(ducked.channelData[0][lateFrame]!).toBeLessThan(plain.channelData[0][lateFrame]!);
    expect(ducked.channelData[0][lateFrame]!).toBeGreaterThan(0);
  });

  it('uses attack and release smoothing in the sample-accurate ducking envelope', () => {
    const dialogue = new Float32Array(2_000);
    dialogue.fill(1, 50, 200);
    const envelope = buildDuckingEnvelope(dialogue, sampleRate, {
      enabled: true,
      thresholdDb: -30,
      reductionDb: -18,
      attackSeconds: 0.002,
      releaseSeconds: 0.01,
    });

    expect(envelope[49]).toBe(1);
    expect(envelope[100]!).toBeLessThan(0.5);
    expect(envelope[201]!).toBeLessThan(envelope[1_999]!);
    expect(envelope[1_999]!).toBeCloseTo(1, 4);
  });

  it('routes stereo channels across the field like StereoPannerNode', () => {
    const input = mixInput(false);
    const dialogueAsset = input.state.assets.dialogue!;
    const state: TimelineState = {
      ...input.state,
      assets: {
        ...input.state.assets,
        dialogue: { ...dialogueAsset, channels: 2 },
      },
      tracks: input.state.tracks.map((track) =>
        track.role === 'dialogue'
          ? { ...track, pan: -1 }
          : { ...track, muted: true },
      ),
    };
    const mix = mixTimeline({
      state,
      pcmByAssetId: {
        ...input.pcmByAssetId,
        dialogue: {
          sampleRate,
          channelData: [
            new Float32Array(sampleRate),
            new Float32Array(sampleRate).fill(0.25),
          ],
        },
      },
    });
    expect(mix.channelData[0][sampleRate / 2]).toBeCloseTo(0.25, 5);
    expect(mix.channelData[1][sampleRate / 2]).toBeCloseTo(0, 5);
  });

  it('includes retained buffers, transfer snapshots, output, envelope, and WAV in its hard cap', () => {
    const input = mixInput(true);
    expect(projectedMixWorkingBytes(input)).toBe(352_044);
    expect(() => validateMixInput(input)).not.toThrow();

    const invalid: MultitrackMixInput = {
      ...input,
      pcmByAssetId: { ...input.pcmByAssetId, dialogue: { sampleRate, channelData: [] } },
    };
    expect(() => validateMixInput(invalid)).toThrow(
      'Multitrack assets must contain mono or stereo PCM.',
    );
  });

  it('caps voice-over before capture so stop and export stay inside the working limit', () => {
    const input = mixInput(false);
    const frames = maxVoiceOverFrames(
      input,
      'track-dialogue',
      48_000,
      5 * 60,
    );
    expect(
      projectedVoiceOverWorkingBytes(
        input,
        'track-dialogue',
        48_000,
        frames,
      ),
    ).toBeLessThanOrEqual(MAX_PCM_ENCODE_BYTES);
    expect(
      projectedVoiceOverWorkingBytes(
        input,
        'track-dialogue',
        48_000,
        frames + 1,
      ),
    ).toBeGreaterThan(MAX_PCM_ENCODE_BYTES);
  });

  it('rejects aggregate PCM expansion before starting another decode', () => {
    const retained = {
      existing: {
        sampleRate: 8_000,
        channelData: [new Float32Array(10 * 1024 * 1024)],
      },
    };
    expect(() => assertDecodeFitsProject(retained, 10 * 60, 48_000)).toThrow(
      'aggregate PCM limit before decoding',
    );
    expect(() => assertDecodeFitsProject({}, 1, 48_000)).not.toThrow();
  });

  it('mixes the maximum number of sequential clips without scanning all clips per frame', () => {
    const base = createEmptyTimeline('Sequential clips');
    const tone = makeAsset('tone', 'tone');
    const clips = Array.from({ length: 128 }, (_, index) => ({
      ...makeClip(`clip-${index}`, 'tone'),
      startTime: index,
    }));
    const state: TimelineState = {
      ...base,
      assets: { tone },
      tracks: base.tracks.map((track, index) =>
        index === 0 ? { ...track, eqPreset: 'flat', clips } : track,
      ),
      autoDucking: { ...base.autoDucking, enabled: false },
    };
    const result = mixTimeline({
      state,
      pcmByAssetId: {
        tone: { sampleRate, channelData: [new Float32Array(sampleRate).fill(0.1)] },
      },
    });
    expect(result.channelData[0]).toHaveLength(128 * sampleRate);
    expect(result.channelData[0].at(-1)).toBeGreaterThan(0);
  });
});
