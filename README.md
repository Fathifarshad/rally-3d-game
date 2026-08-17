# NISSAN Z — ULTIMATE DRIVE

یک بازی رانندگی سه‌بعدی کامل در مرورگر، ساخته‌شده با **Three.js + TypeScript + Vite**.
A complete 3D browser driving game built with **Three.js + TypeScript + Vite**.

---

## 🚀 اجرای بازی / Running the game

**ساده‌ترین راه:** روی فایل **«اجرای بازی»** (یا `PLAY-GAME.bat`) دو بار کلیک کنید.
همین فایل خودش بسته‌ها را نصب می‌کند، سرور را بالا می‌آورد و مرورگر را باز می‌کند.
راهنمای فارسی گام‌به‌گام در `RAHNAMA.txt` است.

**Easiest way:** double-click **`PLAY-GAME.bat`** — it installs dependencies on the
first run, starts the dev server and opens your browser. Keep the console window open
while you play; closing it stops the game.

با خط فرمان / From a terminal:

```bash
npm install     # فقط بار اول
npm run dev     # اجرای بازی
```

سپس مرورگر روی آدرس `http://localhost:5173` باز می‌شود.
Then the browser opens at `http://localhost:5173`.

دستورهای دیگر / Other commands:

```bash
npm run build      # ساخت نسخه نهایی در پوشه dist
npm run preview    # اجرای نسخه نهایی
npm run typecheck  # بررسی خطاهای TypeScript
```

> 🔊 صدا فقط بعد از اولین کلیک شما فعال می‌شود (قانون مرورگرها است، ایراد بازی نیست).
> Audio only starts after your first click — that is a browser policy, not a bug.

---

## 🎮 کنترل‌ها / Controls

| کلید / Key | کار / Action |
| ---------- | ------------ |
| `W` / `↑` | گاز — Accelerate |
| `S` / `↓` | ترمز، و در حالت ایستاده دنده عقب — Brake / reverse |
| `A` `D` / `←` `→` | فرمان — Steer |
| `Space` | ترمز دستی (برای دریفت) — Handbrake (drift) |
| `Shift` | نیترو — Nitro boost |
| `C` | تغییر دوربین — Change camera |
| `R` | برگرداندن خودرو به جاده — Reset car |
| `Esc` | توقف / ادامه — Pause / resume |

روی گوشی و تبلت دکمه‌های لمسی خودکار نمایش داده می‌شوند (در Settings قابل تغییر است).
On phones and tablets on-screen buttons appear automatically (configurable in Settings).

### نکته دریفت / Drift tip

برای گرفتن امتیاز دریفت، **در حین پیچیدن** `Space` را نگه دارید — ترمز دستی در خط مستقیم دریفت نمی‌سازد.
To score drift points hold `Space` **while turning** — the handbrake alone in a straight line will not break traction.

---

## 🕹️ چه چیزهایی در بازی هست / What's in the game

- **خودرو:** Nissan Z مشکی براق با کابین کرمی، رینگ اسپرت، چراغ LED، شیشه دودی و اگزوز دوقلو.
- **فیزیک:** شتاب، ترمز، اصطکاک، گریپ، دریفت، ترمز دستی، انتقال وزن، سیستم تعلیق، گیربکس ۶ سرعته با تعویض خودکار.
- **نیترو:** افزایش سرعت + شعله اگزوز + Motion Blur + تغییر صدای موتور + شارژ تدریجی.
- **سه دوربین:** Third Person، Chase سینمایی، و Cockpit از داخل کابین (کلید `C`).
- **جهان:** جاده ۴ خطه ۴٫۶ کیلومتری با خط‌کشی، گاردریل، تابلو، چراغ خیابان، درخت، شهر، کوه، آسمان واقع‌گرا، ابرهای متحرک و سایه.
- **ترافیک:** ۱۴ خودروی هوشمند با سرعت‌های مختلف، تغییر خط، چراغ ترمز و جلوگیری از تصادف.
- **مسابقه:** ۱۲ چک‌پوینت، ۲ لپ، شمارش معکوس، رتبه‌بندی زنده و صفحه نتایج.
- **مأموریت‌ها:** رسیدن به ۲۰۰ km/h، رانندگی ۵ کیلومتر، سبقت از ۱۰ خودرو، ۲۰ ثانیه دریفت، تکمیل مسابقه.
- **HUD:** سرعت دیجیتال، دور موتور گرافیکی، دنده، نیترو، امتیاز، مسافت، رتبه، لپ، زمان و مینی‌مپ.
- **گاراژ:** چهار نما (جلو/کنار/عقب/داخل) و ۶ رنگ بدنه (پیش‌فرض: مشکی).
- **صدا:** موتور، باد، لاستیک، ترمز، برخورد، نیترو و موسیقی — همه با Web Audio ساخته می‌شوند.

---

## 📁 ساختار پروژه / Project structure

