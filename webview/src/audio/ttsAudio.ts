import { SimpleFilter, SoundTouch, WebAudioBufferSource } from 'soundtouchjs';
import toWav from 'audiobuffer-to-wav';

export const DEFAULT_PITCH_RATIO = 1.5;
const MIN_PITCH_DELTA = 0.005;
const PITCH_CHUNK_SIZE = 8192;

export interface TtsAudioPayload {
  data: string;
  mimeType?: string;
  playbackRate?: number;
  pitchRatio?: number;
}

export interface ProcessedAudioPayload {
  playbackBuffer: AudioBuffer;
  lipSyncWav?: ArrayBuffer;
}

const normalizePitchRatio = (value?: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_PITCH_RATIO;
  }
  return value;
};

const normalizeAudioBuffer = (buffer: AudioBuffer, targetPeak = 0.95): AudioBuffer => {
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) {
      const value = Math.abs(data[i]);
      if (value > peak) {
        peak = value;
      }
    }
  }

  if (peak === 0 || peak >= targetPeak) {
    return buffer;
  }

  const gain = targetPeak / peak;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) {
      data[i] *= gain;
    }
  }
  return buffer;
};

const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
};

const audioBufferToWavArrayBuffer = (buffer: AudioBuffer): ArrayBuffer =>
  toWav(buffer, { float32: false });

const pitchShiftAudioBuffer = (ctx: AudioContext, buffer: AudioBuffer, pitchRatio: number): AudioBuffer => {
  const soundTouch = new SoundTouch();
  soundTouch.rate = 1;
  soundTouch.tempo = 1;
  soundTouch.pitch = pitchRatio;
  const stretch = (soundTouch as unknown as { stretch?: any }).stretch;
  if (stretch) {
    try {
      stretch.quickSeek = false;
      stretch.setParameters(buffer.sampleRate, 40, 15, 10);
    } catch (error) {
      console.warn('Failed to adjust SoundTouch stretch parameters', error);
    }
  }

  const source = new WebAudioBufferSource(buffer);
  const filter = new SimpleFilter(source, soundTouch);

  const inputChannelCount = Math.max(buffer.numberOfChannels, 1);
  const filterChannels = 2; // SimpleFilter emits stereo samples regardless of input
  const collected: number[][] = Array.from({ length: filterChannels }, () => [] as number[]);
  const interleaved = new Float32Array(PITCH_CHUNK_SIZE * filterChannels);

  let framesExtracted = 0;
  do {
    framesExtracted = filter.extract(interleaved, PITCH_CHUNK_SIZE);
    for (let i = 0; i < framesExtracted; i++) {
      for (let channel = 0; channel < filterChannels; channel++) {
        const sample = interleaved[i * filterChannels + channel] ?? 0;
        collected[channel].push(sample);
      }
    }
  } while (framesExtracted > 0);

  const frameCount = collected[0]?.length ?? 0;
  if (frameCount === 0) {
    return buffer;
  }

  const stereoBuffer = ctx.createBuffer(filterChannels, frameCount, buffer.sampleRate);
  for (let channel = 0; channel < filterChannels; channel++) {
    const samples = collected[channel] ?? collected[0] ?? [];
    stereoBuffer.getChannelData(channel).set(Float32Array.from(samples));
  }

  if (inputChannelCount === 1) {
    const monoBuffer = ctx.createBuffer(1, frameCount, buffer.sampleRate);
    const left = stereoBuffer.getChannelData(0);
    const mono = monoBuffer.getChannelData(0);
    for (let i = 0; i < frameCount; i++) {
      mono[i] = left[i];
    }
    return monoBuffer;
  }

  if (inputChannelCount === 2) {
    return stereoBuffer;
  }

  const result = ctx.createBuffer(inputChannelCount, frameCount, buffer.sampleRate);
  for (let channel = 0; channel < inputChannelCount; channel++) {
    const sourceChannel = channel < filterChannels ? stereoBuffer.getChannelData(channel) : stereoBuffer.getChannelData(channel % filterChannels);
    result.getChannelData(channel).set(sourceChannel);
  }

  return result;
};

export const processAudioForPlayback = (
  ctx: AudioContext,
  buffer: AudioBuffer,
  pitchRatio: number
): { playbackBuffer: AudioBuffer; lipSyncWav?: ArrayBuffer } => {
  const normalizedRatio = normalizePitchRatio(pitchRatio);
  const requiresPitchShift = Math.abs(normalizedRatio - 1) >= MIN_PITCH_DELTA;

  let workingBuffer = buffer;

  if (requiresPitchShift) {
    try {
      workingBuffer = pitchShiftAudioBuffer(ctx, buffer, normalizedRatio);
    } catch (error) {
      console.warn('Pitch shifting failed; using original audio buffer instead.', error, {
        bufferLength: buffer.length,
        bufferChannels: buffer.numberOfChannels,
      });
      workingBuffer = buffer;
    }
  }

  try {
    const normalized = normalizeAudioBuffer(workingBuffer);
    const wavBuffer = audioBufferToWavArrayBuffer(normalized);
    return {
      playbackBuffer: normalized,
      lipSyncWav: wavBuffer,
    };
  } catch (encodeError) {
    console.warn('WAV encoding failed; lip sync may be degraded for this utterance.', encodeError, {
      bufferLength: workingBuffer.length,
      bufferChannels: workingBuffer.numberOfChannels,
    });
    return {
      playbackBuffer: workingBuffer,
      lipSyncWav: undefined,
    };
  }
};

export const prepareAudioForPlayback = async (
  ctx: AudioContext,
  payload: TtsAudioPayload
): Promise<ProcessedAudioPayload> => {
  const arrayBuffer = base64ToArrayBuffer(payload.data);
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));

  const { playbackBuffer, lipSyncWav } = processAudioForPlayback(
    ctx,
    audioBuffer,
    payload.pitchRatio ?? payload.playbackRate ?? DEFAULT_PITCH_RATIO
  );

  return {
    playbackBuffer,
    lipSyncWav,
  };
};
