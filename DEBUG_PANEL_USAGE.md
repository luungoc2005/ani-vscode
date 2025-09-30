# Debug Panel Usage & Troubleshooting

## Enabling the Debug Panel

1. Open VSCode Settings (`Cmd+,` on Mac, `Ctrl+,` on Windows/Linux)
2. Search for **"ani-vscode debug"**
3. Check the **"Debug Panel"** checkbox
4. Close and reopen the Ani panel (or reload the extension)

## Using the Debug Panel

Once enabled:
- The debug panel appears on the **middle-left side** of the webview
- It shows the current model name (Hiyori or Mao)
- Lists all available motions grouped by category (Idle, TapBody, etc.)
- Click any motion name to trigger it immediately

## Troubleshooting

### Panel is Empty or Shows "No motions available"

**Check the Browser Console:**
1. Open the Ani webview panel
2. Open Developer Tools:
   - macOS: `Cmd+Option+I`
   - Windows/Linux: `Ctrl+Shift+I`
3. Click on the **Console** tab
4. Look for debug messages starting with:
   - `getAvailableMotions`
   - `LAppModel.getAvailableMotions`
   - `Debug Panel`

**Common Issues and Solutions:**

1. **Model not initialized yet**
   - Console will show: `"model not initialized yet"`
   - **Solution**: Wait a few seconds for the model to load, the panel polls every second

2. **_modelSetting is null**
   - Console will show: `"_modelSetting is null"`
   - **Solution**: The model failed to load. Check for earlier errors in console

3. **No subdelegates available**
   - Console will show: `"No subdelegates available"`
   - **Solution**: The Cubism framework didn't initialize properly. Try reloading the extension

4. **Panel doesn't update when switching models**
   - The panel polls every second for changes
   - Switch the model using the star (⭐) button
   - Wait 1-2 seconds for the panel to refresh

### Expected Console Output (Success)

When working correctly, you should see logs like:
```
getAvailableMotions - delegate: LAppDelegate {...}
getAvailableMotions - subdelegate: LAppSubdelegate {...}
getAvailableMotions - manager: LAppLive2DManager {...}
LAppModel.getAvailableMotions - motionGroupCount: 2
LAppModel.getAvailableMotions - group Idle has 9 motions
LAppModel.getAvailableMotions - group TapBody has 1 motions
getAvailableMotions - result: {motions: Array(10), modelName: "Hiyori"}
Debug Panel - Fetched motions: {motions: Array(10), modelName: "Hiyori"}
```

### Playing Motions

When you click a motion:
- Console should show: `playMotion called: <groupName> <index>`
- Followed by: `playMotion - Motion started successfully`
- The model should animate

If the motion doesn't play, check console for errors.

## Disabling the Debug Panel

1. Uncheck the **"Debug Panel"** checkbox in settings
2. The panel will hide immediately (no reload needed)

## Available Motions

### Hiyori Model
- **Idle**: 9 motions (Hiyori_m01 through Hiyori_m10, excluding m04)
- **TapBody**: 1 motion (Hiyori_m04)

### Mao Model
- **Idle**: 2 motions (mtn_01, sample_01)
- **TapBody**: 6 motions (mtn_02, mtn_03, mtn_04, special_01, special_02, special_03)

