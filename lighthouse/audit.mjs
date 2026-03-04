import puppeteer from 'puppeteer';
import { startFlow } from 'lighthouse';
import fs from 'fs';

// ─────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────
const APP_URL = 'http://localhost';
const VIEWPORT = { width: 1280, height: 800 };

const LIGHTHOUSE_CONFIG = {
  settingsOverrides: {
    throttlingMethod: 'devtools',
    screenEmulation: {
      mobile: false,
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      disabled: false,
    },
    formFactor: 'desktop',
  },
};

// ─────────────────────────────────────────────
//  SELECTORS
// ─────────────────────────────────────────────
const SEL = {
  product: {
    addToCartBtn:  'button.green-box.ic-design',
    cartAddedInfo: '.cart-added-info',
    cartLink:      '.cart-added-info a, a[href*="/cart"]',
  },
  cart: {
    checkoutBtn: 'input.to_cart_submit, input[type="submit"][name="cart_submit"]',
  },
  checkout: {
    name:    '[name="cart_name"]',
    address: '[name="cart_address"]',
    postal:  '[name="cart_postal"]',
    city:    '[name="cart_city"]',
    state:   '[name="cart_state"]',
    phone:   '[name="cart_phone"]',
    email:   '[name="cart_email"]',
    country: '[name="cart_country"]',
    submit:  '[name="cart_submit"]',
  },
};

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function safeClick(page, selector) {
  await page.waitForSelector(selector, { timeout: 10_000 });
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    el?.scrollIntoView({ block: 'center' });
    el?.click();
  }, selector);
}

async function screenshot(page, name) {
  await page.screenshot({ path: `debug-${name}.png` });
  console.log(`  📸 saved debug-${name}.png`);
}

// ─────────────────────────────────────────────
//  PICK A RANDOM PRODUCT FROM A CATEGORY PAGE
// ─────────────────────────────────────────────
async function pickRandomProductUrl(page, categoryPath) {
  await page.goto(`${APP_URL}${categoryPath}`, { waitUntil: 'domcontentloaded' });
  await delay(1_000);

  const links = await page.$$eval(
    'a[href*="/products/"]',
    (els) => els.map((el) => el.href),
  );

  if (!links.length) throw new Error(`No product links found on ${categoryPath}`);

  return links[Math.floor(Math.random() * links.length)];
}

// ─────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────
async function runAudit() {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: VIEWPORT,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  );

  const flow = await startFlow(page, {
    name: 'E-commerce Order Flow',
    configContext: LIGHTHOUSE_CONFIG,
  });

  // ── STEP 1 ── Homepage (full navigation → LCP, CLS, TBT, FCP, SI)
  console.log('\n▶ Step 1 — Homepage');
  await flow.navigate(APP_URL, { stepName: '1. Homepage' });
  console.log('  ✓ done\n');

  await delay(1_000);

  // ── STEP 2 ── Tables category page (full navigation → complete metrics)
  console.log('▶ Step 2 — Tables category page');
  const productUrl = await pickRandomProductUrl(page, '/tables');
  await flow.navigate(`${APP_URL}/tables`, { stepName: '2. Tables category page' });
  console.log('  ✓ done\n');

  await delay(800);

  // ── STEP 3 ── Product detail page (full navigation → complete metrics)
  console.log(`▶ Step 3 — Product page: ${productUrl}`);
  await flow.navigate(productUrl, { stepName: '3. Product detail page' });
  console.log('  ✓ done\n');

  await delay(800);

  // ── STEP 4 ── Add to cart (timespan — pure interaction, no page load)
  //             CLS is measured here during the UI state change
  console.log('▶ Step 4 — Add product to cart');
  await flow.startTimespan({ stepName: '4. Add to cart interaction' });
  try {
    await safeClick(page, SEL.product.addToCartBtn);
    console.log('  clicked "Add to Cart"');

    await page.waitForFunction(
      () =>
        document.body.innerText.includes('Added') ||
        document.body.innerText.includes('added') ||
        !!document.querySelector('.cart-added-info') ||
        !!document.querySelector('a[href*="/cart"]'),
      { timeout: 10_000 },
    );

    console.log('  ✓ item in cart');
    await delay(1_200);
  } catch (err) {
    await screenshot(page, 'add-to-cart');
    throw err;
  } finally {
    await flow.endTimespan();
    console.log('  timespan ended\n');
  }

  // ── STEP 5 ── Cart page (full navigation → complete metrics)
  console.log('▶ Step 5 — Cart page');
  try {
    const cartUrl = await page
      .$eval(SEL.product.cartLink, (el) => el.href)
      .catch(() => `${APP_URL}/cart/`);

    await flow.navigate(cartUrl, { stepName: '5. Cart page' });
    console.log('  ✓ done\n');
  } catch (err) {
    await screenshot(page, 'cart');
    throw err;
  }

  await delay(800);

  // ── STEP 6 ── Checkout page (full navigation → complete metrics)
  console.log('▶ Step 6 — Checkout page');
  try {
    await safeClick(page, SEL.cart.checkoutBtn);
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10_000 });
    await page.waitForSelector(SEL.checkout.name, { timeout: 10_000 });

    // Snapshot after navigation so Lighthouse captures the loaded checkout page
    await flow.snapshot({ stepName: '6. Checkout page loaded' });
    console.log('  ✓ done\n');
  } catch (err) {
    await screenshot(page, 'checkout');
    throw err;
  }

  // ── STEP 7 ── Fill & submit form (timespan — interaction + CLS on form)
  console.log('▶ Step 7 — Fill checkout form & submit order');
  await flow.startTimespan({ stepName: '7. Form fill & order submission' });
  try {
    await page.evaluate((s) => {
      document.querySelector(s.name).value    = 'Test User';
      document.querySelector(s.address).value = 'Test Street 123';
      document.querySelector(s.postal).value  = '12345';
      document.querySelector(s.city).value    = 'Madrid';
      document.querySelector(s.state).value   = 'Madrid';
      document.querySelector(s.phone).value   = '999999999';
      document.querySelector(s.email).value   = 'test@test.com';
    }, SEL.checkout);

    try {
      await page.select(SEL.checkout.country, 'US');
    } catch {
      console.log('  ⚠ country select skipped');
    }

    console.log('  all fields filled');
    await delay(1_500);

    await safeClick(page, SEL.checkout.submit);

    await page.waitForFunction(
      () =>
        ['Thank You', 'thank you', 'Thank you'].some((t) =>
          document.body.innerText.includes(t),
        ) ||
        !!document.querySelector('.success, .order-complete'),
      { timeout: 15_000 },
    );

    console.log('  ✓ order submitted');
    await delay(1_000);
  } catch (err) {
    await screenshot(page, 'submit');
    throw err;
  } finally {
    await flow.endTimespan();
    console.log('  timespan ended\n');
  }

  // ── STEP 8 ── Thank-you / confirmation page (full navigation snapshot)
  //             Captures final page state with complete metric set
  console.log('▶ Step 8 — Order confirmation page');
  await flow.snapshot({ stepName: '8. Order confirmation page' });
  console.log('  ✓ snapshot done\n');

  // ── REPORT ──
  console.log('📄 Generating report…');
  const report = await flow.generateReport();
  const reportPath = 'flow-report.html';
  fs.writeFileSync(reportPath, report);
  console.log(`  ✓ Report saved → ${reportPath}\n`);

  await browser.close();
  console.log('🎉 All done!\n');
}

// ─────────────────────────────────────────────
runAudit().catch((err) => {
  console.error('\n❌ Audit failed:', err);
  process.exit(1);
});
