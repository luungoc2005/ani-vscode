import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { MessageQueue } from './MessageQueue';
import { PluginManager } from './plugins/PluginManager';
import { CodeReviewPlugin } from './plugins/CodeReviewPlugin';
import { HackerNewsPlugin } from './plugins/HackerNewsPlugin';
import { RSSFeedPlugin } from './plugins/RSSFeedPlugin';
import { ScreenshotPlugin } from './plugins/ScreenshotPlugin';
import { AgentLoop } from './AgentLoop';
import { TelemetryService } from './TelemetryService';
import { registerGitPushListener } from './plugins/git/GitIntegration';

const TELEMETRY_CONNECTION_STRING = 'InstrumentationKey=6bc6947c-fe8b-473e-9caf-bfc436ebfb14;IngestionEndpoint=https://eastasia-0.in.applicationinsights.azure.com/;LiveEndpoint=https://eastasia.livediagnostics.monitor.azure.com/;ApplicationId=71da0b5b-cc56-4aec-b943-953b69623c5d';

export function activate(context: vscode.ExtensionContext) {
  // Initialize telemetry
  const telemetry = TelemetryService.initialize(TELEMETRY_CONNECTION_STRING);
  context.subscriptions.push({ dispose: () => telemetry.dispose() });
  const disposable = vscode.commands.registerCommand('ani-vscode.showPanel', () => {
    // Retrieve last panel position, defaulting to Beside if not previously saved
    const lastPanelColumn = context.globalState.get<vscode.ViewColumn>('ani-vscode.lastPanelColumn', vscode.ViewColumn.Beside);
    
    // Use the saved position directly. VS Code will handle the positioning intelligently:
    // - Beside (-2) creates a split to the side of the active editor
    // - Resolved columns (One, Two, etc.) open in that specific column, creating it if needed
    // This preserves the user's last panel position whether it was left, right, or any column
    
    const panel = vscode.window.createWebviewPanel(
      'aniVscodePanel',
      'Ani: AI Assistant',
      lastPanelColumn,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(context.extensionPath, 'media')),
          vscode.Uri.file(path.join(context.extensionPath, 'webview', 'dist'))
        ]
      }
    );

    const distDir = path.join(context.extensionPath, 'webview', 'dist');
    const candidateIndexPaths = [
      path.join(distDir, 'index.html'),
      path.join(distDir, 'src', 'index.html')
    ];
    const indexHtmlPath = candidateIndexPaths.find((p) => fs.existsSync(p));
    if (!indexHtmlPath) {
      vscode.window.showErrorMessage(
        'Ani: built webview index.html not found. Try running "npm run build".'
      );
      return;
    }
    let html = fs.readFileSync(indexHtmlPath, 'utf8');

    // Read configuration
    const cfg = vscode.workspace.getConfiguration('ani-vscode');
    const transparentBackground = cfg.get<boolean>('transparentBackground', true);
    const character = cfg.get<string>('character', 'Hiyori');
    const debugPanel = cfg.get<boolean>('debugPanel', false);

    // Record panel opened event
    telemetry.recordPanelOpened(character, transparentBackground, debugPanel);

    // Record model configuration
    const mainModel = cfg.get<string>('llm.model', 'unknown');
    const fastModel = cfg.get<string>('llm.fastModel', '');
    telemetry.recordModelUsed('main', mainModel);
    if (fastModel) {
      telemetry.recordModelUsed('fast', fastModel);
    }

    // Rewrite asset paths for VSCode webview
    const asWebviewUri = (p: string) => panel.webview.asWebviewUri(vscode.Uri.file(p)).toString();

    const baseHref = asWebviewUri(distDir) + '/';

    html = html
      .replace(/<head>/i, `<head>\n  <base href="${baseHref}">`)
      .replace(/<script src="\/Core\/live2dcubismcore\.js"><\/script>/, () => {
        const corePath = path.join(distDir, 'Core', 'live2dcubismcore.js');
        return `<script src="${asWebviewUri(corePath)}"></script>`;
      })
      .replace(/(href|src)="\/(.*?)"/g, (_m: string, attr: string, rel: string) => {
        const filePath = path.join(distDir, rel);
        return `${attr}="${asWebviewUri(filePath)}"`;
      });

    // Inject transparent background flag and CSS if enabled
    if (transparentBackground) {
      html = html
        .replace(/<body(.*?)>/i, '<body$1 data-transparent-background="true" style="background: transparent">')
        .replace(/<head>/i, '<head>\n  <style>html,body,#root{background:transparent !important;}</style>');
    } else {
      html = html.replace(/<body(.*?)>/i, '<body$1 data-transparent-background="false">');
    }

    // Inject selected character and debug panel setting
    html = html.replace(
      /<body(.*?)>/i,
      (_m: string, attrs: string) => {
        // Avoid duplicating attributes by merging attrs
        const hasDataChar = /data-character=/i.test(attrs);
        const hasDataDebug = /data-debug-panel=/i.test(attrs);
        let mergedAttrs = hasDataChar ? attrs : `${attrs} data-character="${character}"`;
        mergedAttrs = hasDataDebug ? mergedAttrs : `${mergedAttrs} data-debug-panel="${debugPanel}"`;
        return `<body${mergedAttrs}>`;
      }
    );

    panel.webview.html = html;

    let panelColumn = panel.viewColumn;
    panel.onDidChangeViewState((e) => {
      panelColumn = e.webviewPanel.viewColumn;
      // Save the panel column whenever it changes
      if (panelColumn !== undefined) {
        context.globalState.update('ani-vscode.lastPanelColumn', panelColumn);
      }
    });

    // Post caret position updates to the webview when an editor is focused and selection changes
    const postCaret = () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const sel = editor.selection;
      const pos = sel.active;
      const doc = editor.document;
      const totalLines = doc.lineCount;
      const lineText = doc.lineAt(pos.line).text;
      const lineLen = lineText.length || 1;
      // Normalize by editor viewport dimensions is non-trivial; approximate with doc position
      // X: column within line; Y: line within document
      const normX = Math.max(0, Math.min(1, pos.character / lineLen));
      const normY = Math.max(0, Math.min(1, pos.line / Math.max(1, totalLines - 1)));
      const editorColumn = editor.viewColumn;
      let side: 'left' | 'right' | 'same' = 'same';
      if (typeof editorColumn === 'number' && typeof panelColumn === 'number') {
        if (editorColumn < panelColumn) side = 'left';
        else if (editorColumn > panelColumn) side = 'right';
        else side = 'same';
      }
      panel.webview.postMessage({ type: 'caret', x: normX, y: normY, side });
    };

    // Initialize plugin system
    const messageQueue = new MessageQueue();
    const pluginManager = new PluginManager();
    
    // Register plugins
    const codeReviewPlugin = new CodeReviewPlugin();
    pluginManager.register(codeReviewPlugin);
    
    const hackerNewsPlugin = new HackerNewsPlugin();
    pluginManager.register(hackerNewsPlugin);
    
    const rssFeedPlugin = new RSSFeedPlugin();
    pluginManager.register(rssFeedPlugin);
    
    const screenshotPlugin = new ScreenshotPlugin();
    pluginManager.register(screenshotPlugin);

    // Record enabled plugins
    const enabledPlugins = pluginManager.getEnabledPlugins(cfg).map(p => p.id);
    telemetry.recordEnabledPlugins(enabledPlugins);
    
    // Initialize agent loop
    const agentLoop = new AgentLoop(messageQueue, pluginManager);
    agentLoop.setPanel(panel);
    agentLoop.setExtensionPath(context.extensionPath);
    agentLoop.setCharacter(character);
    agentLoop.setTelemetryService(telemetry);
    
    // Track last edited files (MRU) for context
    const lastEditedFiles: string[] = [];
    const touchFile = (uri: vscode.Uri | undefined) => {
      if (!uri) return;
      const fsPath = uri.fsPath;
      const idx = lastEditedFiles.indexOf(fsPath);
      if (idx !== -1) lastEditedFiles.splice(idx, 1);
      lastEditedFiles.unshift(fsPath);
      // keep only last 5
      if (lastEditedFiles.length > 5) lastEditedFiles.length = 5;
      agentLoop.setLastEditedFiles(lastEditedFiles);
    };

    const selectionListener = vscode.window.onDidChangeTextEditorSelection((e) => {
      postCaret();
      touchFile(e.textEditor?.document?.uri);
      // Only trigger when the editor is focused - trigger CodeReview plugin on selection changes
      if (vscode.window.activeTextEditor?.document === e.textEditor.document) {
        agentLoop.trigger('codeReview');
      }
    });
    const focusListener = vscode.window.onDidChangeActiveTextEditor((ed) => {
      postCaret();
      touchFile(ed?.document?.uri);
      // Clear chat history when switching to a different file
      if (ed && ed.document) {
        agentLoop.resetChatHistory();
        codeReviewPlugin.resetAnchor();
        agentLoop.trigger('codeReview');
      }
    });
    const keysListener = vscode.workspace.onDidChangeTextDocument((ev) => {
      postCaret();
      touchFile(ev.document.uri);
      // Trigger CodeReview plugin when user is typing
      if (vscode.window.activeTextEditor?.document === ev.document) {
        agentLoop.trigger('codeReview');
      }
    });

    // Set up periodic plugin trigger (randomly selects from enabled plugins)
    let periodicTimer: NodeJS.Timeout | undefined;
    const setupPeriodicTrigger = () => {
      const cfg = vscode.workspace.getConfiguration('ani-vscode');
      const intervalMinutes = cfg.get<number>('plugins.periodicIntervalMinutes', 5);
      
      // Clear existing timer
      if (periodicTimer) {
        clearInterval(periodicTimer);
        periodicTimer = undefined;
      }
      
      // Set up new timer if interval > 0
      if (intervalMinutes > 0) {
        const intervalMs = intervalMinutes * 60 * 1000;
        periodicTimer = setInterval(() => {
          agentLoop.triggerRandomPlugin();
        }, intervalMs);
        
        // Also trigger once after a short delay when first set up
        setTimeout(() => {
          agentLoop.triggerRandomPlugin();
        }, 1000); // 10 seconds after panel opens
      }
    };
    
    // Initial setup
    setupPeriodicTrigger();
    
    // Test connectivity immediately when panel opens
    (async () => {
      const result = await agentLoop.testConnectivity();
      if (!result.success) {
        // Show setup guide immediately if connectivity fails
        panel.webview.postMessage({
          type: 'setupError',
          message: result.error || 'Failed to connect to LLM service'
        });
      } else {
        // Notify webview that connection is working
        panel.webview.postMessage({ type: 'connectionSuccess' });
      }
    })();
    
    // Listen for configuration changes
    const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('ani-vscode.plugins.periodicIntervalMinutes')) {
        setupPeriodicTrigger();
      }
      if (e.affectsConfiguration('ani-vscode.debugPanel')) {
        const newDebugPanel = vscode.workspace.getConfiguration('ani-vscode').get<boolean>('debugPanel', false);
        panel.webview.postMessage({ type: 'setDebugPanel', visible: newDebugPanel });
      }
    });

    // Listen for messages from webview
    const messageListener = panel.webview.onDidReceiveMessage((message) => {
      if (message.type === 'characterChanged' && message.characterName) {
        // Record character change
        const oldCharacter = agentLoop.getCurrentCharacter();
        telemetry.recordCharacterChanged(oldCharacter, message.characterName);
        
        // Update agent loop's character
        agentLoop.setCharacter(message.characterName);
        
        // Dismiss current speech bubble
        panel.webview.postMessage({ type: 'dismissSpeech' });
        
        // Trigger a random plugin to showcase the new character
        setTimeout(() => {
          agentLoop.triggerRandomPlugin();
        }, 500);
      } else if (message.type === 'openSettings') {
        // Open VSCode settings for ani-vscode
        vscode.commands.executeCommand('workbench.action.openSettings', 'ani-vscode');
      } else if (message.type === 'retryConnection') {
        // Test connectivity immediately
        (async () => {
          const result = await agentLoop.testConnectivity();
          if (!result.success) {
            // Show error again if still failing
            panel.webview.postMessage({
              type: 'setupError',
              message: result.error || 'Failed to connect to LLM service'
            });
          } else {
            // Connection successful, trigger a plugin to show it's working
            panel.webview.postMessage({ type: 'connectionSuccess' });
            setTimeout(() => {
              agentLoop.triggerRandomPlugin();
            }, 500);
          }
        })();
      }
    });

    panel.onDidDispose(() => {
      // Save the panel column before disposal
      if (panelColumn !== undefined) {
        context.globalState.update('ani-vscode.lastPanelColumn', panelColumn);
      }
      
      // Dispose of all listeners
      selectionListener.dispose();
      focusListener.dispose();
      keysListener.dispose();
      configListener.dispose();
      messageListener.dispose();
      
      // Clear the periodic timer
      if (periodicTimer) {
        clearInterval(periodicTimer);
        periodicTimer = undefined;
      }
      
      // Dispose of the agent loop to clean up its timers
      agentLoop.dispose();
    });

    // Register Git push listener asynchronously (does not block panel creation)
    void registerGitPushListener(codeReviewPlugin, agentLoop).then((disposable) => {
      if (disposable) {
        panel.onDidDispose(() => disposable.dispose());
      }
    });
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {}


