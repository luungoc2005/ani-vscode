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
  const channels = Math.max(1, buffer.numberOfChannels);
  const sampleRate = buffer.sampleRate;
  const interleaved = interleaveChannels(buffer, channels);

  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = interleaved.length * bytesPerSample;
  const bufferLength = 44 + dataSize;
  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const writtenSamples = floatTo16BitPCM(view, 44, interleaved);
  const actualDataSize = writtenSamples * bytesPerSample;

  if (actualDataSize !== dataSize) {
    view.setUint32(4, 36 + actualDataSize, true);
    view.setUint32(40, actualDataSize, true);
    const trimmedLength = 44 + actualDataSize;
    if (trimmedLength < arrayBuffer.byteLength) {
      return arrayBuffer.slice(0, trimmedLength);
    }
  }

  return arrayBuffer;
};

const interleaveChannels = (buffer: AudioBuffer, channels: number): Float32Array => {
  const frameCount = buffer.length;
  const result = new Float32Array(frameCount * channels);
  const channelData: Float32Array[] = Array.from({ length: channels }, (_, index) => {
    if (index < buffer.numberOfChannels) {
      return buffer.getChannelData(index);
    }
    return new Float32Array(frameCount);
  });

  let writeIndex = 0;
  for (let frame = 0; frame < frameCount; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      result[writeIndex++] = channelData[channel][frame] ?? 0;
    }
  }

  return result;
};

const writeString = (view: DataView, offset: number, value: string) => {
  for (let i = 0; i < value.length; i++) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
};

const floatTo16BitPCM = (view: DataView, offset: number, samples: Float32Array): number => {
  const byteLength = view.byteLength;
  let written = 0;
  for (let i = 0; i < samples.length && offset + 1 < byteLength; i++, offset += 2) {
    let sample = samples[i];
    sample = Math.max(-1, Math.min(1, sample || 0));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    written++;
  }
  if (written < samples.length) {
    console.warn('Truncated WAV encoding due to buffer bounds.');
  }
  return written;
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
