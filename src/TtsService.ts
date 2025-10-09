import { Buffer } from 'node:buffer';

export interface TtsConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  voice: string;
}

export interface TtsResult {
  mimeType: string;
  base64Audio: string;
}

export interface TtsSynthesisOptions {
  voiceInstructions?: string;
}

export class TtsService {
  async synthesize(text: string, config: TtsConfig, options?: TtsSynthesisOptions): Promise<TtsResult | null> {
    if (!config.enabled) {
      return null;
    }

    const trimmed = text.trim();
    if (!trimmed) {
      return null;
    }

    if (!config.baseUrl) {
      throw new Error('Text-to-speech base URL is not configured.');
    }

    if (!config.model) {
      throw new Error('Text-to-speech model is not configured.');
    }

    if (!config.apiKey) {
      throw new Error('Text-to-speech API key is not configured.');
    }

    const endpoint = this.buildEndpoint(config.baseUrl);

    const instructions = options?.voiceInstructions?.trim();

    const requestBody: Record<string, unknown> = {
      model: config.model,
      input: trimmed,
      voice: config.voice,
      response_format: 'wav',
    };

    if (instructions) {
      requestBody.instructions = instructions;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'audio/wav',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errText = await this.safeReadText(response);
      throw new Error(`TTS request failed (${response.status}): ${errText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    if (!arrayBuffer.byteLength) {
      throw new Error('Received empty audio payload from TTS service.');
    }

    const base64Audio = Buffer.from(arrayBuffer).toString('base64');
    return {
      mimeType: 'audio/wav',
      base64Audio,
    };
  }

  private buildEndpoint(baseUrl: string): string {
    // Ensure we point at /audio/speech relative to the configured base URL
    try {
      const url = new URL('audio/speech', this.ensureTrailingSlash(baseUrl));
      return url.toString();
    } catch (error) {
      throw new Error(`Invalid TTS base URL: ${baseUrl}`);
    }
  }

  private ensureTrailingSlash(value: string): string {
    if (!value.endsWith('/')) {
      return `${value}/`;
    }
    return value;
  }

  private async safeReadText(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch (error) {
      return '<no response body>';
    }
  }
}
