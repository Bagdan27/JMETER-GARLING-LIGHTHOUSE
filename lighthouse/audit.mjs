import puppeteer from 'puppeteer';
import { startFlow } from 'lighthouse';
import fs from 'fs';

const APP_URL = 'http://localhost';
const VIEWPORT = { width: 1280, height: 800 };

const SELECTORS = {
  product: {
    addToCartButton: 'button.green-box.ic-design',
    viewCartLink: '.cart-added-info a, a[href*="/cart"]',
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

// simulate — единственный режим, дающий все CWV в timespan/navigate
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

async function runAudit() {
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
    name: 'E-commerce Order Flow — Full CWV',
    config: LH_CONFIG,
  });

  // ── 1. Homepage ──────────────────────────────────────────────────────────
  console.log('\n[1] Homepage...');
  await flow.navigate(APP_URL, { stepName: '1. Homepage' });
  console.log('✓ Done\n');
  await wait(1500);

  // ── 2. Tables page ───────────────────────────────────────────────────────
  console.log('[2] Tables page...');
  await flow.navigate(`${APP_URL}/tables`, { stepName: '2. Tables category' });
  console.log('✓ Done');

  let productLinks = await page.$$eval('a[href*="/products/"]', (els) => els.map((e) => e.href));
  if (!productLinks.length) {
    productLinks = await page.$$eval('.product-list a, .products a', (els) => els.map((e) => e.href));
  }
  if (!productLinks.length) throw new Error('No product links found on /tables');
  const productUrl = productLinks[Math.floor(Math.random() * productLinks.length)];
  console.log(`  → Product: ${productUrl}\n`);

  // ── 3. Product page ───────────────────────────────────────────────────────
  console.log('[3] Product page...');
  await flow.navigate(productUrl, { stepName: '3. Product detail page' });
  const title = await page.$eval('h1', (el) => el.textContent.trim()).catch(() => 'Unknown');
  console.log(`✓ "${title}"\n`);

  // ── 4. Add to cart (timespan) ─────────────────────────────────────────────
  console.log('[4] Add to cart (timespan)...');
  await flow.startTimespan({ stepName: '4. Add to cart' });
  try {
    await page.waitForSelector(SELECTORS.product.addToCartButton, { timeout: 10000 });
    await page.focus(SELECTORS.product.addToCartButton);
    await wait(200);
    await page.click(SELECTORS.product.addToCartButton);
    console.log('  → Clicked Add to Cart');
    await page.waitForFunction(
      () =>
        document.body.innerText.includes('Added') ||
        document.body.innerText.includes('added') ||
        !!document.querySelector('.cart-added-info') ||
        !!document.querySelector('a[href*="/cart"]'),
      { timeout: 10000 }
    );
    console.log('  → Confirmed');
    await wait(2500);
  } finally {
    await flow.endTimespan();
    console.log('✓ Done\n');
  }

  // ── 5. Cart page ──────────────────────────────────────────────────────────
  console.log('[5] Cart page...');
  const cartUrl = await page
    .$eval(SELECTORS.product.viewCartLink, (el) => el.href)
    .catch(() => `${APP_URL}/cart/`);
  await flow.navigate(cartUrl, { stepName: '5. Cart page' });
  await page.waitForFunction(
    () =>
      !!document.querySelector('input.to_cart_submit') ||
      !!document.querySelector('[name="cart_submit"]') ||
      document.body.innerText.toLowerCase().includes('cart'),
    { timeout: 10000 }
  );
  console.log('✓ Done\n');

  // ── 6. Checkout (navigate с кликом внутри) ────────────────────────────────
  // FIX: navigate() вместо timespan+snapshot — убирает дубли шагов в отчёте
  console.log('[6] Checkout page...');
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
  console.log('✓ Done\n');

  // ── 7. Fill form & submit (timespan) ─────────────────────────────────────
  console.log('[7] Fill form & submit (timespan)...');
  await flow.startTimespan({ stepName: '7. Fill form and place order' });
  try {
    await page.waitForSelector(SELECTORS.checkout.nameField, { timeout: 10000 });

    // focus → type → Tab: имитация реального пользователя, триггерит INP корректно
    const fillField = async (selector, value) => {
      await page.focus(selector);
      await wait(80);
      await page.type(selector, value, { delay: 40 });
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

    try {
      await page.select(SELECTORS.checkout.countrySelect, 'US');
    } catch (_) {
      console.log('  ⚠ Country selection skipped');
    }

    console.log('  → Fields filled');
    await wait(2000);

    await page.focus(SELECTORS.checkout.submitButton);
    await wait(100);
    await page.click(SELECTORS.checkout.submitButton);

    await page.waitForFunction(
      () => {
        const t = document.body.innerText;
        return (
          t.includes('Thank You') ||
          t.includes('Thank you') ||
          t.includes('thank you') ||
          !!document.querySelector('.success') ||
          !!document.querySelector('.order-complete')
        );
      },
      { timeout: 15000 }
    );
    console.log('  → Order confirmed');
    await wait(3000);
  } finally {
    await flow.endTimespan();
    console.log('✓ Done\n');
  }

  // ── 8. Final snapshot ─────────────────────────────────────────────────────
  console.log('[8] Order confirmation snapshot...');
  await flow.snapshot({ stepName: '8. Order confirmation' });
  console.log('✓ Done\n');

  // ── REPORT ────────────────────────────────────────────────────────────────
  console.log('Generating report...');
  const report = await flow.generateReport();
  fs.writeFileSync('flow-report.html', report);
  console.log('✓ flow-report.html saved');

  const flowResult = await flow.createFlowResult();
  const metrics = flowResult.steps.map((step) => {
    const audits = step.lhr?.audits ?? {};
    return {
      step:  step.name,
      mode:  step.lhr?.gatherMode,
      FCP:   audits['first-contentful-paint']?.numericValue,
      LCP:   audits['largest-contentful-paint']?.numericValue,
      CLS:   audits['cumulative-layout-shift']?.numericValue,
      TBT:   audits['total-blocking-time']?.numericValue,
      SI:    audits['speed-index']?.numericValue,
      TTI:   audits['interactive']?.numericValue,
      INP:   audits['interaction-to-next-paint']?.numericValue,
      score: step.lhr?.categories?.performance?.score,
    };
  });

  fs.writeFileSync('flow-metrics.json', JSON.stringify(metrics, null, 2));
  console.log('✓ flow-metrics.json saved\n');

  const fmt = (v, unit, div = 1) =>
    v != null ? `${(v / div).toFixed(unit === 's' ? 2 : unit === 'ms' ? 0 : 4)} ${unit}` : '—';

  console.log('═'.repeat(55));
  console.log('  METRICS SUMMARY');
  console.log('═'.repeat(55));
  for (const m of metrics) {
    console.log(`\n▸ [${m.mode}] ${m.step}`);
    console.log(`  FCP  ${fmt(m.FCP, 's', 1000)}   LCP  ${fmt(m.LCP, 's', 1000)}`);
    console.log(`  CLS  ${fmt(m.CLS, '')}   TBT  ${fmt(m.TBT, 'ms')}`);
    console.log(`  SI   ${fmt(m.SI, 's', 1000)}   TTI  ${fmt(m.TTI, 's', 1000)}`);
    console.log(`  INP  ${fmt(m.INP, 'ms')}`);
    if (m.score != null) console.log(`  Perf score: ${Math.round(m.score * 100)}/100`);
  }
  console.log('\n' + '═'.repeat(55));

  await browser.close();
  console.log('\n✅ Audit complete!');
}

runAudit().catch((err) => {
  console.error('\n❌ Audit failed:', err);
  process.exit(1);
});
