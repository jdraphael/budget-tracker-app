// smoke-test.js
// Headless smoke test using Puppeteer
// Navigates between tabs, captures console errors, and takes screenshots at several viewports.

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const URL = process.env.TEST_URL || 'http://127.0.0.1:5500/public/index.html';
const viewports = [
  { name: 'desktop', width: 1366, height: 900 },
  { name: 'tablet', width: 900, height: 800 },
  { name: 'mobile', width: 412, height: 915 },
];

const OUT_DIR = path.resolve(process.cwd(), 'test-screenshots');

function ts() {
  return new Date().toISOString();
}

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(ts(), 'Created directory', OUT_DIR);
}

(async () => {
  console.log(ts(), 'Launching Puppeteer');
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  const consoleErrors = [];
  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error') {
      consoleErrors.push({ text, location: msg.location() });
      console.error(ts(), '[PAGE ERROR]', text);
    } else {
      console.log(ts(), '[PAGE]', text);
    }
  });

  for (const vp of viewports) {
    console.log(`\n${ts()} --- Testing viewport: ${vp.name} (${vp.width}x${vp.height})`);
    await page.setViewport({ width: vp.width, height: vp.height });
    try {
      await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
    } catch (err) {
      console.warn(ts(), 'Page load failed or timed out:', err.message);
    }

    await page.waitForTimeout(1000); // let any layout JS run

    // Ensure tabs exist
    let tabs = [];
    try {
      tabs = await page.$$eval('.tab', els => els.map(e => e.getAttribute('data-tab')));
    } catch (err) {
      console.warn(ts(), 'Error querying tabs:', err.message);
    }
    console.log(ts(), 'Found tabs:', tabs);

    for (const tab of tabs) {
      console.log(ts(), `Clicking tab: ${tab}`);
      try {
        await page.evaluate(t => {
          const el = document.querySelector(`.tab[data-tab="${t}"]`);
          if (el) el.click();
        }, tab);
      } catch (err) {
        console.warn(ts(), `Error clicking tab ${tab}:`, err.message);
      }

      // Wait for the tab-content to become active but don't hang forever
      try {
        await page.waitForSelector(`#${tab}.active`, { timeout: 8000 });
      } catch (e) {
        console.warn(ts(), `Tab content #${tab} did not become active within timeout`);
      }

      // Small pause, then screenshot
      await page.waitForTimeout(500);
      const screenshotPath = path.join(OUT_DIR, `${vp.name}-${tab}.png`);
      try {
        await page.screenshot({ path: screenshotPath, fullPage: false });
        console.log(ts(), 'Saved screenshot:', screenshotPath);
      } catch (err) {
        console.warn(ts(), 'Failed to save screenshot:', err.message);
      }
    }

    // Scroll to the bills table area to test sticky header behavior (if bills tab exists)
    try {
      const billsExists = await page.$('.tab[data-tab="bills"]');
        if (billsExists) {
        await page.evaluate(() => document.querySelector('.tab[data-tab="bills"]').click());
        try {
          await page.waitForSelector('#bills.active', { timeout: 5000 });
        } catch (e) {}
        await page.waitForTimeout(500);
        await page.evaluate(() => window.scrollTo({ top: 800, behavior: 'auto' }));
        await page.waitForTimeout(500);
        const stickyShot = path.join(OUT_DIR, `${vp.name}-bills-scrolled.png`);
        try {
          await page.screenshot({ path: stickyShot, fullPage: false });
          console.log(ts(), 'Saved sticky screenshot:', stickyShot);
        } catch (err) {
          console.warn(ts(), 'Failed to save sticky screenshot:', err.message);
        }

        // Visual assertion: thead must appear below the tabs
        try {
          // Robust wait + retry for table/thead presence and stable layout
          let ok = null;
          const maxAttempts = 4;
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            // small backoff between attempts
            await page.waitForTimeout(250 * attempt);
            // try to detect thead exists and is rendered
            const theadExists = await page.evaluate(() => !!document.querySelector('#bills table thead'));
            if (!theadExists) {
              if (attempt === maxAttempts) break; // will be handled below
              continue;
            }

            // compute bounding rects in page context
            ok = await page.evaluate(() => {
              const tabs = document.querySelector('.tabs');
              const table = document.querySelector('#bills table');
              const thead = table ? table.querySelector('thead') : null;
              if (!tabs || !table || !thead) return { ok: false, reason: 'missing-elements' };
              const tabsRect = tabs.getBoundingClientRect();
              const theadRect = thead.getBoundingClientRect();
              // allow 2px tolerance
              const passes = theadRect.top >= (tabsRect.bottom - 2);
              return { ok: passes, tabsBottom: tabsRect.bottom, theadTop: theadRect.top };
            });

            if (ok && ok.ok) {
              console.log(ts(), 'Visual assertion passed: thead below tabs', ok);
              break;
            }

            // if not passed and not last attempt, let layout settle and retry
            if (attempt === maxAttempts) break;
          }

          if (!ok || !ok.ok) {
            // Persistent failure: capture a DOM snapshot of the bills section to help debugging
            let domSnapshot = '<missing>';
            try {
              domSnapshot = await page.evaluate(() => {
                const el = document.querySelector('#bills');
                return el ? el.outerHTML : '<missing>'; 
              });
              const dumpPath = path.join(OUT_DIR, `${vp.name}-bills-dom.html`);
              fs.writeFileSync(dumpPath, domSnapshot, 'utf8');
              console.error(ts(), 'VISUAL ASSERTION FAILED: thead is not below tabs', ok || { ok: false, reason: 'missing-elements' });
              console.error(ts(), 'See screenshot:', stickyShot);
              console.error(ts(), 'DOM snapshot written to:', dumpPath);
              consoleErrors.push({ text: 'VISUAL_ASSERTION_FAILED: thead-not-below-tabs', detail: ok || { ok: false, reason: 'missing-elements' }, dom: dumpPath });
            } catch (e) {
              console.error(ts(), 'VISUAL ASSERTION FAILED and failed to write DOM snapshot:', e && e.message ? e.message : String(e));
              consoleErrors.push({ text: 'VISUAL_ASSERTION_FAILED: thead-not-below-tabs', detail: ok || { ok: false, reason: 'missing-elements' } });
            }
          }
        } catch (err) {
          console.warn(ts(), 'Error during visual assertion:', err && err.message ? err.message : String(err));
        }
      }
    } catch (err) {
      console.warn(ts(), 'Error while capturing bills sticky screenshot:', err.message);
    }
  }

  await browser.close();

  if (consoleErrors.length) {
    console.error('\nSMOKE TEST FAILED: Console errors detected:', consoleErrors.length);
    console.error('Sample error:', consoleErrors[0]);
    process.exit(2);
  }
  console.log('\nSMOKE TEST PASSED: No console errors detected.');
  process.exit(0);
})();
