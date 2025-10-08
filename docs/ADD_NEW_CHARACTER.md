# Adding a New Character

This guide explains how to add a new Live2D character to the VSCode extension.

## Prerequisites

You'll need a Live2D Cubism model with the following files:
- `YourCharacter.model3.json` - Main model configuration
- `YourCharacter.moc3` - Compiled model file
- Texture files (usually in a folder like `YourCharacter.2048/texture_00.png`)
- Motion files (in a `motions/` subfolder, e.g., `motion_01.motion3.json`)
- Optional: `YourCharacter.physics3.json`, `YourCharacter.pose3.json`, expressions, etc.

## Step-by-Step Instructions

### Step 1: Add Model Assets to Resources

1. Create a new folder in `webview/public/Resources/` named after your character (e.g., `YourCharacter/`)
2. Copy all your Live2D model files into this folder
3. Ensure the folder structure matches the references in your `model3.json` file

**Example structure:**
```
webview/public/Resources/YourCharacter/
  ├── YourCharacter.model3.json
  ├── YourCharacter.moc3
  ├── YourCharacter.physics3.json
  ├── YourCharacter.pose3.json
  ├── YourCharacter.2048/
  │   └── texture_00.png
  └── motions/
      ├── motion_01.motion3.json
      ├── motion_02.motion3.json
      └── motion_03.motion3.json
```

### Step 2: Register Character in ModelDir

Edit `webview/src/viewer/lappdefine.ts` and add your character name to the `ModelDir` array:

```typescript
export const ModelDir: string[] = [
  'Hiyori',
  'Mao',
  'YourCharacter'  // Add your character here
];
```

**Important:** The name must exactly match your folder name in Resources.

### Step 3: Create Character Card (MDX file)

Create `src/characters/YourCharacter.mdx` with your character's personality and behavior:

```mdx
---
name: YourCharacter
---

Good morning! You are finally awake. Your name is YourCharacter - a Japanese AI Vtuber.

[Add your character's background story and personality here]

Your personality is [describe personality traits]. You [describe behaviors and tendencies].

Important: Make your answers very short and concise, no more than 30 words. Reply in markdown format.
```

**Note:** The `name` field should match your character's folder name in Resources.

### Step 4: Add Motion Mappings

Edit `src/motions_map.json` to map emotions to your character's motion files:

```json
{
  "Hiyori": {
    "Smile": "Hiyori_m01.motion3.json",
    ...
  },
  "Mao": {
    "Happy": "mtn_02.motion3.json",
    ...
  },
  "YourCharacter": {
    "Happy": "motion_01.motion3.json",
    "Sad": "motion_02.motion3.json",
    "Surprised": "motion_03.motion3.json",
    "Thinking": "motion_04.motion3.json",
    "Love": "motion_05.motion3.json"
  }
}
```

**Available emotion tags:** Happy, Sad, Surprised, Thinking, Love, Smile, Shy, Questioning, Laugh, Doubt, Proud, Magic, etc.

The motion file names must match the actual files in your `motions/` folder.

### Step 5: Rebuild the Extension

Run the build commands to compile TypeScript and bundle the webview:

```bash
# Build the extension
npm run compile

# Build the webview (if needed)
cd webview
npm run build
cd ..
```

### Step 6: Test Your Character

1. **Reload VSCode Extension:**
   - Press `F5` if developing, or
   - Run "Developer: Reload Window" from the command palette

2. **Open the Extension Panel:**
   - Open the Live2D character panel in VSCode

3. **Switch Characters:**
   - Click the ⭐ button in the top-left to cycle through characters
   - Your new character should appear in the rotation

4. **Test Interactions:**
   - Try talking to the character to verify the personality loads correctly
   - Check that motions play appropriately based on emotional context

## Troubleshooting

### Character doesn't appear
- Verify the folder name in `webview/public/Resources/` exactly matches the name in `ModelDir`
- Check that `YourCharacter.model3.json` exists and is valid JSON
- Look for errors in the Developer Tools console

### Motions don't play
- Ensure motion file paths in `motions_map.json` match actual files
- Check that motion files are referenced in your `model3.json` under the `Motions` section
- Verify motion files are valid `.motion3.json` format

### Character personality isn't working
- Confirm `src/characters/YourCharacter.mdx` exists
- Check that the `name` in frontmatter matches the folder name
- Rebuild with `npm run compile` to copy MDX files to the `out/` folder

### Model doesn't load or shows errors
- Validate your `model3.json` file structure
- Ensure all referenced files (textures, moc3, physics, etc.) exist at the specified paths
- Check that texture paths are relative to the model folder

## Checklist

Before considering your character complete:

- [ ] Live2D model assets placed in `webview/public/Resources/YourCharacter/`
- [ ] Character name added to `ModelDir` in `webview/src/viewer/lappdefine.ts`
- [ ] Character card created at `src/characters/YourCharacter.mdx`
- [ ] Motion mappings added in `src/motions_map.json`
- [ ] Extension rebuilt with `npm run compile` and webview rebuilt
- [ ] Character appears when switching with ⭐ button
- [ ] Character responds with correct personality
- [ ] Motions play correctly during interactions

## Important Notes

- **Naming consistency is critical:** Use the same character name across all files and configurations
- **Case sensitivity:** Character names are case-sensitive on some systems
- **File paths:** All paths in `model3.json` should be relative to the character's folder
- **Rebuild required:** Always rebuild after making changes to see them take effect

## Example: Adding "Sakura" Character

1. Create `webview/public/Resources/Sakura/` with model files
2. Edit `lappdefine.ts`: add `'Sakura'` to ModelDir
3. Create `src/characters/Sakura.mdx` with personality
4. Edit `motions_map.json`: add Sakura motion mappings
5. Run `npm run compile`
6. Reload VSCode and test

---

For more details on the plugin system, see [PLUGIN_SYSTEM.md](PLUGIN_SYSTEM.md).

