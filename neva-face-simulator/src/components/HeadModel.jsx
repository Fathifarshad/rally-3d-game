import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { MathUtils } from 'three';

/**
 * مدل هندسی انتزاعی سر انسان — ساخته‌شده صرفاً از Sphere و Box.
 *
 * محورها: چهره رو به +Z، بالای سر +Y.
 *
 * دو ناحیه‌ی درمانی به‌صورت پارامتریک کنترل می‌شوند:
 *   - گونه‌ها (cheekVolume): حجم و برجستگی استخوان گونه
 *   - زاویه فک (jawDefinition): پهنا و برش زاویه گونیال + چانه
 */

const SKIN = '#dcb69b';
const SKIN_DEEP = '#c9a086';
const GOLD = '#d4af37';

// ضریب میرایی: هرچه بزرگ‌تر، رسیدن به مقدار هدف سریع‌تر
const DAMP = 6;

/** میرایی مستقل از نرخ فریم روی یک بردار سه‌بعدی */
function dampVec3(vec, [x, y, z], delta) {
  vec.x = MathUtils.damp(vec.x, x, DAMP, delta);
  vec.y = MathUtils.damp(vec.y, y, DAMP, delta);
  vec.z = MathUtils.damp(vec.z, z, DAMP, delta);
}

/** یک ناحیه‌ی درمانی: مقیاس/موقعیت متحرک + درخشش طلایی متناسب با شدت درمان */
function TreatedZone({ children, scale, position, intensity, ...props }) {
  const group = useRef(null);
  const material = useRef(null);

  // مقادیر اولیه فقط یک‌بار به‌عنوان prop اعمال می‌شوند؛ در غیر این صورت
  // هر بار که اسلایدر تغییر کند، R3F مقدار جدید را مستقیم روی آبجکت می‌نشاند
  // و انیمیشن نرم (damping) عملاً بی‌اثر می‌شود.
  const initial = useRef({ scale, position });

  useFrame((_, delta) => {
    if (group.current) {
      dampVec3(group.current.scale, scale, delta);
      dampVec3(group.current.position, position, delta);
    }
    if (material.current) {
      material.current.emissiveIntensity = MathUtils.damp(
        material.current.emissiveIntensity,
        intensity * 0.45,
        DAMP,
        delta
      );
    }
  });

  return (
    <group
      ref={group}
      position={initial.current.position}
      scale={initial.current.scale}
      {...props}
    >
      <mesh castShadow receiveShadow>
        {children}
        <meshStandardMaterial
          ref={material}
          color={SKIN}
          emissive={GOLD}
          emissiveIntensity={0}
          roughness={0.62}
          metalness={0.05}
        />
      </mesh>
    </group>
  );
}

/** بافت پوستی مشترک برای اجزای ثابت صورت */
function Skin({ color = SKIN, ...props }) {
  return <meshStandardMaterial color={color} roughness={0.65} metalness={0.05} {...props} />;
}

