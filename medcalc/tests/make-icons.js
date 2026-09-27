// Builds the PWA icons from logo.jpg on the brand navy (#151c2c). Run: npm run icons
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

(async () => {
  const root = path.join(__dirname, '..');
  const logo = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(root, 'logo.jpg')).toString('base64');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<canvas id="c"></canvas>');
  const jobs = [['icon-192.png', 192, 0.86], ['icon-512.png', 512, 0.86], ['icon-maskable-512.png', 512, 0.64]];
  for (const [name, size, fill] of jobs) {
    const b64 = await page.evaluate(async ([src, size, fill]) => {
      const img = new Image(); img.src = src; await img.decode();
      const c = document.getElementById('c'); c.width = c.height = size;
      const g = c.getContext('2d');
      g.fillStyle = '#151c2c'; g.fillRect(0, 0, size, size);
      const h = size * fill, w = h * img.width / img.height;
      g.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      return c.toDataURL('image/png').split(',')[1];
    }, [logo, size, fill]);
    fs.writeFileSync(path.join(root, 'icons', name), Buffer.from(b64, 'base64'));
    console.log('wrote icons/' + name);
  }
  await browser.close();
})();
