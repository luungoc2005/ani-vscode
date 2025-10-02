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
   * Get the effective weight for a plugin (user config overrides default)
   */
  private getPluginWeight(plugin: IPlugin, config: vscode.WorkspaceConfiguration): number {
    // Try to get user-configured weight first
    const userWeight = config.get<number>(`plugins.${plugin.id}.weight`);
    if (userWeight !== undefined && userWeight >= 0) {
      return userWeight;
    }
    
    // Fall back to plugin's default weight
    if (plugin.getWeight) {
      return plugin.getWeight(config);
    }
    
    // Default weight is 1.0
    return 1.0;
  }

  /**
   * Randomly select an enabled plugin that should trigger in the current context
   * Uses weighted random selection based on plugin weights
   */
  selectRandomPlugin(config: vscode.WorkspaceConfiguration, context?: PluginContext): IPlugin | null {
    let enabled = this.getEnabledPlugins(config);
    
    // Filter by shouldTrigger if context is provided
    if (context) {
      enabled = enabled.filter(plugin => {
        // If plugin doesn't implement shouldTrigger, assume it should trigger
        if (!plugin.shouldTrigger) {
          return true;
        }
        return plugin.shouldTrigger(context);
      });
    }
    
    if (enabled.length === 0) {
      return null;
    }

    // Build weighted list
    const weights = enabled.map(plugin => this.getPluginWeight(plugin, config));
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    
    // If total weight is 0, return null (all plugins have 0 weight)
    if (totalWeight === 0) {
      return null;
    }
    
    // Weighted random selection
    let random = Math.random() * totalWeight;
    for (let i = 0; i < enabled.length; i++) {
      random -= weights[i];
      if (random <= 0) {
        return enabled[i];
      }
    }
    
    // Fallback (shouldn't happen, but just in case)
    return enabled[enabled.length - 1];
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
   * Get a message from a specific plugin by ID
   */
  async getPluginMessage(pluginId: string, context: PluginContext, config: vscode.WorkspaceConfiguration): Promise<PluginMessage | null> {
    const plugin = this.getPlugin(pluginId);
    if (!plugin || !plugin.isEnabled(config)) {
      return null;
    }
    
    // Check if plugin should trigger in current context
    if (plugin.shouldTrigger && !plugin.shouldTrigger(context)) {
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