export default function HeadModel({ cheekVolume = 0, jawDefinition = 0 }) {
  const c = MathUtils.clamp(cheekVolume, 0, 1);
  const j = MathUtils.clamp(jawDefinition, 0, 1);

  // فیلر گونه: عمدتاً برجستگی رو به جلو (Z) و کمی پهنا (X)
  const cheekScale = [0.92 + c * 0.42, 0.74 + c * 0.30, 0.78 + c * 0.72];
  const cheekY = -0.16 + c * 0.06;
  const cheekX = 0.60 + c * 0.05;

  // زاویه‌سازی فک: پهن‌تر و کشیده‌تر شدن زاویه گونیال
  const ramusScale = [1 + j * 0.46, 1 + j * 0.26, 1 + j * 0.34];
  const ramusX = 0.62 + j * 0.10;
  const ramusY = -0.70 - j * 0.07;

  return (
    <group position={[0, 0.25, 0]}>
      {/* ---------- جمجمه و پیشانی ---------- */}
      <mesh castShadow receiveShadow scale={[0.94, 1.08, 1]}>
        <sphereGeometry args={[1, 64, 64]} />
        <Skin />
      </mesh>

      {/* توده‌ی میانی صورت */}
      <mesh castShadow receiveShadow position={[0, -0.3, 0.1]} scale={[0.86, 0.92, 0.94]}>
        <sphereGeometry args={[1, 48, 48]} />
        <Skin />
      </mesh>

      {/* ---------- گونه‌ها (متصل به اسلایدر حجم‌دهی) ---------- */}
      {[-1, 1].map((side) => (
        <TreatedZone
          key={`cheek-${side}`}
          position={[side * cheekX, cheekY, 0.58]}
          scale={cheekScale}
          intensity={c}
        >
          <sphereGeometry args={[0.34, 48, 48]} />
        </TreatedZone>
      ))}

      {/* ---------- زاویه فک / راموس (متصل به اسلایدر زاویه‌سازی) ---------- */}
      {[-1, 1].map((side) => (
        <TreatedZone
          key={`ramus-${side}`}
          position={[side * ramusX, ramusY, 0.06]}
          scale={ramusScale}
          intensity={j}
          rotation={[0, 0, side * 0.12]}
        >
          <boxGeometry args={[0.3, 0.6, 0.72]} />
        </TreatedZone>
      ))}

      {/* بدنه‌ی فک پایین */}
      <mesh castShadow receiveShadow position={[0, -1.0, 0.3]} rotation={[0.08, 0, 0]}>
        <boxGeometry args={[1.02, 0.32, 0.72]} />
        <Skin color={SKIN_DEEP} />
      </mesh>

      {/* چانه — با زاویه‌سازی فک کمی برجسته‌تر می‌شود */}
      <TreatedZone
        position={[0, -1.06, 0.6]}
        scale={[1 + j * 0.16, 1 + j * 0.12, 1 + j * 0.3]}
        intensity={j * 0.7}
      >
        <boxGeometry args={[0.46, 0.34, 0.26]} />
      </TreatedZone>

      {/* ---------- بینی ---------- */}
      <mesh castShadow position={[0, -0.28, 0.94]} rotation={[0.18, 0, 0]}>
        <boxGeometry args={[0.16, 0.52, 0.22]} />
        <Skin />
      </mesh>
      <mesh castShadow position={[0, -0.52, 1.0]}>
        <sphereGeometry args={[0.13, 32, 32]} />
        <Skin />
      </mesh>

      {/* ---------- چشم‌ها و ابروها ---------- */}
      {[-1, 1].map((side) => (
        <group key={`eye-${side}`}>
          <mesh position={[side * 0.34, -0.06, 0.82]} scale={[1.15, 0.72, 0.6]}>
            <sphereGeometry args={[0.15, 32, 32]} />
            <meshStandardMaterial color="#2b2b2b" roughness={0.2} metalness={0.1} />
          </mesh>
          <mesh castShadow position={[side * 0.34, 0.14, 0.85]} rotation={[0, 0, side * -0.1]}>
            <boxGeometry args={[0.34, 0.06, 0.1]} />
            <meshStandardMaterial color="#4a3527" roughness={0.8} />
          </mesh>
        </group>
      ))}

      {/* ---------- لب‌ها ---------- */}
      <mesh castShadow position={[0, -0.78, 0.82]}>
        <boxGeometry args={[0.4, 0.09, 0.14]} />
        <meshStandardMaterial color="#b9756b" roughness={0.5} />
      </mesh>

      {/* ---------- گوش‌ها ---------- */}
      {[-1, 1].map((side) => (
        <mesh
          key={`ear-${side}`}
          castShadow
          position={[side * 0.92, -0.12, -0.02]}
          scale={[0.4, 1.05, 0.75]}
        >
          <sphereGeometry args={[0.2, 32, 32]} />
          <Skin color={SKIN_DEEP} />
        </mesh>
      ))}

      {/* ---------- گردن ---------- */}
      <mesh castShadow receiveShadow position={[0, -1.62, 0.02]}>
        <cylinderGeometry args={[0.4, 0.46, 0.8, 40]} />
        <Skin color={SKIN_DEEP} />
      </mesh>
    </group>
  );
}
