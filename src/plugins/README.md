# Plugins Directory

This directory contains all plugin implementations for the AI assistant.

## Current Plugins

### CodeReview Plugin
- **File**: `CodeReviewPlugin.ts`
- **Purpose**: Analyzes and provides witty, constructive feedback on code
- **Config**: `ani-vscode.plugins.codeReview.enabled`
- **Default**: Enabled

## Adding a New Plugin

See `PLUGIN_SYSTEM.md` in the root directory for detailed instructions.

## Quick Example

```typescript
import { IPlugin, PluginContext, PluginMessage } from './IPlugin';
import * as vscode from 'vscode';

export class ExamplePlugin implements IPlugin {
  readonly id = 'example';
  readonly name = 'Example Plugin';

  isEnabled(config: vscode.WorkspaceConfiguration): boolean {
    return config.get<boolean>('plugins.example.enabled', false);
  }

  async generateMessage(context: PluginContext): Promise<PluginMessage | null> {
    const { editor } = context;
    if (!editor) return null;

    const doc = editor.document;
    const language = doc.languageId;

    return {
      userPrompt: `Tell me something interesting about ${language} programming.`,
      includeContext: false
    };
  }
}
```
