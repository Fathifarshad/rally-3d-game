import { describe, expect, it } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import HeadModel from './components/HeadModel.jsx';

describe('HeadModel', () => {
  it('mounts and animates the treated zones toward their targets', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <HeadModel cheekVolume={0} jawDefinition={0} />
    );

    const meshes = renderer.scene.findAllByType('Mesh');
    expect(meshes.length).toBeGreaterThan(10);

    // مقیاس اولیه (بدون درمان) را پس از تثبیت انیمیشن ثبت می‌کنیم
    await ReactThreeTestRenderer.act(async () => {
      renderer.advanceFrames(30, 0.016);
    });
    const cheekBefore = findTreatedScales(renderer);

    await renderer.update(<HeadModel cheekVolume={1} jawDefinition={1} />);
    await ReactThreeTestRenderer.act(async () => {
      renderer.advanceFrames(120, 0.016);
    });
    const cheekAfter = findTreatedScales(renderer);

    // پس از حرکت اسلایدرها، حداقل یکی از نواحی باید بزرگ‌تر شده باشد
    expect(Math.max(...cheekAfter)).toBeGreaterThan(Math.max(...cheekBefore));
  });
});

/** مقیاس Z تمام گروه‌های صحنه — نواحی درمانی روی این محور رشد می‌کنند */
function findTreatedScales(renderer) {
  const scales = [];
  renderer.scene.instance.traverse((object) => {
    if (object.type === 'Group') scales.push(object.scale.z);
  });
  return scales;
}
