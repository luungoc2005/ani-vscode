import * as vscode from 'vscode';
import { ChatOpenAI, ChatOpenAIFields } from '@langchain/openai';
import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import type { ToolCall } from '@langchain/core/messages/tool';
import { MessageQueue } from './MessageQueue';
import { PluginManager } from './plugins/PluginManager';
import { PluginContext, EnqueueMessageOptions } from './plugins/IPlugin';
import { loadCharacterCard } from './CharacterLoader';
import { TelemetryService } from './TelemetryService';
import motionsMap from './motions_map.json';
import { TtsService, TtsConfig } from './TtsService';

const QUICK_REPLY_TOOL = {
  type: 'function',
  function: {
    name: 'show_quick_replies',
    description:
      'Display up to three concise quick-reply options for the user. The user can use these options to reply to you. Think and imagine about how the user would reply to your message. Do not just repeat what you said.',
    parameters: {
      type: 'object',
      properties: {
        replies: {
          type: 'array',
          description: 'Between one and three short replies for the user to choose from.',
          minItems: 1,
          maxItems: 3,
          items: {
            type: 'string',
            minLength: 1,
            description: 'Replies that the user can choose from.',
          },
        },
      },
      required: ['replies'],
    },
  },
} as const;

/**
 * Main agent loop that processes messages from the queue or plugins
 */
export class AgentLoop {
  private messageQueue: MessageQueue;
  private pluginManager: PluginManager;
  private telemetry: TelemetryService | null = null;
  private llmInFlight = false;
  private roastDebounceTimer: NodeJS.Timeout | undefined;
  private cooldownTimer: NodeJS.Timeout | undefined;
  private lastLlmEndedAt: number | null = null;
  private chatHistory: Array<SystemMessage | HumanMessage | AIMessage | ToolMessage> = [];
  private lastFilePath: string | null = null;
  private currentCharacter: string = 'Mao';
  private extensionPath: string = '';
  private ttsService = new TtsService();
  private logger?: vscode.OutputChannel;
  private hasAudioCapability = false;
  private pendingQuickReplies: string[] = [];

  constructor(messageQueue: MessageQueue, pluginManager: PluginManager, logger?: vscode.OutputChannel) {
    this.messageQueue = messageQueue;
    this.pluginManager = pluginManager;
    this.logger = logger;
  }

