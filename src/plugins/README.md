# Plugins Directory

This directory contains all plugin implementations for the AI assistant.

## Current Plugins

### CodeReview Plugin
- **File**: `CodeReviewPlugin.ts`
- **Purpose**: Analyzes and provides witty, constructive feedback on code
- **Config**: `ani-vscode.plugins.codeReview.enabled`
- **Default**: Enabled

### HackerNews Plugin
- **File**: `HackerNewsPlugin.ts`
- **Purpose**: Fetches top 3 random HackerNews articles and asks the AI to comment on them
- **Config**: 
  - `ani-vscode.plugins.hackerNews.enabled` (default: `true`)
  - `ani-vscode.plugins.hackerNews.periodicIntervalMinutes` (default: `30`)
- **Default**: Enabled with 30-minute intervals
- **Features**: 
  - Fetches from top 30 stories, displays title, author, score, comments count, and URL
  - **Periodic Trigger**: Automatically triggers every N minutes (configurable)
  - Also triggers normally when you're coding (along with other plugins)
  - Set interval to `0` to disable periodic triggers

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
