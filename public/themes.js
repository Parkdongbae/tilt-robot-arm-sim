// 배경 테마: 폰의 배경 버튼(또는 Q/E 키)으로 전환
import * as THREE from 'three';

const rand = (a, b) => a + Math.random() * (b - a);
// 로봇팔 작업 영역(반경 3.6) 밖에 장식물을 놓기 위한 위치
// (카메라가 있는 앞쪽(+z)은 화면을 가리지 않도록 비워 둠)
function outside(minR = 4.5, maxR = 11) {
  for (;;) {
    const a = Math.random() * Math.PI * 2;
    const r = rand(minR, maxR);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (z > 1 && Math.abs(x) < 9) continue;
    return [x, z];
  }
}

function skyTexture(top, bottom) {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, top);
  grd.addColorStop(1, bottom);
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const THEMES = [
  {
    name: '로봇 공장',
    sky: ['#3b4252', '#9aa3b5'], fog: [0x9aa3b5, 14, 34],
    floor: 0x6c727f, arena: 0x8a909c, grid: 0x50555f,
    hemi: [0xffffff, 0x444a55, 0.9], sun: [0xfff1dd, 2.2],
    build(g) {
      const pillarM = new THREE.MeshStandardMaterial({ color: 0x4a5160, metalness: 0.4, roughness: 0.6 });
      const crateM = new THREE.MeshStandardMaterial({ color: 0xb07a42, roughness: 0.9 });
      const stripeM = new THREE.MeshStandardMaterial({ color: 0xffc531, roughness: 0.7 });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.6, 6, 0.6), pillarM);
        p.position.set(Math.cos(a) * 9, 3, Math.sin(a) * 9);
        p.castShadow = true;
        g.add(p);
      }
      for (let i = 0; i < 18; i++) {
        const s = rand(0.5, 1.1);
        const c = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateM);
        const [x, z] = outside(4.8, 8);
        c.position.set(x, s / 2, z);
        c.rotation.y = rand(0, Math.PI);
        c.castShadow = c.receiveShadow = true;
        g.add(c);
      }
      // 작업 영역 경계 노란 띠
      const ring = new THREE.Mesh(new THREE.RingGeometry(3.55, 3.7, 64), stripeM);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.012;
      g.add(ring);
      // 컨베이어 벨트 장식
      const belt = new THREE.Mesh(new THREE.BoxGeometry(12, 0.5, 1.2), new THREE.MeshStandardMaterial({ color: 0x2b2f36 }));
      belt.position.set(0, 0.25, -6.5);
      belt.castShadow = belt.receiveShadow = true;
      g.add(belt);
    },
  },
  {
    name: '우주 정거장',
    sky: ['#02030a', '#141a3a'], fog: [0x0a0e22, 18, 50],
    floor: 0x2c3140, arena: 0x3c4458, grid: 0x5a7bff,
    hemi: [0x99aaff, 0x111122, 0.6], sun: [0xffffff, 2.6],
    build(g) {
      const n = 900;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const v = new THREE.Vector3().randomDirection().multiplyScalar(rand(40, 60));
        v.y = Math.abs(v.y) * 0.9 + 2;
        pos.set([v.x, v.y, v.z], i * 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const stars = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.25, fog: false }));
      g.add(stars);
      const planet = new THREE.Mesh(new THREE.SphereGeometry(6, 48, 32),
        new THREE.MeshStandardMaterial({ color: 0x4f7dd8, emissive: 0x10224a, roughness: 0.8, fog: false }));
      planet.position.set(-18, 12, -32);
      g.add(planet);
      const ringP = new THREE.Mesh(new THREE.RingGeometry(8, 11, 64),
        new THREE.MeshBasicMaterial({ color: 0xc9b98a, side: THREE.DoubleSide, transparent: true, opacity: 0.55, fog: false }));
      ringP.position.copy(planet.position);
      ringP.rotation.x = 1.2;
      g.add(ringP);
      // 정거장 모듈
      const modM = new THREE.MeshStandardMaterial({ color: 0xd8dde8, metalness: 0.6, roughness: 0.35 });
      for (let i = 0; i < 6; i++) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 3, 24), modM);
        const [x, z] = outside(6, 10);
        m.position.set(x, 0.8, z);
        m.rotation.z = Math.PI / 2;
        m.rotation.y = rand(0, Math.PI);
        m.castShadow = true;
        g.add(m);
      }
      const glow = new THREE.Mesh(new THREE.RingGeometry(3.55, 3.65, 64), new THREE.MeshBasicMaterial({ color: 0x5ad1ff }));
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.012;
      g.add(glow);
      g.userData.update = (t) => { stars.rotation.y = t * 0.005; };
    },
  },
  {
    name: '바닷속 연구소',
    sky: ['#03253f', '#0d6e8f'], fog: [0x0b5874, 6, 22],
    floor: 0xc9b07a, arena: 0xd8c08c, grid: 0xa88f5c,
    hemi: [0x9fe8ff, 0x2a4a3a, 1.0], sun: [0xcff6ff, 1.6],
    build(g) {
      const weedM = new THREE.MeshStandardMaterial({ color: 0x2f9a55, roughness: 0.8 });
      const weeds = [];
      for (let i = 0; i < 40; i++) {
        const h = rand(1, 3);
        const w = new THREE.Mesh(new THREE.ConeGeometry(0.12, h, 6), weedM);
        const [x, z] = outside(4.2, 10);
        w.position.set(x, h / 2, z);
        w.userData.phase = rand(0, 6);
        g.add(w);
        weeds.push(w);
      }
      const rockM = new THREE.MeshStandardMaterial({ color: 0x6d6a66, roughness: 1 });
      for (let i = 0; i < 14; i++) {
        const r = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.3, 0.9)), rockM);
        const [x, z] = outside(4.5, 10);
        r.position.set(x, 0.2, z);
        r.castShadow = true;
        g.add(r);
      }
      const bubM = new THREE.MeshStandardMaterial({ color: 0xdff8ff, transparent: true, opacity: 0.45, roughness: 0.1 });
      const bubbles = [];
      for (let i = 0; i < 60; i++) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(rand(0.03, 0.09), 8, 6), bubM);
        const [x, z] = outside(3.8, 9);
        b.position.set(x, rand(0, 8), z);
        b.userData.speed = rand(0.3, 0.8);
        g.add(b);
        bubbles.push(b);
      }
      g.userData.update = (t, dt) => {
        weeds.forEach((w) => { w.rotation.z = Math.sin(t * 1.2 + w.userData.phase) * 0.15; });
        bubbles.forEach((b) => { b.position.y += b.userData.speed * dt; if (b.position.y > 9) b.position.y = 0; });
      };
    },
  },
  {
    name: '숲 속 캠프',
    sky: ['#5fa8ef', '#d7ecff'], fog: [0xcfe6f7, 16, 40],
    floor: 0x5c9a46, arena: 0x8a7a5c, grid: 0x6f6046,
    hemi: [0xffffff, 0x3f6b2f, 1.0], sun: [0xfff3d6, 2.6],
    build(g) {
      const trunkM = new THREE.MeshStandardMaterial({ color: 0x7a5434, roughness: 1 });
      const leafM = new THREE.MeshStandardMaterial({ color: 0x2f7d3a, roughness: 0.9 });
      for (let i = 0; i < 32; i++) {
        const s = rand(0.8, 1.6);
        const tree = new THREE.Group();
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * s, 0.16 * s, 1.2 * s, 8), trunkM);
        trunk.position.y = 0.6 * s;
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.8 * s, 2 * s, 10), leafM);
        leaf.position.y = 2 * s;
        trunk.castShadow = leaf.castShadow = true;
        tree.add(trunk, leaf);
        const [x, z] = outside(5, 14);
        tree.position.set(x, 0, z);
        g.add(tree);
      }
      const tent = new THREE.Mesh(new THREE.ConeGeometry(1.4, 1.8, 4), new THREE.MeshStandardMaterial({ color: 0xe06a3a }));
      tent.position.set(5.5, 0.9, -3);
      tent.castShadow = true;
      g.add(tent);
      const cloudM = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, fog: false });
      for (let i = 0; i < 6; i++) {
        const c = new THREE.Group();
        for (let j = 0; j < 4; j++) {
          const s = new THREE.Mesh(new THREE.SphereGeometry(rand(0.8, 1.4), 12, 10), cloudM);
          s.position.set(j * 1.1, rand(-0.2, 0.3), rand(-0.3, 0.3));
          c.add(s);
        }
        const [x, z] = outside(14, 24);
        c.position.set(x, rand(9, 13), z);
        g.add(c);
      }
    },
  },
  {
    name: '사막 발굴지',
    sky: ['#f08a4b', '#ffe0a8'], fog: [0xf5cf98, 14, 38],
    floor: 0xe0b56e, arena: 0xc9a066, grid: 0xb18850,
    hemi: [0xfff1d6, 0x8a5a2a, 1.0], sun: [0xffd8a0, 2.8],
    build(g) {
      const duneM = new THREE.MeshStandardMaterial({ color: 0xd9a95e, roughness: 1 });
      for (let i = 0; i < 10; i++) {
        const d = new THREE.Mesh(new THREE.SphereGeometry(rand(2, 4), 20, 12), duneM);
        const [x, z] = outside(9, 16);
        d.position.set(x, -1.2, z);
        d.scale.y = 0.45;
        g.add(d);
      }
      const cactM = new THREE.MeshStandardMaterial({ color: 0x4f8a3c, roughness: 0.8 });
      for (let i = 0; i < 12; i++) {
        const c = new THREE.Group();
        const h = rand(1, 2);
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, h, 4, 8), cactM);
        body.position.y = h / 2 + 0.18;
        const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.5, 4, 8), cactM);
        arm.position.set(0.25, h * 0.6, 0);
        body.castShadow = arm.castShadow = true;
        c.add(body, arm);
        const [x, z] = outside(4.5, 10);
        c.position.set(x, 0, z);
        c.rotation.y = rand(0, 6);
        g.add(c);
      }
      const sun = new THREE.Mesh(new THREE.SphereGeometry(3, 24, 16), new THREE.MeshBasicMaterial({ color: 0xfff2c4, fog: false }));
      sun.position.set(20, 14, -40);
      g.add(sun);
    },
  },
];

export function applyTheme(ctx, index) {
  const th = THEMES[index];
  const { scene, decor, floor, arena, grid, hemi, sun } = ctx;
  decor.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
  decor.clear();
  if (scene.background && scene.background.dispose) scene.background.dispose();
  decor.userData.update = null;
  th.build(decor);
  scene.background = skyTexture(th.sky[0], th.sky[1]);
  scene.fog = new THREE.Fog(th.fog[0], th.fog[1], th.fog[2]);
  floor.material.color.setHex(th.floor);
  arena.material.color.setHex(th.arena);
  grid.material.color.setHex(th.grid);
  hemi.color.setHex(th.hemi[0]);
  hemi.groundColor.setHex(th.hemi[1]);
  hemi.intensity = th.hemi[2];
  sun.color.setHex(th.sun[0]);
  sun.intensity = th.sun[1];
  return th.name;
}
