import puppeteer from 'puppeteer';
import { startFlow } from 'lighthouse';
import fs from 'fs';

const APP_URL = 'http://localhost'; 
const VIEWPORT = { width: 1280, height: 800 };


const SELECTORS = {
  product: {
    title: 'h1',
    addToCartButton: 'button.green-box.ic-design',
    productIdInput: 'input[name="current_product"]',
    cartAddedInfo: '.cart-added-info',
    viewCartLink: '.cart-added-info a, a[href*="/cart"]'
  },
  
  cart: {
    checkoutButton: 'input.to_cart_submit, input[type="submit"][name="cart_submit"]',
    cartItems: '.cart-item, .product-item'
  },
  
  checkout: {
    nameField: '[name="cart_name"]',
    addressField: '[name="cart_address"]',
    postalField: '[name="cart_postal"]',
    cityField: '[name="cart_city"]',
    stateField: '[name="cart_state"]',
    phoneField: '[name="cart_phone"]',
    emailField: '[name="cart_email"]',
    countrySelect: '[name="cart_country"]',
    submitButton: '[name="cart_submit"]'
  }
};

async function runAudit() {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: VIEWPORT,
    args: ['--disable-blink-features=AutomationControlled']
  });
  
  const page = await browser.newPage();
  
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  const flow = await startFlow(page, {
    name: 'E-commerce Order Flow',
    configContext: {
      settingsOverrides: {
        throttlingMethod: 'devtools', 
        screenEmulation: { mobile: false, width: 1280, height: 800, deviceScaleFactor: 1, disabled: false },
        formFactor: 'desktop',
      },
    },
  });

  console.log('Start\n');
  console.log('Opening application homepage...');
  await flow.navigate(APP_URL, {
    stepName: '1. Initial page load'
  });
  console.log('Homepage loaded\n');

  await new Promise(resolve => setTimeout(resolve, 2000));


  console.log(' Navigating to Tables category');
  await flow.startTimespan({ stepName: '2. Navigate to Tables category and select product' });
  
  try {
    console.log('Opening /tables page...');
    await page.goto(`${APP_URL}/tables`, { waitUntil: 'domcontentloaded' });
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    await page.waitForSelector('body', { timeout: 5000 });
    
    let productLinks = await page.$$('a[href*="/products/"]');
    
    if (productLinks.length > 0) {
      const randomIndex = Math.floor(Math.random() * productLinks.length);
      console.log(`Found ${productLinks.length} table product links. Selecting #${randomIndex + 1}`);
      
      const productUrl = await page.evaluate(el => el.href, productLinks[randomIndex]);
      console.log(`Navigating to table product: ${productUrl}`);
      
      await page.goto(productUrl, { waitUntil: 'domcontentloaded' });
      
    } else {
      console.log('No product links found, trying to find product images on tables page...');
      const productImages = await page.$$('.product-list img, .products img');
      
      if (productImages.length > 0) {
        const randomIndex = Math.floor(Math.random() * productImages.length);
        console.log(`Found ${productImages.length} table product images. Clicking #${randomIndex + 1}`);
        
        await productImages[randomIndex].scrollIntoView();
        await new Promise(resolve => setTimeout(resolve, 500));
        
        await page.evaluate(el => el.click(), productImages[randomIndex]);
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 });
      } else {
        throw new Error('No table products found on the /tables page');
      }
    }
    
    await page.waitForFunction(
      () => document.querySelector('h1') !== null || 
            document.querySelector('button.green-box') !== null,
      { timeout: 10000 }
    );
    
    const productTitle = await page.$eval('h1', el => el.textContent).catch(() => 'Table Product');
    console.log(`Table product page loaded: "${productTitle}"`);
    
  } catch (error) {
    console.error(' Error navigating to product:', error.message);
    console.log('Current URL:', page.url());
    
    await page.screenshot({ path: 'debug-screenshot.png' });
    console.log('Debug screenshot saved as debug-screenshot.png');
    
    throw error;
  } finally {
    try {
      await flow.endTimespan();
      console.log('Timespan ended for product navigation\n');
    } catch (timespanError) {
      if (timespanError.message && timespanError.message.includes('NO_LCP')) {
        console.log('⚠ Timespan ended with LCP warning (non-critical)\n');
      } else {
        console.log('Timespan ended\n');
      }
    }
  }

  
  console.log(' Adding product to cart...');
  await flow.startTimespan({ stepName: '3. Add product to cart' });
  
  try {
    await page.waitForSelector(SELECTORS.product.addToCartButton, { timeout: 10000 });
    
    await page.evaluate((selector) => {
      const button = document.querySelector(selector);
      if (button) button.scrollIntoView({ block: 'center' });
    }, SELECTORS.product.addToCartButton);
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    await page.evaluate((selector) => {
      const button = document.querySelector(selector);
      if (button) button.click();
    }, SELECTORS.product.addToCartButton);
    
    console.log('Clicked "Add to Cart" button');
    
    await page.waitForFunction(
      () => {
        const bodyText = document.body.innerText;
        return bodyText.includes('Added') || 
               bodyText.includes('added') ||
               document.querySelector('.cart-added-info') !== null ||
               document.querySelector('a[href*="/cart"]') !== null;
      },
      { timeout: 10000 }
    );
    
    console.log('Product added to cart successfully');
    
    await new Promise(resolve => setTimeout(resolve, 1500));
    
  } catch (error) {
    console.error(' Error adding to cart:', error.message);
    await page.screenshot({ path: 'debug-add-to-cart.png' });
    console.log('Debug screenshot saved as debug-add-to-cart.png');
    throw error;
  } finally {
    await flow.endTimespan();
    console.log('Timespan ended for adding to cart\n');
  }

  
  console.log('Opening cart page...');
  await flow.startTimespan({ stepName: '4. Navigate to cart' });
  
  try {
    const cartLinkExists = await page.$(SELECTORS.product.viewCartLink) !== null;
    
    if (cartLinkExists) {
      const cartUrl = await page.$eval(SELECTORS.product.viewCartLink, el => el.href);
      console.log(`Navigating to cart: ${cartUrl}`);
      await page.goto(cartUrl, { waitUntil: 'domcontentloaded' });
    } else {
      console.log('Cart link not found, navigating directly to /cart/');
      await page.goto(`${APP_URL}/cart/`, { waitUntil: 'domcontentloaded' });
    }
    
    
    await page.waitForFunction(
      () => document.querySelector('input.to_cart_submit') !== null ||
            document.querySelector('[name="cart_submit"]') !== null ||
            document.body.innerText.toLowerCase().includes('cart'),
      { timeout: 10000 }
    );
    
    console.log('Cart page loaded');
    
  } catch (error) {
    console.error('Error opening cart:', error.message);
    await page.screenshot({ path: 'debug-cart.png' });
    throw error;
  } finally {
    await flow.endTimespan();
    console.log('Timespan ended for cart navigation\n');
  }


  console.log('Proceeding to checkout...');
  await flow.startTimespan({ stepName: '5. Proceed to checkout' });
  
  try {
    const checkoutButtonExists = await page.$(SELECTORS.cart.checkoutButton) !== null;
    
    if (checkoutButtonExists) {
      await page.evaluate((selector) => {
        const button = document.querySelector(selector);
        if (button) {
          button.scrollIntoView({ block: 'center' });
          button.click();
        }
      }, SELECTORS.cart.checkoutButton);
      
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 });
    } else {
      console.log('Checkout button not found, trying form submit...');
      await page.evaluate(() => {
        const form = document.querySelector('form');
        if (form) form.submit();
      });
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 });
    }
    
    
    await page.waitForSelector(SELECTORS.checkout.nameField, { timeout: 10000 });
    console.log(' Checkout page loaded');
    
  } catch (error) {
    console.error(' Error proceeding to checkout:', error.message);
    await page.screenshot({ path: 'debug-checkout.png' });
    throw error;
  } finally {
    await flow.endTimespan();
    console.log('Timespan ended for checkout navigation\n');
  }

  console.log(' Filling checkout form and placing order...');
  await flow.startTimespan({ stepName: '6. Fill form and submit order' });
  
  try {
    await page.evaluate((selectors) => {
      document.querySelector(selectors.nameField).value = 'Test User';
      document.querySelector(selectors.addressField).value = 'Test Street 123';
      document.querySelector(selectors.postalField).value = '12345';
      document.querySelector(selectors.cityField).value = 'Madrid';
      document.querySelector(selectors.stateField).value = 'Madrid';
      document.querySelector(selectors.phoneField).value = '999999999';
      document.querySelector(selectors.emailField).value = 'test@test.com';
    }, SELECTORS.checkout);
    
    
    try {
      await page.select(SELECTORS.checkout.countrySelect, 'US');
      console.log(' Country selected');
    } catch (e) {
      console.log('⚠ Country selection skipped');
    }
    
    console.log('All form fields filled');
    
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log('Submitting order...');
    
    await page.evaluate((selector) => {
      const button = document.querySelector(selector);
      if (button) button.click();
    }, SELECTORS.checkout.submitButton);
    
    await page.waitForFunction(
      () => {
        const bodyText = document.body.innerText;
        return bodyText.includes('Thank You') || 
               bodyText.includes('thank you') ||
               bodyText.includes('Thank you') ||
               document.querySelector('.success') !== null ||
               document.querySelector('.order-complete') !== null;
      },
      { timeout: 15000 }
    );
    
    console.log(' Order submitted successfully - Thank You page displayed');
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
  } catch (error) {
    console.error(' Error during checkout:', error.message);
    await page.screenshot({ path: 'debug-submit.png' });
    throw error;
  } finally {
    await flow.endTimespan();
    console.log('Timespan ended for checkout submission\n');
  }

  console.log('Taking final snapshot...');
  await new Promise(resolve => setTimeout(resolve, 1000));
  await flow.snapshot({ stepName: '7. Order confirmation page' });
  console.log(' Final snapshot captured\n');

  console.log('Generate report');
  const report = await flow.generateReport();
  const reportPath = 'flow-report.html';
  fs.writeFileSync(reportPath, report);
  console.log(` Report saved as ${reportPath}`);
  
  await browser.close();
  console.log('\n Success');
}

runAudit().catch(error => {
  console.error('\n Failed');
  console.error(error);
  process.exit(1);
});
