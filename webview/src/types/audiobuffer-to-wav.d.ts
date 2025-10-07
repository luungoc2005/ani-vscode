declare module 'audiobuffer-to-wav' {
  export default function toWav(buffer: AudioBuffer, opt?: { float32?: boolean; disableNormalization?: boolean }): ArrayBuffer;
}
