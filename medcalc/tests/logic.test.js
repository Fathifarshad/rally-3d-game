// Acceptance tests (section 9 of the spec) — run with: npm test
// Loads the real index.html in jsdom, drives it through the DOM, and mocks SpeechRecognition.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

/* A fake recogniser: every start() answers with the queued transcript(s). */
function makeSR(queue) {
  return class FakeSR {
    start() {
      const alts = queue.shift();
      setTimeout(() => {
        this.onstart && this.onstart();
        const res = [].concat(alts).map(t => ({ transcript: t }));
        res.isFinal = true;
        this.onresult && this.onresult({ results: [res] });
        this.onend && this.onend();
      }, 0);
    }
    stop() {} abort() {}
  };
}

function load(opts = {}) {
  const vc = new VirtualConsole(); // swallow jsdom "not implemented" noise (scrollTo etc.)
  vc.on('jsdomError', e => { if (!/Not implemented/.test(e.message)) console.error(e); });
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://medcalc.test/', virtualConsole: vc,
    beforeParse(w) {
      if (opts.sr) w.SpeechRecognition = opts.sr;
      w.scrollTo = () => {};
    }
  });
  const w = dom.window, d = w.document;
  const $ = id => d.getElementById(id);
  const api = {
    w, d, $,
    set(id, v) { const e = $(id); e.value = v; e.dispatchEvent(new w.Event('input', { bubbles: true })); },
    sel(id, v) { const e = $(id); e.value = v; e.dispatchEvent(new w.Event('change', { bubbles: true })); },
    seg(id, v) { $(id).querySelector(`[data-val="${v}"]`).click(); },
    tab(k) { d.querySelector(`[data-tab="${k}"]`).click(); },
    main(k) { return d.querySelector(`[data-out="${k}"] .res-val`).textContent.trim(); },
    mainNum(k) { return parseFloat(api.main(k).replace(/,/g, '')); },
    row(k, label) {
      const r = [...d.querySelectorAll(`[data-out="${k}"] .res-rows div`)].find(x => x.querySelector('dt').textContent.includes(label));
      return r ? r.querySelector('dd').textContent.trim() : null;
    },
    msgs(k, kind) { return [...d.querySelectorAll(`[data-msgs="${k}"] .msg${kind ? '.' + kind : ''}`)].map(m => m.textContent); },
    toast() { return $('vtoast').hidden ? '' : $('vt-title').textContent + ' | ' + $('vt-text').textContent; },
    mic(id) { $(id).closest('.inrow').querySelector('.mic').click(); },
    tick(ms = 5) { return new Promise(r => setTimeout(r, ms)); },
    close() { w.close(); }
  };
  return api;
}

