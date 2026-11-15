import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const origin = 'http://127.0.0.1:5173';
const output = 'artifacts/cinematic';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const results = { browser: 'Chromium headless', viewports: [], chapters: [], mode: 'browser-local practice', liveBackendTrades: false };
const figures = ['odysseus', 'athena', 'poseidon', 'ithaca'];

async function noOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.ok(dimensions.scrollWidth <= dimensions.width, `${label}: horizontal overflow ${JSON.stringify(dimensions)}`);
  results.viewports.push({ label, ...dimensions });
}
async function centerChapter(page, name) {
  await page.locator(`[data-figure="${name}"]`).evaluate(element => {
    const top = element.getBoundingClientRect().top + window.scrollY;
    const midpoint = top + element.clientHeight / 2;
    window.scrollTo(0, Math.max(0, midpoint - innerHeight / 2));
  });
}
function contrast(foreground, background) {
  const luminance = rgb => {
    const values = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
      const s = value / 255;
      return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
    });
    return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
  };
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference' });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin, { waitUntil: 'networkidle' });
  assert.deepEqual(await page.locator('.odyssey-chapter').evaluateAll(elements => elements.map(element => element.dataset.figure)), figures);
  await expect(page.getByRole('heading', { name: 'Sign in to see live FaZe matches.' }).first()).toBeVisible();
  assert.equal(await page.locator('.market-card').count(), 0, 'Signed-out account view never substitutes practice markets');
  await page.getByRole('button', { name: 'Try practice mode', exact: true }).click();
  await expect(page.locator('.cinematic-hero .market-card')).toBeVisible();
  assert.equal(await page.locator('.landing-markets .market-card').count(), 2);
  await page.evaluate(() => document.fonts.ready);

  for (const name of figures) {
    const art = page.locator(`[data-figure="${name}"] .odyssey-art`);
    await centerChapter(page, name);
    await expect.poll(() => art.evaluate(element => Number(getComputedStyle(element).opacity))).toBeGreaterThan(.1);
    const opacity = await art.evaluate(element => Number(getComputedStyle(element).opacity));
    assert.ok(opacity <= .2, `${name} must remain subdued`);
    assert.equal(await art.evaluate(element => getComputedStyle(element).pointerEvents), 'none');
    assert.equal(await art.locator('img').getAttribute('alt'), '');
    await expect.poll(() => art.locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
    results.chapters.push({ name, opacity, desktopSource: await art.locator('img').evaluate(image => image.currentSrc.split('/').at(-1)) });
    await page.locator(`[data-figure="${name}"]`).screenshot({ path: `${output}/${name}-desktop.png` });
  }

  const heroArt = page.locator('.chapter-odysseus .odyssey-art');
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => heroArt.evaluate(element => Number(getComputedStyle(element).opacity))).toBeGreaterThan(.1);
  const initialTransform = await heroArt.evaluate(element => getComputedStyle(element).transform);
  await page.locator('.chapter-athena').evaluate(element => window.scrollTo(0, element.offsetTop + element.clientHeight));
  await expect.poll(() => heroArt.evaluate(element => Number(getComputedStyle(element).opacity))).toBeLessThan(.02);
  assert.notEqual(await heroArt.evaluate(element => getComputedStyle(element).transform), initialTransform, 'Artwork position follows scrolling');

  await page.locator('#landing-contracts').fill('25');
  await page.locator('.landing-trade-panel').getByRole('button', { name: 'NO', exact: true }).click();
  await page.getByRole('button', { name: 'Review prediction', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#contract-count')).toHaveValue('25');
  await expect(dialog.getByRole('button', { name: 'No, FaZe loses', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog).toContainText('Return if correct50 coins');
  await dialog.getByRole('button', { name: 'Confirm simulated trade', exact: true }).click();
  await expect(dialog).toContainText('Your prediction is placed.');
  await expect(page.locator('.wallet-pill')).toContainText('975');
  await dialog.getByRole('button', { name: 'View portfolio', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your portfolio.' })).toBeVisible();
  await expect(page.locator('tbody')).toContainText('NAVI');
  await expect(page.locator('tbody')).toContainText('25');
  await page.screenshot({ path: `${output}/portfolio-desktop.png`, fullPage: true });
  await page.locator('.main-nav').getByRole('link', { name: 'Markets', exact: true }).click();
  await page.getByRole('button', { name: 'CS2', exact: true }).click();
  assert.equal(await page.locator('.market-card').count(), 2);
  await page.locator('.main-nav').getByRole('link', { name: 'The Oracle', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ask before you predict.' })).toBeVisible();
  await page.screenshot({ path: `${output}/oracle-practice-desktop.png`, fullPage: true });
  await page.locator('header').getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page, 'mobile auth dialog');
  await page.getByRole('dialog').screenshot({ path: `${output}/auth-mobile.png` });
  await page.getByRole('dialog').locator('.icon-button').click();
  await page.getByRole('button', { name: 'Try practice mode', exact: true }).click();
  await page.locator('header .brand').click();

  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width < 800 ? 844 : 1000 });
    await noOverflow(page, `practice home ${width}`);
    const bounds = await page.locator('#landing-contracts').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, 'Calculator input stays inside the viewport');
  }

  const colors = await page.locator('.hero-actions .button-primary').evaluate(element => {
    const style = getComputedStyle(element);
    return { foreground: style.color, background: style.backgroundColor };
  });
  assert.ok(contrast(colors.foreground, colors.background) >= 4.5, 'Primary action text has AA contrast');
  const cardColors = await page.locator('.cinematic-hero .contract-button').first().evaluate(element => {
    const style = getComputedStyle(element);
    return { foreground: style.color, background: style.backgroundColor };
  });
  assert.ok(contrast(cardColors.foreground, cardColors.background) >= 4.5, 'Contract button text has AA contrast');

  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of figures) {
    await centerChapter(page, name);
    const chapter = page.locator(`[data-figure="${name}"]`);
    await expect.poll(() => chapter.locator('.odyssey-art img').evaluate(image => image.complete && image.currentSrc.includes('-mobile.webp'))).toBe(true);
    await chapter.screenshot({ path: `${output}/${name}-mobile.png` });
  }
  await page.locator('.cinematic-hero .yes-button').click();
  await page.getByRole('dialog').locator('#contract-count').fill('5');
  await noOverflow(page, 'mobile trade dialog');
  await page.getByRole('dialog').screenshot({ path: `${output}/trade-mobile.png` });
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm simulated trade', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Your prediction is placed.');
  await page.getByRole('dialog').getByRole('button', { name: 'View portfolio', exact: true }).click();
  await expect(page.locator('.stat-value').first()).toHaveText('970');
  await page.screenshot({ path: `${output}/portfolio-mobile.png`, fullPage: true });
  await page.locator('.main-nav').getByRole('link', { name: 'Leaderboard', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'The leaderboard.' })).toBeVisible();
  await noOverflow(page, 'mobile leaderboard');
  await page.locator('footer').getByRole('link', { name: 'Terms of use' }).click();
  await expect(page.getByText('DRAFT FOR REVIEW / HACKATHON PROTOTYPE')).toBeVisible();
  await page.locator('footer').getByRole('link', { name: 'Privacy notice' }).click();
  await expect(page.getByRole('heading', { name: 'Privacy notice' })).toBeVisible();

  const reduced = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  reduced.on('pageerror', error => errors.push(error.message));
  await reduced.goto(origin, { waitUntil: 'networkidle' });
  assert.equal(await reduced.locator('[data-motion="static"]').count(), 4);
  for (const name of figures) {
    const art = reduced.locator(`[data-figure="${name}"] .odyssey-art`);
    assert.equal(await art.evaluate(element => getComputedStyle(element).transform), 'none');
    assert.equal(await art.evaluate(element => element.getAnimations().length), 0);
    assert.equal(await art.evaluate(element => getComputedStyle(element).opacity), '0.13');
  }
  await reduced.keyboard.press('Tab');
  await expect(reduced.locator('.skip-link')).toBeFocused();
  await expect(reduced.locator('.skip-link')).toBeInViewport();
  await reduced.keyboard.press('Enter');
  await expect(reduced.locator('#main-content')).toBeFocused();
  await noOverflow(reduced, 'reduced-motion mobile home');
  await reduced.screenshot({ path: `${output}/reduced-motion-mobile.png`, fullPage: true });
  results.reducedMotion = 'Four static artwork layers, no transforms or animations; skip link works';
  results.mainAction = '25-coin NO practice prediction: confirmation preserved quantity and side, wallet 1000 to 975, portfolio position present';
  results.mobileMainAction = '5-coin YES practice prediction: mobile confirmation and portfolio work, wallet 975 to 970';
  results.primaryButtonContrast = contrast(colors.foreground, colors.background);
  results.contractButtonContrast = contrast(cardColors.foreground, cardColors.background);
  assert.deepEqual(errors, [], 'No browser JavaScript errors');
  results.errors = errors;
  await writeFile(`${output}/report.json`, JSON.stringify(results, null, 2));
  console.log('PASS: real Chromium desktop/mobile layout, four artwork stages, scroll fade/parallax, responsive image loading, reduced motion, keyboard skip link, action contrast, calculator purchase, wallet/portfolio, filters, leaderboard, and legal links.');
  console.log(`Screenshots and report: ${output}/. Practice wallet only; no live account trades or settlement.`);
} finally {
  await browser.close();
}
