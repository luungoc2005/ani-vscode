declare module 'soundtouchjs' {
  export class SoundTouch {
    pitch: number;
    rate: number;
    tempo: number;
    constructor();
  }

  export class SimpleFilter {
    constructor(source: any, pipe: any, callback?: (detail: unknown) => void);
    extract(target: Float32Array, numFrames: number): number;
    position: number;
    sourcePosition: number;
  }

  export class WebAudioBufferSource {
    constructor(buffer: AudioBuffer);
    extract(target: Float32Array, numFrames: number, position?: number): number;
    position: number;
  }

  export class PitchShifter {
    constructor(context: AudioContext, buffer: AudioBuffer, bufferSize?: number);
    connect(node: AudioNode): void;
    disconnect(): void;
    on(eventName: string, callback: (detail: unknown) => void): void;
    off(eventName?: string): void;
    rate: number;
    tempo: number;
    pitch: number;
  }

  export function getWebAudioNode(
    context: AudioContext,
    filter: SimpleFilter,
    sourcePositionCallback?: (sourcePosition: number) => void,
    bufferSize?: number
  ): ScriptProcessorNode;
}
