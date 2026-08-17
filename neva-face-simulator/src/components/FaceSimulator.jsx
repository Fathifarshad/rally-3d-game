import { Suspense, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { ContactShadows, Environment, Lightformer, OrbitControls } from '@react-three/drei';
import HeadModel from './HeadModel.jsx';

const GOLD = '#d4af37';

/** پارامترهای درمانی — مقدار هر اسلایدر بین ۰ تا ۱۰۰ نگهداری می‌شود */
const TREATMENTS = [
  {
    id: 'cheek',
    label: 'حجم‌دهی گونه',
    hint: 'افزایش برجستگی استخوان گونه (Cheek Filler)',
  },
  {
    id: 'jaw',
    label: 'زاویه‌سازی فک',
    hint: 'برجسته‌سازی زاویه گونیال و خط فک (Jawline)',
  },
];

const INITIAL = { cheek: 0, jaw: 0 };

/** نورپردازی استودیویی سه‌نقطه‌ای + سافت‌باکس‌های محیطی */
function StudioLighting() {
  return (
    <>
      <ambientLight intensity={0.35} />
      <hemisphereLight args={['#ffffff', '#1a1a1a', 0.5]} />

      {/* نور اصلی (Key) — تنها منبع سایه‌انداز */}
      <spotLight
        position={[4, 5, 6]}
        angle={0.42}
        penumbra={0.9}
        intensity={140}
        color="#fff4e2"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0005}
      />

      {/* نور پرکننده (Fill) — نرم‌کردن سایه سمت مقابل */}
      <directionalLight position={[-5, 1.5, 3]} intensity={0.7} color="#cfe0ff" />

      {/* نور لبه‌ای طلایی (Rim) — امضای بصری برند NEVA */}
      <spotLight position={[-3, 2, -5]} angle={0.8} penumbra={1} intensity={90} color={GOLD} />
      <spotLight position={[3, 1, -5]} angle={0.8} penumbra={1} intensity={55} color="#8fb7ff" />

      {/* محیط استودیویی محلی (بدون نیاز به فایل HDRI خارجی) */}
      <Suspense fallback={null}>
        <Environment resolution={256}>
          <Lightformer intensity={3} position={[0, 4, 3]} scale={[8, 3, 1]} color="#ffffff" />
          <Lightformer
            intensity={1.6}
            rotation-y={Math.PI / 2}
            position={[-5, 1, 1]}
            scale={[10, 4, 1]}
            color="#ffe9c4"
          />
          <Lightformer
            intensity={1.2}
            rotation-y={-Math.PI / 2}
            position={[5, 1, 1]}
            scale={[10, 4, 1]}
            color="#bcd4ff"
          />
        </Environment>
      </Suspense>
    </>
  );
}

/** صحنه سه‌بعدی: مدل سر + سایه تماسی + کنترل مدار دوربین */
function Scene({ cheek, jaw }) {
  return (
    <>
      <color attach="background" args={['#08080a']} />
      <fog attach="fog" args={['#08080a', 8, 16]} />

      <StudioLighting />

      <HeadModel cheekVolume={cheek / 100} jawDefinition={jaw / 100} />

      <ContactShadows
        position={[0, -2.35, 0]}
        opacity={0.55}
        scale={12}
        blur={2.6}
        far={5}
        color="#000000"
      />

      <OrbitControls
        makeDefault
        enablePan={false}
        minDistance={3}
        maxDistance={9}
        minPolarAngle={Math.PI / 5}
        maxPolarAngle={Math.PI / 1.7}
        target={[0, 0.1, 0]}
        autoRotate
        autoRotateSpeed={0.4}
      />
    </>
  );
}

/** یک اسلایدر درمانی با نمایش زنده‌ی درصد */
function TreatmentSlider({ label, hint, value, onChange }) {
  return (
    <div className="slider-block">
      <div className="slider-head">
        <label htmlFor={`slider-${label}`}>{label}</label>
        <span className="slider-value">{value}%</span>
      </div>
      <input
        id={`slider-${label}`}
        className="slider"
        type="range"
        min="0"
        max="100"
        step="1"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ '--fill': `${value}%` }}
      />
      <p className="slider-hint">{hint}</p>
    </div>
  );
}

export default function FaceSimulator() {
  const [values, setValues] = useState(INITIAL);

  const setValue = (id, value) => setValues((prev) => ({ ...prev, [id]: value }));
  const reset = () => setValues(INITIAL);

  return (
    <div className="simulator">
      <aside className="sidebar">
        <header className="brand">
          <div className="brand-mark">NEVA</div>
          <h1 className="brand-title">مطب زیبایی نوا</h1>
          <p className="brand-sub">
            زیر نظر دکتر فرشاد فتحی
            <br />و دکتر نغمه نوری
          </p>
        </header>

        <div className="panel">
          <h2 className="panel-title">شبیه‌ساز سه‌بعدی چهره</h2>
          <p className="panel-desc">
            با تغییر اسلایدرها، نتیجه‌ی تقریبی درمان به‌صورت زنده روی مدل سه‌بعدی نمایش داده می‌شود.
          </p>

          {TREATMENTS.map((treatment) => (
            <TreatmentSlider
              key={treatment.id}
              label={treatment.label}
              hint={treatment.hint}
              value={values[treatment.id]}
              onChange={(value) => setValue(treatment.id, value)}
            />
          ))}

          <button className="btn-reset" type="button" onClick={reset}>
            بازگشت به حالت اولیه
          </button>
        </div>

        <footer className="sidebar-footer">
          <p>برای چرخش مدل، با ماوس بکشید — با اسکرول زوم کنید.</p>
          <small>
            این شبیه‌سازی صرفاً جنبه‌ی تصویری دارد و جایگزین مشاوره‌ی حضوری پزشک نیست.
          </small>
        </footer>
      </aside>

      <main className="stage">
        <Canvas
          shadows
          dpr={[1, 2]}
          gl={{ antialias: true }}
          camera={{ position: [0, 0.4, 5.2], fov: 35 }}
        >
          <Scene cheek={values.cheek} jaw={values.jaw} />
        </Canvas>
        <div className="stage-badge">NEVA · Phase 1 — 3D Face Simulator</div>
      </main>
    </div>
  );
}
