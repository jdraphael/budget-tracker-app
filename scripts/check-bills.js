const puppeteer = require('puppeteer');

(async () => {
  const url = process.env.TEST_URL || 'http://127.0.0.1:5500/';
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);

  try {
    // Capture console and page errors for debugging
    page.on('console', msg => console.log('[PAGE]', msg.type(), msg.text()));
    page.on('pageerror', err => console.error('[PAGEERROR]', err.message || String(err)));
    page.on('requestfailed', req => console.error('[REQFAILED]', req.url(), req.failure()?.errorText));
    page.on('response', res => {
      if (res.status() >= 400) console.error('[HTTP]', res.status(), res.url());
    });
    // Pre-set login to avoid modal before navigation
    await page.evaluateOnNewDocument(() => {
      try { localStorage.setItem('budgetAppUser', JSON.stringify({ user: 'check', pass: 'x' })); } catch {}
    });
    await page.goto(url, { waitUntil: 'networkidle2' });
    // Log basic signals
    const env = await page.evaluate(() => ({
      hasState: typeof window.state !== 'undefined',
      hasRenderBills: typeof window.renderBillsList === 'function',
      activeTab: window.state?.activeTab || null,
      tabs: Array.from(document.querySelectorAll('.tab')).map(t => t.getAttribute('data-tab')),
      billsSectionExists: !!document.getElementById('bills')
    }));
    console.log('[CHECK] Env:', env);
    // Wait for app state to exist then for data to load
    await page.waitForFunction(() => typeof window.state !== 'undefined');
    await page.waitForFunction(() => {
      const s = window.state;
      return s && s.data && Array.isArray(s.data.bills) && s.data.bills.length > 0;
    });
    const billsLen = await page.evaluate(() => window.state.data.bills.length);
    console.log('[CHECK] state.data.bills length:', billsLen);
    // Try to render Bills directly regardless of tab active state
    await page.evaluate(() => {
      try {
        if (typeof window.renderBillsList === 'function') {
          window.renderBillsList();
        }
      } catch {}
    });
    // Wait for table rows to exist
    await page.waitForSelector('#bills table tbody tr');

    // Save a screenshot for sanity
    try { await page.screenshot({ path: 'test-screenshots/check-bills.png', fullPage: false }); } catch {}

    const result = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('#bills table tbody tr'));
      const sample = rows.slice(0, 5).map(r => {
        const tds = r.querySelectorAll('td');
        return {
          id: r.getAttribute('data-id') || '',
          name: tds[0]?.textContent?.trim() || '',
          amount: tds[1]?.textContent?.trim() || ''
        };
      });
      return { rowCount: rows.length, sample };
    });

    console.log('[CHECK] Bills table row count:', result.rowCount);
    console.log('[CHECK] First rows:', result.sample);
    if (!result.rowCount) {
      console.error('No rows detected in Bills table');
      process.exit(2);
    }
  } catch (e) {
    console.error('Check failed:', e && e.message ? e.message : String(e));
    process.exit(2);
  } finally {
    await browser.close();
  }
  process.exit(0);
})();