/* ---------------------------------------------------------------- */
describe('محاسبات', () => {
  test('D=500 mg, H=250 mg, V=5 mL → 10 mL', () => {
    const a = load(); a.tab('dhv');
    a.set('dhv-dose', '500'); a.set('dhv-have', '250'); a.set('dhv-vol', '5');
    assert.equal(a.main('dhv'), '10 mL');
    assert.match(a.d.querySelector('[data-out="dhv"] .formula').textContent, /\(500 mg ÷ 250 mg\) × 5 mL = 10 mL/);
  });

  test('D=۰٫۵ g (ارقام فارسی), H=250 mg, V=5 mL → 10 mL', () => {
    const a = load();
    a.set('dhv-dose', '۰٫۵'); a.sel('dhv-dose-u', 'g'); a.set('dhv-have', '250'); a.set('dhv-vol', '5');
    assert.equal(a.main('dhv'), '10 mL');
  });

  test('قرص: 750 mg ÷ 500 mg → 1.5 tab', () => {
    const a = load(); a.seg('dhv-form', 'tab');
    a.set('dhv-dose', '750'); a.set('dhv-have', '500');
    assert.equal(a.main('dhv'), '1.5 tab');
    assert.equal(a.msgs('dhv', 'warn').length, 0);
  });

  test('15 mg/kg × 20 kg, آمپول 120 mg/5 mL → 300 mg و 12.5 mL', () => {
    const a = load();
    a.set('wb-w', '20'); a.set('wb-dose', '15'); a.set('wb-ca', '120'); a.set('wb-cv', '5');
    assert.equal(a.main('wb'), '300 mg');
    assert.equal(a.row('wb', 'حجم برداشت'), '12.5 mL');
  });

  test('سقف دوز: هر دو عدد نمایش داده می‌شود و حجم با سقف حساب می‌شود', () => {
    const a = load();
    a.set('wb-w', '100'); a.set('wb-dose', '15'); a.set('wb-max', '1000'); a.set('wb-ca', '500'); a.set('wb-cv', '5');
    assert.equal(a.main('wb'), '1,500 mg');
    assert.equal(a.row('wb', 'دوز با اعمال سقف'), '1,000 mg');
    assert.equal(a.row('wb', 'حجم برداشت'), '10 mL');
    assert.equal(a.msgs('wb', 'warn').length, 1);
  });

  test('نوراپی‌نفرین 4 mg/50 mL، 0.1 mcg/kg/min، 70 kg → 5.25 mL/h و برعکس', () => {
    const a = load();
    a.set('inf-amt', '4'); a.set('inf-vol', '50'); a.set('inf-w', '70'); a.set('inf-dose', '0.1');
    assert.equal(a.main('inf'), '5.25 mL/h');
    assert.equal(a.row('inf', 'غلظت محلول'), '80 mcg/mL');
    a.seg('inf-mode', 'dose'); a.set('inf-rate', '5.25');
    assert.equal(a.main('inf'), '0.1 mcg/kg/min');
  });

  test('هپارین 25000 units/250 mL با 10 mL/h → 1000 units/h', () => {
    const a = load();
    a.seg('inf-mode', 'dose'); a.set('inf-amt', '25000'); a.sel('inf-amtu', 'units'); a.set('inf-vol', '250');
    a.sel('inf-du', 'units/h'); a.set('inf-rate', '10');
    assert.equal(a.main('inf'), '1,000 units/h');
    assert.equal(a.row('inf', 'زمان اتمام'), '25 ساعت');
  });

  test('1000 mL در 8 ساعت با ست 20 → 42 gtt/min', () => {
    const a = load();
    a.set('gtt-vol', '1000'); a.set('gtt-h', '8');
    assert.equal(a.main('gtt'), '42 gtt/min');
    assert.equal(a.row('gtt', 'معادل سرعت'), '125 mL/h');
  });

  test('مرد ۶۰ ساله، 170 cm، 70 kg، Cr=1 → CrCl 77.78 و BSA 1.82', () => {
    const a = load();
    a.set('r-age', '60'); a.set('r-h', '170'); a.set('r-w', '70'); a.set('r-scr', '1');
    assert.equal(a.main('renal'), '77.78 mL/min');
    assert.equal(a.row('renal', 'BSA'), '1.82 m²');
  });

  test('کودک 25 kg → 65 mL/h و 1600 mL/day', () => {
    const a = load();
    a.set('m-w', '25');
    assert.equal(a.main('maint'), '65 mL/h');
    assert.equal(a.row('maint', '۲۴ ساعته'), '1,600 mL/day');
  });

  test('۲٪ → 20 mg/mL و 1:1000 → 1 mg/mL', () => {
    const a = load();
    a.set('dil-pct', '۲');
    assert.equal(a.main('dilB'), '20 mg/mL');
    a.set('dil-pct', ''); a.set('dil-ratio', '1000');
    assert.equal(a.main('dilB'), '1 mg/mL');
  });

  test('C1=10, C2=1, V2=10 → V1=1 mL و حلال 9 mL؛ C2≥C1 خطا', () => {
    const a = load();
    a.set('dil-c1', '10'); a.set('dil-c2', '1'); a.set('dil-v2', '10');
    assert.equal(a.main('dilC'), '1 mL');
    assert.equal(a.row('dilC', 'حجم حلال'), '9 mL');
    a.set('dil-c2', '10');
    assert.equal(a.msgs('dilC', 'err').length, 1);
    assert.equal(a.main('dilC'), '—');
  });

  test('تبدیل بین خانواده‌های واحد ممنوع است (mg ↔ units)', () => {
    const a = load();
    a.set('dhv-dose', '5000'); a.sel('dhv-dose-u', 'units'); a.set('dhv-have', '250'); a.set('dhv-vol', '5');
    assert.equal(a.main('dhv'), '—');
    assert.equal(a.msgs('dhv', 'err').length, 1);
  });

  test('عدد مبهم «25,000» خطا می‌دهد و حدس زده نمی‌شود؛ «2,5» = 2.5', () => {
    const a = load();
    a.set('dhv-dose', '25,000'); a.set('dhv-have', '5000'); a.set('dhv-vol', '1');
    assert.equal(a.main('dhv'), '—');
    assert.match(a.msgs('dhv', 'err')[0], /مبهم/);
    a.set('dhv-dose', '2,5'); a.set('dhv-have', '5'); a.set('dhv-vol', '1');
    assert.equal(a.main('dhv'), '0.5 mL');
  });

  test('فرمت اعداد', () => {
    const { fmt } = load().w.MedCalc;
    assert.equal(fmt(1234.56), '1,234.6');
    assert.equal(fmt(5.254), '5.25');
    assert.equal(fmt(0.1234), '0.123');
    assert.equal(fmt(0.001234), '0.00123');
  });

  test('هشدارها: حجم < 0.1 mL، سرعت < 0.5 mL/h، بیش از 80 قطره، 2400 mL/day، Schwartz', () => {
    const a = load();
    a.set('dhv-dose', '0.05'); a.set('dhv-have', '1'); a.set('dhv-vol', '1');
    assert.match(a.msgs('dhv', 'warn').join(), /0\.1 mL/);
    a.set('inf-amt', '4'); a.set('inf-vol', '50'); a.set('inf-w', '3'); a.set('inf-dose', '0.1');
    assert.match(a.msgs('inf', 'warn').join(), /0\.5 mL\/h/);
    a.set('gtt-vol', '1000'); a.set('gtt-h', '2');
    assert.match(a.msgs('gtt', 'warn').join(), /۸۰/);
    a.set('m-w', '120');
    assert.match(a.msgs('maint', 'warn').join(), /2400/);
    a.set('r-age', '12'); a.set('r-w', '40'); a.set('r-scr', '0.6');
    assert.match(a.msgs('renal', 'warn').join(), /Schwartz/);
  });
});

