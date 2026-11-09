import { expect, test, type Page } from '@playwright/test';
import { nothingClipped } from './layout';
import { MockBackend, type MockOptions } from './mock';

/** Prices in exactly one currency, the visitor's: naira in Nigeria, pounds in the UK, euros where
 * the euro is the money, US dollars everywhere else (Switzerland included). The page guesses from the time zone at once, and the country Cloudflare sees
 * (/api/geo, answered by the mock) settles it; checkout charges what's shown. */

/** Every price-looking thing on the page, by currency symbol. */
async function currenciesShown(page: Page): Promise<string[]> {
  const text = await page.locator('body').innerText();
  return [...new Set([...text.matchAll(/(US\$|[$£₦€])\s?\d/g)].map((m) => m[1]))].sort();
}

async function landing(page: Page, opts: MockOptions) {
  const m = new MockBackend(opts);
  await m.install(page, { signedIn: false });
  await page.goto('/');
  const pricing = page.locator('#pricing');
  await pricing.scrollIntoViewIfNeeded();
  return { m, pricing };
}

async function openFaq(page: Page, q: string) {
  const d = page.locator('details', { hasText: q });
  await d.locator('summary').click();
  return d;
}

const PLANS = '/app/plan';

async function goPro(page: Page, m: MockBackend, button: string) {
  await page.route('https://checkout.flutterwave.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<h1>Checkout</h1>' }));
  await page.getByRole('button', { name: button }).click();
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  return m.made('/functions/v1/web-pay', 'POST').map((r) => r.body as { action: string; plan?: string; currency?: string }).filter((b) => b.action === 'subscribe').at(-1);
}

test.describe('a visitor in the US', () => {
  test.use({ timezoneId: 'America/Chicago' });

  test('sees US dollars everywhere, and pays in them', async ({ page }) => {
    const { m, pricing } = await landing(page, { country: 'US', payOn: true });
    await expect(pricing.getByText('$7.99', { exact: true })).toBeVisible();
    await expect(pricing.getByText('$0', { exact: true })).toBeVisible();
    await expect(pricing.getByText('Students: Pro for $5.99 a month')).toBeVisible();
    await expect(pricing.getByText('25% off')).toBeVisible();
    await expect(pricing.getByText('Prices in US dollars. Your bank converts if your card is in another currency. Payments by Flutterwave.')).toBeVisible();
    await expect((await openFaq(page, 'Is there a student discount?')).getByText(/Students get Pro for \$5\.99 a month instead of \$7\.99/)).toBeVisible();
    expect(await currenciesShown(page)).toEqual(['$']);
    await nothingClipped(page);

    await m.install(page);
    await page.goto(PLANS);
    await expect(page.getByText('Prices in US dollars. Your bank converts if your card is in another currency. Payments by Flutterwave.')).toBeVisible();
    expect(await currenciesShown(page)).toEqual(['$']);
    expect(await goPro(page, m, 'Go Pro for $7.99 a month')).toMatchObject({ plan: 'study.pro.monthly', currency: 'USD' });
  });

  test('sees the institutions’ price in dollars only, and the Terms in dollars', async ({ page }) => {
    const m = new MockBackend({ country: 'US' });
    await m.install(page, { signedIn: false });
    await page.goto('/institutions#pricing');
    const pricing = page.locator('#pricing');
    await pricing.scrollIntoViewIfNeeded();
    await expect(pricing.getByText('$45', { exact: true })).toBeVisible();
    expect(await currenciesShown(page)).toEqual(['$']);
    await page.goto('/terms');
    await expect(page.getByText(/Chip Study Pro costs \$7\.99 a month \(your bank converts if your card is in another currency\)/)).toBeVisible();
    await expect(page.getByText(/costs \$45 per student per year, billed yearly/)).toBeVisible();
    expect(await currenciesShown(page)).toEqual(['$']);
  });
});

