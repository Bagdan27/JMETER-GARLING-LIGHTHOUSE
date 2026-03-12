import puppeteer from 'puppeteer';
import { startFlow } from 'lighthouse';
import fs from 'fs';

const APP_URL          = process.env.APP_URL || 'http://localhost';
const TOTAL_RUNS       = parseInt(process.env.LIGHTHOUSE_RUNS || '1', 10);
const VIEWPORT         = { width: 1280, height: 800 };

const SELECTORS = {
  product: {
    addToCartButton: 'button.green-box.ic-design',
    viewCartLink:    '.cart-added-info a, a[href*="/cart"]',
  },
  cart: {
    checkoutButton: 'input.to_cart_submit, input[type="submit"][name="cart_submit"]',
  },
  checkout: {
    nameField:     '[name="cart_name"]',
    addressField:  '[name="cart_address"]',
    postalField:   '[name="cart_postal"]',
    cityField:     '[name="cart_city"]',
    stateField:    '[name="cart_state"]',
    phoneField:    '[name="cart_phone"]',
    emailField:    '[name="cart_email"]',
    countrySelect: '[name="cart_country"]',
    submitButton:  '[name="cart_submit"]',
  },
};

const LH_CONFIG = {
  extends: 'lighthouse:default',
  settings: {
    throttlingMethod: 'simulate',
    throttling: {
      rttMs: 40,
      throughputKbps: 10240,
      cpuSlowdownMultiplier: 1,
      requestLatencyMs: 0,
      downloadThroughputKbps: 0,
      uploadThroughputKbps: 0,
    },
    screenEmulation: {
      mobile: false,
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      deviceScaleFactor: 1,
      disabled: false,
    },
    formFactor: 'desktop',
    onlyCategories: ['performance'],
  },
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function runOnce(runIndex) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  RUN ${runIndex} of ${TOTAL_RUNS}  →  ${APP_URL}`);
  console.log(`${'═'.repeat(60)}\n`);

  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: VIEWPORT,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-background-networking',
      '--disable-extensions',
      '--disable-sync',
      '--no-first-run',
      '--metrics-recording-only',
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    ],
  });

  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);

  const flow = await startFlow(page, {
    name: `E-commerce Flow — Run ${runIndex}`,
    config: LH_CONFIG,
  });

  // 1. Homepage
  console.log('[1/8] Homepage...');
  await flow.navigate(APP_URL, { stepName: '1. Homepage' });
  await wait(1500);
  console.log('✓\n');

  // 2. Tables
  console.log('[2/8] Tables page...');
  await flow.navigate(`${APP_URL}/tables`, { stepName: '2. Tables category' });

  let productLinks = await page.$$eval('a[href*="/products/"]', els => els.map(e => e.href));
  if (!productLinks.length)
    productLinks = await page.$$eval('.product-list a, .products a', els => els.map(e => e.href));
  if (!productLinks.length) throw new Error('No product links on /tables');
  const productUrl = productLinks[Math.floor(Math.random() * productLinks.length)];
  console.log(`✓ → ${productUrl}\n`);

  // 3. Product page
  console.log('[3/8] Product page...');
  await flow.navigate(productUrl, { stepName: '3. Product detail page' });
  const title = await page.$eval('h1', el => el.textContent.trim()).catch(() => 'Unknown');
  console.log(`✓ "${title}"\n`);

  // 4. Add to cart (timespan — нет смены URL)
  console.log('[4/8] Add to cart...');
  await flow.startTimespan({ stepName: '4. Add to cart' });
  try {
    await page.waitForSelector(SELECTORS.product.addToCartButton, { timeout: 10000 });
    await page.focus(SELECTORS.product.addToCartButton);
    await wait(200);
    await page.click(SELECTORS.product.addToCartButton);
    await page.waitForFunction(
      () => document.body.innerText.includes('Added') ||
            document.body.innerText.includes('added') ||
            !!document.querySelector('.cart-added-info') ||
            !!document.querySelector('a[href*="/cart"]'),
      { timeout: 10000 }
    );
    await wait(2500); 
  } finally {
    await flow.endTimespan();
    console.log('✓\n');
  }

  // 5. Cart page
  console.log('[5/8] Cart page...');
  const cartUrl = await page.$eval(SELECTORS.product.viewCartLink, el => el.href)
    .catch(() => `${APP_URL}/cart/`);
  await flow.navigate(cartUrl, { stepName: '5. Cart page' });
  await page.waitForFunction(
    () => !!document.querySelector('input.to_cart_submit') ||
          !!document.querySelector('[name="cart_submit"]') ||
          document.body.innerText.toLowerCase().includes('cart'),
    { timeout: 10000 }
  );
  console.log('✓\n');

  // 6. Checkout page 
  console.log('[6/8] Checkout page...');
  await flow.navigate(
    async () => {
      const hasBtn = !!(await page.$(SELECTORS.cart.checkoutButton));
      if (hasBtn) {
        await page.focus(SELECTORS.cart.checkoutButton);
        await wait(100);
        await page.click(SELECTORS.cart.checkoutButton);
      } else {
        await page.evaluate(() => document.querySelector('form')?.submit());
      }
    },
    { stepName: '6. Checkout page' }
  );
  await wait(1500);
  console.log('✓\n');

  // 7. Fill form & submit (timespan)
  console.log('[7/8] Fill form & submit...');
  await flow.startTimespan({ stepName: '7. Fill form and submit order' });
  try {
    await page.waitForSelector(SELECTORS.checkout.nameField, { timeout: 10000 });

    const fillField = async (sel, val) => {
      await page.focus(sel);
      await wait(80);
      await page.type(sel, val, { delay: 40 });
      await page.keyboard.press('Tab');
      await wait(120);
    };

    await fillField(SELECTORS.checkout.nameField,    'Test User');
    await fillField(SELECTORS.checkout.addressField, 'Test Street 123');
    await fillField(SELECTORS.checkout.postalField,  '12345');
    await fillField(SELECTORS.checkout.cityField,    'Madrid');
    await fillField(SELECTORS.checkout.stateField,   'Madrid');
    await fillField(SELECTORS.checkout.phoneField,   '999999999');
    await fillField(SELECTORS.checkout.emailField,   'test@test.com');

    try { await page.select(SELECTORS.checkout.countrySelect, 'US'); } catch (_) {}

    await wait(2000);

    await page.focus(SELECTORS.checkout.submitButton);
    await wait(100);
    await page.click(SELECTORS.checkout.submitButton);

    await page.waitForFunction(
      () => {
        const t = document.body.innerText;
        return t.includes('Thank You') || t.includes('Thank you') || t.includes('thank you') ||
               !!document.querySelector('.success') || !!document.querySelector('.order-complete');
      },
      { timeout: 15000 }
    );
    await wait(3000); 
  } finally {
    await flow.endTimespan();
    console.log('✓\n');
  }

  // 8. Confirmation snapshot
  console.log('[8/8] Order confirmation snapshot...');
  await flow.snapshot({ stepName: '8. Order confirmation' });
  console.log('✓\n');

  const runReport = await flow.generateReport();
  const runReportFile = `flow-report-run${runIndex}.html`;
  fs.writeFileSync(runReportFile, runReport);
  console.log(`✓ Saved: ${runReportFile}`);

  const flowResult = await flow.createFlowResult();
  
  const jsonReportFile = `flow-report-run${runIndex}.json`;
  fs.writeFileSync(jsonReportFile, JSON.stringify(flowResult, null, 2));
  console.log(`✓ Saved JSON: ${jsonReportFile}`);

  const metrics = flowResult.steps.map(step => {
    const a = step.lhr?.audits ?? {};
    return {
      step:  step.name,
      mode:  step.lhr?.gatherMode,
      score: step.lhr?.categories?.performance?.score ?? null,
      FCP:   a['first-contentful-paint']?.numericValue   ?? null,
      LCP:   a['largest-contentful-paint']?.numericValue ?? null,
      CLS:   a['cumulative-layout-shift']?.numericValue  ?? null,
      TBT:   a['total-blocking-time']?.numericValue      ?? null,
      SI:    a['speed-index']?.numericValue              ?? null,
      TTI:   a['interactive']?.numericValue              ?? null,
      INP:   a['interaction-to-next-paint']?.numericValue ?? null,
    };
  });

  await browser.close();
  return { runIndex, metrics, reportFile: runReportFile };
}

function printSummary(allRuns) {
  const fmt = (v, unit, div = 1) =>
    v != null ? `${(v / div).toFixed(unit === 's' ? 2 : unit === 'ms' ? 0 : 4)}${unit}` : '—';

  console.log(`\n${'═'.repeat(70)}`);
  console.log('  SUMMARY — ALL RUNS');
  console.log(`${'═'.repeat(70)}`);

  const stepNames = allRuns[0].metrics.map(m => m.step);
  for (const stepName of stepNames) {
    console.log(`\n  ▸ ${stepName}`);
    console.log(`  ${'─'.repeat(60)}`);

    const header = '  ' + 'Run'.padEnd(6) + 'Score'.padEnd(8) +
      'FCP'.padEnd(8) + 'LCP'.padEnd(8) + 'CLS'.padEnd(8) +
      'TBT'.padEnd(8) + 'SI'.padEnd(8) + 'TTI'.padEnd(8) + 'INP'.padEnd(8);
    console.log(header);

    for (const run of allRuns) {
      const m = run.metrics.find(s => s.step === stepName);
      if (!m) continue;
      const row = `  Run${run.runIndex}`.padEnd(8) +
        (m.score != null ? `${Math.round(m.score*100)}/100` : '—').padEnd(8) +
        fmt(m.FCP, 's', 1000).padEnd(8) +
        fmt(m.LCP, 's', 1000).padEnd(8) +
        fmt(m.CLS, '').padEnd(8) +
        fmt(m.TBT, 'ms').padEnd(8) +
        fmt(m.SI,  's', 1000).padEnd(8) +
        fmt(m.TTI, 's', 1000).padEnd(8) +
        fmt(m.INP, 'ms').padEnd(8);
      console.log(row);
    }
  }
  console.log(`\n${'═'.repeat(70)}\n`);
}

function generateSummaryHtml(allRuns) {
  const runTabs = allRuns.map((r, i) =>
    `<button class="tab${i === 0 ? ' active' : ''}" onclick="show(${i})"
      title="${r.reportFile}">Run ${r.runIndex}</button>`
  ).join('\n    ');

  const iframes = allRuns.map((r, i) =>
    `<iframe id="frame${i}" src="${r.reportFile}" class="frame${i === 0 ? ' visible' : ''}"></iframe>`
  ).join('\n    ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Lighthouse — ${TOTAL_RUNS} Runs</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: #0f1117; color: #e2e8f0; height: 100vh; display: flex; flex-direction: column; }
  .bar { display: flex; align-items: center; gap: 8px; padding: 10px 16px; background: #181c27; border-bottom: 1px solid #2a2f45; flex-shrink: 0; }
  .bar h1 { font-size: 14px; font-weight: 600; color: #a5b4fc; margin-right: 12px; }
  .tab {
    padding: 6px 18px; border-radius: 6px; border: 1px solid #2a2f45;
    background: #1e2333; color: #94a3b8; cursor: pointer; font-size: 13px; font-weight: 500;
    transition: all .15s;
  }
  .tab:hover { background: #2a2f45; color: #e2e8f0; }
  .tab.active { background: #4f46e5; border-color: #4f46e5; color: #fff; }
  .meta { margin-left: auto; font-size: 11px; color: #475569; }
  .frame-wrap { flex: 1; position: relative; }
  iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: none; display: none; }
  iframe.visible { display: block; }
</style>
</head>
<body>
<div class="bar">
  <h1>⚡ Lighthouse Flow</h1>
  ${runTabs}
  <span class="meta">${new Date().toLocaleString()} · ${APP_URL}</span>
</div>
<div class="frame-wrap">
  ${iframes}
</div>
<script>
  function show(idx) {
    document.querySelectorAll('iframe').forEach((f, i) => f.classList.toggle('visible', i === idx));
    document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', i === idx));
  }
</script>
</body>
</html>`;
}

async function main() {
  console.log(`\nLighthouse Flow Audit`);
  console.log(`APP_URL: ${APP_URL}`);
  console.log(`Runs:    ${TOTAL_RUNS}\n`);

  const allRuns = [];

  for (let i = 1; i <= TOTAL_RUNS; i++) {
    try {
      const result = await runOnce(i);
      allRuns.push(result);
    } catch (err) {
      console.error(`\n❌ Run ${i} failed: ${err.message}`);
    }
  }

  if (!allRuns.length) {
    console.error('All runs failed. Exiting.');
    process.exit(1);
  }

  const summaryHtml = generateSummaryHtml(allRuns);
  fs.writeFileSync('flow-report.html', summaryHtml);
  console.log('\n✓ flow-report.html (summary with tabs) saved');

  printSummary(allRuns);

  console.log('✅ Done');
}

main().catch(err => {
  console.error('\n❌ Fatal:', err);
  process.exit(1);
});
