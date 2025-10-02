import * as vscode from 'vscode';
import { ChatOpenAI, ChatOpenAIFields } from '@langchain/openai';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { MessageQueue } from './MessageQueue';
import { PluginManager } from './plugins/PluginManager';
import { PluginContext } from './plugins/IPlugin';
import { getCharacterSystemPrompt } from './CharacterLoader';
import motionsMap from './motions_map.json';

/**
 * Main agent loop that processes messages from the queue or plugins
 */
export class AgentLoop {
  private messageQueue: MessageQueue;
  private pluginManager: PluginManager;
  private llmInFlight = false;
  private roastDebounceTimer: NodeJS.Timeout | undefined;
  private cooldownTimer: NodeJS.Timeout | undefined;
  private lastLlmEndedAt: number | null = null;
  private chatHistory: Array<SystemMessage | HumanMessage | AIMessage> = [];
  private lastFilePath: string | null = null;
  private currentCharacter: string = 'Mao';
  private extensionPath: string = '';

  constructor(messageQueue: MessageQueue, pluginManager: PluginManager) {
    this.messageQueue = messageQueue;
    this.pluginManager = pluginManager;
  }

  /**
   * Set the extension path for loading character cards
   */
  setExtensionPath(path: string): void {
    this.extensionPath = path;
  }

  /**
   * Set the current character and reset chat history
   */
  setCharacter(characterName: string): void {
    this.currentCharacter = characterName;
    this.resetChatHistory();
  }

  /**
   * Get the current character name
   */
  getCurrentCharacter(): string {
    return this.currentCharacter;
  }

  /**
   * Trigger the agent loop with a debounce
   */
  trigger(pluginId?: string): void {
    if (this.roastDebounceTimer) {
      clearTimeout(this.roastDebounceTimer);
    }
    // Debounce slightly to avoid spamming on rapid cursor/keys
    this.roastDebounceTimer = setTimeout(() => this.run(pluginId), 500);
  }