test.describe('a visitor in the UK', () => {
  test.use({ timezoneId: 'Europe/London' });

  test('sees pounds everywhere, and pays in them', async ({ page }) => {
    const { m, pricing } = await landing(page, { country: 'GB', payOn: true });
    await expect(pricing.getByText('£6.49', { exact: true })).toBeVisible();
    await expect(pricing.getByText('£0', { exact: true })).toBeVisible();
    await expect(pricing.getByText('Students: Pro for £4.99 a month')).toBeVisible();
    await expect(pricing.getByText('23% off')).toBeVisible();
    await expect(pricing.getByText('Prices in pounds. Payments by Flutterwave.')).toBeVisible();
    await expect((await openFaq(page, 'Is there a student discount?')).getByText(/Students get Pro for £4\.99 a month instead of £6\.49/)).toBeVisible();
    expect(await currenciesShown(page)).toEqual(['£']);
    await nothingClipped(page);

    await m.install(page);
    await page.goto(PLANS);
    await expect(page.getByText('Students get Pro for £4.99 a month')).toBeVisible();
    await expect(page.getByText('Prices in pounds. Payments by Flutterwave.')).toBeVisible();
    expect(await currenciesShown(page)).toEqual(['£']);
    await nothingClipped(page);
    expect(await goPro(page, m, 'Go Pro for £6.49 a month')).toMatchObject({ plan: 'study.pro.monthly', currency: 'GBP' });
  });

  test('a school email sees the student price in pounds, and pays it in pounds', async ({ page }) => {
    const m = new MockBackend({ payOn: true, student: true });
    await m.install(page);
    await page.goto(PLANS);
    await expect(page.getByText('£4.99', { exact: true })).toBeVisible();
    await expect(page.locator('s', { hasText: '£6.49' })).toBeVisible();
    expect(await goPro(page, m, 'Go Pro for £4.99 a month')).toMatchObject({ plan: 'study.pro.student.monthly', currency: 'GBP' });
  });

  test('where the server has no price in pounds yet, sees and pays US dollars, never a mix', async ({ page }) => {
    const m = new MockBackend({ payOn: true, serverCurrencies: ['USD', 'NGN'] });
    await m.install(page);
    await page.goto(PLANS);
    await expect(page.getByRole('button', { name: 'Go Pro for $7.99 a month' })).toBeVisible();
    await expect(page.getByText(/^Prices in US dollars\./)).toBeVisible();
    expect(await currenciesShown(page)).toEqual(['$']);
    expect(await goPro(page, m, 'Go Pro for $7.99 a month')).toMatchObject({ currency: 'USD' });
  });

  test('sees the institutions’ price in pounds only, the sign-in student note and the Terms in pounds', async ({ page }) => {
    const m = new MockBackend({ country: 'GB' });
    await m.install(page, { signedIn: false });
    await page.goto('/institutions');
    await page.locator('#pilot').scrollIntoViewIfNeeded();
    await expect(page.getByText(/£36 per student per year, billed yearly by invoice, from 50 students\. Kaivon sends the invoice/)).toBeVisible();
    expect(await currenciesShown(page)).toEqual(['£']);
    await page.goto('/signin');
    await expect(page.getByText('Student? Use your school email and Pro is 23% off.')).toBeVisible();
    await page.getByRole('textbox').first().fill('ada@strath.ac.uk');
    await expect(page.getByText('A school email: Pro is yours at the student price, £4.99 a month.')).toBeVisible();
    await page.goto('/terms');
    await expect(page.getByText(/Chip Study Pro costs £6\.49 a month\. It renews/)).toBeVisible();
    await expect(page.getByText(/Students get Pro for £4\.99 a month/)).toBeVisible();
    await expect(page.getByText(/costs £36 per student per year, billed yearly/)).toBeVisible();
    expect(await currenciesShown(page)).toEqual(['£']);
  });
});

test.describe('a visitor in Germany', () => {
  test.use({ timezoneId: 'Europe/Berlin' });

  test('sees euros everywhere, and pays in them', async ({ page }) => {
    const { m, pricing } = await landing(page, { country: 'DE', payOn: true });
    await expect(pricing.getByText('€7.49', { exact: true })).toBeVisible();
    await expect(pricing.getByText('€0', { exact: true })).toBeVisible();
    await expect(pricing.getByText('Students: Pro for €5.49 a month')).toBeVisible();
    await expect(pricing.getByText('27% off')).toBeVisible();
    await expect(pricing.getByText('Prices in euros. Payments by Flutterwave.')).toBeVisible();
    await expect((await openFaq(page, 'Is there a student discount?')).getByText(/Students get Pro for €5\.49 a month instead of €7\.49/)).toBeVisible();
    expect(await currenciesShown(page)).toEqual(['€']);
    await nothingClipped(page);
    await page.goto('/institutions#pricing');
    await page.locator('#pricing').scrollIntoViewIfNeeded();
    await expect(page.locator('#pricing').getByText('€42', { exact: true })).toBeVisible();
    expect(await currenciesShown(page)).toEqual(['€']);
    await page.goto('/terms');
    await expect(page.getByText(/Chip Study Pro costs €7\.49 a month\. It renews/)).toBeVisible();
    expect(await currenciesShown(page)).toEqual(['€']);
    await m.install(page);
    await page.goto(PLANS);
    await expect(page.getByText('Prices in euros. Payments by Flutterwave.')).toBeVisible();
    expect(await currenciesShown(page)).toEqual(['€']);
    expect(await goPro(page, m, 'Go Pro for €7.49 a month')).toMatchObject({ plan: 'study.pro.monthly', currency: 'EUR' });
  });

  test('where the server has no price in euros yet, sees and pays US dollars, never a mix', async ({ page }) => {
    const m = new MockBackend({ payOn: true, country: 'DE', serverCurrencies: ['USD', 'GBP', 'NGN'] });
    await m.install(page);
    await page.goto(PLANS);
    await expect(page.getByRole('button', { name: 'Go Pro for $7.99 a month' })).toBeVisible();
    expect(await currenciesShown(page)).toEqual(['$']);
    expect(await goPro(page, m, 'Go Pro for $7.99 a month')).toMatchObject({ currency: 'USD' });
  });
});

