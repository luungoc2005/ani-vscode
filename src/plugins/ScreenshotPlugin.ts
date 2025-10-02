import * as vscode from 'vscode';
import { IPlugin, PluginContext, PluginMessage } from './IPlugin';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const execAsync = promisify(exec);

/**
 * Screenshot plugin that captures the screen and asks AI to comment on it
 */
export class ScreenshotPlugin implements IPlugin {
  readonly id = 'screenshot';
  readonly name = 'Screenshot Analyzer';
  
  private lastScreenshotTime: number = 0;
  private readonly minIntervalMs = 60000; // At least 1 minute between screenshots
  private previousScreenshotBuffer: Buffer | null = null;
  private previousComment: string | null = null;

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

      // Compare with previous screenshot if it exists
      let similarityPercent = 0;
      if (this.previousScreenshotBuffer) {
        similarityPercent = await this.compareScreenshots(this.previousScreenshotBuffer, imageBuffer);
      }

      // Create a prompt that includes the image
      const promptParts = [`I've captured a screenshot`,];

      // If screenshots are >80% similar and we have a previous comment, include it
      if (similarityPercent > 80 && this.previousComment) {
        promptParts.push('Your previous comment about my screen was:');
        promptParts.push(`"${this.previousComment}"`);
        promptParts.push('');
        promptParts.push('Please provide an updated comment that:');
        promptParts.push('- Acknowledges what has/hasn\'t changed since your last comment');
        promptParts.push('- Provides fresh insights or follow-up observations');
        promptParts.push('- Maintains your witty, constructive style');
      } else {
        promptParts.push('');
        promptParts.push('Please analyze this screenshot and provide a brief, witty comment about:');
        promptParts.push('- The code or content visible');
        promptParts.push('- The workspace setup or layout');
        promptParts.push('- Any interesting patterns or issues you notice');
        promptParts.push('- General coding style or practices');
        promptParts.push('');
        promptParts.push('Keep it concise, constructive, and maybe a bit playful!');
      }

      promptParts.push('');
      promptParts.push(`[Screenshot captured at ${new Date().toLocaleTimeString()}]`);

      const userPrompt = promptParts.join('\n');

      // Store current screenshot for next comparison
      this.previousScreenshotBuffer = imageBuffer;

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

  /**
   * Called by AgentLoop after AI generates a response
   * Stores the response for comparison in the next screenshot
   */
  onResponse(response: string): void {
    this.previousComment = response;
  }

  /**
   * Compare two screenshots and return similarity percentage
   * Returns a value between 0 (completely different) and 100 (identical)
   */
  private async compareScreenshots(buffer1: Buffer, buffer2: Buffer): Promise<number> {
    try {
      // Parse both PNG images
      const img1 = PNG.sync.read(buffer1);
      const img2 = PNG.sync.read(buffer2);

      // If dimensions don't match, resize or return low similarity
      if (img1.width !== img2.width || img1.height !== img2.height) {
        // Different dimensions = not very similar
        return 0;
      }

      const { width, height } = img1;
      const totalPixels = width * height;

      // Create diff image buffer
      const diff = new PNG({ width, height });

      // Compare images using pixelmatch
      const mismatchedPixels = pixelmatch(
        img1.data,
        img2.data,
        diff.data,
        width,
        height,
        { threshold: 0.1 } // 0.1 is a reasonable threshold for detecting differences
      );

      // Calculate similarity percentage
      const matchedPixels = totalPixels - mismatchedPixels;
      const similarityPercent = (matchedPixels / totalPixels) * 100;

      return similarityPercent;
    } catch (error) {
      console.error('Error comparing screenshots:', error);
      // If comparison fails, assume they're different
      return 0;
    }
  }
}

