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
      
      // Get top 30 stories and randomly select 3
      const selectedIds = this.randomSelect(topStoryIds.slice(0, 30), 3);
      
      // Fetch article details for selected stories
      const articles = await Promise.all(
        selectedIds.map(id => this.fetchArticle(id))
      );

      // Filter out any null/invalid articles
      const validArticles = articles.filter(a => a && a.title);

      if (validArticles.length === 0) {
        return null;
      }

      // Format articles for the prompt
      const articleSummaries = validArticles.map((article, idx) => {
        const parts = [
          `${idx + 1}. **${article.title}**`,
          `   By: ${article.by}`,
        ];
        
        // if (article.descendants !== undefined) {
        //   parts.push(`   Comments: ${article.descendants}`);
        // }
        
        parts.push(`   HN Discussion: https://news.ycombinator.com/item?id=${article.id}`);
        
        if (article.text) {
          // Truncate long text content
          const truncated = article.text.length > 200 
            ? article.text.substring(0, 200) + '...'
            : article.text;
          parts.push(`   Content: ${truncated}`);
        }
        
        return parts.join('\n');
      }).join('\n\n');

      const userPrompt = [
        'Top HackerNews Articles',
        '',
        articleSummaries,
        '',
        'I haven\'t read these articles yet, so brief anything interesting to me. Tell me what article you are talking about and give me the link to the discussion. Be concise and witty.'
      ].join('\n');

      return {
        userPrompt,
        includeContext: false
      };
    } catch (error) {
      console.error('HackerNewsPlugin error:', error);
      return null;
    }
  }
}