/* ---------------------------------------------------------------- */
describe('ورود صوتی (SpeechRecognition شبیه‌سازی‌شده)', () => {
  async function say(field, phrase, opts = {}) {
    const a = load({ sr: makeSR([phrase]) });
    if (opts.lang) a.seg('voice-lang', opts.lang);
    if (opts.tab) a.tab(opts.tab);
    a.mic(field); await a.tick();
    return a;
  }

  test('«پانصد میلی گرم» → 500 mg', async () => {
    const a = await say('dhv-dose', 'پانصد میلی گرم');
    assert.equal(a.$('dhv-dose').value, '500'); assert.equal(a.$('dhv-dose-u').value, 'mg');
    assert.match(a.toast(), /ثبت شد: 500 mg.*شنیده شد: «پانصد میلی گرم»/);
  });
  test('«صفر ممیز صفر پنج» → 0.05', async () => {
    const a = await say('inf-dose', 'صفر ممیز صفر پنج');
    assert.equal(a.$('inf-dose').value, '0.05');
  });
  test('«دو و پنج دهم» → 2.5', async () => {
    const a = await say('wb-dose', 'دو و پنج دهم');
    assert.equal(a.$('wb-dose').value, '2.5');
  });
  test('«بیست و پنج هزار واحد» → 25000 units', async () => {
    const a = await say('inf-amt', 'بیست و پنج هزار واحد');
    assert.equal(a.$('inf-amt').value, '25000'); assert.equal(a.$('inf-amtu').value, 'units');
  });
  test('«هفتاد و پنج کیلو» → 75 kg', async () => {
    const a = await say('wb-w', 'هفتاد و پنج کیلو');
    assert.equal(a.$('wb-w').value, '75'); assert.equal(a.$('wb-wu').value, 'kg');
  });
  test('«یک متر و هفتاد» → 170 cm', async () => {
    const a = await say('r-h', 'یک متر و هفتاد');
    assert.equal(a.$('r-h').value, '170');
  });
  test('«صد و ده میکرومول» → 110 µmol/L', async () => {
    const a = await say('r-scr', 'صد و ده میکرومول');
    assert.equal(a.$('r-scr').value, '110'); assert.equal(a.$('r-scru').value, 'umol');
  });
  test('«two and a half grams» → 2.5 g', async () => {
    const a = await say('dhv-dose', 'two and a half grams', { lang: 'en' });
    assert.equal(a.$('dhv-dose').value, '2.5'); assert.equal(a.$('dhv-dose-u').value, 'g');
  });
  test('«500mg» → 500 mg', async () => {
    const a = await say('dhv-dose', '500mg');
    assert.equal(a.$('dhv-dose').value, '500'); assert.equal(a.$('dhv-dose-u').value, 'mg');
  });
  test('«سلام» → خطا و هیچ مقداری ثبت نمی‌شود', async () => {
    const a = await say('dhv-dose', 'سلام');
    assert.equal(a.$('dhv-dose').value, '');
    assert.match(a.toast(), /عددی.*پیدا نشد/);
  });

  test('جفت «۲۵۰ میلی‌گرم در ۵ سی‌سی» هر دو کادر را پر می‌کند', async () => {
    const a = await say('dhv-have', '۲۵۰ میلی‌گرم در ۵ سی‌سی');
    assert.equal(a.$('dhv-have').value, '250'); assert.equal(a.$('dhv-vol').value, '5');
    assert.match(a.toast(), /250 mg، 5 mL/);
  });
  test('تبدیل‌های خاص: لیتر، گرم در وزن، ساعت و نیم، دقیقه، نسبت', async () => {
    assert.equal((await say('gtt-vol', 'یک لیتر')).$('gtt-vol').value, '1000');
    assert.equal((await say('m-w', 'سه هزار و دویست گرم')).$('m-w').value, '3.2');
    let a = await say('gtt-h', 'هشت ساعت و نیم');
    assert.deepEqual([a.$('gtt-h').value, a.$('gtt-m').value], ['8', '30']);
    a = await say('gtt-m', 'نود دقیقه');
    assert.deepEqual([a.$('gtt-h').value, a.$('gtt-m').value], ['1', '30']);
    assert.equal((await say('dil-ratio', 'یک به ده هزار')).$('dil-ratio').value, '10000');
    assert.equal((await say('dhv-vol', 'سی سی سی')).$('dhv-vol').value, '30');
  });
  test('قواعد عدد فارسی: «هشتاد هجده» دو عدد است، «هشتاد و هجده» = 98، «پنج صد» = 500', () => {
    const M = load().w.MedCalc, q = s => [...M.extractQuantities(M.norm(s))].map(x => x.value);  // copy out of the jsdom realm
    assert.deepEqual(q('هشتاد هجده'), [80, 18]);
    assert.deepEqual(q('هشتاد و هجده'), [98]);
    assert.deepEqual(q('پنج صد'), [500]);
    assert.deepEqual(q('twenty five'), [25]);
    assert.deepEqual(q('دو ممیز بیست و پنج'), [2.25]);
  });
  test('واحد ناسازگار رد می‌شود و چیزی ثبت نمی‌شود', async () => {
    let a = await say('inf-dose', 'هشتاد واحد بر کیلو');
    assert.equal(a.$('inf-dose').value, ''); assert.match(a.toast(), /بدون واحد زمان/);
    a = await say('dhv-dose', 'ده میلی گرم بر کیلو');
    assert.equal(a.$('dhv-dose').value, ''); assert.match(a.toast(), /چیزی ثبت نشد/);
  });
  test('خطای not-allowed → حالت میکروفون کیبورد', async () => {
    class Denied { start() { setTimeout(() => { this.onerror({ error: 'not-allowed' }); this.onend(); }, 0); } stop() {} abort() {} }
    const a = load({ sr: Denied });
    a.mic('dhv-dose'); await a.tick();
    assert.match(a.toast(), /دسترسی/);
    a.mic('dhv-dose');
    assert.equal(a.$('vsheet').hidden, false);
  });
});

