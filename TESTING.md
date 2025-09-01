Visual test guide and running the headless smoke test

1) Start the static server (the app expects to be served from ./public)
   - Using the script in package.json:
     npm install
     npm run start
   - This will serve the app at http://127.0.0.1:5500/public/index.html

2) Run the headless smoke test (requires Node.js and npm)
   npm install
   npm run smoke-test

What the smoke test does:
- Launches a headless Chromium instance.
- Loads the app at the test URL (default: http://127.0.0.1:5500/public/index.html).
- Iterates three viewports (desktop/tablet/mobile), clicks each tab, waits for the content to activate, takes screenshots into ./test-screenshots.
- Scrolls the Bills tab to capture sticky header/table state.
- Fails if any console.error messages were emitted during the test.

Visual checks to perform manually:
- Open the screenshots in ./test-screenshots and confirm the header is sticky and tabs sit above the table header.
- Check mobile/tablet screenshots for overlapping or clipping.

Notes:
- The smoke test will create a ./test-screenshots directory (ensure write permission).
- Puppeteer downloads a Chromium binary during npm install; this can take time and bandwidth.