  /**
   * Run the agent loop immediately
   */
  private async run(pluginId?: string, options?: { skipReschedule?: boolean }): Promise<void> {
    if (this.llmInFlight) {
      return;
    }

    // Try to get active editor, or fall back to first visible editor
    let editor = vscode.window.activeTextEditor;
    if (!editor) {
      const visibleEditors = vscode.window.visibleTextEditors;
      if (visibleEditors.length > 0) {
        editor = visibleEditors[0];
      }
    }

    // Ensure we have LLM settings
    const cfg = vscode.workspace.getConfiguration('ani-vscode');
    const baseUrl = cfg.get<string>('llm.baseUrl', 'https://api.openai.com/v1');
    const apiKey = cfg.get<string>('llm.apiKey', 'dummy');
    const fallbackPrompt = 'You are a helpful AI assistant. Reply in a friendly and concise manner.';
    const systemPrompt = getCharacterSystemPrompt(this.currentCharacter, this.extensionPath, fallbackPrompt);
    const minIntervalSec = Math.max(10, cfg.get<number>('llm.minIntervalSeconds', 10));
    const maxHistory = Math.max(1, cfg.get<number>('llm.maxHistory', 5));

    // Check cooldown
    const now = Date.now();
    if (this.lastLlmEndedAt !== null) {
      const elapsedMs = now - this.lastLlmEndedAt;
      const minMs = minIntervalSec * 1000;
      if (elapsedMs < minMs) {
        // If skipReschedule is true, just return (used by triggerPlugin)
        if (options?.skipReschedule) {
          return;
        }
        const delay = Math.max(0, minMs - elapsedMs);
        if (this.cooldownTimer) clearTimeout(this.cooldownTimer);
        this.cooldownTimer = setTimeout(() => {
          this.cooldownTimer = undefined;
          this.run(pluginId, options);
        }, delay);
        return;
      }
    }

    try {
      this.llmInFlight = true;
      
      // Get the webview panel from context (will be set via method parameter in actual usage)
      const panel = (this as any).panel as vscode.WebviewPanel;
      if (panel) {
        panel.webview.postMessage({ type: 'thinking', on: true });
      }

      // Reset chat history when switching to a different file
      if (editor) {
        const doc = editor.document;
        const absPath = doc.uri.fsPath;
        if (this.lastFilePath !== absPath) {
          this.chatHistory = [];
          this.lastFilePath = absPath;
        }
      }

      // Ensure system prompt is present at the start of history
      if (this.chatHistory.length === 0 || !(this.chatHistory[0] instanceof SystemMessage)) {
        this.chatHistory.unshift(new SystemMessage(systemPrompt));
      }

      let userPrompt: string;
      let appendText: string | undefined;
      let imageData: { image: string; mimeType: string } | undefined;
      let triggeringPlugin: any = null; // Track which plugin generated this message
      
      // Check if there are user messages in the queue
      if (!this.messageQueue.isEmpty()) {
        // Process user message from queue
        const message = this.messageQueue.dequeue();
        if (!message) {
          return;
        }
        userPrompt = message;
      } else {
        // Get message from specific plugin or randomly selected plugin
        const context = this.createPluginContext(editor, panel);
        
        // Get the plugin instance
        if (pluginId) {
          triggeringPlugin = this.pluginManager.getPlugin(pluginId);
        } else {
          triggeringPlugin = this.pluginManager.selectRandomPlugin(cfg, context);
        }
        
        if (!triggeringPlugin) {
          return;
        }
        
        const pluginMessage = await triggeringPlugin.generateMessage(context);
        
        if (!pluginMessage) {
          // No plugin available or no message generated
          return;
        }
        
        userPrompt = pluginMessage.userPrompt;
        appendText = pluginMessage.text;
        
        // Check if plugin message includes image data
        if (appendText) {
          try {
            const parsed = JSON.parse(appendText);
            if (parsed.image && parsed.mimeType) {
              imageData = parsed;
              appendText = undefined; // Don't append to display text
            }
          } catch {
            // Not JSON, treat as regular append text
          }
        }
      }

      // Send to LLM
      const model = cfg.get<string>('llm.model', 'gpt-4o-mini');
      const llmFields: ChatOpenAIFields = {
        model,
        configuration: { baseURL: baseUrl },
      };
      if (apiKey) {
        llmFields.apiKey = apiKey;
      }
      const llm = new ChatOpenAI(llmFields);

      // Create human message with optional image content
      let humanMessage: HumanMessage;
      if (imageData) {
        // Multi-modal message with text and image
        humanMessage = new HumanMessage({
          content: [
            { type: 'text', text: userPrompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:${imageData.mimeType};base64,${imageData.image}`,
              },
            },
          ],
        });
      } else {
        // Text-only message
        humanMessage = new HumanMessage(userPrompt);
      }

      const historyToSend = [...this.chatHistory, humanMessage];
      const aiMsg = await llm.invoke(historyToSend);

      let text = typeof aiMsg.content === 'string'
        ? aiMsg.content
        : Array.isArray(aiMsg.content)
          ? aiMsg.content.map((c: any) => (typeof c?.text === 'string' ? c.text : '')).join('')
          : String(aiMsg.content ?? '');
      text = this.stripCodeBlockTags(text);
      text = this.stripThinkTags(text);

      // Notify the plugin of the AI response if it has an onResponse method
      if (triggeringPlugin && typeof triggeringPlugin.onResponse === 'function') {
        triggeringPlugin.onResponse(text);
      }

      // Update chat history and prune if needed
      this.chatHistory.push(new HumanMessage(userPrompt));
      this.chatHistory.push(new AIMessage(text));
      if (this.chatHistory.length > maxHistory) {
        const system = this.chatHistory[0] instanceof SystemMessage ? [this.chatHistory[0]] : [];
        const tail = this.chatHistory.slice(-1 * (maxHistory - system.length));
        this.chatHistory = [...system, ...tail];
      }

      if (panel) {
        // Append plugin text if available
        const displayText = appendText ? text + appendText : text;
        panel.webview.postMessage({ type: 'speech', text: displayText });
        
        // Trigger expression animation if fastModel is configured
        await this.triggerExpression(text, panel, cfg);
      }
    } catch (err: any) {
      const msg = err?.message || String(err);
      const panel = (this as any).panel as vscode.WebviewPanel;
      if (panel) {
        panel.webview.postMessage({ type: 'speech', text: `LLM error: ${msg}` });
      }
    } finally {
      this.llmInFlight = false;
      this.lastLlmEndedAt = Date.now();
      const panel = (this as any).panel as vscode.WebviewPanel;
      if (panel) {
        panel.webview.postMessage({ type: 'thinking', on: false });
      }
    }
  }

  /**
   * Set the webview panel for the agent loop
   */
  setPanel(panel: vscode.WebviewPanel): void {
    (this as any).panel = panel;
  }

  /**
   * Add a user message to the queue
   */
  enqueueUserMessage(message: string): void {
    this.messageQueue.enqueue(message);
  }

  /**
   * Reset chat history (e.g., when changing files)
   */
  resetChatHistory(): void {
    this.chatHistory = [];
    this.lastFilePath = null;
  }

  /**
   * Create plugin context for the current state
   */
  private createPluginContext(editor: vscode.TextEditor | undefined, panel: vscode.WebviewPanel): PluginContext {
    const lastEditedFiles: string[] = (this as any).lastEditedFiles || [];
    
    const getRelativePath = (absPath: string) => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0) return absPath;
      for (const folder of folders) {
        const path = require('path');
        const rel = path.relative(folder.uri.fsPath, absPath);
        if (!rel.startsWith('..')) return rel || path.basename(absPath);
      }
      const path = require('path');
      return path.basename(absPath);
    };

    const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

    const getLinesAround = (doc: vscode.TextDocument, centerLine: number, radius: number) => {
      const start = clamp(centerLine - radius, 0, doc.lineCount - 1);
      const end = clamp(centerLine + radius, 0, doc.lineCount - 1);
      const lines: string[] = [];
      for (let i = start; i <= end; i++) {
        lines.push(doc.lineAt(i).text);
      }
      return { start, end, text: lines.join('\n') };
    };

    return {
      editor,
      panel,
      lastEditedFiles,
      chatHistory: this.chatHistory,
      getRelativePath,
      getLinesAround
    };
  }

  /**
   * Set last edited files (for context)
   */
  setLastEditedFiles(files: string[]): void {
    (this as any).lastEditedFiles = files;
  }


  // Utility function to remove markdown code block tags
  private stripCodeBlockTags(text: string): string {
    // Only strip if the entire text is wrapped in code blocks
    const trimmed = text.trim();
    const startsWithCodeBlock = /^```\w*\n/.test(trimmed);
    const endsWithCodeBlock = /\n```$/.test(trimmed);
    
    if (startsWithCodeBlock && endsWithCodeBlock) {
      // Remove first line (opening ```) and last line (closing ```)
      const lines = trimmed.split('\n');
      return lines.slice(1, -1).join('\n');
    }
    
    return text;
  };

  // Utility function to remove <think> tags and their content
  private stripThinkTags(text: string): string {
    // Remove all <think>...</think> blocks (including multiline)
    return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  };

  /**
   * Trigger a specific plugin by ID
   */
  async triggerPlugin(pluginId: string): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('ani-vscode');
    const plugin = this.pluginManager.getPlugin(pluginId);
    
    if (!plugin || !plugin.isEnabled(cfg)) {
      return;
    }

    // Delegate to run() with skipReschedule
    await this.run(pluginId, { skipReschedule: true });
  }

  /**
   * Trigger expression animation based on the AI response
   */
  private async triggerExpression(
    aiResponse: string,
    panel: vscode.WebviewPanel,
    cfg: vscode.WorkspaceConfiguration
  ): Promise<void> {
    try {
      const fastModel = cfg.get<string>('llm.fastModel', '');
      if (!fastModel) {
        // Expression feature disabled
        return;
      }

      // Request current character from webview (in case user switched)
      panel.webview.postMessage({ type: 'getCurrentModel' });
      
      // Wait for response from webview
      const character = await new Promise<string>((resolve) => {
        const timeout = setTimeout(() => {
          // Fallback to config if no response
          resolve(cfg.get<string>('character', 'Hiyori'));
        }, 1000);
        
        const disposable = panel.webview.onDidReceiveMessage((msg) => {
          if (msg.type === 'currentModel' && msg.modelName) {
            clearTimeout(timeout);
            disposable.dispose();
            resolve(msg.modelName);
          }
        });
      });
      
      // Get character expressions from motions map
      const characterExpressions = motionsMap[character as keyof typeof motionsMap];
      
      if (!characterExpressions) {
        return;
      }
      
      const availableExpressions = Object.keys(characterExpressions);
      
      // Create prompt for fast model to choose expression
      const expressionPrompt = `Based on the following AI response, choose the most appropriate expression from this list: ${availableExpressions.join(', ')}.

AI Response: "${aiResponse}"

Respond with ONLY the expression name, nothing else.`;
      
      // Call fast model
      const baseUrl = cfg.get<string>('llm.baseUrl', 'https://api.openai.com/v1');
      const apiKey = cfg.get<string>('llm.apiKey', 'dummy');
      
      const llmFields: ChatOpenAIFields = {
        model: fastModel,
        configuration: { baseURL: baseUrl },
        temperature: 0.3,
      };
      if (apiKey) {
        llmFields.apiKey = apiKey;
      }
      const llm = new ChatOpenAI(llmFields);
      
      const expressionMsg = await llm.invoke([new HumanMessage(expressionPrompt)]);
      const expressionText = typeof expressionMsg.content === 'string'
        ? expressionMsg.content.trim()
        : String(expressionMsg.content ?? '').trim();
      
      // Find matching expression (case-insensitive, partial match)
      let selectedExpression: string | null = null;
      for (const expr of availableExpressions) {
        if (expressionText.toLowerCase().includes(expr.toLowerCase())) {
          selectedExpression = expr;
          break;
        }
      }
      
      // If no match found, try exact match
      if (!selectedExpression && availableExpressions.includes(expressionText)) {
        selectedExpression = expressionText;
      }
      
      // Get motion filename
      if (selectedExpression) {
        const motionFileName = characterExpressions[selectedExpression as keyof typeof characterExpressions];
        if (motionFileName) {
          // Send message to webview to play the motion
          panel.webview.postMessage({
            type: 'playMotionByFileName',
            fileName: motionFileName,
          });
        }
      }
    } catch (err: any) {
      // Silently fail - expression is optional
      console.error('Error triggering expression:', err);
    }
  }

  /**
   * Trigger a randomly selected plugin
   */
  async triggerRandomPlugin(): Promise<void> {
    if (this.llmInFlight) {
      return;
    }

    // Try to get active editor, or fall back to first visible editor
    let editor = vscode.window.activeTextEditor;
    if (!editor) {
      const visibleEditors = vscode.window.visibleTextEditors;
      if (visibleEditors.length > 0) {
        editor = visibleEditors[0];
      }
      // Note: editor can be undefined, which is fine for plugins that don't need it
    }

    const cfg = vscode.workspace.getConfiguration('ani-vscode');
    const panel = (this as any).panel as vscode.WebviewPanel;
    
    // Create context for shouldTrigger check (editor may be undefined)
    const context = this.createPluginContext(editor, panel);
    
    // Select a random plugin that should trigger in current context
    const plugin = this.pluginManager.selectRandomPlugin(cfg, context);
    
    if (!plugin) {
      return;
    }

    // Delegate to triggerPlugin
    await this.triggerPlugin(plugin.id);
  }
}
