import * as vscode from 'vscode';
import { IPlugin, PluginContext, PluginMessage } from './IPlugin';

/**
 * CodeReview plugin that analyzes and roasts code
 */
export class CodeReviewPlugin implements IPlugin {
  readonly id = 'codeReview';
  readonly name = 'Code Review';

  private lastAnchorLine: number | null = null;
  private lastFilePath: string | null = null;

  isEnabled(config: vscode.WorkspaceConfiguration): boolean {
    return config.get<boolean>('plugins.codeReview.enabled', true);
  }

  async generateMessage(context: PluginContext): Promise<PluginMessage | null> {
    const { editor, getRelativePath, getLinesAround } = context;
    
    if (!editor) {
      return null;
    }

    const doc = editor.document;
    const pos = editor.selection.active;
    const absPath = doc.uri.fsPath;

    // Reset anchor when switching files
    if (this.lastFilePath !== absPath) {
      this.lastAnchorLine = null;
      this.lastFilePath = absPath;
    }

    const context10 = getLinesAround(doc, pos.line, 10);
    const context10LinesAbove = context10.start;
    const context10LinesBelow = (doc.lineCount - 1) - context10.end;
    const snippet2 = getLinesAround(doc, pos.line, 2);

    // Determine if there is an error diagnostic on the focused line
    const hasErrorAtFocusedLine = (() => {
      try {
        const diags = vscode.languages.getDiagnostics(doc.uri) || [];
        return diags.some((d) =>
          d?.severity === vscode.DiagnosticSeverity.Error &&
          typeof d?.range?.start?.line === 'number' &&
          typeof d?.range?.end?.line === 'number' &&
          d.range.start.line <= pos.line && pos.line <= d.range.end.line
        );
      } catch {
        return false;
      }
    })();

    // Insert caret indicator into focused snippet display
    const snippet2Display = (() => {
      const lines = snippet2.text.split('\n');
      const correctedCaretLineIndex = pos.line - snippet2.start;
      const targetIndex = correctedCaretLineIndex;
      if (hasErrorAtFocusedLine && targetIndex >= 0 && targetIndex < lines.length) {
        const line = lines[targetIndex];
        const insertAt = Math.max(0, Math.min(pos.character, line.length));
        lines[targetIndex] = line.slice(0, insertAt) + '...' + line.slice(insertAt);
      }
      return lines.join('\n');
    })();

    const language = doc.languageId;
    const filePath = getRelativePath(absPath);

    // Decide whether to include a wider context
    let includeContext10 = false;
    if (this.lastAnchorLine == null) {
      includeContext10 = true;
      this.lastAnchorLine = pos.line;
    } else if (Math.abs(pos.line - this.lastAnchorLine) > 10) {
      includeContext10 = true;
      this.lastAnchorLine = pos.line;
    }

    const ellipsisNote = hasErrorAtFocusedLine
      ? 'Important: The ellipsis is only added for you to know the position of the caret and not a part of the code'
      : '';

    const instructionWithNote = (baseInstruction: string) =>
      ellipsisNote ? `${ellipsisNote}\n\n${baseInstruction}` : baseInstruction;

    const userPrompt = includeContext10
      ? [
          `File: ${filePath}  |  Language: ${language}  |  Line: ${pos.line + 1}`,
          '',
          'Context:',
          ...(context10LinesAbove > 0 ? [`(${context10LinesAbove} lines above)`] : []),
          '```',
          context10.text,
          '```',
          ...(context10LinesBelow > 0 ? [`(${context10LinesBelow} lines below)`] : []),
          '',
          'Focused snippet:',
          '```',
          snippet2Display,
          '```',
          '',
          instructionWithNote('Roast the code above. Be concise, witty, and constructive.')
        ].join('\n')
      : [
          `File: ${filePath}  |  Language: ${language}  |  Line: ${pos.line + 1}`,
          'Snippet:',
          '```',
          snippet2Display,
          '```',
          instructionWithNote('Continue roasting based on prior context. Be concise and witty.')
        ].join('\n');

    return {
      userPrompt,
      includeContext: includeContext10
    };
  }

  /**
   * Reset the anchor line (useful when changing files)
   */
  resetAnchor(): void {
    this.lastAnchorLine = null;
    this.lastFilePath = null;
  }
}
