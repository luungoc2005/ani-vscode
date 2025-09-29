import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand('ani-vscode.showPanel', () => {
    const panel = vscode.window.createWebviewPanel(
      'aniVscodePanel',
      'Ani: Cubism Viewer',
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

    const selectionListener = vscode.window.onDidChangeTextEditorSelection(() => postCaret());
    const focusListener = vscode.window.onDidChangeActiveTextEditor(() => postCaret());
    const keysListener = vscode.workspace.onDidChangeTextDocument(() => postCaret());

    panel.onDidDispose(() => {
      selectionListener.dispose();
      focusListener.dispose();
      keysListener.dispose();
    });
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {}