  /**
   * Set the telemetry service
   */
  setTelemetryService(telemetry: TelemetryService): void {
    this.telemetry = telemetry;
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

  setAudioCapability(canPlay: boolean): void {
    if (this.hasAudioCapability === canPlay) {
      return;
    }
    this.hasAudioCapability = canPlay;
    this.logInfo(`Audio capability ${canPlay ? 'enabled' : 'disabled'} by webview.`);
  }

  /**
   * Trigger the agent loop with a debounce
   */
  trigger(pluginId?: string): void {
    if (this.roastDebounceTimer) {
      clearTimeout(this.roastDebounceTimer);
    }
    // Debounce slightly to avoid spamming on rapid cursor/keys
    this.roastDebounceTimer = setTimeout(() => {
      // Record plugin triggered event if a specific plugin is being triggered
      if (pluginId && this.telemetry) {
        const cfg = vscode.workspace.getConfiguration('ani-vscode');
        const plugin = this.pluginManager.getPlugin(pluginId);
        if (plugin && plugin.isEnabled(cfg)) {
          this.telemetry.recordPluginTriggered(pluginId, 'auto');
        }
      }
      this.run(pluginId);
    }, 500);
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
    const characterCard = loadCharacterCard(this.currentCharacter, this.extensionPath);
    const systemPrompt = characterCard?.systemPrompt || fallbackPrompt;
    const voiceInstructions = characterCard?.voiceInstructions?.trim();
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
          triggeringPlugin = await this.pluginManager.selectRandomPlugin(cfg, context);
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
      const quickRepliesEnabled = cfg.get<boolean>('quickReplies.enabled', false);
      const llmFields: ChatOpenAIFields = {
        model,
        configuration: { baseURL: baseUrl },
      };
      if (apiKey) {
        llmFields.apiKey = apiKey;
      }
      this.pendingQuickReplies = [];

      const llm = new ChatOpenAI(llmFields);
      const llmRunner = quickRepliesEnabled ? llm.bindTools([QUICK_REPLY_TOOL]) : llm;

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

      const historyToSend: Array<SystemMessage | HumanMessage | AIMessage | ToolMessage> = [...this.chatHistory, humanMessage];
      const newMessages: Array<HumanMessage | AIMessage | ToolMessage> = [humanMessage];

      let aiMsg = await llmRunner.invoke(historyToSend);

      if (quickRepliesEnabled) {
        while (true) {
          historyToSend.push(aiMsg);
          newMessages.push(aiMsg);

          const toolCalls = Array.isArray(aiMsg.tool_calls) ? aiMsg.tool_calls : [];
          if (!toolCalls.length) {
            break;
          }

          for (const call of toolCalls) {
            const toolMessage = await this.executeToolCall(call);
            historyToSend.push(toolMessage);
            newMessages.push(toolMessage);
          }

          aiMsg = await llmRunner.invoke(historyToSend);
        }
      } else {
        historyToSend.push(aiMsg);
        newMessages.push(aiMsg);
      }

      let text = typeof aiMsg.content === 'string'
        ? aiMsg.content
        : Array.isArray(aiMsg.content)
          ? aiMsg.content.map((c: any) => (typeof c?.text === 'string' ? c.text : '')).join('')
          : String(aiMsg.content ?? '');
      text = this.stripCodeBlockTags(text);
      text = this.stripThinkTags(text);
      text = this.stripTrailingLlmArtifacts(text);

      const finalAiMessageForHistory = new AIMessage(text);
      if (historyToSend.length > 0) {
        historyToSend[historyToSend.length - 1] = finalAiMessageForHistory;
      }
      for (let i = newMessages.length - 1; i >= 0; i--) {
        if (newMessages[i] instanceof AIMessage) {
          newMessages[i] = finalAiMessageForHistory;
          break;
        }
      }

      // Notify the plugin of the AI response if it has an onResponse method
      if (triggeringPlugin && typeof triggeringPlugin.onResponse === 'function') {
        triggeringPlugin.onResponse(text);
      }

      // Update chat history and prune if needed
      this.chatHistory.push(...newMessages);
      if (this.chatHistory.length > maxHistory) {
        const system = this.chatHistory[0] instanceof SystemMessage ? [this.chatHistory[0]] : [];
        const tail = this.chatHistory.slice(-1 * (maxHistory - system.length));
        this.chatHistory = [...system, ...tail];
      }

      if (panel) {
        const { config: ttsConfig, playbackRate, pitchRatio } = this.getTtsOptions(cfg, baseUrl, apiKey);
        let audioPayload: { mimeType: string; data: string; playbackRate: number; pitchRatio: number } | undefined;
        let ttsErrorMessage: string | undefined;

        if (!ttsConfig.enabled) {
          this.logInfo('TTS disabled via settings; skipping synthesis.');
        } else if (!this.hasAudioCapability) {
          this.logInfo('Skipping speech synthesis because audio is locked in the webview.');
        } else {
          this.logInfo(
            `Synthesizing speech with model "${ttsConfig.model}" (voice "${ttsConfig.voice}") via ${ttsConfig.baseUrl}`
          );
          const playbackRateLabel = Number.isFinite(playbackRate)
            ? playbackRate.toFixed(2)
            : String(playbackRate);
          if (voiceInstructions) {
            this.logInfo('Applying character voice instructions to TTS request.');
          }
          try {
            const ttsResult = await this.ttsService.synthesize(text, ttsConfig, {
              voiceInstructions,
            });
            if (ttsResult) {
              audioPayload = {
                mimeType: ttsResult.mimeType,
                data: ttsResult.base64Audio,
                playbackRate,
                pitchRatio,
              };
              const approxBytes = Math.round((ttsResult.base64Audio.length * 3) / 4);
              this.logInfo(
                `Received TTS audio (~${approxBytes} bytes, playbackRate ${playbackRateLabel}, pitchRatio ${pitchRatio.toFixed(2)})`
              );
            } else {
              this.logInfo('TTS returned no audio payload (possibly empty text).');
            }
          } catch (ttsError: unknown) {
            this.logError('Failed to synthesize speech', ttsError);
            ttsErrorMessage = this.formatError(ttsError) || 'Unknown TTS error';
          }
        }

        if (panel) {
          if (ttsErrorMessage) {
            panel.webview.postMessage({ type: 'ttsError', message: ttsErrorMessage });
          } else {
            panel.webview.postMessage({ type: 'ttsError', clear: true });
          }
        }

        const displayText = appendText ? `${text}\n\n${appendText}` : text;
        const quickReplies = quickRepliesEnabled ? this.consumePendingQuickReplies() : [];
        panel.webview.postMessage({
          type: 'speech',
          text: displayText,
          audio: audioPayload,
          ...(quickReplies.length > 0 ? { quickReplies } : {}),
        });
        
        // Send connection success message to hide setup guide if it's showing
        panel.webview.postMessage({ type: 'connectionSuccess' });
        
        // Trigger expression animation if fastModel is configured
        await this.triggerExpression(text, panel, cfg);
      } else {
        this.consumePendingQuickReplies();
      }
    } catch (err: any) {
      const msg = err?.message || String(err);
      const panel = (this as any).panel as vscode.WebviewPanel;
      this.consumePendingQuickReplies();
      
      // Check if this is a connection error or model not found error
      const isConnectionError = 
        msg.toLowerCase().includes('econnrefused') ||
        msg.toLowerCase().includes('fetch failed') ||
        msg.toLowerCase().includes('network') ||
        msg.toLowerCase().includes('connection') ||
        msg.toLowerCase().includes('getaddrinfo') ||
        msg.toLowerCase().includes('etimedout');
      
      const isModelError = 
        msg.toLowerCase().includes('model') && 
        (msg.toLowerCase().includes('not found') || 
         msg.toLowerCase().includes('does not exist') ||
         msg.toLowerCase().includes('not available'));
      
      if (panel && (isConnectionError || isModelError)) {
        // Send structured error to show setup guide
        panel.webview.postMessage({ 
          type: 'setupError', 
          message: msg 
        });
      } else if (panel) {
        // For other errors, just show in speech bubble
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
  enqueueUserMessage(message: string, options?: EnqueueMessageOptions): void {
    if (options?.priority) {
      this.messageQueue.enqueueFront(message);
    } else {
      this.messageQueue.enqueue(message);
    }
  }

  /**
   * Reset chat history (e.g., when changing files)
   */
  resetChatHistory(): void {
    this.chatHistory = [];
    this.lastFilePath = null;
  }

  private logInfo(message: string): void {
    this.logger?.appendLine(`[TTS] ${message}`);
  }

  private logError(message: string, err?: unknown): void {
    if (!this.logger) {
      return;
    }
    const detail = this.formatError(err);
    this.logger.appendLine(`[TTS][error] ${message}${detail ? `: ${detail}` : ''}`);
    if (err instanceof Error && err.stack) {
      this.logger.appendLine(err.stack);
    }
  }

  private formatError(err: unknown): string {
    if (!err) {
      return '';
    }
    if (err instanceof Error) {
      return err.message;
    }
    if (typeof err === 'string') {
      return err;
    }
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }

  private getTtsOptions(
    cfg: vscode.WorkspaceConfiguration,
    fallbackBaseUrl: string,
    fallbackApiKey: string
  ): { config: TtsConfig; playbackRate: number; pitchRatio: number } {
    const enabled = cfg.get<boolean>('tts.enabled', true);
    let baseUrl = cfg.get<string>('tts.baseUrl', fallbackBaseUrl);
    let apiKey = cfg.get<string>('tts.apiKey', fallbackApiKey);
    const model = cfg.get<string>('tts.model', 'gpt-4o-mini-tts');
    const voice = cfg.get<string>('tts.voice', 'alloy');
    const playbackRate = cfg.get<number>('tts.playbackRate', 1.1);
    const rawPitchRatio = cfg.get<number>('tts.pitchRatio', NaN);

    const pitchRatio = Number.isFinite(rawPitchRatio) && rawPitchRatio > 0 ? rawPitchRatio : Math.max(playbackRate, 1.0);

    if ((!apiKey || apiKey === 'dummy') && fallbackApiKey && fallbackApiKey !== 'dummy') {
      apiKey = fallbackApiKey;
    }

    if (!baseUrl) {
      baseUrl = fallbackBaseUrl;
    }

    return {
      playbackRate,
      pitchRatio,
      config: {
        enabled,
        baseUrl,
        apiKey,
        model,
        voice,
      },
    };
  }

  private async executeToolCall(call: ToolCall): Promise<ToolMessage> {
    const toolCallId = call.id ?? `tool-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    let content: string;
    let status: 'success' | 'error' = 'success';

    switch (call.name) {
      case 'show_quick_replies':
        content = this.handleQuickRepliesTool(call);
        break;
      default:
        content = `Tool "${call.name}" is not implemented.`;
        status = 'error';
        break;
    }

    return new ToolMessage({
      tool_call_id: toolCallId,
      content,
      status,
    });
  }

  private handleQuickRepliesTool(call: ToolCall): string {
    const args = this.parseToolArgs(call.args as unknown);
    const replies = this.normalizeQuickReplies((args as { replies?: unknown }).replies);

    if (replies.length === 0) {
      this.pendingQuickReplies = [];
      return 'No quick replies were displayed because no valid replies were provided.';
    }

    this.pendingQuickReplies = replies;
    return `Prepared ${replies.length} quick reply option${replies.length === 1 ? '' : 's'} for the user.`;
  }

  private parseToolArgs(raw: unknown): Record<string, unknown> {
    if (!raw) {
      return {};
    }

    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch (error) {
        this.logger?.appendLine(`[Tools][error] Failed to parse tool arguments: ${String(error)}`);
      }
      return {};
    }

    if (typeof raw === 'object' && !Array.isArray(raw)) {
      return raw as Record<string, unknown>;
    }

    return {};
  }

  private normalizeQuickReplies(input: unknown): string[] {
    if (!Array.isArray(input)) {
      return [];
    }

    const replies: string[] = [];
    const seen = new Set<string>();
    const candidateKeys = ['text', 'label', 'value', 'reply'];

    for (const item of input) {
      let candidate: string | undefined;

      if (typeof item === 'string') {
        candidate = item.trim();
      } else if (item && typeof item === 'object') {
        for (const key of candidateKeys) {
          const value = (item as Record<string, unknown>)[key];
          if (typeof value === 'string' && value.trim().length > 0) {
            candidate = value.trim();
            break;
          }
        }
      }

      if (candidate && candidate.length > 0 && !seen.has(candidate)) {
        seen.add(candidate);
        replies.push(candidate);
        if (replies.length >= 5) {
          break;
        }
      }
    }

    return replies;
  }

  private consumePendingQuickReplies(): string[] {
    const replies = this.pendingQuickReplies;
    this.pendingQuickReplies = [];
    return replies;
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
      getLinesAround,
      enqueueMessage: (message: string, opts?: EnqueueMessageOptions) => {
        this.enqueueUserMessage(message, opts);
      }
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

  // Utility function to remove trailing LLM decoder artifacts (e.g., </start_of_turn>)
  private stripTrailingLlmArtifacts(text: string): string {
    return text.replace(/\s*(?:<\/start_of_turn>|<\/end_of_turn>)+\s*$/i, '').trim();
  };

  private messageContentToString(message: SystemMessage | HumanMessage | AIMessage | ToolMessage): string {
    const content = (message as SystemMessage | HumanMessage | AIMessage | ToolMessage).content as any;
    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      const segments = content
        .map((part: any) => {
          if (!part) {
            return '';
          }
          if (typeof part === 'string') {
            return part;
          }
          if (typeof part === 'object') {
            if (typeof part.text === 'string') {
              return part.text;
            }
            if (typeof part.data === 'string') {
              return part.data;
            }
            try {
              return JSON.stringify(part);
            } catch {
              return String(part);
            }
          }
          return String(part);
        })
        .filter((segment: string) => segment.length > 0);
      return segments.join('\n');
    }

    if (content && typeof content === 'object') {
      if (typeof content.text === 'string') {
        return content.text;
      }
      try {
        return JSON.stringify(content);
      } catch {
        return String(content);
      }
    }

    if (content == null) {
      return '';
    }

    return String(content);
  }

  getChatHistoryForExport(): { messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string }> } {
    const messages = this.chatHistory.map((msg) => {
      let role: 'system' | 'user' | 'assistant' | 'tool';
      if (msg instanceof SystemMessage) {
        role = 'system';
      } else if (msg instanceof HumanMessage) {
        role = 'user';
      } else if (msg instanceof AIMessage) {
        role = 'assistant';
      } else if (msg instanceof ToolMessage) {
        role = 'tool';
      } else {
        role = 'user';
      }

      const serialized = {
        role,
        content: this.messageContentToString(msg),
      } as { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string };

      if (msg instanceof ToolMessage && typeof msg.tool_call_id === 'string') {
        serialized.tool_call_id = msg.tool_call_id;
      }

      return serialized;
    });

    return { messages };
  }

  /**
   * Trigger a specific plugin by ID
   */
  async triggerPlugin(pluginId: string, triggerType: 'auto' | 'periodic' | 'manual' = 'manual'): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('ani-vscode');
    const plugin = this.pluginManager.getPlugin(pluginId);
    
    if (!plugin || !plugin.isEnabled(cfg)) {
      return;
    }

    // Record plugin triggered event
    if (this.telemetry) {
      this.telemetry.recordPluginTriggered(pluginId, triggerType);
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
      
      // Get target asset
      if (selectedExpression) {
        const assetIdentifier = characterExpressions[selectedExpression as keyof typeof characterExpressions];
        if (assetIdentifier) {
          panel.webview.postMessage({
            type: 'playEmotion',
            character,
            emotion: selectedExpression,
            fileName: assetIdentifier,
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
    const plugin = await this.pluginManager.selectRandomPlugin(cfg, context);
    
    if (!plugin) {
      return;
    }

    // Delegate to triggerPlugin with 'periodic' trigger type
    await this.triggerPlugin(plugin.id, 'periodic');
  }

  /**
   * Test connectivity to the LLM service quickly
   * Returns true if connection successful, false otherwise
   */
  async testConnectivity(): Promise<{ success: boolean; error?: string }> {
    try {
      const cfg = vscode.workspace.getConfiguration('ani-vscode');
      const baseUrl = cfg.get<string>('llm.baseUrl', 'https://api.openai.com/v1');
      const apiKey = cfg.get<string>('llm.apiKey', 'dummy');
      const model = cfg.get<string>('llm.model', 'gpt-4o-mini');

      // Create a simple test LLM instance with a short timeout
      const llmFields: ChatOpenAIFields = {
        model,
        configuration: { baseURL: baseUrl },
        timeout: 5000, // 5 second timeout for quick check
        maxRetries: 0, // Don't retry on failure
      };
      if (apiKey) {
        llmFields.apiKey = apiKey;
      }
      const llm = new ChatOpenAI(llmFields);

      // Send a minimal test message
      const testMessage = new HumanMessage('Hi');
      const response = await llm.invoke([testMessage]);

      // If we got here, connection works
      return { success: true };
    } catch (err: any) {
      const msg = err?.message || String(err);
      return { success: false, error: msg };
    }
  }

  /**
   * Clean up timers and resources
   */
  dispose(): void {
    if (this.roastDebounceTimer) {
      clearTimeout(this.roastDebounceTimer);
      this.roastDebounceTimer = undefined;
    }
    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
      this.cooldownTimer = undefined;
    }
    // Clear the panel reference to prevent memory leaks
    (this as any).panel = null;
  }
}
