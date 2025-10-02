# Plugin System Architecture

## Overview

The extension has been refactored to use a modular plugin system that allows for extensible AI assistant behaviors. The main agent loop processes messages either from a user message queue or from randomly selected plugins.

## Architecture

### Core Components

1. **AgentLoop** (`src/AgentLoop.ts`)
   - Main loop that coordinates message processing
   - Checks the user message queue first
   - If queue is empty, selects a random enabled plugin to generate a message
   - Sends messages to the LLM and manages chat history
   - Handles cooldown and debouncing

2. **MessageQueue** (`src/MessageQueue.ts`)
   - Simple queue implementation for user messages
   - FIFO (First In, First Out) queue
   - User messages always take priority over plugin-generated messages

3. **PluginManager** (`src/plugins/PluginManager.ts`)
   - Manages all registered plugins
   - Filters enabled plugins based on configuration
   - Randomly selects plugins when needed
   - Handles plugin activation and deactivation

4. **IPlugin Interface** (`src/plugins/IPlugin.ts`)
   - Base interface that all plugins must implement
   - Defines the contract for plugin behavior
   - Key methods:
     - `isEnabled()`: Check if plugin is enabled
     - `generateMessage()`: Generate a message for the LLM
     - `activate()` / `deactivate()`: Lifecycle hooks

### Flow Diagram

```
User edits code
       ↓
AgentLoop.trigger() (with debounce)
       ↓
Is user message queue empty?
  ├── NO  → Dequeue user message → Send to LLM
  └── YES → Select random enabled plugin
               ↓
          Plugin.generateMessage()
               ↓
          Send to LLM
               ↓
          Update chat history
               ↓
          Send response to webview
```

## Built-in Plugins

### CodeReview Plugin (`src/plugins/CodeReviewPlugin.ts`)

The CodeReview plugin contains the original code roasting functionality. It:
- Analyzes the current code context
- Generates witty, constructive code reviews
- Maintains anchor points to track context changes
- Includes error diagnostics in its analysis

**Configuration:**
```json
"ani-vscode.plugins.codeReview.enabled": true
```

### HackerNews Plugin (`src/plugins/HackerNewsPlugin.ts`)

The HackerNews plugin fetches top stories from Hacker News and asks the AI to comment on them.

**Configuration:**
```json
"ani-vscode.plugins.hackerNews.enabled": true
```

### RSS Feed Plugin (`src/plugins/RSSFeedPlugin.ts`)

The RSS Feed plugin fetches articles from configured RSS feeds and asks the AI to summarize them.

**Configuration:**
```json
"ani-vscode.plugins.rssFeed.enabled": true,
"ani-vscode.plugins.rssFeed.feeds": [
  "https://example.com/feed.xml"
]
```

### Screenshot Plugin (`src/plugins/ScreenshotPlugin.ts`)

The Screenshot plugin captures your workspace and asks a vision-capable AI to comment on it. It:
- Captures screenshots using platform-native tools (macOS, Windows, Linux)
- Sends screenshots to vision-capable models (e.g., GPT-4 Vision)
- Provides witty commentary about code, workspace setup, and practices
- Automatically throttles to prevent excessive captures

**Requirements:**
- Vision-capable AI model (e.g., `gpt-4o`, `gpt-4-vision-preview`)

**Configuration:**
```json
"ani-vscode.plugins.screenshot.enabled": false
```

## Creating a New Plugin

To create a new plugin:

1. Create a new file in `src/plugins/` (e.g., `MyPlugin.ts`)

2. Implement the `IPlugin` interface:

```typescript
import { IPlugin, PluginContext, PluginMessage } from './IPlugin';
import * as vscode from 'vscode';

export class MyPlugin implements IPlugin {
  readonly id = 'myPlugin';
  readonly name = 'My Plugin';

  isEnabled(config: vscode.WorkspaceConfiguration): boolean {
    return config.get<boolean>('plugins.myPlugin.enabled', false);
  }

  async generateMessage(context: PluginContext): Promise<PluginMessage | null> {
    // Your logic here
    return {
      userPrompt: 'Your generated prompt',
      includeContext: true
    };
  }
}
```

3. Register the plugin in `extension.ts`:

```typescript
import { MyPlugin } from './plugins/MyPlugin';

// In the activate function:
const myPlugin = new MyPlugin();
pluginManager.register(myPlugin);
```

4. Add configuration in `package.json`:

```json
"ani-vscode.plugins.myPlugin.enabled": {
  "type": "boolean",
  "default": false,
  "description": "Enable My Plugin"
}
```

## Configuration

All plugin configurations follow this pattern:

```
ani-vscode.plugins.<pluginId>.enabled
```

Current plugins:
- `ani-vscode.plugins.codeReview.enabled` (default: `true`)
- `ani-vscode.plugins.hackerNews.enabled` (default: `true`)
- `ani-vscode.plugins.rssFeed.enabled` (default: `true`)
- `ani-vscode.plugins.screenshot.enabled` (default: `false`)

## User Message Queue

The user message queue allows for future extensibility, such as:
- Adding a chat interface for direct user questions
- Processing commands from the webview
- Handling user feedback or corrections

Messages in the queue always take priority over plugin-generated messages.

## Benefits

1. **Modularity**: Each plugin is self-contained and can be enabled/disabled independently
2. **Extensibility**: New plugins can be added without modifying core logic
3. **Priority System**: User messages always take precedence
4. **Random Selection**: When idle, the system picks random enabled plugins for variety
5. **Clean Separation**: Plugin logic is separated from the main extension code

## Future Enhancements

Possible future additions:
- More built-in plugins (e.g., documentation generator, test suggestion, performance tips)
- Plugin weights for selection probability
- Plugin scheduling (time-based triggers)
- Inter-plugin communication
- Plugin marketplace/registry
