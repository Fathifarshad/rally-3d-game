import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { Track } from './Track';
import { terrainHeight } from './Terrain';
import { CollisionSystem } from '../physics/CollisionSystem';
import { TRACK, type QualitySettings } from '../game/Config';
import { createRandom } from '../core/MathUtils';
import {
  buildingEmissiveTexture,
  buildingTexture,
  cloudTexture,
  grassTexture,
  signTexture,
} from '../core/TextureFactory';

const BARRIER_OFFSET = TRACK.halfWidth + 1.0;

/**
 * Everything that is not the car: terrain, sky, road furniture, scenery and
 * lighting. Scenery is instanced (one draw call per prop type) and every solid
 * object registers a collider so the world is not just decoration.
 */
export class World {
  readonly scene = new THREE.Scene();
  readonly sun: THREE.DirectionalLight;
  readonly collisions = new CollisionSystem();

  private readonly track: Track;
  private readonly quality: QualitySettings;
  private readonly windUniform = { value: 0 };
  private readonly clouds: THREE.Sprite[] = [];
  private readonly checkpointGates: Array<{
    group: THREE.Group;
    material: THREE.MeshStandardMaterial;
    structure: THREE.MeshStandardMaterial;
  }> = [];
  private elapsed = 0;

  constructor(track: Track, quality: QualitySettings) {
    this.track = track;
    this.quality = quality;

    this.scene.background = new THREE.Color(0x8fb4d8);
    this.scene.fog = new THREE.Fog(0x9fbcd8, 620, quality.drawDistance);

    /* ----------------------------------------------------------------
       Lighting.
       Fill light is kept deliberately low: with a bright sky plus a
       studio environment map, a strong hemisphere/ambient pair turns the
       black paint grey and flattens the whole scene. The sun does the work.
       ---------------------------------------------------------------- */
    const hemi = new THREE.HemisphereLight(0xbcd6f5, 0x4a4a3c, 0.5);
    this.scene.add(hemi);

    const ambient = new THREE.AmbientLight(0xffffff, 0.1);
    this.scene.add(ambient);

    this.sun = new THREE.DirectionalLight(0xfff3e0, 3.1);
    this.sun.position.set(120, 190, -90);
    this.sun.castShadow = quality.shadows;
    this.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    const cam = this.sun.shadow.camera;
    cam.near = 1;
    cam.far = 620;
    cam.left = -110;
    cam.right = 110;
    cam.top = 110;
    cam.bottom = -110;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.045;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.buildSky();
    this.buildTerrain();
    this.scene.add(track.buildRoadMesh(quality.anisotropy));
    this.buildGuardrails();
    this.buildStreetLights();
    this.buildSigns();
    this.buildTrees();
    this.buildBuildings();
    this.buildMountains();
    this.buildClouds();
    this.buildCheckpoints();
  }

  /* ================================================================ */
  /* sky                                                              */
  /* ================================================================ */

  private buildSky(): void {
    const sky = new Sky();
    sky.scale.setScalar(12000);
    const u = sky.material.uniforms;
    u.turbidity.value = 6;
    u.rayleigh.value = 1.6;
    u.mieCoefficient.value = 0.005;
    u.mieDirectionalG.value = 0.75;
    const phi = THREE.MathUtils.degToRad(90 - 34);
    const theta = THREE.MathUtils.degToRad(148);
    u.sunPosition.value.setFromSphericalCoords(1, phi, theta);
    this.scene.add(sky);

    this.sun.position.copy(u.sunPosition.value).multiplyScalar(400);
  }

  /* ================================================================ */
  /* ground                                                           */
  /* ================================================================ */

  private buildTerrain(): void {
    const size = 7000;
    const seg = 170;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, terrainHeight(x, z) - 0.35);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();

