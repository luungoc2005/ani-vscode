# Expression Animation Feature

This feature adds automatic expression animations to the Live2D character based on the AI's responses.

## How It Works

1. When the main AI model generates a response, the extension automatically triggers an expression animation
2. A fast LLM model analyzes the AI's response and selects the most appropriate expression
3. The selected expression is mapped to a motion file and played on the character

## Configuration

### Enable/Disable Expressions

To enable expressions, set the `fastModel` setting in VSCode settings:

```json
{
  "ani-vscode.llm.fastModel": "gpt-4o-mini"
}
```

To disable expressions, leave it empty:

```json
{
  "ani-vscode.llm.fastModel": ""
}
```

### Settings

- **`ani-vscode.llm.fastModel`**: The model to use for expression generation
  - Default: `""` (disabled)
  - Example: `"gpt-4o-mini"`, `"gemma3:12b"`, etc.
  - This model should be fast and cheap since it's called for every AI response
  - If empty, the expression feature is disabled

## Available Expressions

### Hiyori
- **Smile**: Gentle smile expression
- **Shy**: Shy/embarrassed expression
- **Questioning**: Curious/questioning expression
- **Laugh**: Laughing expression
- **Love**: Loving/affectionate expression
- **Surprised**: Surprised expression
- **Happy**: Very happy expression
- **Doubt**: Doubtful/uncertain expression
- **Sad**: Sad expression

### Mao
- **Happy**: Happy expression
- **Thinking**: Thinking/pondering expression
- **Proud**: Proud expression
- **Love**: Loving expression
- **Magic**: Magical/excited expression

## Technical Details

### How Expression Selection Works

1. The main AI model generates a response
2. If `fastModel` is configured, the extension:
   - Requests the current character name from the webview (supports character switching)
   - Loads the expression mappings from `motions_map.json`
   - Sends a prompt to the fast model asking it to choose an appropriate expression
   - Parses the response (supports both exact matches and verbose responses)
   - Maps the expression to the motion file
   - Triggers the motion in the webview

### Adding New Expressions

To add new expressions for a character, edit `src/motions_map.json`:

```json
{
  "CharacterName": {
    "ExpressionName": "motion_file.motion3.json"
  }
}
```

Then ensure the motion file exists in the character's motions folder.

## Example Workflow

1. User types code in VSCode
2. AI assistant responds: "Great job! That's a very efficient solution!"
3. Fast model analyzes the response and selects "Happy" or "Proud"
4. The character plays the corresponding happy/proud motion
5. The expression animation plays while showing the speech bubble

## Troubleshooting

### Expressions not playing

- Check that `fastModel` is set to a valid model name
- Verify the model is accessible via your configured `llm.baseUrl`
- Check the developer console for any errors
- Ensure the character has the selected expression in `motions_map.json`

### Wrong expressions playing

- The fast model might need better prompting or a different temperature
- Consider using a more capable model for better expression matching
- The default temperature is 0.3 for consistent results

### Performance issues

- Use a very fast, lightweight model (e.g., `gpt-4o-mini`, `gemma3:3b`)
- The expression request happens asynchronously and won't block the main response
- Errors in expression generation are silently caught to avoid disrupting the main flow

