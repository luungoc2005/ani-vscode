# Plugins Directory

This directory contains all plugin implementations for the AI assistant.

## Plugin Selection

Plugins are selected using **weighted random selection**. Each plugin has a weight that determines how likely it is to trigger:

- Higher weight = more likely to trigger
- Weights are relative to each other (don't need to sum to 1.0)
- A plugin with weight 2.0 is twice as likely to trigger as one with weight 1.0
- Each plugin defines a default weight in code
- You can override weights in VS Code settings: `ani-vscode.plugins.{pluginId}.weight`

**Example**: 
```json
{
  "ani-vscode.plugins.codeReview.weight": 3.0,    // 3x more likely than default
  "ani-vscode.plugins.hackerNews.weight": 0.5     // Half as likely as default
}
```

## Current Plugins

### CodeReview Plugin
- **File**: `CodeReviewPlugin.ts`
- **Purpose**: Analyzes and provides witty, constructive feedback on code
- **Default Weight**: 2.0 (higher since it's core functionality)
- **Config**: 
  - `ani-vscode.plugins.codeReview.enabled` (default: `true`)
  - `ani-vscode.plugins.codeReview.weight` (default: `2.0`)

### HackerNews Plugin
- **File**: `HackerNewsPlugin.ts`
- **Purpose**: Fetches top 3 random HackerNews articles and asks the AI to comment on them
- **Default Weight**: 1.0
- **Config**: 
  - `ani-vscode.plugins.hackerNews.enabled` (default: `true`)
  - `ani-vscode.plugins.hackerNews.weight` (default: `1.0`)
  - `ani-vscode.plugins.hackerNews.periodicIntervalMinutes` (default: `30`)
- **Features**: 
  - Fetches from top 30 stories, displays title, author, score, comments count, and URL
  - **Periodic Trigger**: Automatically triggers every N minutes (configurable)
  - Also triggers normally when you're coding (along with other plugins)
  - Set interval to `0` to disable periodic triggers

### RSS Feed Plugin
- **File**: `RSSFeedPlugin.ts`
- **Purpose**: Fetches articles from configured RSS feeds and asks the AI to summarize them
- **Default Weight**: 1.0
- **Config**: 
  - `ani-vscode.plugins.rssFeed.enabled` (default: `true`)
  - `ani-vscode.plugins.rssFeed.weight` (default: `1.0`)
  - `ani-vscode.plugins.rssFeed.feeds` (default: `["https://hnrss.org/frontpage", "https://www.theverge.com/rss/index.xml"]`)
- **Features**: 
  - Randomly selects one RSS feed from the configured list
  - Fetches and parses RSS 2.0 and Atom feeds
  - Selects 3 random articles from the feed
  - Displays title, author, link, summary/content, and publication date
  - **Periodic Trigger**: Automatically triggers every N minutes (configurable via `ani-vscode.plugins.periodicIntervalMinutes`)
  - Configurable feed list - add your favorite RSS feeds in VS Code settings
  - Supports both HTTP and HTTPS feeds with redirect handling

### Screenshot Plugin
- **File**: `ScreenshotPlugin.ts`
- **Purpose**: Captures screenshots of your workspace and asks AI to comment on them
- **Default Weight**: 2
- **Config**: 
  - `ani-vscode.plugins.screenshot.enabled` (default: `false`)
  - `ani-vscode.plugins.screenshot.weight` (default: `2.0`)
- **Features**: 
  - Captures screenshots using platform-native tools (macOS, Windows, Linux)
  - Sends screenshots to vision-capable models (e.g., GPT-4 Vision)
  - Provides witty commentary about code, workspace setup, and practices
  - Automatically throttles to prevent excessive captures (minimum 1 minute between screenshots)
  - Compares screenshots to detect changes and provide contextual feedback
- **Requirements**: Vision-capable AI model (e.g., `gpt-4o`, `gpt-4-vision-preview`)

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

  // Optional: Define a default weight (defaults to 1.0 if not specified)
  getWeight(config: vscode.WorkspaceConfiguration): number {
    return 1.0;
  }

  // Optional: Control when this plugin should be eligible to trigger
  shouldTrigger(context: PluginContext): boolean {
    return context.editor !== undefined;
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
