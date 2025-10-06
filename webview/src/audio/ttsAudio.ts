import { SimpleFilter, SoundTouch, WebAudioBufferSource } from 'soundtouchjs';

export const DEFAULT_PITCH_RATIO = 1.5;
const MIN_PITCH_DELTA = 0.005;
const PITCH_CHUNK_SIZE = 2048;

export interface TtsAudioPayload {
  data: string;
  mimeType?: string;
  playbackRate?: number;
  pitchRatio?: number;
}

export interface ProcessedAudioPayload {
  playbackBuffer: AudioBuffer;
  lipSyncBase64: string;
  mimeType: string;
}

const normalizePitchRatio = (value?: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_PITCH_RATIO;
  }
  return value;
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

const audioBufferToWavArrayBuffer = (buffer: AudioBuffer): ArrayBuffer => {
  const numChannels = Math.max(buffer.numberOfChannels, 1);
  const sampleRate = buffer.sampleRate;
  const frameCount = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = frameCount * blockAlign;
  const bufferLength = 44 + dataSize;
  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const sourceChannels: Float32Array[] =
    buffer.numberOfChannels > 0
      ? Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel))
      : [new Float32Array(frameCount)];

  let offset = 44;
  for (let frame = 0; frame < frameCount; frame++) {
    for (let channel = 0; channel < numChannels; channel++) {
      const data = sourceChannels[Math.min(channel, sourceChannels.length - 1)];
      let sample = data[frame] ?? 0;
      sample = Math.max(-1, Math.min(1, sample));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += bytesPerSample;
    }
  }

  return arrayBuffer;
};

const arrayBufferToBase64 = (input: ArrayBuffer): string => {
  const bytes = new Uint8Array(input);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const pitchShiftAudioBuffer = (ctx: AudioContext, buffer: AudioBuffer, pitchRatio: number): AudioBuffer => {
  const soundTouch = new SoundTouch();
  soundTouch.rate = 1;
  soundTouch.tempo = 1;
  soundTouch.pitch = pitchRatio;

  const source = new WebAudioBufferSource(buffer);
  const filter = new SimpleFilter(source, soundTouch);

  const channelCount = Math.max(buffer.numberOfChannels, 1);
  const channelsToCollect = Math.max(Math.min(channelCount, 2), 1);
  const collected: number[][] = Array.from({ length: channelsToCollect }, () => [] as number[]);
  const interleaved = new Float32Array(PITCH_CHUNK_SIZE * channelsToCollect);

  let framesExtracted = 0;
  do {
    framesExtracted = filter.extract(interleaved, PITCH_CHUNK_SIZE);
    for (let i = 0; i < framesExtracted; i++) {
      for (let channel = 0; channel < channelsToCollect; channel++) {
        const sample = interleaved[i * channelsToCollect + channel] ?? 0;
        collected[channel].push(sample);
      }
    }
  } while (framesExtracted > 0);

  const frameCount = collected[0]?.length ?? 0;
  if (frameCount === 0) {
    return buffer;
  }

  const result = ctx.createBuffer(channelCount, frameCount, buffer.sampleRate);
  result.getChannelData(0).set(Float32Array.from(collected[0]));

  if (channelCount > 1) {
    const right = collected.length > 1 ? collected[1] : collected[0];
    result.getChannelData(1).set(Float32Array.from(right));
  }

  for (let channel = 2; channel < channelCount; channel++) {
    const sourceChannel = buffer.getChannelData(channel);
    const targetChannel = result.getChannelData(channel);
    if (sourceChannel.length >= frameCount) {
      targetChannel.set(sourceChannel.subarray(0, frameCount));
    } else {
      targetChannel.set(sourceChannel);
      for (let i = sourceChannel.length; i < frameCount; i++) {
        targetChannel[i] = 0;
      }
    }
  }

  return result;
};

export const processAudioForPlayback = (
  ctx: AudioContext,
  buffer: AudioBuffer,
  pitchRatio: number,
  originalBase64: string
): { playbackBuffer: AudioBuffer; lipSyncBase64: string } => {
  const normalizedRatio = normalizePitchRatio(pitchRatio);
  if (Math.abs(normalizedRatio - 1) < MIN_PITCH_DELTA) {
    return { playbackBuffer: buffer, lipSyncBase64: originalBase64 };
  }

  try {
    const shifted = pitchShiftAudioBuffer(ctx, buffer, normalizedRatio);
    const wavBuffer = audioBufferToWavArrayBuffer(shifted);
    return {
      playbackBuffer: shifted,
      lipSyncBase64: arrayBufferToBase64(wavBuffer),
    };
  } catch (error) {
    console.warn('Pitch shifting failed; using original audio buffer instead.', error);
    return { playbackBuffer: buffer, lipSyncBase64: originalBase64 };
  }
};

export const prepareAudioForPlayback = async (
  ctx: AudioContext,
  payload: TtsAudioPayload
): Promise<ProcessedAudioPayload> => {
  const mimeType = payload.mimeType ?? 'audio/wav';
  const arrayBuffer = base64ToArrayBuffer(payload.data);
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));

  const { playbackBuffer, lipSyncBase64 } = processAudioForPlayback(
    ctx,
    audioBuffer,
    payload.pitchRatio ?? payload.playbackRate ?? DEFAULT_PITCH_RATIO,
    payload.data
  );

  return {
    playbackBuffer,
    lipSyncBase64,
    mimeType,
  };
};
