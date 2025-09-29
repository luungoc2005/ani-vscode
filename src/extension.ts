import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ChatOpenAI, ChatOpenAIFields } from '@langchain/openai';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand('ani-vscode.showPanel', () => {
    const panel = vscode.window.createWebviewPanel(
      'aniVscodePanel',
      'Ani: AI Assistant',
      vscode.ViewColumn.Beside,
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

    // Inject selected character
    html = html.replace(
      /<body(.*?)>/i,
      (_m: string, attrs: string) => {
        // Avoid duplicating attributes by merging attrs
        const hasDataChar = /data-character=/i.test(attrs);
        const mergedAttrs = hasDataChar ? attrs : `${attrs} data-character="${character}"`;
        return `<body${mergedAttrs}>`;
      }
    );

    panel.webview.html = html;

    let panelColumn = panel.viewColumn;
    panel.onDidChangeViewState((e) => {
      panelColumn = e.webviewPanel.viewColumn;
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
    };

    // LLM single-flight state
    let llmInFlight = false;
    let roastDebounceTimer: NodeJS.Timeout | undefined;

    // Chat history state (maintained while editing the same file)
    let chatHistory: Array<SystemMessage | HumanMessage | AIMessage> = [];
    let lastFilePath: string | null = null;
    let lastAnchorLine: number | null = null;

    const getRelativePath = (absPath: string) => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0) return absPath;
      for (const folder of folders) {
        const rel = path.relative(folder.uri.fsPath, absPath);
        if (!rel.startsWith('..')) return rel || path.basename(absPath);
      }
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

    const maybeRoast = () => {
      if (roastDebounceTimer) clearTimeout(roastDebounceTimer);
      // debounce slightly to avoid spamming on rapid cursor/keys
      roastDebounceTimer = setTimeout(() => roastNow(), 500);
    };

    const roastNow = async () => {
      if (llmInFlight) return;
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      // Ensure we have LLM settings
      const cfg = vscode.workspace.getConfiguration('ani-vscode');
      const baseUrl = cfg.get<string>('llm.baseUrl', 'https://api.openai.com/v1');
      const apiKey = cfg.get<string>('llm.apiKey', 'dummy');
      const systemPrompt = cfg.get<string>('llm.systemPrompt', 'You are a ruthless but witty code critic. Roast the code concisely with sharp, constructive jabs.');

      try {
        llmInFlight = true;
        const doc = editor.document;
        const pos = editor.selection.active;
        touchFile(doc.uri);

        const context10 = getLinesAround(doc, pos.line, 10);
        const snippet2 = getLinesAround(doc, pos.line, 2);

        const language = doc.languageId;
        const absPath = doc.uri.fsPath;
        const filePath = getRelativePath(absPath);

        // Reset chat history when switching to a different file
        if (lastFilePath !== absPath) {
          chatHistory = [];
          lastFilePath = absPath;
          lastAnchorLine = pos.line; // establish new anchor at current line
        }

        // Ensure system prompt is present at the start of history
        if (chatHistory.length === 0 || !(chatHistory[0] instanceof SystemMessage)) {
          chatHistory.unshift(new SystemMessage(systemPrompt));
        }

        // Decide whether to include a wider context
        let includeContext10 = false;
        if (lastAnchorLine == null) {
          includeContext10 = true;
          lastAnchorLine = pos.line;
        } else if (Math.abs(pos.line - lastAnchorLine) > 10) {
          includeContext10 = true;
          lastAnchorLine = pos.line; // move anchor when we re-add context
        }

        const userPrompt = includeContext10
          ? [
              `File: ${filePath}  |  Language: ${language}  |  Line: ${pos.line + 1}`,
              '',
              'Context:',
              '```',
              context10.text,
              '```',
              '',
              'Focused snippet:',
              '```',
              snippet2.text,
              '```',
              '',
              'Roast the code above. Be concise, witty, and constructive.'
            ].join('\n')
          : [
              `File: ${filePath}  |  Language: ${language}  |  Line: ${pos.line + 1}`,
              'Snippet:',
              '```',
              snippet2.text,
              '```',
              'Continue roasting based on prior context. Be concise and witty.'
            ].join('\n');

        const model = cfg.get<string>('llm.model', 'gpt-4o-mini');
        const llmFields: ChatOpenAIFields = {
          model,
          configuration: { baseURL: baseUrl },
        };
        if (apiKey) {
          llmFields.apiKey = apiKey;
        }
        const llm = new ChatOpenAI(llmFields);

        const historyToSend = [...chatHistory, new HumanMessage(userPrompt)];
        const aiMsg = await llm.invoke(historyToSend);

        const text = typeof aiMsg.content === 'string'
          ? aiMsg.content
          : Array.isArray(aiMsg.content)
            ? aiMsg.content.map((c: any) => (typeof c?.text === 'string' ? c.text : '')).join('')
            : String(aiMsg.content ?? '');

        // Update chat history and prune if needed
        chatHistory.push(new HumanMessage(userPrompt));
        chatHistory.push(new AIMessage(text));
        const MAX_HISTORY = 20; // includes system message
        if (chatHistory.length > MAX_HISTORY) {
          const system = chatHistory[0] instanceof SystemMessage ? [chatHistory[0]] : [];
          const tail = chatHistory.slice(-1 * (MAX_HISTORY - system.length));
          chatHistory = [...system, ...tail];
        }

        panel.webview.postMessage({ type: 'speech', text });
      } catch (err: any) {
        const msg = err?.message || String(err);
        panel.webview.postMessage({ type: 'speech', text: `LLM error: ${msg}` });
      } finally {
        llmInFlight = false;
      }
    };

    const selectionListener = vscode.window.onDidChangeTextEditorSelection((e) => {
      postCaret();
      touchFile(e.textEditor?.document?.uri);
      // Only trigger when the editor is focused
      if (vscode.window.activeTextEditor?.document === e.textEditor.document) {
        maybeRoast();
      }
    });
    const focusListener = vscode.window.onDidChangeActiveTextEditor((ed) => {
      postCaret();
      touchFile(ed?.document?.uri);
      // Clear chat history when switching to a different file
      if (ed && ed.document) {
        const fsPath = ed.document.uri.fsPath;
        if (lastFilePath !== null && lastFilePath !== fsPath) {
          chatHistory = [];
          lastAnchorLine = null;
        }
        lastFilePath = fsPath;
        maybeRoast();
      }
    });
    const keysListener = vscode.workspace.onDidChangeTextDocument((ev) => {
      postCaret();
      touchFile(ev.document.uri);
      if (vscode.window.activeTextEditor?.document === ev.document) {
        maybeRoast();
      }
    });

    panel.onDidDispose(() => {
      selectionListener.dispose();
      focusListener.dispose();
      keysListener.dispose();
    });
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {}


