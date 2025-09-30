import * as vscode from 'vscode';
import { ChatOpenAI, ChatOpenAIFields } from '@langchain/openai';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { MessageQueue } from './MessageQueue';
import { PluginManager } from './plugins/PluginManager';
import { PluginContext } from './plugins/IPlugin';

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

  constructor(messageQueue: MessageQueue, pluginManager: PluginManager) {
    this.messageQueue = messageQueue;
    this.pluginManager = pluginManager;
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
  private async run(pluginId?: string): Promise<void> {
    if (this.llmInFlight) {
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    // Ensure we have LLM settings
    const cfg = vscode.workspace.getConfiguration('ani-vscode');
    const baseUrl = cfg.get<string>('llm.baseUrl', 'https://api.openai.com/v1');
    const apiKey = cfg.get<string>('llm.apiKey', 'dummy');
    const systemPrompt = cfg.get<string>('llm.systemPrompt', 'You are a ruthless but witty code critic. Roast the code concisely with sharp, constructive jabs.');
    const minIntervalSec = Math.max(10, cfg.get<number>('llm.minIntervalSeconds', 10));

    // Check cooldown
    const now = Date.now();
    if (this.lastLlmEndedAt !== null) {
      const elapsedMs = now - this.lastLlmEndedAt;
      const minMs = minIntervalSec * 1000;
      if (elapsedMs < minMs) {
        const delay = Math.max(0, minMs - elapsedMs);
        if (this.cooldownTimer) clearTimeout(this.cooldownTimer);
        this.cooldownTimer = setTimeout(() => {
          this.cooldownTimer = undefined;
          this.run(pluginId);
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

      const doc = editor.document;
      const absPath = doc.uri.fsPath;

      // Reset chat history when switching to a different file
      if (this.lastFilePath !== absPath) {
        this.chatHistory = [];
        this.lastFilePath = absPath;
      }

      // Ensure system prompt is present at the start of history
      if (this.chatHistory.length === 0 || !(this.chatHistory[0] instanceof SystemMessage)) {
        this.chatHistory.unshift(new SystemMessage(systemPrompt));
      }

      let userPrompt: string;
      
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
        const pluginMessage = pluginId
          ? await this.pluginManager.getPluginMessage(pluginId, context, cfg)
          : await this.pluginManager.getRandomPluginMessage(context, cfg);
        
        if (!pluginMessage) {
          // No plugin available or no message generated
          return;
        }
        
        userPrompt = pluginMessage.userPrompt;
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

      const historyToSend = [...this.chatHistory, new HumanMessage(userPrompt)];
      const aiMsg = await llm.invoke(historyToSend);

      const text = typeof aiMsg.content === 'string'
        ? aiMsg.content
        : Array.isArray(aiMsg.content)
          ? aiMsg.content.map((c: any) => (typeof c?.text === 'string' ? c.text : '')).join('')
          : String(aiMsg.content ?? '');

      // Update chat history and prune if needed
      this.chatHistory.push(new HumanMessage(userPrompt));
      this.chatHistory.push(new AIMessage(text));
      const MAX_HISTORY = 20; // includes system message
      if (this.chatHistory.length > MAX_HISTORY) {
        const system = this.chatHistory[0] instanceof SystemMessage ? [this.chatHistory[0]] : [];
        const tail = this.chatHistory.slice(-1 * (MAX_HISTORY - system.length));
        this.chatHistory = [...system, ...tail];
      }

      if (panel) {
        panel.webview.postMessage({ type: 'speech', text });
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
  private createPluginContext(editor: vscode.TextEditor, panel: vscode.WebviewPanel): PluginContext {
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

  /**
   * Trigger a specific plugin by ID
   */
  async triggerPlugin(pluginId: string): Promise<void> {
    if (this.llmInFlight) {
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    const cfg = vscode.workspace.getConfiguration('ani-vscode');
    const plugin = this.pluginManager.getPlugin(pluginId);
    
    if (!plugin || !plugin.isEnabled(cfg)) {
      return;
    }

    // Check cooldown
    const minIntervalSec = Math.max(10, cfg.get<number>('llm.minIntervalSeconds', 10));
    const now = Date.now();
    if (this.lastLlmEndedAt !== null) {
      const elapsedMs = now - this.lastLlmEndedAt;
      const minMs = minIntervalSec * 1000;
      if (elapsedMs < minMs) {
        // Skip if still in cooldown
        return;
      }
    }

    try {
      this.llmInFlight = true;
      
      const panel = (this as any).panel as vscode.WebviewPanel;
      if (panel) {
        panel.webview.postMessage({ type: 'thinking', on: true });
      }

      const context = this.createPluginContext(editor, panel);
      const pluginMessage = await plugin.generateMessage(context);
      
      if (!pluginMessage) {
        return;
      }

      const userPrompt = pluginMessage.userPrompt;
      
      // Get LLM settings
      const baseUrl = cfg.get<string>('llm.baseUrl', 'https://api.openai.com/v1');
      const apiKey = cfg.get<string>('llm.apiKey', 'dummy');
      const systemPrompt = cfg.get<string>('llm.systemPrompt', 'You are a helpful AI assistant.');
      const model = cfg.get<string>('llm.model', 'gpt-4o-mini');

      // Ensure system prompt is present
      if (this.chatHistory.length === 0 || !(this.chatHistory[0] instanceof SystemMessage)) {
        this.chatHistory.unshift(new SystemMessage(systemPrompt));
      }

      const llmFields: ChatOpenAIFields = {
        model,
        configuration: { baseURL: baseUrl },
      };
      if (apiKey) {
        llmFields.apiKey = apiKey;
      }
      const llm = new ChatOpenAI(llmFields);

      const historyToSend = [...this.chatHistory, new HumanMessage(userPrompt)];
      const aiMsg = await llm.invoke(historyToSend);

      const text = typeof aiMsg.content === 'string'
        ? aiMsg.content
        : Array.isArray(aiMsg.content)
          ? aiMsg.content.map((c: any) => (typeof c?.text === 'string' ? c.text : '')).join('')
          : String(aiMsg.content ?? '');

      // Update chat history
      this.chatHistory.push(new HumanMessage(userPrompt));
      this.chatHistory.push(new AIMessage(text));
      const MAX_HISTORY = 20;
      if (this.chatHistory.length > MAX_HISTORY) {
        const system = this.chatHistory[0] instanceof SystemMessage ? [this.chatHistory[0]] : [];
        const tail = this.chatHistory.slice(-1 * (MAX_HISTORY - system.length));
        this.chatHistory = [...system, ...tail];
      }

      if (panel) {
        panel.webview.postMessage({ type: 'speech', text });
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
   * Trigger a randomly selected plugin
   */
  async triggerRandomPlugin(): Promise<void> {
    if (this.llmInFlight) {
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    const cfg = vscode.workspace.getConfiguration('ani-vscode');
    const panel = (this as any).panel as vscode.WebviewPanel;
    
    // Create context for shouldTrigger check
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