/* ---------------------------------------------------------------- */
describe('فرمان‌های یک‌جمله‌ای', () => {
  function cmd(text) { const a = load(); a.set('drug', text); a.$('drug-go').click(); return a; }

  test('«نوراپی نفرین چهار میلی گرم در پنجاه سی سی وزن هفتاد دوز صفر ممیز یک» → 5.25 mL/h', () => {
    const a = cmd('نوراپی نفرین چهار میلی گرم در پنجاه سی سی وزن هفتاد دوز صفر ممیز یک');
    assert.equal(a.main('inf'), '5.25 mL/h');
    assert.ok(a.d.querySelector('[data-calc="inf"] .drug-tag').classList.contains('high'));
  });
  test('«نوراپی نفرین» بر «اپی نفرین» غلبه می‌کند', () => {
    const M = load().w.MedCalc;
    assert.equal(M.findDrug(M.norm('نوراپی نفرین')).drug.en, 'Norepinephrine');
    assert.equal(M.findDrug(M.norm('اپی نفرین')).drug.en, 'Epinephrine');
    assert.equal(M.findDrug(M.norm('دوبو')).drug.en, 'Dobutamine');
    assert.equal(M.findDrug(M.norm('کلسیم')), null);
  });
  test('«هپارین وزن هشتاد هجده واحد بر کیلو بر ساعت» → 2.88 mL/h', () => {
    const a = cmd('هپارین وزن هشتاد هجده واحد بر کیلو بر ساعت');
    assert.equal(a.main('inf'), '2.88 mL/h');
  });
  test('«هپارین هشتاد واحد بر کیلو» → در انفوزیون رد و گزارش می‌شود', () => {
    const a = cmd('هپارین هشتاد واحد بر کیلو');
    assert.equal(a.$('inf-dose').value, '');
    assert.match(a.toast(), /رد شد:.*بدون واحد زمان/);
  });
  test('«کتامین وزن هفتاد دوز یک و نیم» → 105 mg و 2.1 mL', () => {
    const a = cmd('کتامین وزن هفتاد دوز یک و نیم');
    assert.equal(a.main('wb'), '105 mg');
    assert.equal(a.row('wb', 'حجم برداشت'), '2.1 mL');
  });
  test('«پتاسیم بیست میلی اکی والان» → 10 mL با برچسب قرمز پرخطر', () => {
    const a = cmd('پتاسیم بیست میلی اکی والان');
    assert.equal(a.main('dhv'), '10 mL');
    const tag = a.d.querySelector('[data-calc="dhv"] .drug-tag');
    assert.ok(tag.classList.contains('high')); assert.match(tag.textContent, /همکار دوم/);
  });
  test('«منیزیم سولفات دو گرم» → 4 mL', () => {
    assert.equal(cmd('منیزیم سولفات دو گرم').main('dhv'), '4 mL');
  });
  test('«انسولین صفر ممیز یک واحد بر کیلوگرم بر ساعت وزن شصت» → 6 mL/h', () => {
    assert.equal(cmd('انسولین صفر ممیز یک واحد بر کیلوگرم بر ساعت وزن شصت').main('inf'), '6 mL/h');
  });
  test('داروی خارج از فهرست فقط به‌عنوان برچسب ثبت می‌شود؛ مقدار اضافی «نادیده گرفته شد»', () => {
    const a = cmd('سفتریاکسون وزن بیست پنج ساعت');
    const tag = a.d.querySelector('#tab-dhv [data-calc] .drug-tag');
    assert.match(tag.textContent, /سفتریاکسون/);
    assert.match(a.toast(), /نادیده گرفته شد: 20، 5 h/);
  });
  test('انتخاب دارو کارت اطلاعات و حالت‌ها را نشان می‌دهد', () => {
    const a = cmd('میدازولام');
    assert.equal(a.$('drug-info').hidden, false);
    assert.equal(a.d.querySelectorAll('#drug-info .chip').length, 2);
    a.d.querySelectorAll('#drug-info .chip')[1].click();
    assert.equal(a.$('inf-amt').value, '50');
    assert.equal(a.d.querySelector('[data-tab="inf"]').getAttribute('aria-selected'), 'true');
  });
});

