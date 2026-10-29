# The Way of Sounds

A React-based audio visualizer and writing space. Load audio or use a microphone
to drive the visuals, customize the layout, and export a video.

## Requirements

- Node.js and npm
- For desktop exports: a computer that can run Electron

## Run in VS Code

1. Open this project folder in VS Code.
2. Open **Terminal → New Terminal**. Make sure the terminal is at the project
   root (the folder containing `package.json`).
3. Install dependencies (first run, or after dependencies change):

   ```sh
   npm install
   ```

4. Start the development server:

   ```sh
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

Leave the terminal running while you use the app. Press **Ctrl+C** in that
terminal to stop the server.

## Use the app

1. Choose **Upload Audio** for one track, or **Upload Multiple** to create a
   playlist. Choose **Use Mic** and allow microphone access to visualize live
   input instead.
2. Use **Play/Pause** and the progress bar to control a loaded audio track.
3. Edit the writing pane and open **Settings** to adjust the visualizer, colors,
   layout, and export options.
4. Choose **Snapshot UI** for a short five-second WebM preview.
5. For a full audio-and-visual video, use **Generate Video**. With multiple
   tracks, choose whether to export one video per track or combine the tracks
   into one.

## Run the desktop app

Studio video rendering and its save-file dialog require the Electron desktop
app. For development, keep the Vite server running in one VS Code terminal:

```sh
npm run dev
```

Then open a second terminal at the project root and run:

```sh
npm run dev:desktop
```

To build the web app and launch the desktop app from the built files, stop any
running development server first, then run:

```sh
npm run prod:desktop
```