    // 7000 m of ground: ~22 m per tile keeps the grass readable up close
    // without turning into moiré in the distance.
    const map = grassTexture([320, 320]);
    map.anisotropy = this.quality.anisotropy;
    const mat = new THREE.MeshStandardMaterial({
      map,
      color: 0x8fa07c,
      roughness: 1,
      metalness: 0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = this.quality.shadows;
    mesh.matrixAutoUpdate = false;
    mesh.name = 'terrain';
    this.scene.add(mesh);
  }

  /* ================================================================ */
  /* guardrails                                                       */
  /* ================================================================ */

  private buildGuardrails(): void {
    const n = this.track.sampleCount;
    const step = 2; // use every other frame — 4 m sections
    const frame = { pos: new THREE.Vector3(), dir: new THREE.Vector3(), side: new THREE.Vector3() };

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    let vertexBase = 0;

    const railTop = 1.05;
    const railBottom = 0.45;

    for (const sign of [-1, 1]) {
      let first = true;
      for (let i = 0; i <= n; i += step) {
        const d = (i % n) * (this.track.totalLength / n);
        this.track.frameAt(d, frame);
        const x = frame.pos.x + frame.side.x * BARRIER_OFFSET * sign;
        const z = frame.pos.z + frame.side.z * BARRIER_OFFSET * sign;
        const y = terrainHeight(x, z);
        const nx = -frame.side.x * sign;
        const nz = -frame.side.z * sign;

        positions.push(x, y + railBottom, z, x, y + railTop, z);
        normals.push(nx, 0, nz, nx, 0, nz);
        const v = d / 8;
        uvs.push(v, 0, v, 1);

        if (!first) {
          const a = vertexBase - 2;
          indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
        first = false;
        vertexBase += 2;
      }
      // Break the strip between the two sides.
      vertexBase += 0;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeBoundingSphere();

    const mat = new THREE.MeshStandardMaterial({
      color: 0xb9bfc6,
      metalness: 0.85,
      roughness: 0.42,
      side: THREE.DoubleSide,
      envMapIntensity: 1.2,
    });
    const rail = new THREE.Mesh(geo, mat);
    rail.castShadow = false;
    rail.receiveShadow = true;
    rail.matrixAutoUpdate = false;
    rail.name = 'guardrail';
    this.scene.add(rail);

    // Posts every 8 m, instanced.
    const postGeo = new THREE.BoxGeometry(0.12, 1.1, 0.12);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x6d747c, metalness: 0.7, roughness: 0.55 });
    const perSide = Math.floor(this.track.totalLength / 8);
    const posts = new THREE.InstancedMesh(postGeo, postMat, perSide * 2);
    posts.castShadow = this.quality.shadows;
    const m = new THREE.Matrix4();
    let idx = 0;
    for (const sign of [-1, 1]) {
      for (let i = 0; i < perSide; i++) {
        const d = i * 8;
        this.track.frameAt(d, frame);
        const x = frame.pos.x + frame.side.x * BARRIER_OFFSET * sign;
        const z = frame.pos.z + frame.side.z * BARRIER_OFFSET * sign;
        m.makeTranslation(x, terrainHeight(x, z) + 0.55, z);
        posts.setMatrixAt(idx++, m);
      }
    }
    posts.count = idx;
    posts.instanceMatrix.needsUpdate = true;
    this.scene.add(posts);
  }

  /* ================================================================ */
  /* street lights                                                    */
  /* ================================================================ */

  private buildStreetLights(): void {
    const spacing = this.quality.streetLightSpacing;
    const count = Math.floor(this.track.totalLength / spacing);
    const frame = { pos: new THREE.Vector3(), dir: new THREE.Vector3(), side: new THREE.Vector3() };

    const poleGeo = new THREE.CylinderGeometry(0.11, 0.15, 8.4, 8);
    poleGeo.translate(0, 4.2, 0);
    const armGeo = new THREE.BoxGeometry(2.3, 0.14, 0.14);
    const lampGeo = new THREE.BoxGeometry(0.9, 0.18, 0.36);

    const metal = new THREE.MeshStandardMaterial({ color: 0x4b5158, metalness: 0.8, roughness: 0.45 });
    const lampMat = new THREE.MeshStandardMaterial({
      color: 0xfff2d0,
      emissive: 0xffd9a0,
      emissiveIntensity: 1.6,
      roughness: 0.4,
    });

    const poles = new THREE.InstancedMesh(poleGeo, metal, count);
    const arms = new THREE.InstancedMesh(armGeo, metal, count);
    const lamps = new THREE.InstancedMesh(lampGeo, lampMat, count);
    poles.castShadow = this.quality.shadows;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);

    for (let i = 0; i < count; i++) {
      const d = i * spacing;
      const sign = i % 2 === 0 ? 1 : -1;
      this.track.frameAt(d, frame);
      const x = frame.pos.x + frame.side.x * (BARRIER_OFFSET + 2.2) * sign;
      const z = frame.pos.z + frame.side.z * (BARRIER_OFFSET + 2.2) * sign;
      const y = terrainHeight(x, z);
      const yaw = Math.atan2(frame.side.x, frame.side.z) + (sign > 0 ? Math.PI : 0);
      q.setFromAxisAngle(up, yaw);

      pos.set(x, y, z);
      m.compose(pos, q, scale);
      poles.setMatrixAt(i, m);

      pos.set(x - frame.side.x * sign * 1.1, y + 8.2, z - frame.side.z * sign * 1.1);
      m.compose(pos, q, scale);
      arms.setMatrixAt(i, m);

      pos.set(x - frame.side.x * sign * 2.1, y + 8.05, z - frame.side.z * sign * 2.1);
      m.compose(pos, q, scale);
      lamps.setMatrixAt(i, m);

      this.collisions.add(x, z, 0.5, 'lamp');
    }
    [poles, arms, lamps].forEach((mesh) => {
      mesh.instanceMatrix.needsUpdate = true;
      this.scene.add(mesh);
    });
  }

