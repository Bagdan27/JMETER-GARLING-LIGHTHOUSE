import puppeteer from 'puppeteer';
import { startFlow } from 'lighthouse';
import fs from 'fs';

const APP_URL = 'http://localhost';
const VIEWPORT = { width: 1280, height: 800 };

// ─── SELECTORS ────────────────────────────────────────────────────────────────
const SELECTORS = {
  product: {
    title: 'h1',
    addToCartButton: 'button.green-box.ic-design',
    cartAddedInfo: '.cart-added-info',
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

// ─── LIGHTHOUSE CONFIG ────────────────────────────────────────────────────────
// KEY FIX: используем simulate-throttling вместо devtools,
// добавляем полный набор аудитов включая CLS, LCP, INP, TBT, FCP, SI
const LH_CONFIG = {
  extends: 'lighthouse:default',
  settings: {
    // 'simulate' — единственный метод, который гарантирует все CWV в timespan
    throttlingMethod: 'simulate',
    throttling: {
      rttMs: 40,
      throughputKbps: 10_240,
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
    // Явно перечисляем нужные категории
    onlyCategories: ['performance'],
    // Включаем все ключевые аудиты
    skipAudits: [],
  },
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function safeFindProductLink(page) {
  // Ищем ссылки на продукты несколькими способами
  let links = await page.$$eval('a[href*="/products/"]', (els) =>
    els.map((el) => el.href).filter(Boolean)
  );
  if (!links.length) {
    links = await page.$$eval('.product-list a, .products a, .product a', (els) =>
      els.map((el) => el.href).filter(Boolean)
    );
  }
  return links;
}

// ─── MAIN AUDIT ───────────────────────────────────────────────────────────────
async function runAudit() {
  // KEY FIX: Добавляем флаги необходимые Lighthouse для корректной работы
  const browser = await puppeteer.launch({
    headless: true, // KEY FIX: headless:true обязателен для корректного сбора LCP/CLS
    defaultViewport: VIEWPORT,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      // KEY FIX: отключаем сохранение состояния между навигациями — важно для CLS
      '--disable-background-networking',
      '--disable-client-side-phishing-detection',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-hang-monitor',
      '--disable-popup-blocking',
      '--disable-prompt-on-repost',
      '--disable-sync',
      '--disable-translate',
      '--metrics-recording-only',
      '--no-first-run',
      '--safebrowsing-disable-auto-update',
      '--password-store=basic',
      '--use-mock-keychain',
      // Разрешаем Lighthouse инжектировать скрипты
      '--disable-blink-features=AutomationControlled',
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    ],
  });

  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);

  // KEY FIX: startFlow принимает конфиг как третий аргумент
  const flow = await startFlow(page, {
    name: 'E-commerce Order Flow — Full CWV',
    config: LH_CONFIG,
  });

  // ── STEP 1: Homepage navigation (полный navigate = LCP + CLS + FCP + SI) ──
  console.log('\n[1/7] Homepage — full navigation audit...');
  await flow.navigate(APP_URL, {
    stepName: '1. Homepage (initial load)',
  });
  console.log('✓ Homepage loaded\n');

  await wait(2000);

  // ── STEP 2: Tables page navigation ─────────────────────────────────────────
  console.log('[2/7] Tables page — navigation audit...');
  // KEY FIX: navigate() вместо startTimespan() для страниц с новой навигацией
  // navigate() корректно измеряет LCP, CLS, FCP, TTI, TBT для каждой страницы
  await flow.navigate(`${APP_URL}/tables`, {
    stepName: '2. Tables category page',
  });
  console.log('✓ Tables page loaded');

  // Выбираем случайный продукт
  const productLinks = await safeFindProductLink(page);
  if (!productLinks.length) {
    throw new Error('No product links found on /tables page');
  }
  const productUrl = productLinks[Math.floor(Math.random() * productLinks.length)];
  console.log(`  → Selected product: ${productUrl}\n`);

  // ── STEP 3: Product page navigation ────────────────────────────────────────
  console.log('[3/7] Product page — navigation audit...');
  await flow.navigate(productUrl, {
    stepName: '3. Product detail page',
  });
  const productTitle = await page.$eval('h1', (el) => el.textContent.trim()).catch(() => 'Unknown');
  console.log(`✓ Product page: "${productTitle}"\n`);

  // ── STEP 4: Add to cart (timespan — взаимодействие без новой навигации) ────
  console.log('[4/7] Add to cart — timespan (CLS/INP измеряются корректно)...');
  // KEY FIX: timespan используем ТОЛЬКО для взаимодействий без перехода на новую страницу
  await flow.startTimespan({ stepName: '4. Add product to cart (interaction)' });

  try {
    await page.waitForSelector(SELECTORS.product.addToCartButton, { timeout: 10_000 });
    await page.evaluate((sel) => {
      const btn = document.querySelector(sel);
      btn?.scrollIntoView({ block: 'center' });
    }, SELECTORS.product.addToCartButton);
    await wait(300);

    await page.click(SELECTORS.product.addToCartButton);
    console.log('  → Clicked "Add to Cart"');

    // Ждём подтверждения добавления
    await page.waitForFunction(
      () =>
        document.body.innerText.includes('Added') ||
        document.body.innerText.includes('added') ||
        !!document.querySelector('.cart-added-info') ||
        !!document.querySelector('a[href*="/cart"]'),
      { timeout: 10_000 }
    );
    console.log('  → Cart confirmation received');
    // KEY FIX: даём время накопиться CLS после DOM-изменений
    await wait(2000);
  } finally {
    await flow.endTimespan();
    console.log('✓ Add-to-cart timespan ended\n');
  }

  // ── STEP 5: Cart page navigation ───────────────────────────────────────────
  console.log('[5/7] Cart page — navigation audit...');
  // Определяем URL корзины
  const cartUrl = await page
    .$eval(SELECTORS.product.viewCartLink, (el) => el.href)
    .catch(() => `${APP_URL}/cart/`);

  await flow.navigate(cartUrl, {
    stepName: '5. Cart page',
  });
  await page.waitForFunction(
    () =>
      !!document.querySelector('input.to_cart_submit') ||
      !!document.querySelector('[name="cart_submit"]') ||
      document.body.innerText.toLowerCase().includes('cart'),
    { timeout: 10_000 }
  );
  console.log('✓ Cart page loaded\n');

  // ── STEP 6: Checkout page navigation ───────────────────────────────────────
  console.log('[6/7] Checkout — navigation audit...');
  // Кликаем «Оформить заказ» и ловим навигацию
  await flow.startTimespan({ stepName: '6. Proceed to checkout (click)' });
  try {
    const hasCheckoutBtn = !!(await page.$(SELECTORS.cart.checkoutButton));
    if (hasCheckoutBtn) {
      await page.evaluate((sel) => {
        const btn = document.querySelector(sel);
        btn?.scrollIntoView({ block: 'center' });
        btn?.click();
      }, SELECTORS.cart.checkoutButton);
    } else {
      await page.evaluate(() => document.querySelector('form')?.submit());
    }
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15_000 });
    await wait(1500);
  } finally {
    await flow.endTimespan();
  }

  // KEY FIX: снапшот страницы чекаута — измеряет CLS в статическом состоянии
  await flow.snapshot({ stepName: '6b. Checkout page snapshot' });
  console.log('✓ Checkout page snapshotted\n');

  // ── STEP 7: Fill form & submit (timespan) ──────────────────────────────────
  console.log('[7/7] Fill form & submit order — timespan...');
  await flow.startTimespan({ stepName: '7. Fill checkout form & submit order' });

  try {
    await page.waitForSelector(SELECTORS.checkout.nameField, { timeout: 10_000 });

    // KEY FIX: используем page.type() вместо прямого .value =
    // чтобы триггерить нативные события (input/change), нужные для CLS/INP
    await page.type(SELECTORS.checkout.nameField,    'Test User',       { delay: 30 });
    await page.type(SELECTORS.checkout.addressField, 'Test Street 123', { delay: 30 });
    await page.type(SELECTORS.checkout.postalField,  '12345',           { delay: 30 });
    await page.type(SELECTORS.checkout.cityField,    'Madrid',          { delay: 30 });
    await page.type(SELECTORS.checkout.stateField,   'Madrid',          { delay: 30 });
    await page.type(SELECTORS.checkout.phoneField,   '999999999',       { delay: 30 });
    await page.type(SELECTORS.checkout.emailField,   'test@test.com',   { delay: 30 });

    try {
      await page.select(SELECTORS.checkout.countrySelect, 'US');
    } catch (_) {
      console.log('  ⚠ Country selection skipped');
    }

    console.log('  → All fields filled');
    await wait(2000); // даём время CLS накопиться после заполнения формы

    await page.evaluate((sel) => {
      document.querySelector(sel)?.click();
    }, SELECTORS.checkout.submitButton);

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
      { timeout: 15_000 }
    );
    console.log('  → Order confirmed (Thank You page)');
    // KEY FIX: ждём полного завершения layout shifts после загрузки страницы
    await wait(3000);
  } finally {
    await flow.endTimespan();
    console.log('✓ Checkout timespan ended\n');
  }

  // ── STEP 8: Final snapshot ─────────────────────────────────────────────────
  console.log('[8/8] Order confirmation — final snapshot...');
  await flow.snapshot({ stepName: '8. Order confirmation page' });
  console.log('✓ Final snapshot captured\n');

  // ── GENERATE REPORT ────────────────────────────────────────────────────────
  console.log('Generating Lighthouse report...');
  const report = await flow.generateReport();
  const reportPath = 'flow-report.html';
  fs.writeFileSync(reportPath, report);
  console.log(`✓ Report saved → ${reportPath}`);

  // KEY FIX: дополнительно сохраняем JSON с сырыми метриками для анализа
  const flowResult = await flow.createFlowResult();
  const metricsPath = 'flow-metrics.json';

  const metrics = flowResult.steps.map((step) => {
    const lhr = step.lhr;
    const audits = lhr?.audits ?? {};
    return {
      step: step.name,
      mode: lhr?.gatherMode,
      metrics: {
        FCP:  audits['first-contentful-paint']?.numericValue,
        LCP:  audits['largest-contentful-paint']?.numericValue,
        CLS:  audits['cumulative-layout-shift']?.numericValue,
        TBT:  audits['total-blocking-time']?.numericValue,
        SI:   audits['speed-index']?.numericValue,
        TTI:  audits['interactive']?.numericValue,
        INP:  audits['interaction-to-next-paint']?.numericValue,
      },
      scores: {
        performance: lhr?.categories?.performance?.score,
      },
    };
  });

  fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2));
  console.log(`✓ Raw metrics saved → ${metricsPath}\n`);

  // Печатаем сводку в консоль
  console.log('═══════════════════════════════════════════════');
  console.log('              METRICS SUMMARY');
  console.log('═══════════════════════════════════════════════');
  for (const s of metrics) {
    console.log(`\n▸ ${s.step} [${s.mode}]`);
    const m = s.metrics;
    if (m.FCP  != null) console.log(`  FCP : ${(m.FCP  / 1000).toFixed(2)} s`);
    if (m.LCP  != null) console.log(`  LCP : ${(m.LCP  / 1000).toFixed(2)} s`);
    if (m.CLS  != null) console.log(`  CLS : ${m.CLS.toFixed(4)}`);
    if (m.TBT  != null) console.log(`  TBT : ${m.TBT.toFixed(0)} ms`);
    if (m.SI   != null) console.log(`  SI  : ${(m.SI   / 1000).toFixed(2)} s`);
    if (m.TTI  != null) console.log(`  TTI : ${(m.TTI  / 1000).toFixed(2)} s`);
    if (m.INP  != null) console.log(`  INP : ${m.INP.toFixed(0)} ms`);
    if (s.scores.performance != null)
      console.log(`  Perf score: ${Math.round(s.scores.performance * 100)}/100`);
  }
  console.log('\n═══════════════════════════════════════════════');

  await browser.close();
  console.log('\n✅ Audit complete!');
}

runAudit().catch((err) => {
  console.error('\n❌ Audit failed:', err);
  process.exit(1);
});
