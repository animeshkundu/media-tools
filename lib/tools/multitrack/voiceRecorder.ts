export const MAX_VOICE_OVER_SECONDS = 5 * 60;

export interface RecordedVoiceOver {
  readonly channelData: readonly [Float32Array];
  readonly duration: number;
  readonly sampleRate: number;
}

export function recordingFrameLimit(sampleRate: number, maxPcmBytes: number): number {
  if (!Number.isInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 192_000) {
    throw new Error('The microphone sample rate is unsupported.');
  }
  if (!Number.isSafeInteger(maxPcmBytes) || maxPcmBytes < Float32Array.BYTES_PER_ELEMENT) {
    throw new Error('There is not enough project memory available for a voice-over.');
  }
  return Math.min(
    Math.floor(maxPcmBytes / Float32Array.BYTES_PER_ELEMENT),
    sampleRate * MAX_VOICE_OVER_SECONDS,
  );
}

export function concatenateRecordedChunks(
  chunks: readonly Float32Array[],
  frameCount: number,
): Float32Array {
  if (!Number.isSafeInteger(frameCount) || frameCount < 1) {
    throw new Error('No microphone audio was recorded.');
  }
  const output = new Float32Array(frameCount);
  let offset = 0;
  for (const chunk of chunks) {
    if (offset + chunk.length > frameCount) {
      throw new Error('Recorded microphone chunks exceed their validated frame count.');
    }
    output.set(chunk, offset);
    offset += chunk.length;
  }
  if (offset !== frameCount) throw new Error('Recorded microphone chunks are incomplete.');
  return output;
}

export class VoiceOverRecorder {
  readonly #onAutoStop?: () => void;
  #stream?: MediaStream;
  #context?: AudioContext;
  #source?: MediaStreamAudioSourceNode;
  #processor?: ScriptProcessorNode;
  #silentGain?: GainNode;
  #chunks: Float32Array[] = [];
  #frames = 0;
  #maxFrames = 0;
  #captureEnded = false;
  #cancelRequested = false;

  constructor(onAutoStop?: () => void) {
    this.#onAutoStop = onAutoStop;
  }

  static isSupported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      typeof navigator.mediaDevices?.getUserMedia === 'function' &&
      typeof AudioContext === 'function'
    );
  }

  get isRecording(): boolean {
    return this.#context !== undefined && !this.#captureEnded;
  }

  get hasStarted(): boolean {
    return this.#context !== undefined;
  }

  async start(frameLimitForSampleRate: (sampleRate: number) => number): Promise<void> {
    if (!VoiceOverRecorder.isSupported()) {
      throw new Error('Microphone recording is not supported in this browser.');
    }
    if (this.#context) throw new Error('A voice-over recording is already active.');
    this.#cancelRequested = false;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: false,
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
      },
    });
    if (this.#cancelRequested) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error('Voice-over recording was cancelled.');
    }
    let context: AudioContext;
    try {
      context = new AudioContext({ latencyHint: 'interactive' });
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      throw error;
    }
    this.#stream = stream;
    this.#context = context;
    this.#captureEnded = false;
    try {
      const maxFrames = frameLimitForSampleRate(context.sampleRate);
      if (
        !Number.isSafeInteger(maxFrames) ||
        maxFrames < 1 ||
        maxFrames > context.sampleRate * MAX_VOICE_OVER_SECONDS
      ) {
        throw new Error('The voice-over frame limit is invalid.');
      }
      this.#maxFrames = maxFrames;
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4_096, 1, 1);
      const silentGain = context.createGain();
      silentGain.gain.value = 0;
      processor.onaudioprocess = (event) => {
        if (this.#captureEnded) return;
        const input = event.inputBuffer.getChannelData(0);
        const remaining = this.#maxFrames - this.#frames;
        if (remaining <= 0) {
          this.#endCapture();
          this.#onAutoStop?.();
          return;
        }
        const chunk = input.slice(0, Math.min(input.length, remaining));
        this.#chunks.push(chunk);
        this.#frames += chunk.length;
        if (this.#frames >= this.#maxFrames) {
          this.#endCapture();
          this.#onAutoStop?.();
        }
      };
      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(context.destination);
      this.#source = source;
      this.#processor = processor;
      this.#silentGain = silentGain;
      await context.resume();
      if (this.#cancelRequested) throw new Error('Voice-over recording was cancelled.');
    } catch (error) {
      this.#endCapture();
      await this.#disposeNodes();
      throw error;
    }
  }

  async stop(): Promise<RecordedVoiceOver> {
    const context = this.#context;
    if (!context) throw new Error('No voice-over recording is active.');
    this.#endCapture();
    const sampleRate = context.sampleRate;
    const frameCount = this.#frames;
    const chunks = this.#chunks;
    await this.#disposeNodes();
    const channel = concatenateRecordedChunks(chunks, frameCount);
    this.#chunks = [];
    this.#frames = 0;
    return {
      sampleRate,
      channelData: [channel],
      duration: channel.length / sampleRate,
    };
  }

  async cancel(): Promise<void> {
    this.#cancelRequested = true;
    this.#endCapture();
    this.#chunks = [];
    this.#frames = 0;
    await this.#disposeNodes();
  }

  #endCapture(): void {
    if (this.#captureEnded) return;
    this.#captureEnded = true;
    this.#stream?.getTracks().forEach((track) => track.stop());
    this.#source?.disconnect();
    if (this.#processor) {
      this.#processor.onaudioprocess = null;
      this.#processor.disconnect();
    }
    this.#silentGain?.disconnect();
  }

  async #disposeNodes(): Promise<void> {
    const context = this.#context;
    this.#stream = undefined;
    this.#context = undefined;
    this.#source = undefined;
    this.#processor = undefined;
    this.#silentGain = undefined;
    if (context && context.state !== 'closed') await context.close();
  }
}
