Ani VSCode
==========

VSCode extension that opens a webview showing Live2D Cubism models (Hiyori and Mao) following the mouse without requiring mouse down.

Usage:
- Run "Ani: Show Cubism Panel" command.

Build:
- From this folder: `npm install` then `npm run build`.

Text-to-Speech:
- Enable `Ani VSCode › TTS › Enabled` in the extension settings to have responses spoken aloud.
- Provide the base URL, API key, model, and voice for your OpenAI-compatible speech endpoint.
- Adjust `Ani VSCode › TTS › Pitch Ratio` (default `1.45`) to brighten or deepen the synthesized voice without changing timing. Leave `Playback Rate` at `1.0` unless you explicitly want faster/slower speech.
- Check the **Ani VSCode** output channel (`View → Output`) for detailed TTS logs and troubleshooting information.