/* ---------------------------------------------------------------- */
describe('جایگزین کیبورد', () => {
  test('بدون SpeechRecognition: میکروفون پنجره را باز می‌کند؛ «دویست و پنجاه میلی گرم» + ثبت → 250 mg', () => {
    const a = load();
    assert.ok(!a.w.SpeechRecognition && !a.w.webkitSpeechRecognition);
    a.mic('dhv-dose');
    assert.equal(a.$('vsheet').hidden, false);
    a.$('vs-input').value = 'دویست و پنجاه میلی گرم';
    a.$('vs-go').click();
    assert.equal(a.$('vsheet').hidden, true);
    assert.equal(a.$('dhv-dose').value, '250'); assert.equal(a.$('dhv-dose-u').value, 'mg');
  });
  test('watchdog: اگر تا ۳.۵ ثانیه start نیاید، به کیبورد سوئیچ می‌کند', async () => {
    class Silent { start() {} stop() {} abort() {} }
    const a = load({ sr: Silent });
    a.mic('dhv-dose');
    assert.match(a.toast(), /در حال شنیدن/);
    await a.tick(3600);
    assert.match(a.toast(), /پاسخ نمی‌دهد/);
    a.mic('dhv-dose');
    assert.equal(a.$('vsheet').hidden, false);
  });
});

describe('حریم خصوصی', () => {
  test('فقط تب و زبان گفتار در localStorage ذخیره می‌شود', () => {
    const a = load();
    a.set('wb-w', '70'); a.tab('wb'); a.seg('voice-lang', 'en');
    const keys = Object.keys(a.w.localStorage).sort();
    assert.deepEqual(keys, ['medcalc-tab', 'medcalc-voice']);
  });
});
