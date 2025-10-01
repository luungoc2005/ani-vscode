import * as fs from 'fs';
import * as path from 'path';

export interface CharacterCard {
  name: string;
  systemPrompt: string;
}

/**
 * Parses MDX frontmatter and content
 */
function parseMDX(content: string): { frontmatter: Record<string, string>; body: string } {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);
  
  if (!match) {
    return { frontmatter: {}, body: content };
  }
  
  const [, frontmatterText, body] = match;
  const frontmatter: Record<string, string> = {};
  
  // Parse YAML-style frontmatter
  const lines = frontmatterText.split('\n');
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim();
      frontmatter[key] = value;
    }
  }
  
  return { frontmatter, body: body.trim() };
}

/**
 * Loads a character card from an MDX file
 */
export function loadCharacterCard(characterName: string, extensionPath: string): CharacterCard | null {
  try {
    const filePath = path.join(extensionPath, 'out', 'characters', `${characterName}.mdx`);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.error(`Character card not found: ${filePath}`);
      return null;
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
    const { frontmatter, body } = parseMDX(content);
    
    return {
      name: frontmatter.name || characterName,
      systemPrompt: body,
    };
  } catch (error) {
    console.error(`Error loading character card for ${characterName}:`, error);
    return null;
  }
}

/**
 * Gets the system prompt for a character
 */
export function getCharacterSystemPrompt(characterName: string, extensionPath: string, fallbackPrompt: string): string {
  const card = loadCharacterCard(characterName, extensionPath);
  return card?.systemPrompt || fallbackPrompt;
}

/**
 * Gets all available character names
 */
export function getAvailableCharacters(extensionPath: string): string[] {
  try {
    const charactersDir = path.join(extensionPath, 'out', 'characters');
    
    if (!fs.existsSync(charactersDir)) {
      return [];
    }
    
    const files = fs.readdirSync(charactersDir);
    return files
      .filter(f => f.endsWith('.mdx'))
      .map(f => path.basename(f, '.mdx'));
  } catch (error) {
    console.error('Error listing available characters:', error);
    return [];
  }
}