test.describe('a visitor in Switzerland', () => {
  test.use({ timezoneId: 'Europe/Zurich' });

  test('sees US dollars, not euros, and pays in them', async ({ page }) => {
    const { m, pricing } = await landing(page, { country: 'CH', payOn: true });
    await expect(pricing.getByText('$7.99', { exact: true })).toBeVisible();
    expect(await currenciesShown(page)).toEqual(['$']);
    await page.goto('/institutions#pricing');
    await page.locator('#pricing').scrollIntoViewIfNeeded();
    await expect(page.locator('#pricing').getByText('$45', { exact: true })).toBeVisible();
    expect(await currenciesShown(page)).toEqual(['$']);
    await m.install(page);
    await page.goto(PLANS);
    await expect(page.getByText(/^Prices in US dollars\./)).toBeVisible();
    expect(await goPro(page, m, 'Go Pro for $7.99 a month')).toMatchObject({ currency: 'USD' });
  });

  test.describe('in a euro time zone', () => {
    test.use({ timezoneId: 'Europe/Berlin' });

    test('Cloudflare seeing Switzerland settles it on dollars', async ({ page }) => {
      const { pricing } = await landing(page, { country: 'CH' });
      await expect(pricing.getByText('$7.99', { exact: true })).toBeVisible();
      expect(await currenciesShown(page)).toEqual(['$']);
    });
  });
});

test.describe('a visitor in Nigeria', () => {
  test('sees naira everywhere, and pays in naira', async ({ page }) => {
    const { m, pricing } = await landing(page, { country: 'NG', payOn: true });
    await expect(pricing.getByText('₦7,990', { exact: true })).toBeVisible();
    await expect(pricing.getByText('₦0', { exact: true })).toBeVisible();
    await expect(pricing.getByText('Students: Pro for ₦5,990 a month')).toBeVisible();
    await expect(pricing.getByText('Prices in naira. Payments by Flutterwave.')).toBeVisible();
    expect(await currenciesShown(page)).toEqual(['₦']);
    await page.goto('/institutions#pricing');
    await page.locator('#pricing').scrollIntoViewIfNeeded();
    await expect(page.locator('#pricing').getByText('₦45,000', { exact: true })).toBeVisible();
    expect(await currenciesShown(page)).toEqual(['₦']);
    await m.install(page);
    await page.goto(PLANS);
    await expect(page.getByText('Prices in naira. Payments by Flutterwave.')).toBeVisible();
    expect(await currenciesShown(page)).toEqual(['₦']);
    expect(await goPro(page, m, 'Go Pro for ₦7,990 a month')).toMatchObject({ currency: 'NGN' });
  });
});

test.describe('the country settles what the time zone guessed', () => {
  test.describe('in a US time zone', () => {
    test.use({ timezoneId: 'America/New_York' });

    test('a visitor Cloudflare sees in the UK gets pounds, and keeps them for the visit without asking again', async ({ page }) => {
      let asks = 0;
      const m = new MockBackend({ country: 'GB', payOn: true });
      await m.install(page, { signedIn: false });
      page.on('request', (r) => {
        if (new URL(r.url()).pathname === '/api/geo') asks++;
      });
      await page.goto('/');
      const pricing = page.locator('#pricing');
      await pricing.scrollIntoViewIfNeeded();
      await expect(pricing.getByText('£6.49', { exact: true })).toBeVisible();
      expect(await currenciesShown(page)).toEqual(['£']);
      await page.goto('/institutions');
      await expect(page.locator('#pricing').getByText('£36', { exact: true })).toBeAttached();
      expect(asks).toBe(1);
    });

    test('an unknown country, or no answer, keeps the time zone’s dollars', async ({ page }) => {
      const { pricing } = await landing(page, { country: 'XX' });
      await expect(pricing.getByText('$7.99', { exact: true })).toBeVisible();
      await page.waitForTimeout(500);
      expect(await currenciesShown(page)).toEqual(['$']);
    });
  });

  test.describe('in a London time zone', () => {
    test.use({ timezoneId: 'Europe/London' });

    test('a visitor Cloudflare sees in the US gets dollars', async ({ page }) => {
      const { pricing } = await landing(page, { country: 'US' });
      await expect(pricing.getByText('$7.99', { exact: true })).toBeVisible();
      expect(await currenciesShown(page)).toEqual(['$']);
    });

    test('a visitor Cloudflare sees in Jersey keeps pounds', async ({ page }) => {
      const { pricing } = await landing(page, { country: 'JE' });
      await expect(pricing.getByText('£6.49', { exact: true })).toBeVisible();
    });
  });
});