  /* ================================================================ */
  /* signs                                                            */
  /* ================================================================ */

  private buildSigns(): void {
    const kinds = ['speed', 'curve', 'exit', 'checkpoint'] as const;
    const spacing = 260;
    const count = Math.floor(this.track.totalLength / spacing);
    const frame = { pos: new THREE.Vector3(), dir: new THREE.Vector3(), side: new THREE.Vector3() };
    const postGeo = new THREE.CylinderGeometry(0.07, 0.07, 3.0, 6);
    postGeo.translate(0, 1.5, 0);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x8b9199, metalness: 0.6, roughness: 0.5 });
    const panelGeo = new THREE.PlaneGeometry(1.7, 1.7);

    for (let i = 0; i < count; i++) {
      const kind = kinds[i % kinds.length];
      const d = i * spacing + 40;
      const sign = i % 2 === 0 ? 1 : -1;
      this.track.frameAt(d, frame);
      const x = frame.pos.x + frame.side.x * (BARRIER_OFFSET + 2.6) * sign;
      const z = frame.pos.z + frame.side.z * (BARRIER_OFFSET + 2.6) * sign;
      const y = terrainHeight(x, z);

      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.rotation.y = Math.atan2(-frame.dir.x, -frame.dir.z);

      const post = new THREE.Mesh(postGeo, postMat);
      post.castShadow = this.quality.shadows;
      g.add(post);

      const panel = new THREE.Mesh(
        panelGeo,
        new THREE.MeshStandardMaterial({
          map: signTexture(kind),
          transparent: true,
          roughness: 0.55,
          metalness: 0.1,
          side: THREE.DoubleSide,
        }),
      );
      panel.position.y = 2.5;
      g.add(panel);
      this.scene.add(g);

      this.collisions.add(x, z, 0.35, 'sign');
    }
  }

  /* ================================================================ */
  /* scenery                                                          */
  /* ================================================================ */

  private buildTrees(): void {
    const rand = createRandom(7717);
    const count = this.quality.treeCount;

    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 3.4, 6);
    trunkGeo.translate(0, 1.7, 0);
    const foliageGeo = new THREE.ConeGeometry(1.9, 5.4, 8);
    foliageGeo.translate(0, 5.0, 0);

    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x53412c, roughness: 0.95 });
    const foliageMat = new THREE.MeshStandardMaterial({ color: 0x2f5a2c, roughness: 0.86 });

    // Cheap wind: shift the crown in the vertex shader by a shared time uniform.
    foliageMat.onBeforeCompile = (shader) => {
      shader.uniforms.uWind = this.windUniform;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform float uWind;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           float sway = sin(uWind + instanceMatrix[3][0] * 0.12 + instanceMatrix[3][2] * 0.08);
           transformed.x += sway * 0.16 * max(transformed.y - 2.0, 0.0) * 0.25;
           transformed.z += cos(uWind * 0.8 + instanceMatrix[3][2] * 0.1) * 0.12 * max(transformed.y - 2.0, 0.0) * 0.25;`,
        );
    };

    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
    const crowns = new THREE.InstancedMesh(foliageGeo, foliageMat, count);
    trunks.castShadow = this.quality.shadows;
    crowns.castShadow = this.quality.shadows;

    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const frame = { pos: new THREE.Vector3(), dir: new THREE.Vector3(), side: new THREE.Vector3() };

    let placed = 0;
    let guard = 0;
    while (placed < count && guard < count * 6) {
      guard++;
      const d = rand() * this.track.totalLength;
      const zone = this.track.zoneAt(d);
      if (zone === 'city' && rand() < 0.75) continue;

      const sign = rand() < 0.5 ? -1 : 1;
      const spread = zone === 'forest' ? 90 : zone === 'mountain' ? 150 : 60;
      const lateral = (BARRIER_OFFSET + 6 + rand() * spread) * sign;
      this.track.frameAt(d, frame);
      const x = frame.pos.x + frame.side.x * lateral;
      const z = frame.pos.z + frame.side.z * lateral;
      const y = terrainHeight(x, z);

      const s = 0.7 + rand() * 0.9;
      scale.set(s, s * (0.85 + rand() * 0.5), s);
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      pos.set(x, y, z);
      m.compose(pos, q, scale);
      trunks.setMatrixAt(placed, m);
      crowns.setMatrixAt(placed, m);
      placed++;

      // Only trees close to the road are solid — distant ones are scenery.
      if (Math.abs(lateral) < 26) this.collisions.add(x, z, 0.6 * s, 'tree');
    }
    trunks.count = placed;
    crowns.count = placed;
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    this.scene.add(trunks);
    this.scene.add(crowns);
  }

  private buildBuildings(): void {
    const rand = createRandom(4242);
    const count = this.quality.buildingCount;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const map = buildingTexture();
    map.anisotropy = this.quality.anisotropy;
    const mat = new THREE.MeshStandardMaterial({
      map,
      emissiveMap: buildingEmissiveTexture(),
      emissive: 0xffc98a,
      emissiveIntensity: 0.22,
      roughness: 0.72,
      metalness: 0.18,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.castShadow = this.quality.shadows;
    mesh.receiveShadow = this.quality.shadows;

    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const frame = { pos: new THREE.Vector3(), dir: new THREE.Vector3(), side: new THREE.Vector3() };

    let placed = 0;
    let guard = 0;
    while (placed < count && guard < count * 8) {
      guard++;
      const d = rand() * this.track.totalLength;
      if (this.track.zoneAt(d) !== 'city') continue;

      const sign = rand() < 0.5 ? -1 : 1;
      const lateral = (BARRIER_OFFSET + 22 + rand() * 90) * sign;
      this.track.frameAt(d, frame);
      const x = frame.pos.x + frame.side.x * lateral;
      const z = frame.pos.z + frame.side.z * lateral;
      const y = terrainHeight(x, z);

      const w = 12 + rand() * 20;
      const dpt = 12 + rand() * 20;
      const h = 14 + rand() * rand() * 62;
      scale.set(w, h, dpt);
      q.setFromAxisAngle(up, Math.atan2(frame.dir.x, frame.dir.z) + (rand() - 0.5) * 0.4);
      pos.set(x, y + h / 2 - 0.4, z);
      m.compose(pos, q, scale);
      mesh.setMatrixAt(placed, m);
      placed++;

      this.collisions.add(x, z, Math.max(w, dpt) * 0.5, 'building');
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(mesh);
  }

  private buildMountains(): void {
    const rand = createRandom(909);
    const geo = new THREE.ConeGeometry(1, 1, 7, 1);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x6c7a80,
      roughness: 1,
      metalness: 0,
      flatShading: true,
    });
    const count = 90;
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);

    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rand() * 0.06;
      const r = 1900 + rand() * 1100;
      const x = Math.cos(a) * r * 1.15;
      const z = Math.sin(a) * r;
      const h = 260 + rand() * 460;
      scale.set(h * (0.9 + rand() * 0.9), h, h * (0.9 + rand() * 0.9));
      q.setFromAxisAngle(up, rand() * Math.PI);
      pos.set(x, terrainHeight(x, z) - 20, z);
      m.compose(pos, q, scale);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  private buildClouds(): void {
    const tex = cloudTexture();
    for (let i = 0; i < this.quality.cloudCount; i++) {
      const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        opacity: 0.42 + Math.random() * 0.3,
        depthWrite: false,
        color: 0xffffff,
      });
      const sprite = new THREE.Sprite(mat);
      const a = Math.random() * Math.PI * 2;
      const r = 300 + Math.random() * 2400;
      const s = 340 + Math.random() * 620;
      sprite.position.set(Math.cos(a) * r, 300 + Math.random() * 420, Math.sin(a) * r);
      sprite.scale.set(s, s * 0.45, 1);
      sprite.renderOrder = -1;
      this.scene.add(sprite);
      this.clouds.push(sprite);
    }
  }

  /* ================================================================ */
  /* checkpoints                                                      */
  /* ================================================================ */

  private buildCheckpoints(): void {
    const frame = { pos: new THREE.Vector3(), dir: new THREE.Vector3(), side: new THREE.Vector3() };
    const pillarGeo = new THREE.BoxGeometry(0.6, 7.5, 0.6);
    const beamGeo = new THREE.BoxGeometry(BARRIER_OFFSET * 2 + 1.2, 0.9, 0.5);
    // A light *bar* rather than a full-height sheet: driving through a big
    // translucent plane tints the entire screen green for a frame or two.
    const ringGeo = new THREE.PlaneGeometry(BARRIER_OFFSET * 2, 0.55);

    this.track.checkpointDistances.forEach((d, i) => {
      this.track.frameAt(d, frame);
      const g = new THREE.Group();
      g.position.copy(frame.pos);
      g.rotation.y = Math.atan2(frame.dir.x, frame.dir.z);

      const structMat = new THREE.MeshStandardMaterial({
        color: 0x14171c,
        metalness: 0.7,
        roughness: 0.4,
      });
      [-1, 1].forEach((s) => {
        const p = new THREE.Mesh(pillarGeo, structMat);
        p.position.set(s * (BARRIER_OFFSET + 0.4), 3.75, 0);
        p.castShadow = this.quality.shadows;
        g.add(p);
      });
      const beam = new THREE.Mesh(beamGeo, structMat);
      beam.position.y = 7.6;
      g.add(beam);

      const material = new THREE.MeshStandardMaterial({
        color: 0x05070a,
        emissive: i === 0 ? 0x2ad07a : 0x1a4a7a,
        emissiveIntensity: 1.8,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(ringGeo, material);
      ring.position.y = 6.6;
      g.add(ring);

      // Banner text uses the checkpoint sign texture.
      const banner = new THREE.Mesh(
        new THREE.PlaneGeometry(6.4, 1.6),
        new THREE.MeshBasicMaterial({ map: signTexture('checkpoint'), transparent: true }),
      );
      banner.position.set(0, 7.6, 0.3);
      g.add(banner);

      this.scene.add(g);
      this.checkpointGates.push({ group: g, material, structure: structMat });
    });
  }

  /** Highlights the gate the player has to drive through next. */
  setActiveCheckpoint(index: number): void {
    this.checkpointGates.forEach((gate, i) => {
      const active = i === index;
      gate.material.emissive.setHex(active ? 0x2ad07a : 0x123a5e);
      gate.material.emissiveIntensity = active ? 3.2 : 1.0;
      // The gantry itself glows faintly so the next gate is readable from afar.
      gate.structure.emissive.setHex(active ? 0x0d3a22 : 0x000000);
      gate.structure.emissiveIntensity = active ? 1 : 0;
    });
  }

  /* ================================================================ */
  /* per-frame                                                        */
  /* ================================================================ */

  update(dt: number, focus: THREE.Vector3): void {
    this.elapsed += dt;
    this.windUniform.value = this.elapsed * 1.4;

    // Keep the shadow frustum tight around the player.
    this.sun.target.position.copy(focus);
    this.sun.position.set(focus.x + 150, focus.y + 210, focus.z - 120);

    // Drifting clouds + a slow day cycle on the light colour.
    for (let i = 0; i < this.clouds.length; i++) {
      const c = this.clouds[i];
      c.position.x += (6 + (i % 5)) * dt * 0.6;
      if (c.position.x > 3200) c.position.x = -3200;
    }

    const warm = 0.5 + 0.5 * Math.sin(this.elapsed * 0.02);
    this.sun.intensity = 2.7 + warm * 0.6;
  }

  dispose(): void {
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh || (obj as THREE.InstancedMesh).isInstancedMesh) {
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m) => m?.dispose());
      }
    });
    this.collisions.clear();
  }
}
