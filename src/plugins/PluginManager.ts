import * as vscode from 'vscode';
import { IPlugin, PluginContext, PluginMessage } from './IPlugin';

/**
 * Manages all plugins and handles plugin selection
 */
export class PluginManager {
  private plugins: IPlugin[] = [];

  /**
   * Register a plugin
   */
  register(plugin: IPlugin): void {
    this.plugins.push(plugin);
  }

  /**
   * Get all registered plugins
   */
  getAllPlugins(): IPlugin[] {
    return [...this.plugins];
  }

  /**
   * Get all enabled plugins based on current configuration
   */
  getEnabledPlugins(config: vscode.WorkspaceConfiguration): IPlugin[] {
    return this.plugins.filter(plugin => plugin.isEnabled(config));
  }

  /**
   * Randomly select an enabled plugin
   */
  selectRandomPlugin(config: vscode.WorkspaceConfiguration): IPlugin | null {
    const enabled = this.getEnabledPlugins(config);
    if (enabled.length === 0) {
      return null;
    }
    const index = Math.floor(Math.random() * enabled.length);
    return enabled[index];
  }

  /**
   * Get a message from a randomly selected plugin
   */
  async getRandomPluginMessage(context: PluginContext, config: vscode.WorkspaceConfiguration): Promise<PluginMessage | null> {
    const plugin = this.selectRandomPlugin(config);
    if (!plugin) {
      return null;
    }
    return plugin.generateMessage(context);
  }

  /**
   * Find a plugin by ID
   */
  getPlugin(id: string): IPlugin | undefined {
    return this.plugins.find(p => p.id === id);
  }

  /**
   * Activate all enabled plugins
   */
  activatePlugins(context: PluginContext, config: vscode.WorkspaceConfiguration): void {
    const enabled = this.getEnabledPlugins(config);
    for (const plugin of enabled) {
      if (plugin.activate) {
        plugin.activate(context);
      }
    }
  }

  /**
   * Deactivate all plugins
   */
  deactivatePlugins(): void {
    for (const plugin of this.plugins) {
      if (plugin.deactivate) {
        plugin.deactivate();
      }
    }
  }
}
