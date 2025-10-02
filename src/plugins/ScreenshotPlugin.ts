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

  getWeight(config: vscode.WorkspaceConfiguration): number {
    // Default weight for Screenshot plugin
    return 2.0;
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
    } catch (error: any) {
      console.error('Screenshot plugin error:', error);
      const errorMessage = error.message || String(error);
      vscode.window.showErrorMessage(`Failed to capture screenshot: ${errorMessage}`);
      return null;
    }
  }

  /**
   * Take a screenshot using platform-specific commands
   * Returns the path to the screenshot file
   * Throws an error with detailed information if screenshot fails
   */
  private async takeScreenshot(): Promise<string> {
    const tempDir = os.tmpdir();
    const timestamp = Date.now();
    const screenshotPath = path.join(tempDir, `vscode-screenshot-${timestamp}.png`);

    try {
      const platform = os.platform();
      let execResult: { stdout: string; stderr: string } | undefined;

      switch (platform) {
        case 'darwin': // macOS
          // Use screencapture command to capture main screen automatically
          // -x: no sound
          // -T 0: capture immediately (no delay)
          // Without -i flag, it captures the entire main screen non-interactively
          execResult = await execAsync(`screencapture -x -T 0 "${screenshotPath}"`);
          break;

        case 'win32': // Windows
          // Use a temporary PowerShell script file for better reliability
          // Avoids command-line escaping issues and allows better error capture
          const tempScriptPath = path.join(tempDir, `screenshot-${timestamp}.ps1`);
          const psScript = `
$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.Encoding]::UTF8

try {
    Write-Host "Starting screenshot capture..."
    
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    
    Write-Host "Assemblies loaded successfully"
    
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen
    $bounds = $screen.Bounds
    
    Write-Host "Screen bounds: $($bounds.Width)x$($bounds.Height) at $($bounds.Location)"
    
    if ($bounds.Width -le 0 -or $bounds.Height -le 0) {
        throw "Invalid screen dimensions: $($bounds.Width)x$($bounds.Height)"
    }
    
    $bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
    Write-Host "Bitmap created"
    
    $graphics = [System.Drawing.Graphics]::FromImage($bmp)
    Write-Host "Graphics context created"
    
    Start-Sleep -Milliseconds 100
    
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    Write-Host "Screen captured to bitmap"
    
    $outputPath = "${screenshotPath.replace(/\\/g, '\\\\')}"
    $bmp.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Host "Bitmap saved to: $outputPath"
    
    if (-not (Test-Path $outputPath)) {
        throw "Screenshot file was not created at: $outputPath"
    }
    
    $fileSize = (Get-Item $outputPath).Length
    Write-Host "File size: $fileSize bytes"
    
    if ($fileSize -eq 0) {
        throw "Screenshot file is empty"
    }
    
    $graphics.Dispose()
    $bmp.Dispose()
    
    Write-Host "SUCCESS: Screenshot saved successfully"
    exit 0
    
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "ERROR TYPE: $($_.Exception.GetType().FullName)" -ForegroundColor Red
    Write-Host "STACK TRACE: $($_.ScriptStackTrace)" -ForegroundColor Red
    exit 1
}
`;
          
          try {
            // Write script to temp file
            fs.writeFileSync(tempScriptPath, psScript, 'utf8');
            
            // Execute the script file
            execResult = await execAsync(`powershell -ExecutionPolicy Bypass -NoProfile -File "${tempScriptPath}"`, {
              timeout: 15000, // 15 second timeout
              windowsHide: true
            });
            
            // Clean up script file
            try {
              fs.unlinkSync(tempScriptPath);
            } catch (cleanupError) {
              // Ignore cleanup errors
            }
            
          } catch (psError: any) {
            // Clean up script file on error
            try {
              if (fs.existsSync(tempScriptPath)) {
                fs.unlinkSync(tempScriptPath);
              }
            } catch (cleanupError) {
              // Ignore cleanup errors
            }
            
            // Capture and log PowerShell errors with stderr output
            console.error('PowerShell screenshot failed:');
            console.error('Error message:', psError.message);
            console.error('Command:', psError.cmd || '(unknown)');
            if (psError.stdout) {
              console.error('PowerShell stdout:', psError.stdout);
            } else {
              console.error('PowerShell stdout: (empty)');
            }
            if (psError.stderr) {
              console.error('PowerShell stderr:', psError.stderr);
            } else {
              console.error('PowerShell stderr: (empty)');
            }
            
            // Create a detailed error message for Windows
            let errorDetails = '';
            if (psError.stdout || psError.stderr) {
              errorDetails = '\n' + (psError.stdout || '') + (psError.stderr || '');
            } else {
              errorDetails = '\nNo output captured. This might indicate PowerShell execution was blocked or timed out.';
            }
            
            throw new Error(`PowerShell screenshot failed: ${psError.message}${errorDetails}`);
          }
          break;

        case 'linux':
          // Try various Linux screenshot tools (all non-interactive)
          try {
            // Try gnome-screenshot first
            // --file: output file path
            // (default without -w or -a flags captures full screen)
            execResult = await execAsync(`gnome-screenshot --file="${screenshotPath}"`);
          } catch {
            try {
              // Try scrot (captures entire screen automatically)
              execResult = await execAsync(`scrot "${screenshotPath}"`);
            } catch {
              try {
                // Try import (ImageMagick) - captures root window (entire screen)
                execResult = await execAsync(`import -window root "${screenshotPath}"`);
              } catch {
                throw new Error('No screenshot tool found. Please install gnome-screenshot, scrot, or ImageMagick.');
              }
            }
          }
          break;

        default:
          throw new Error(`Screenshot not supported on platform: ${platform}`);
      }

      // Verify the file was created
      if (fs.existsSync(screenshotPath) && fs.statSync(screenshotPath).size > 0) {
        return screenshotPath;
      } else {
        // File wasn't created even though command didn't throw - include output for debugging
        const debugInfo = execResult 
          ? `\nstdout: ${execResult.stdout || '(empty)'}\nstderr: ${execResult.stderr || '(empty)'}`
          : '';
        console.error('Screenshot file was not created or is empty');
        console.error('Command output:', debugInfo);
        throw new Error(`Screenshot file was not created or is empty${debugInfo}`);
      }
    } catch (error: any) {
      console.error('Failed to take screenshot:', error);
      throw error; // Re-throw to be handled by caller
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

