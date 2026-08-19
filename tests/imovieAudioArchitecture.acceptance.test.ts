import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const architecture = readFileSync(
  new URL(
    '../docs/research/2026-07-22-imovie-audio-suite-feasibility-architecture.md',
    import.meta.url,
  ),
  'utf8',
);

describe('iMovie audio-suite Phase 1 architecture acceptance', () => {
  it('records an explicit no-code disposition and bounded next slice', () => {
    expect(architecture).toContain('## Phase 1 outcome');
    expect(architecture).toMatch(/\| Application code authorized \| \*\*No\*\* \|/);
    expect(architecture).toMatch(
      /\| Next implementation candidate \| Worker-owned clip gain and fade envelopes \|/,
    );
  });

  it.each([
    'Audio Skimmer Engine',
    'Inline Gain Bar',
    'Visual Fade Anchors',
    'Stem Anchoring System',
    'Extract Track Action',
    'Auto-Ducking Processor',
    'EQ and De-Noiser',
    'Live VO Capture',
    'Time-Stretch and WSOLA',
    'DSP Effect Matrix',
  ])('maps the requested %s capability to a status and gate', (capability) => {
    const matrixRow = architecture
      .split('\n')
      .find((line) => line.startsWith(`| ${capability}`));

    expect(matrixRow).toBeDefined();
    expect(matrixRow).toMatch(/\*\*(?:Conflict|Candidate|Roadmap gate)\*\*/);
  });

  it('selects libraries and a worker-owned production topology without adding dependencies', () => {
    expect(architecture).toContain('No new runtime dependency is selected.');
    expect(architecture).toContain('Dedicated media Web Worker');
    expect(architecture).toContain('WebCodecs AudioDecoder');
    expect(architecture).toContain('WAV: direct PCM parser');
    expect(architecture).toContain('WAV: native encoder / MP3: bundled lamejs');
    expect(architecture).toContain('Keep Canvas 2D; evaluate built-in OffscreenCanvas before WebGL');
    expect(architecture).toContain('Do not select for the cross-browser core');
  });

  it('documents the non-shipping Web Audio graph and browser capability audit', () => {
    for (const primitive of [
      'AudioContext',
      'OfflineAudioContext',
      'AudioWorklet',
      'getUserMedia',
      'MediaRecorder',
      'OffscreenCanvas',
      'WebAssembly',
    ]) {
      expect(architecture).toContain(primitive);
    }

    for (const graphNode of [
      'per-clip GainNode',
      'optional BiquadFilterNode chain',
      'sidechain meter worklet',
      'track GainNode',
      'master GainNode',
      'DynamicsCompressorNode',
      'AnalyserNode -> meter',
      'AudioContext.destination',
    ]) {
      expect(architecture).toContain(graphNode);
    }

    expect(architecture).toContain('not selected for production');
  });

  it('preserves repository guardrails and treats performance numbers as benchmark gates', () => {
    for (const guardrail of [
      '64 MiB per-file input limit',
      '256 MiB decoded or in-flight PCM limit',
      'mono/stereo channel limit',
      'no remote code',
      'no partial download',
    ]) {
      expect(architecture).toContain(guardrail);
    }

    expect(architecture).toContain('`<20 ms` skimming response');
    expect(architecture).toContain('Locked 60 FPS');
    expect(architecture).toContain('`1 ms/px` waveform zoom');
    expect(architecture).toContain('Sample-accurate edits');
    expect(architecture).toContain('`>10x` real-time export');
    expect(architecture).toContain('candidate benchmark thresholds, not claims');
  });

  it('defines the baseline UI and evidence strategy', () => {
    expect(architecture).toContain('shared React function-component app');
    expect(architecture).toContain('shipped Tailwind design system');
    expect(architecture).toContain('Preserve DOM controls for keyboard access');
    expect(architecture).toContain('Do not reproduce proprietary Apple assets or trade dress');
    expect(architecture).toContain('Run the matrix on real production artifacts');
    expect(architecture).toContain('## Sources');
  });
});
