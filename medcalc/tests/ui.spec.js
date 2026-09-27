// Layout tests — run with: npm run test:ui
// At 360px and 1280px, in light and dark: no horizontal overflow, every unit visible, one screenshot per tab.
const { test, expect } = require('@playwright/test');
const path = require('path');

const URL = 'file://' + path.join(__dirname, '..', 'index.html');
const SHOTS = path.join(__dirname, 'screenshots');
const TABS = ['dhv', 'wb', 'inf', 'gtt', 'dil', 'renal', 'maint'];

// Realistic values so screenshots show a working calculator, not empty boxes.
const SAMPLE = {
  dhv: { 'dhv-dose': '500', 'dhv-have': '250', 'dhv-vol': '5' },
  wb: { 'wb-w': '20', 'wb-dose': '15', 'wb-n': '3', 'wb-ca': '120', 'wb-cv': '5' },
  inf: { 'inf-amt': '4', 'inf-vol': '50', 'inf-w': '70', 'inf-dose': '0.1' },
  gtt: { 'gtt-vol': '1000', 'gtt-h': '8' },
  dil: { 'dil-a-amt': '1', 'dil-a-vol': '10', 'dil-pct': '2', 'dil-c1': '10', 'dil-c2': '1', 'dil-v2': '10' },
  renal: { 'r-age': '60', 'r-h': '170', 'r-w': '70', 'r-scr': '1' },
  maint: { 'm-w': '25' }
};

for (const width of [360, 1280]) {
  for (const scheme of ['light', 'dark']) {
    test.describe(`${width}px ${scheme}`, () => {
      test.use({ viewport: { width, height: 800 }, colorScheme: scheme, deviceScaleFactor: 2 });

      test('no overflow, units visible, screenshots', async ({ page }) => {
        await page.goto(URL);
        await page.evaluate(() => document.fonts && document.fonts.ready);
        for (const k of TABS) {
          await page.click(`[data-tab="${k}"]`);
          for (const [id, v] of Object.entries(SAMPLE[k])) await page.fill('#' + id, v);
          await page.locator('#vtoast').evaluate(e => { e.hidden = true; });

          const sw = await page.evaluate(() => document.documentElement.scrollWidth);
          expect(sw, `horizontal overflow on tab ${k}`).toBe(width);

          // every unit label / unit menu of the visible card sits fully inside its row and the viewport
          const bad = await page.evaluate(vw => {
            const out = [];
            document.querySelectorAll('.calc.active .inrow, .drugbox .inrow').forEach(row => {
              if (!row.offsetParent) return;
              const r = row.getBoundingClientRect();
              row.querySelectorAll('.unit, select, .mic, input').forEach(u => {
                const b = u.getBoundingClientRect();
                if (b.width < 8 || b.left < r.left - 1 || b.right > r.right + 1 || b.left < 0 || b.right > vw)
                  out.push(`${u.className || u.tagName}#${u.id} in ${row.querySelector('input') && row.querySelector('input').id}: ${Math.round(b.left)}–${Math.round(b.right)}`);
              });
              const u = row.querySelector('.unit');
              if (u && u.scrollWidth > u.clientWidth + 1) out.push(`clipped unit text "${u.textContent}"`);
            });
            return out;
          }, width);
          expect(bad, `units outside their rows on tab ${k}`).toEqual([]);

          // the main result is filled in (sample values are complete)
          const res = await page.locator('.calc.active .result').first().getAttribute('class');
          expect(res).not.toContain('is-empty');

          await page.locator('.calc.active').screenshot({ path: path.join(SHOTS, `${width}-${scheme}-${k}.png`) });
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(SHOTS, `${width}-${scheme}-top.png`) });
      });
    });
  }
}

test.describe('360px drug command', () => {
  test.use({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 2 });
  test('high-alert drug card and tag', async ({ page }) => {
    await page.goto(URL);
    await page.fill('#drug', 'هپارین وزن هشتاد هجده واحد بر کیلو بر ساعت');
    await page.click('#drug-go');
    await expect(page.locator('[data-out="inf"] .res-val')).toHaveText('2.88 mL/h');
    await expect(page.locator('[data-calc="inf"] .drug-tag')).toHaveClass(/high/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(SHOTS, '360-light-command.png'), fullPage: true });
  });
  test('keyboard-dictation sheet (no speech API in headless)', async ({ page }) => {
    await page.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; });
    await page.goto(URL);
    await page.click('[data-tab="dhv"]');
    await page.locator('#dhv-dose').locator('xpath=..').locator('.mic').click();
    await expect(page.locator('#vsheet')).toBeVisible();
    await page.fill('#vs-input', 'دویست و پنجاه میلی گرم');
    await page.screenshot({ path: path.join(SHOTS, '360-light-sheet.png') });
    await page.click('#vs-go');
    await expect(page.locator('#dhv-dose')).toHaveValue('250');
  });
});
