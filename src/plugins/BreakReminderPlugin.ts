import * as vscode from 'vscode';
import { IPlugin, PluginContext, PluginMessage } from './IPlugin';

/**
 * Reminds the user to take a quick break after long, uninterrupted coding streaks.
 */
export class BreakReminderPlugin implements IPlugin {
  readonly id = 'breakReminder';
  readonly name = 'Break Reminder';

  private static readonly IDLE_RESET_MS = 2 * 60 * 1000; // Reset streak after 2 minutes of inactivity

  private disposables: vscode.Disposable[] = [];
  private lastActivity: number | null = null;
  private sessionStart: number | null = null;
  private lastNotification: number | null = null;

  isEnabled(config: vscode.WorkspaceConfiguration): boolean {
    return config.get<boolean>('plugins.breakReminder.enabled', true);
  }

  getWeight(config: vscode.WorkspaceConfiguration): number {
    return config.get<number>('plugins.breakReminder.weight', 1) ?? 1;
  }

  activate(_context: PluginContext): void {
    this.disposeListeners();

    const recordActivity = () => this.recordActivity();

    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument(recordActivity),
      vscode.workspace.onDidSaveTextDocument(recordActivity),
      vscode.window.onDidChangeActiveTextEditor(recordActivity)
    );

    // Prime the timers so a fresh session starts with the next detected activity
    this.lastActivity = null;
    this.sessionStart = null;
  }

  deactivate(): void {
    this.disposeListeners();
  }

  async shouldTrigger(_context?: PluginContext): Promise<boolean> {
    const cfg = vscode.workspace.getConfiguration('ani-vscode');
    const activeMinutes = Math.max(1, cfg.get<number>('plugins.breakReminder.activeMinutes', 10) ?? 10);
    const cooldownMinutes = Math.max(1, cfg.get<number>('plugins.breakReminder.cooldownMinutes', 5) ?? 5);

    const now = Date.now();

    if (this.sessionStart === null || this.lastActivity === null) {
      return false;
    }

    if (now - this.lastActivity > BreakReminderPlugin.IDLE_RESET_MS) {
      return false;
    }

    if (this.lastNotification !== null) {
      const cooldownMs = cooldownMinutes * 60 * 1000;
      if (now - this.lastNotification < cooldownMs) {
        return false;
      }
    }

    const activeMs = activeMinutes * 60 * 1000;
    return now - this.sessionStart >= activeMs;
  }

  async generateMessage(_context: PluginContext): Promise<PluginMessage | null> {
    const cfg = vscode.workspace.getConfiguration('ani-vscode');
    const activeMinutes = Math.max(1, cfg.get<number>('plugins.breakReminder.activeMinutes', 10) ?? 10);

    if (!(await this.shouldTrigger())) {
      return null;
    }

    const now = Date.now();
    const activeDurationMs = this.sessionStart ? now - this.sessionStart : 0;
    const activeDurationMinutes = Math.max(1, Math.round(activeDurationMs / 60000));

    this.lastNotification = now;
    this.sessionStart = now; // Reset streak so the next reminder waits for a new run
    this.lastActivity = now;

    const userPrompt = [
      `I've been working steadily for about ${activeDurationMinutes} minutes, which is over my configured break reminder threshold of ${activeMinutes} minutes.`,
      'In a friendly, upbeat tone, suggest I take a short break—maybe stretch, refill water, or rest my eyes for a moment.',
      'Keep it concise (under 70 words) and acknowledge that a brief pause can improve focus when I get back.'
    ].join('\n');

    return {
      userPrompt,
      includeContext: false
    };
  }

  private recordActivity(): void {
    const now = Date.now();

    if (this.lastActivity === null || now - this.lastActivity > BreakReminderPlugin.IDLE_RESET_MS) {
      this.sessionStart = now;
    }

    this.lastActivity = now;
  }

  private disposeListeners(): void {
    if (this.disposables.length === 0) {
      return;
    }
    for (const disposable of this.disposables) {
      try {
        disposable.dispose();
      } catch {
        // No-op; disposal errors are non-fatal
      }
    }
    this.disposables = [];
  }
}
