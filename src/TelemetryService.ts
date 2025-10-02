import { TelemetryReporter } from '@vscode/extension-telemetry';

/**
 * Telemetry service for tracking extension usage
 */
export class TelemetryService {
  private static instance: TelemetryService | null = null;
  private reporter: TelemetryReporter | null = null;

  private constructor(connectionString: string) {
    this.reporter = new TelemetryReporter(connectionString);
  }

  /**
   * Initialize the telemetry service
   */
  static initialize(connectionString: string): TelemetryService {
    if (!TelemetryService.instance) {
      TelemetryService.instance = new TelemetryService(connectionString);
    }
    return TelemetryService.instance;
  }

  /**
   * Get the telemetry service instance
   */
  static getInstance(): TelemetryService | null {
    return TelemetryService.instance;
  }

  /**
   * Record panel open event
   */
  recordPanelOpened(character: string, transparentBackground: boolean, debugPanel: boolean): void {
    if (!this.reporter) return;

    this.reporter.sendTelemetryEvent('panelOpened', {
      character,
      transparentBackground: String(transparentBackground),
      debugPanel: String(debugPanel)
    });
  }

  /**
   * Record character change event
   */
  recordCharacterChanged(oldCharacter: string, newCharacter: string): void {
    if (!this.reporter) return;

    this.reporter.sendTelemetryEvent('characterChanged', {
      oldCharacter,
      newCharacter
    });
  }

  /**
   * Record model name being used
   */
  recordModelUsed(modelType: 'main' | 'fast', modelName: string): void {
    if (!this.reporter) return;

    this.reporter.sendTelemetryEvent('modelUsed', {
      modelType,
      modelName
    });
  }

  /**
   * Record plugin trigger event
   */
  recordPluginTriggered(pluginId: string, triggerType: 'auto' | 'periodic' | 'manual'): void {
    if (!this.reporter) return;

    this.reporter.sendTelemetryEvent('pluginTriggered', {
      pluginId,
      triggerType
    });
  }

  /**
   * Record which plugins are enabled
   */
  recordEnabledPlugins(enabledPlugins: string[]): void {
    if (!this.reporter) return;

    this.reporter.sendTelemetryEvent('pluginsEnabled', {
      plugins: enabledPlugins.join(','),
      count: String(enabledPlugins.length)
    });
  }

  /**
   * Record error event
   */
  recordError(errorType: string, errorMessage: string, stack?: string): void {
    if (!this.reporter) return;

    this.reporter.sendTelemetryErrorEvent('error', {
      errorType,
      errorMessage
    }, {
      stack: stack ? 1 : 0
    });
  }

  /**
   * Dispose the telemetry reporter
   */
  dispose(): void {
    if (this.reporter) {
      this.reporter.dispose();
      this.reporter = null;
    }
    TelemetryService.instance = null;
  }
}
