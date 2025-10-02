import * as vscode from 'vscode';
import { IPlugin, PluginContext, PluginMessage } from './IPlugin';
import * as https from 'https';
import * as http from 'http';
import { hasInternetConnectivityCached } from './common/connectivity';

/**
 * RSS Feed Item Interface
 */
interface RSSItem {
  title: string;
  link: string;
  description?: string;
  pubDate?: string;
  author?: string;
  content?: string;
}

/**
 * RSS Feed Plugin that fetches articles from configured RSS feeds and asks the AI to summarize
 */
export class RSSFeedPlugin implements IPlugin {
  readonly id = 'rssFeed';
  readonly name = 'RSS Feed Reader';

  isEnabled(config: vscode.WorkspaceConfiguration): boolean {
    return config.get<boolean>('plugins.rssFeed.enabled', true);
  }

  getWeight(config: vscode.WorkspaceConfiguration): number {
    // Default weight for RSS Feed plugin
    return 1.0;
  }

  async shouldTrigger(context: PluginContext): Promise<boolean> {
    // RSS plugin requires internet connectivity
    return await hasInternetConnectivityCached();
  }

  /**
   * Fetch data from a URL using http/https module
   */
  private async fetchData(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      
      protocol.get(url, (res) => {
        // Handle redirects
        if (res.statusCode === 301 || res.statusCode === 302) {
          if (res.headers.location) {
            this.fetchData(res.headers.location).then(resolve).catch(reject);
            return;
          }
        }

        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          resolve(data);
        });
      }).on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Parse RSS/Atom feed XML
   */
  private parseRSS(xml: string): RSSItem[] {
    const items: RSSItem[] = [];
    
    try {
      // Simple XML parsing - handle both RSS 2.0 and Atom feeds
      // Match <item> tags (RSS 2.0) or <entry> tags (Atom)
      const itemRegex = /<(?:item|entry)[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi;
      let match;
      
      while ((match = itemRegex.exec(xml)) !== null) {
        const itemXml = match[1];
        
        // Extract fields using regex
        const getField = (tag: string, cdata = false): string | undefined => {
          const pattern = cdata 
            ? new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i')
            : new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
          const m = itemXml.match(pattern);
          if (m) {
            return this.decodeHtml(m[1].trim());
          }
          return undefined;
        };

        const title = getField('title', true) || getField('title') || 'Untitled';
        
        // Try different link formats
        let link = getField('link') || getField('guid') || '';
        
        // For Atom feeds, link might be in an attribute
        if (!link) {
          const atomLinkMatch = itemXml.match(/<link[^>]+href=["']([^"']+)["']/i);
          if (atomLinkMatch) {
            link = atomLinkMatch[1];
          }
        }
        
        const description = getField('description', true) || getField('description') || 
                           getField('summary', true) || getField('summary');
        const content = getField('content:encoded', true) || getField('content:encoded') ||
                       getField('content', true) || getField('content');
        const pubDate = getField('pubDate') || getField('published') || getField('updated');
        const author = getField('author') || getField('dc:creator');
        
        if (title && link) {
          items.push({
            title,
            link,
            description,
            pubDate,
            author,
            content
          });
        }
      }
    } catch (error) {
      console.error('RSS parsing error:', error);
    }
    
    return items;
  }

  /**
   * Decode HTML entities
   */
  private decodeHtml(html: string): string {
    return html
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .trim();
  }

  /**
   * Strip HTML tags and truncate text
   */
  private stripAndTruncate(html: string | undefined, maxLength: number): string {
    if (!html) return '';
    const stripped = this.decodeHtml(html);
    return stripped.length > maxLength 
      ? stripped.substring(0, maxLength) + '...'
      : stripped;
  }

  /**
   * Randomly select N items from an array
   */
  private randomSelect<T>(array: T[], count: number): T[] {
    const shuffled = [...array].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(count, array.length));
  }

  /**
   * Fetch and parse RSS feed
   */
  private async fetchRSSFeed(feedUrl: string): Promise<RSSItem[]> {
    try {
      const xml = await this.fetchData(feedUrl);
      return this.parseRSS(xml);
    } catch (error) {
      console.error(`Error fetching RSS feed ${feedUrl}:`, error);
      return [];
    }
  }

  async generateMessage(context: PluginContext): Promise<PluginMessage | null> {
    try {
      const config = vscode.workspace.getConfiguration('ani-vscode');
      const feedUrls = config.get<string[]>('plugins.rssFeed.feeds', [
        'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml',
      ]);

      if (feedUrls.length === 0) {
        return null;
      }

      // Randomly select one feed
      const selectedFeed = feedUrls[Math.floor(Math.random() * feedUrls.length)];
      
      // Fetch feed items
      const items = await this.fetchRSSFeed(selectedFeed);
      
      if (items.length === 0) {
        return null;
      }

      // Randomly select 1 article from the feed
      const selectedArticles = this.randomSelect(items, 1);
      const item = selectedArticles[0];

      // Format article for the prompt
      const parts = [];

      parts.push(`Title: ${item.title}`);
      
    //   if (item.author) {
    //     parts.push(`By: ${item.author}`);
    //   }
      
      // Use content first, fall back to description
      const text = item.content || item.description;
      if (text) {
        const truncated = this.stripAndTruncate(text, 250);
        if (truncated) {
          parts.push(`Summary: ${truncated}`);
        }
      }
      
    //   if (item.pubDate) {
    //     parts.push(`Published: ${item.pubDate}`);
    //   }
      
      const articleSummary = parts.join('\n');

      const userPrompt = [
        articleSummary,
        '',
        'Give me some insights or interesting thoughts about this article. Be concise and witty.'
      ].join('\n');

      return {
        userPrompt,
        includeContext: false,
        text: `\n\n**${item.title}**\n[Read more](${item.link})`
      };
    } catch (error) {
      console.error('RSSFeedPlugin error:', error);
      return null;
    }
  }
}
