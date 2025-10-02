import * as vscode from 'vscode';
import { IPlugin, PluginContext, PluginMessage } from './IPlugin';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Screenshot plugin that captures the screen and asks AI to comment on it
 */
export class ScreenshotPlugin implements IPlugin {
  readonly id = 'screenshot';
  readonly name = 'Screenshot Analyzer';
  
  private lastScreenshotTime: number = 0;
  private readonly minIntervalMs = 60000; // At least 1 minute between screenshots

  isEnabled(config: vscode.WorkspaceConfiguration): boolean {
    return config.get<boolean>('plugins.screenshot.enabled', false);
  }

  shouldTrigger(context: PluginContext): boolean {
    const now = Date.now();
    const timeSinceLastScreenshot = now - this.lastScreenshotTime;
    
    // Only trigger if enough time has passed since last screenshot
    if (timeSinceLastScreenshot < this.minIntervalMs) {
      return false;
    }
    
    // Only trigger if there's an active editor
    return context.editor !== undefined;
  }

  async generateMessage(context: PluginContext): Promise<PluginMessage | null> {
    const { editor } = context;
    
    if (!editor) {
      return null;
    }

    try {
      this.lastScreenshotTime = Date.now();
      
      // Take a screenshot
      const screenshotPath = await this.takeScreenshot();
      
      if (!screenshotPath) {
        vscode.window.showErrorMessage('Failed to capture screenshot');
        return null;
      }

      // Read the screenshot as base64
      const imageBuffer = fs.readFileSync(screenshotPath);
      const base64Image = imageBuffer.toString('base64');
      
      // Clean up the temporary file
      fs.unlinkSync(screenshotPath);

      // Get current file info for context
      const doc = editor.document;
      const filePath = context.getRelativePath(doc.uri.fsPath);
      const language = doc.languageId;

      // Create a prompt that includes the image
      const userPrompt = [
        `I've captured a screenshot of my coding workspace.`,
        `Current file: ${filePath} (${language})`,
        '',
        'Please analyze this screenshot and provide a brief, witty comment about:',
        '- The code or content visible',
        '- The workspace setup or layout',
        '- Any interesting patterns or issues you notice',
        '- General coding style or practices',
        '',
        'Keep it concise, constructive, and maybe a bit playful!',
        '',
        `[Screenshot captured at ${new Date().toLocaleTimeString()}]`
      ].join('\n');

      // Return message with base64 image data attached
      return {
        userPrompt,
        includeContext: false,
        text: JSON.stringify({
          image: base64Image,
          mimeType: 'image/png'
        })
      };
    } catch (error) {
      console.error('Screenshot plugin error:', error);
      vscode.window.showErrorMessage(`Screenshot plugin failed: ${error}`);
      return null;
    }
  }

  /**
   * Take a screenshot using platform-specific commands
   * Returns the path to the screenshot file
   */
  private async takeScreenshot(): Promise<string | null> {
    const tempDir = os.tmpdir();
    const timestamp = Date.now();
    const screenshotPath = path.join(tempDir, `vscode-screenshot-${timestamp}.png`);

    try {
      const platform = os.platform();

      switch (platform) {
        case 'darwin': // macOS
          // Use screencapture command to capture main screen automatically
          // -x: no sound
          // -T 0: capture immediately (no delay)
          // Without -i flag, it captures the entire main screen non-interactively
          await execAsync(`screencapture -x -T 0 "${screenshotPath}"`);
          break;

        case 'win32': // Windows
          // Use PowerShell to capture the primary screen automatically
          const psScript = `
            Add-Type -AssemblyName System.Windows.Forms,System.Drawing
            $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
            $bmp = New-Object System.Drawing.Bitmap $bounds.width, $bounds.height
            $graphics = [System.Drawing.Graphics]::FromImage($bmp)
            $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.size)
            $bmp.Save('${screenshotPath.replace(/\\/g, '\\\\')}')
            $graphics.Dispose()
            $bmp.Dispose()
          `;
          await execAsync(`powershell -command "${psScript}"`);
          break;

        case 'linux':
          // Try various Linux screenshot tools (all non-interactive)
          try {
            // Try gnome-screenshot first (non-interactive with -f flag)
            await execAsync(`gnome-screenshot -f "${screenshotPath}"`);
          } catch {
            try {
              // Try scrot (captures entire screen automatically)
              await execAsync(`scrot "${screenshotPath}"`);
            } catch {
              try {
                // Try import (ImageMagick) - captures root window (entire screen)
                await execAsync(`import -window root "${screenshotPath}"`);
              } catch {
                vscode.window.showErrorMessage(
                  'No screenshot tool found. Please install gnome-screenshot, scrot, or ImageMagick.'
                );
                return null;
              }
            }
          }
          break;

        default:
          vscode.window.showErrorMessage(`Screenshot not supported on platform: ${platform}`);
          return null;
      }

      // Verify the file was created
      if (fs.existsSync(screenshotPath) && fs.statSync(screenshotPath).size > 0) {
        return screenshotPath;
      } else {
        return null;
      }
    } catch (error) {
      console.error('Failed to take screenshot:', error);
      return null;
    }
  }
}