```
index.html                 صفحه اصلی + تمام لایه‌های UI
src/
  main.ts                  نقطه شروع برنامه
  styles/main.css          استایل منو و HUD
  game/
    Game.ts                هسته بازی و ماشین حالت (منو/گاراژ/مسابقه)
    Renderer.ts            WebGL، Bloom، Motion Blur، Environment Map
    Config.ts              همه‌ی عددهای تنظیمی بازی (فیزیک، کیفیت، امتیاز)
  core/
    AssetLoader.ts         بارگذاری مدل و صدای اختیاری
    TextureFactory.ts      ساخت تکسچرها به‌صورت procedural
    MathUtils.ts           توابع کمکی ریاضی
  vehicles/
    CarFactory.ts          ساخت مدل سه‌بعدی Nissan Z و خودروهای ترافیک
    Vehicle.ts             خودروی بازیکن: فیزیک + برخورد + افکت‌ها
    TrafficManager.ts      هوش مصنوعی خودروهای NPC
  physics/
    VehiclePhysics.ts      مدل فیزیک خودرو
    CollisionSystem.ts     سیستم برخورد با اشیای محیط
  environment/
    Track.ts               مسیر مسابقه، مش جاده، چک‌پوینت‌ها
    World.ts               زمین، آسمان، نور، گاردریل، شهر، درخت
    Terrain.ts             تابع ارتفاع زمین
  systems/
    InputManager.ts        کیبورد و کنترل لمسی
    CameraManager.ts       سه دوربین بازی
    RaceManager.ts         شمارش معکوس، چک‌پوینت، لپ، پایان مسابقه
    MissionManager.ts      مأموریت‌ها
    ScoreManager.ts        امتیازدهی
  audio/AudioManager.ts    سیستم صدا (Web Audio)
  ui/
    UIManager.ts           مدیریت صفحه‌ها و HUD
    Gauge.ts               عقربه دور موتور
    MiniMap.ts             مینی‌مپ
public/assets/
  models/                  محل قرار دادن nissan_z.glb (اختیاری)
  sounds/                  محل قرار دادن فایل‌های صوتی (اختیاری)
```

---

## 🚗 اضافه کردن مدل واقعی Nissan Z / Using a real Nissan Z model

بازی با یک مدل سه‌بعدی ساخته‌شده با کد اجرا می‌شود، ولی اگر مدل واقعی دارید:

1. فایل را با نام دقیق `nissan_z.glb` در `public/assets/models/` بگذارید.
2. صفحه را رفرش کنید (اگر سرور در حال اجرا است، لازم نیست دوباره اجرا کنید).

بازی خودش مدل را پیدا می‌کند، اندازه و ارتفاعش را درست می‌کند و جای مدل پیش‌فرض می‌گذارد.
جزئیات بیشتر در [public/assets/models/README.md](public/assets/models/README.md).

همین کار برای صدا هم کار می‌کند: فایل‌های `engine.mp3`، `tire.mp3`، `brake.mp3`،
`collision.mp3`، `nitro.mp3` و `music.mp3` را در `public/assets/sounds/` بگذارید.
See [public/assets/sounds/README.md](public/assets/sounds/README.md).

> این تشخیص خودکار با یک پلاگین کوچک Vite انجام می‌شود که محتوای پوشه `public/assets`
> را به‌صورت `assets/manifest.json` منتشر می‌کند — به همین دلیل کنسول مرورگر تمیز می‌ماند.

---

## ⚙️ تنظیم و بهینه‌سازی / Tuning & performance

- کیفیت گرافیک به‌طور خودکار از سخت‌افزار تشخیص داده می‌شود و در **Settings** قابل تغییر است
  (Low / Medium / High: سایه، Bloom، تعداد درخت و ساختمان، Pixel Ratio).
- تغییر رفتار خودرو (قدرت موتور، گریپ، نیترو، سرعت بیشینه) → `src/game/Config.ts`.
- تغییر شکل مسیر (طول، پیچ‌ها، تعداد چک‌پوینت) → `src/environment/Track.ts` و `TRACK` در `Config.ts`.
- روی یک لپ‌تاپ با گرافیک مجتمع (Intel UHD 630) بازی حدود **۵۵ فریم در ثانیه** با کیفیت High
  و حدود **۳۳۰ draw call** در هر فریم اجرا می‌شود.

نکات بهینه‌سازی که در کد رعایت شده: هندسه‌های مشترک و کش‌شده، `InstancedMesh` برای
درخت/ساختمان/گاردریل/چراغ، جاده و حاشیه هرکدام تک draw call، استخر ذرات دود بدون
تخصیص حافظه در هر فریم، فیزیک با گام ثابت (۱۲۰ هرتز) و مستقل از نرخ فریم.

---

## 🧩 عیب‌یابی / Troubleshooting

| مشکل | راه حل |
| ---- | ------ |
| صفحه سیاه است | کنسول مرورگر را باز کنید (`F12`)؛ متن خطا روی صفحه لودینگ هم نشان داده می‌شود |
| صدا نمی‌آید | یک بار روی صفحه کلیک کنید؛ در Settings هم صدا و موسیقی را چک کنید |
| بازی کند است | در Settings کیفیت را `LOW` کنید |
| خودرو به گاردریل چسبیده | خودش صاف می‌شود، یا کلید `R` را بزنید |
| پورت ۵۱۷۳ اشغال است | `npm run dev -- --port 5174` |
