import * as vscode from 'vscode';
import { IPlugin, PluginContext, PluginMessage } from './IPlugin';
import * as https from 'https';

/**
 * HackerNews Article Interface
 */
interface HNArticle {
  id: number;
  title: string;
  url?: string;
  by: string;
  score: number;
  descendants?: number;
  text?: string;
  kids?: number[];
}

/**
 * HackerNews Comment Interface
 */
interface HNComment {
  id: number;
  by: string;
  text?: string;
  kids?: number[];
  deleted?: boolean;
  dead?: boolean;
}

/**
 * HackerNews plugin that fetches top articles and asks the AI to comment
 */
export class HackerNewsPlugin implements IPlugin {
  readonly id = 'hackerNews';
  readonly name = 'HackerNews Reader';

  isEnabled(config: vscode.WorkspaceConfiguration): boolean {
    return config.get<boolean>('plugins.hackerNews.enabled', true);
  }

  shouldTrigger(context: PluginContext): boolean {
    // HackerNews plugin can always trigger (doesn't depend on editor state)
    return true;
  }

  /**
   * Fetch data from a URL using https module
   */
  private async fetchData(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(error);
          }
        });
      }).on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Fetch top HackerNews stories
   */
  private async fetchTopStories(): Promise<number[]> {
    const url = 'https://hacker-news.firebaseio.com/v0/topstories.json';
    return this.fetchData(url);
  }

  /**
   * Fetch article details by ID
   */
  private async fetchArticle(id: number): Promise<HNArticle> {
    const url = `https://hacker-news.firebaseio.com/v0/item/${id}.json`;
    return this.fetchData(url);
  }

  /**
   * Fetch comment details by ID
   */
  private async fetchComment(id: number): Promise<HNComment> {
    const url = `https://hacker-news.firebaseio.com/v0/item/${id}.json`;
    return this.fetchData(url);
  }

  /**
   * Fetch top comments for an article
   * Returns the first N valid (non-deleted, non-dead) comments
   */
  private async fetchTopComments(article: HNArticle, maxComments: number = 3): Promise<HNComment[]> {
    if (!article.kids || article.kids.length === 0) {
      return [];
    }

    const comments: HNComment[] = [];
    
    // Fetch comments in order until we have enough valid ones
    for (const commentId of article.kids.slice(0, maxComments * 2)) {
      if (comments.length >= maxComments) {
        break;
      }

      try {
        const comment = await this.fetchComment(commentId);
        
        // Skip deleted or dead comments
        if (!comment.deleted && !comment.dead && comment.text) {
          comments.push(comment);
        }
      } catch (error) {
        // Skip comments that fail to fetch
        continue;
      }
    }

    return comments;
  }

  /**
   * Strip HTML tags from text
   */
  private stripHtml(html: string): string {
    return html
      .replace(/<p>/g, '\n')
      .replace(/<\/p>/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&#x27;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();
  }

  /**
   * Randomly select N items from an array
   */
  private randomSelect<T>(array: T[], count: number): T[] {
    const shuffled = [...array].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(count, array.length));
  }

  async generateMessage(context: PluginContext): Promise<PluginMessage | null> {
    try {
      // Fetch top stories (returns array of IDs)
      const topStoryIds = await this.fetchTopStories();
      
      // Get top 30 stories and randomly select 1
      const selectedIds = this.randomSelect(topStoryIds.slice(0, 30), 1);
      
      // Fetch article details for selected story
      const articles = await Promise.all(
        selectedIds.map(id => this.fetchArticle(id))
      );

      // Filter out any null/invalid articles
      const validArticles = articles.filter(a => a && a.title);

      if (validArticles.length === 0) {
        return null;
      }

      const article = validArticles[0];
      const hnLink = `https://news.ycombinator.com/item?id=${article.id}`;

      // Fetch top comments for the article
      const comments = await this.fetchTopComments(article, 3);

      // Format article for the prompt
      const parts = [];

      parts.push(`Title: ${article.title}`);
      // parts.push(`By: ${article.by}`);
      
      if (article.text) {
        // Truncate long text content
        const truncated = article.text.length > 200 
          ? article.text.substring(0, 200) + '...'
          : article.text;
        parts.push(`Content: ${truncated}`);
      }

      // Add top comments if available
      if (comments.length > 0) {
        parts.push(''); // Empty line for separation
        parts.push('Top Comments:');
        comments.forEach((comment, index) => {
          const commentText = this.stripHtml(comment.text || '');
          // Truncate long comments
          const truncated = commentText.length > 300
            ? commentText.substring(0, 300) + '...'
            : commentText;
          parts.push(`${index + 1}. [${comment.by}]: ${truncated}`);
        });
      }
      
      const articleSummary = parts.join('\n');

      const userPrompt = [
        articleSummary,
        '',
        'Give me some insights or interesting thoughts about this article and the discussion happening in the comments. Be concise and witty.'
      ].join('\n');

      return {
        userPrompt,
        includeContext: false,
        text: `\n\n**${article.title}**\n[HN Discussion](${hnLink})` + 
              (article.descendants ? ` (${article.descendants} comment${article.descendants > 1 ? 's' : ''})` : '')
      };
    } catch (error) {
      console.error('HackerNewsPlugin error:', error);
      return null;
    }
  }
}
