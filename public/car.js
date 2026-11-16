// 기울기 핸들 레이싱 — PC 게임 화면
// 트랙 생성, 차량 물리, 변속기(자동/수동), 레이스 진행, HUD
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

// ====================================================================
// 트랙
// ====================================================================
const CTRL = [
  [0, 0], [120, 0], [200, -20], [240, -80], [210, -150], [140, -170], [90, -130],
  [40, -120], [-20, -160], [-90, -200], [-170, -170], [-190, -90], [-140, -40], [-80, -10],
];
const N = 640;            // 트랙 중심선 샘플 수
const ROAD_HALF = 6.5;    // 도로 반폭 (m)
const CURB = 0.9;         // 연석 폭
const WALL = 14;          // 중심선에서 방호벽까지 거리
const LAPS = 3;

const curve = new THREE.CatmullRomCurve3(CTRL.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'catmullrom', 0.5);
const P = curve.getSpacedPoints(N).slice(0, N);                                   // 중심선 점
const T = P.map((p, i) => P[(i + 1) % N].clone().sub(P[(i - 1 + N) % N]).normalize()); // 진행 방향
const L = T.map((t) => new THREE.Vector3(t.z, 0, -t.x));                          // 왼쪽 방향
const TRACK_LEN = curve.getLength();

// ====================================================================
// 화면 기본 설정 (하늘·환경광·톤매핑)
// ====================================================================
const renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.42;
const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 4000);

// ---- 후처리: 장면 → 빛 번짐(Bloom) → 톤매핑·색공간 ----
// 장면은 HDR(HalfFloat)로 그리고 4x MSAA 로 계단 현상을 줄인다.
// Bloom 임계값이 높아서 신호등·브레이크등·해처럼 아주 밝은 것만 번진다.
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.45, 0.3, 2.6);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// 태양 방향 (하늘·그림자·반사가 모두 이 방향을 씀) — 맑은 오후
const SUN_DIR = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 30), THREE.MathUtils.degToRad(215));

// ---- 하늘: 위는 짙은 파랑 → 아래로 옅은 하늘색 → 지평선은 노을빛 ----
// 노출(0.42)에 맞춰 하늘 밝기를 SKY_BRIGHT 배로 올려 둔다.
const SKY_BRIGHT = 2.4;
const SKY_TOP = new THREE.Color(0x1f5fc4), SKY_MID = new THREE.Color(0x6aa8ea);
const SKY_HZN = new THREE.Color(0xf3d2b4), SKY_GLOW = new THREE.Color(0xffa565);
function skyMaterial(disk) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: SKY_TOP }, mid: { value: SKY_MID }, hzn: { value: SKY_HZN }, glow: { value: SKY_GLOW },
      sunDir: { value: SUN_DIR }, bright: { value: SKY_BRIGHT }, disk: { value: disk },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 top, mid, hzn, glow, sunDir;
      uniform float bright, disk;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        float s = max(dot(d, sunDir), 0.0);
        float az = 0.5 + 0.5 * dot(normalize(d.xz + 1e-5), normalize(sunDir.xz));   // 해 쪽일수록 1
        vec3 col = mix(hzn, mid, smoothstep(-0.02, 0.24, h));
        col = mix(col, top, smoothstep(0.2, 0.9, h));
        // 지평선 띠: 해가 있는 쪽은 주황빛 노을, 반대쪽은 연한 분홍빛
        float band = 1.0 - smoothstep(0.0, 0.16, abs(h));
        col = mix(col, glow, band * (0.25 + 0.6 * az * az));
        col += glow * pow(s, 18.0) * 0.45;                                       // 해 주변 빛무리
        col += vec3(1.0, 0.95, 0.85) * smoothstep(0.99935, 0.9997, s) * disk;     // 해
        col = mix(col, hzn * 0.85, smoothstep(0.0, -0.12, h));                   // 지평선 아래
        gl_FragColor = vec4(col * bright, 1.0);
      }`,
  });
}
const skyDome = new THREE.Mesh(new THREE.SphereGeometry(3000, 48, 24), skyMaterial(40));
skyDome.renderOrder = -1000;
skyDome.frustumCulled = false;
scene.add(skyDome);

// 지평선 색과 같은 지수 안개 → 먼 산과 나무가 하늘에 자연스럽게 녹아든다
const HAZE = SKY_HZN.clone().lerp(SKY_MID, 0.55).multiplyScalar(SKY_BRIGHT * 0.92);
scene.fog = new THREE.FogExp2(HAZE, 0.00095);

// ---- 환경 반사맵: RoomEnvironment 의 스튜디오 조명판 + 실제 하늘 + 도로 ----
// 방 벽은 빼고 조명판만 남겨, 차체에 또렷한 하이라이트가 생기면서도 하늘과 도로가 비친다.
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = new RoomEnvironment(renderer);
  for (const o of [...env.children]) {
    if (o.isMesh && o.material.isMeshBasicMaterial) o.material.color.multiplyScalar(0.09);  // 조명판
    else env.remove(o);                                                                    // 방 벽·상자·점광원
  }
  env.add(new THREE.Mesh(new THREE.SphereGeometry(90, 32, 16), skyMaterial(6)));
  const ground = new THREE.Mesh(new THREE.CircleGeometry(90, 32),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0x4b5048).multiplyScalar(SKY_BRIGHT * 0.55) }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.2;
  env.add(ground);
  scene.environment = pmrem.fromScene(env, 0.02).texture;
  pmrem.dispose();
}

scene.add(new THREE.HemisphereLight(0xdcecff, 0x5a7a45, 0.8));
const sun = new THREE.DirectionalLight(0xfff1d8, 4.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -42, right: 42, top: 42, bottom: -42, near: 1, far: 400 });
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.035;
sun.shadow.radius = 2.5;
scene.add(sun, sun.target);

// ---- 절차적 텍스처 ----
function canvasTex(size, draw, { repeat = [1, 1], color = true } = {}) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d'), size);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = MAX_ANISO;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function speckle(c, s, n, colors, max = 2.2) {
  for (let i = 0; i < n; i++) {
    c.fillStyle = colors[(rnd() * colors.length) | 0];
    const r = 0.6 + rnd() * max;
    c.fillRect(rnd() * s, rnd() * s, r, r);
  }
}
const asphaltTex = canvasTex(1024, (c, s) => {
  c.fillStyle = '#3c3f45'; c.fillRect(0, 0, s, s);
  // 보수한 자국처럼 조금 더 어둡거나 밝은 얼룩
  for (let i = 0; i < 14; i++) {
    const x = rnd() * s, y = rnd() * s, r = s * (0.05 + rnd() * 0.12);
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    const tone = rnd() > 0.5 ? '0,0,0' : '150,150,155';
    g.addColorStop(0, `rgba(${tone},.10)`); g.addColorStop(1, `rgba(${tone},0)`);
    c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // 거친 골재 입자
  speckle(c, s, 90000, ['rgba(255,255,255,.07)', 'rgba(0,0,0,.14)', 'rgba(120,125,135,.12)', 'rgba(0,0,0,.08)']);
  speckle(c, s, 6000, ['rgba(210,210,215,.22)', 'rgba(0,0,0,.3)'], 1.2);
  // 타이어가 자주 지나가는 자리는 살짝 어둡게
  for (const x of [0.3, 0.7]) {
    const g = c.createLinearGradient((x - 0.13) * s, 0, (x + 0.13) * s, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,.22)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect((x - 0.13) * s, 0, 0.26 * s, s);
  }
});
const asphaltBump = canvasTex(512, (c, s) => {
  c.fillStyle = '#808080'; c.fillRect(0, 0, s, s);
  speckle(c, s, 60000, ['#5a5a5a', '#a8a8a8', '#707070', '#939393'], 1.6);
}, { color: false });
const grassTex = canvasTex(512, (c, s) => {
  c.fillStyle = '#5a9c46'; c.fillRect(0, 0, s, s);
  speckle(c, s, 50000, ['rgba(40,95,35,.35)', 'rgba(120,175,80,.3)', 'rgba(70,130,50,.35)', 'rgba(150,180,90,.14)'], 3);
  // 풀잎 결: 짧은 획을 여러 방향으로
  c.lineWidth = 1;
  c.lineCap = 'round';
  for (let i = 0; i < 14000; i++) {
    const x = rnd() * s, y = rnd() * s, l = 3 + rnd() * 8, a = -0.6 + rnd() * 1.2;
    c.strokeStyle = ['rgba(30,80,28,.38)', 'rgba(145,195,95,.30)', 'rgba(85,145,58,.35)'][(rnd() * 3) | 0];
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.sin(a) * l, y - Math.cos(a) * l); c.stroke();
  }
}, { repeat: [300, 300] });

// 타이어 스키드 자국 (투명 배경 위 검은 줄). 가로 = 도로 폭, 세로 = 30m
const SKID_LEN = 30;
const skidTex = canvasTex(1024, (c, s) => {
  c.clearRect(0, 0, s, s);
  for (let k = 0; k < 11; k++) {
    const cx = s * (0.12 + rnd() * 0.76), y0 = rnd() * s * 0.5, len = s * (0.25 + rnd() * 0.5);
    const gap = 125 * (0.9 + rnd() * 0.2);      // 좌우 바퀴 간격 (~1.6m)
    const peak = 0.55 + rnd() * 0.4, drift = (rnd() - 0.5) * 60;
    for (const off of [-gap / 2, gap / 2]) {
      for (let y = 0; y < len; y += 2) {
        const t = y / len;
        const a = peak * Math.sin(Math.PI * t) ** 0.6 * (0.75 + rnd() * 0.25);
        const x = cx + off + drift * t * t + (rnd() - 0.5) * 1.5;
        c.fillStyle = `rgba(2,2,2,${a.toFixed(3)})`;
        c.fillRect(x - 10, (y0 + y) % s, 20, 2);   // 아래로 넘치면 위에서 이어짐(타일 이음매 없음)
      }
    }
  }
});
const concreteTex = canvasTex(256, (c, s) => {
  c.fillStyle = '#d9dcdf'; c.fillRect(0, 0, s, s);
  speckle(c, s, 9000, ['rgba(0,0,0,.06)', 'rgba(255,255,255,.25)', 'rgba(90,90,90,.06)'], 3);
});

// ---- 트랙을 따라가는 띠 모양 메시 ----
// a, b: 중심선에서의 좌우 거리(왼쪽 +), ya, yb: 높이. uv: [가로 반복, 세로 타일 길이(m)]
const SEG = TRACK_LEN / N;
function ribbon(a, ya, b, yb, material, { colorAt = null, filter = null, uv = null } = {}) {
  const pos = [], col = [], uvs = [], idx = [];
  let n = 0;
  for (let i = 0; i < N; i++) {
    if (filter && !filter(i)) continue;
    const j = (i + 1) % N;
    pos.push(
      P[i].x + L[i].x * a, ya, P[i].z + L[i].z * a,
      P[i].x + L[i].x * b, yb, P[i].z + L[i].z * b,
      P[j].x + L[j].x * a, ya, P[j].z + L[j].z * a,
      P[j].x + L[j].x * b, yb, P[j].z + L[j].z * b,
    );
    if (colorAt) { const c = colorAt(i); for (let k = 0; k < 4; k++) col.push(c.r, c.g, c.b); }
    if (uv) { const v0 = (i * SEG) / uv[1], v1 = ((i + 1) * SEG) / uv[1]; uvs.push(0, v0, uv[0], v0, 0, v1, uv[0], v1); }
    idx.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);
    n += 4;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (colorAt) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.receiveShadow = true;
  scene.add(m);
  return m;
}

const startLamps = [];
function buildWorld() {
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, side: THREE.DoubleSide, ...o });
  const shadow = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };

  // ---- 잔디 (얼룩덜룩한 색 변화) ----
  const gg = new THREE.PlaneGeometry(2600, 2600, 90, 90);
  const gc = [];
  for (let i = 0; i < gg.attributes.position.count; i++) {
    const k = 0.8 + rnd() * 0.3;
    gc.push(k * (0.92 + rnd() * 0.12), k, k * (0.85 + rnd() * 0.15));
  }
  gg.setAttribute('color', new THREE.Float32BufferAttribute(gc, 3));
  const grass = new THREE.Mesh(gg, std({ map: grassTex, vertexColors: true, roughness: 1 }));
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(20, 0, -100);
  grass.receiveShadow = true;
  scene.add(grass);

  // ---- 안전지대(깎은 잔디 줄무늬), 도로, 차선 ----
  const v1 = new THREE.Color(0x77b85a), v2 = new THREE.Color(0x67a84e);
  ribbon(WALL, 0.02, -WALL, 0.02, std({ vertexColors: true, map: grassTex, roughness: 1 }),
    { colorAt: (i) => (Math.floor(i / 5) % 2 ? v1 : v2), uv: [10, 2.8] });
  ribbon(ROAD_HALF, 0.05, -ROAD_HALF, 0.05,
    std({ map: asphaltTex, bumpMap: asphaltBump, bumpScale: 0.6, roughness: 0.82, envMapIntensity: 0.5 }),
    { uv: [1, ROAD_HALF * 2] });
  // 코너 진입 구간(브레이크를 밟는 곳)에만 스키드 자국
  const bend = (i) => { const a = T[(i - 4 + N) % N], b = T[(i + 4) % N]; return Math.acos(clamp(a.x * b.x + a.z * b.z, -1, 1)); };
  const braking = (i) => { let m = 0; for (let k = 0; k <= 36; k += 3) m = Math.max(m, bend((i + k) % N)); return m > 0.2; };
  ribbon(ROAD_HALF, 0.06, -ROAD_HALF, 0.06,
    std({ map: skidTex, transparent: true, depthWrite: false, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    { uv: [1, SKID_LEN], filter: braking });
  const white =std({ color: 0xe9e9e4, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  ribbon(ROAD_HALF - 0.3, 0.07, ROAD_HALF - 0.55, 0.07, white);
  ribbon(-ROAD_HALF + 0.55, 0.07, -ROAD_HALF + 0.3, 0.07, white);
  ribbon(0.13, 0.07, -0.13, 0.07, white, { filter: (i) => (i >> 2) % 2 === 0 });

  // ---- 연석 (빨강/하양, 살짝 솟은 모양) ----
  const red = new THREE.Color(0xc81e2e), wht = new THREE.Color(0xf0f0ec);
  const curbMat = std({ vertexColors: true, roughness: 0.6 });
  const curbCol = (i) => (Math.floor(i / 3) % 2 ? red : wht);
  for (const s of [1, -1]) {
    const a = s * ROAD_HALF, m = s * (ROAD_HALF + CURB * 0.55), b = s * (ROAD_HALF + CURB);
    if (s > 0) { ribbon(m, 0.13, a, 0.055, curbMat, { colorAt: curbCol }); ribbon(b, 0.03, m, 0.13, curbMat, { colorAt: curbCol }); }
    else { ribbon(a, 0.055, m, 0.13, curbMat, { colorAt: curbCol }); ribbon(m, 0.13, b, 0.03, curbMat, { colorAt: curbCol }); }
  }

  // ---- 방호벽 (콘크리트 + 색 띠) ----
  const blue = new THREE.Color(0x1f5fae);
  const wallMat = std({ map: concreteTex, roughness: 0.85 });
  const bandMat = std({ vertexColors: true, roughness: 0.55 });
  const bandCol = (i) => (Math.floor(i / 6) % 2 ? blue : wht);
  for (const s of [1, -1]) {
    const o = WALL * s, t = 0.35 * s;
    shadow(ribbon(o, 0, o, 0.75, wallMat, { uv: [1, 1.5] }));
    shadow(ribbon(o, 0.75, o, 1.05, bandMat, { colorAt: bandCol }));
    if (s > 0) ribbon(o + t, 1.05, o, 1.05, bandMat, { colorAt: bandCol });
    else ribbon(o, 1.05, o + t, 1.05, bandMat, { colorAt: bandCol });
    shadow(ribbon(o + t, 0, o + t, 1.05, wallMat, { uv: [1, 1.5] }));
  }

  // ---- 출발선 + 게이트 + 신호등 ----
  const start = new THREE.Group();
  start.position.copy(P[0]);
  start.rotation.y = Math.atan2(T[0].x, T[0].z);
  const checker = canvasTex(256, (c, s) => {
    const q = s / 16;
    for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) { c.fillStyle = (x + y) % 2 ? '#15161a' : '#f1f1ee'; c.fillRect(x * q, y * q, q, q); }
  }, { repeat: [1, 2 / 13] });
  checker.magFilter = THREE.NearestFilter;
  const line = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2, 2),
    new THREE.MeshStandardMaterial({ map: checker, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  line.rotation.x = -Math.PI / 2;
  line.position.y = 0.075;
  line.receiveShadow = true;
  start.add(line);
  const steel = new THREE.MeshStandardMaterial({ color: 0x2a2f38, metalness: 0.85, roughness: 0.35 });
  for (const s of [1, -1]) {
    const post = shadow(new THREE.Mesh(new RoundedBoxGeometry(0.6, 7.4, 0.6, 3, 0.08), steel));
    post.position.set(s * (ROAD_HALF + 1.8), 3.7, 0);
    const foot = shadow(new THREE.Mesh(new RoundedBoxGeometry(1.3, 0.5, 1.3, 2, 0.08), steel));
    foot.position.set(s * (ROAD_HALF + 1.8), 0.25, 0);
    start.add(post, foot);
  }
  const banner = canvasTex(1024, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 1024);
    g.addColorStop(0, '#e0263a'); g.addColorStop(1, '#a8101f');
    c.fillStyle = g; c.fillRect(0, 0, 1024, 1024);
    c.fillStyle = '#fff'; c.font = '900 620px "Segoe UI", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.save(); c.scale(1, 1); c.fillText('START · FINISH', 512, 540, 960); c.restore();
  });
  const bannerMat = new THREE.MeshStandardMaterial({ map: banner, roughness: 0.5, metalness: 0.1 });
  const beam = shadow(new THREE.Mesh(new RoundedBoxGeometry(ROAD_HALF * 2 + 4.2, 1.6, 0.6, 3, 0.08),
    [steel, steel, steel, steel, bannerMat, bannerMat]));
  beam.position.y = 6.7;
  start.add(beam);
  // 신호등 5개 (카운트다운에 맞춰 켜짐) — 출발 쪽을 향함
  const lampBar = shadow(new THREE.Mesh(new RoundedBoxGeometry(5.6, 0.9, 0.35, 3, 0.08), steel));
  lampBar.position.set(0, 5.4, -0.2);
  start.add(lampBar);
  for (let i = 0; i < 5; i++) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1a1a, emissiveIntensity: 0, roughness: 0.3 });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 14), mat);
    lamp.position.set(-2 + i, 5.4, -0.36);
    lamp.scale.z = 0.5;
    start.add(lamp);
    startLamps.push(mat);
  }
  scene.add(start);

  // ---- 광고판 ----
  const ads = [
    ['TILT RACING', '#0b3d91', '#ffffff'], ['한 바퀴 더!', '#f4a300', '#1a1a1a'], ['BRAKE → TURN → GAS', '#111418', '#4cc9f0'],
    ['SMART WHEEL', '#0f7a4f', '#ffffff'], ['FULL THROTTLE', '#b3122a', '#ffe9a8'], ['PIT STOP CAFE', '#f2f2ee', '#c81e2e'],
  ];
  const sideAt = (i) => {            // 코너 바깥쪽
    const a = T[(i - 12 + N) % N], b = T[(i + 12) % N];
    return a.x * b.z - a.z * b.x > 0 ? -1 : 1;
  };
  [70, 150, 235, 300, 395, 470, 545, 600].forEach((i, k) => {
    const [text, bg, fg] = ads[k % ads.length];
    const tex = canvasTex(512, (c, s) => {
      c.fillStyle = bg; c.fillRect(0, 0, s, s);
      c.fillStyle = fg; c.font = '900 300px "Segoe UI", "Malgun Gothic", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(text, s / 2, s / 2 + 10, s - 50);
    });
    const side = sideAt(i);
    const g = new THREE.Group();
    g.position.set(P[i].x + L[i].x * side * (WALL + 3.5), 0, P[i].z + L[i].z * side * (WALL + 3.5));
    const nx = -T[i].x * 0.55 - side * L[i].x, nz = -T[i].z * 0.55 - side * L[i].z;
    g.rotation.y = Math.atan2(nx, nz);
    const board = shadow(new THREE.Mesh(new RoundedBoxGeometry(11, 2.6, 0.25, 2, 0.06),
      [steel, steel, steel, steel, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 }), steel]));
    board.position.y = 2.6;
    g.add(board);
    for (const x of [-4.2, 4.2]) {
      const leg = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.4, 0.25), steel));
      leg.position.set(x, 0.7, -0.1);
      g.add(leg);
    }
    scene.add(g);
  });

  // ---- 관중석 (출발선 옆) ----
  {
    const i = N - 34, side = 1;
    const g = new THREE.Group();
    g.position.set(P[i].x + L[i].x * side * (WALL + 4), 0, P[i].z + L[i].z * side * (WALL + 4));
    g.rotation.y = Math.atan2(T[i].x, T[i].z);
    const conc = std({ map: concreteTex, color: 0xc9ccd0 });
    const seatCols = [0x1f5fae, 0xe9e9e4, 0xc81e2e];
    for (let r = 0; r < 6; r++) {
      const step = shadow(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.8 * (r + 1), 46), conc));
      step.position.set(r * 1.5 + 0.75, 0.4 * (r + 1), 0);
      const seats = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.35, 45), std({ color: seatCols[r % 3], roughness: 0.5 })));
      seats.position.set(r * 1.5 + 0.9, 0.8 * (r + 1) + 0.17, 0);
      g.add(step, seats);
    }
    const roof = shadow(new THREE.Mesh(new RoundedBoxGeometry(11, 0.3, 48, 2, 0.1), std({ color: 0xf2f3f5, metalness: 0.3, roughness: 0.4 })));
    roof.position.set(4.6, 8.6, 0);
    roof.rotation.z = 0.08;
    g.add(roof);
    for (const z of [-22, -11, 0, 11, 22]) {
      const col = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.35, 8.8, 0.35), steel));
      col.position.set(9.3, 4.4, z);
      g.add(col);
    }
    scene.add(g);
  }

  // ---- 나무 (침엽수 3단, 색·크기 제각각) ----
  const spots = [];
  for (let tries = 0; spots.length < 900 && tries < 14000; tries++) {
    const x = -420 + rnd() * 880, z = -440 + rnd() * 680;
    let ok = true;
    for (let i = 0; i < N; i += 2) {
      const dx = x - P[i].x, dz = z - P[i].z;
      if (dx * dx + dz * dz < (WALL + 9) ** 2) { ok = false; break; }
    }
    if (ok) spots.push([x, z, 0.7 + rnd() * 1.0, rnd() * Math.PI]);
  }
  const cone = (r, h, y) => { const c = new THREE.ConeGeometry(r, h, 9); c.translate(0, y, 0); return c; };
  const leafGeo = mergeGeometries([cone(2.5, 3.6, 3.4), cone(2.0, 3.2, 5.4), cone(1.4, 2.8, 7.2)]);
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.28, 0.42, 2.4, 7), std({ color: 0x5b3d24 }), spots.length);
  const leaf = new THREE.InstancedMesh(leafGeo, std({ color: 0xffffff, roughness: 0.95, envMapIntensity: 0.4 }), spots.length);
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  spots.forEach(([x, z, s, r], i) => {
    q.setFromAxisAngle(up, r);
    mtx.compose(new THREE.Vector3(x, 1.2 * s, z), q, new THREE.Vector3(s, s, s)); trunk.setMatrixAt(i, mtx);
    mtx.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s * (0.9 + rnd() * 0.3), s)); leaf.setMatrixAt(i, mtx);
    leaf.setColorAt(i, col.setHSL(0.30 + rnd() * 0.07, 0.42 + rnd() * 0.2, 0.2 + rnd() * 0.1));
  });
  trunk.castShadow = leaf.castShadow = true;
  leaf.receiveShadow = true;
  scene.add(trunk, leaf);

  // ---- 먼 산 ----
  const mMat = new THREE.MeshStandardMaterial({ color: 0x5f7f6a, roughness: 1, flatShading: true });
  const snow = new THREE.MeshStandardMaterial({ color: 0x7f97a6, roughness: 1, flatShading: true });
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2 + rnd() * 0.1, d = 800 + rnd() * 330, h = 90 + rnd() * 190;
    const m = new THREE.Mesh(new THREE.ConeGeometry(150 + rnd() * 170, h, 7, 3), rnd() > 0.5 ? mMat : snow);
    const p = m.geometry.attributes.position;
    for (let k = 0; k < p.count; k++) if (p.getY(k) < h / 2 - 1) p.setXYZ(k, p.getX(k) * (0.8 + rnd() * 0.5), p.getY(k), p.getZ(k) * (0.8 + rnd() * 0.5));
    m.geometry.computeVertexNormals();
    m.position.set(20 + Math.cos(a) * d, h / 2 - 4, -100 + Math.sin(a) * d);
    m.rotation.y = rnd() * 6;
    scene.add(m);
  }

  // ---- 구름 ----
  const cloudTex = canvasTex(256, (c, s) => {
    for (let i = 0; i < 22; i++) {
      const x = s * (0.2 + rnd() * 0.6), y = s * (0.38 + rnd() * 0.24), r = s * (0.08 + rnd() * 0.14);
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, s, s);
    }
  });
  const cloudMat = new THREE.SpriteMaterial({ map: cloudTex, fog: false, depthWrite: false, opacity: 0.85 });
  cloudMat.color.setScalar(SKY_BRIGHT * 1.05);   // 하늘과 같은 밝기 기준
  for (let i = 0; i < 26; i++) {
    const sp = new THREE.Sprite(cloudMat);
    const a = rnd() * Math.PI * 2, d = 500 + rnd() * 1300, w = 380 + rnd() * 420;
    sp.position.set(Math.cos(a) * d, 260 + rnd() * 240, Math.sin(a) * d);
    sp.scale.set(w, w * 0.55, 1);
    scene.add(sp);
  }
}
buildWorld();

// ====================================================================
// 차량 모델
// ====================================================================
const carObj = new THREE.Group();
const carBody = new THREE.Group();   // 기울어짐(롤/피치) 표현용
const wheels = [];
const frontPivots = [];
let brakeLightMat;
const exhaustTips = [];   // 배기구 끝 위치 (연기 파티클이 나오는 곳)
function buildCar() {
  // 고광택 메탈릭 레드 + 클리어코트: 하늘과 도로가 은은하게 비친다
  const paint = new THREE.MeshPhysicalMaterial({ color: 0xa8000f, metalness: 0.6, roughness: 0.2, clearcoat: 1.0, clearcoatRoughness: 0.03, envMapIntensity: 0.85 });
  // 카본: 능직(트윌) 무늬 + 클리어코트
  const weave = canvasTex(128, (c, s) => {
    const q = s / 8;
    for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) {
      const on = ((x + y) >> 1) % 2 === 0;
      const g = on ? c.createLinearGradient(x * q, 0, x * q + q, 0) : c.createLinearGradient(0, y * q, 0, y * q + q);
      g.addColorStop(0, on ? '#1b1d22' : '#0c0d10'); g.addColorStop(0.5, on ? '#3a3e46' : '#22252b'); g.addColorStop(1, on ? '#1b1d22' : '#0c0d10');
      c.fillStyle = g; c.fillRect(x * q, y * q, q, q);
    }
  }, { repeat: [6, 2] });
  const carbon = new THREE.MeshPhysicalMaterial({ map: weave, metalness: 0.35, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 0.9 });
  const matte = new THREE.MeshStandardMaterial({ color: 0x0b0c0e, metalness: 0.05, roughness: 0.88 });   // 무광 블랙 (범퍼 하단)
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x05080c, metalness: 0.9, roughness: 0.04, clearcoat: 1, envMapIntensity: 1.6 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xeef1f5, metalness: 1, roughness: 0.12, envMapIntensity: 1.3 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.88 });
  const add = (geo, mat, x = 0, y = 0, z = 0, parent = carBody) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const rbox = (w, h, d, r = 0.03) => new RoundedBoxGeometry(w, h, d, 3, r);
  // 옆모습(앞뒤 z, 높이 y)을 그려 차폭 방향으로 밀어내 차체를 만든다
  const extrudeSide = (shape, width, bevel) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.7, bevelSegments: 5, curveSegments: 24 });
    g.rotateY(-Math.PI / 2);
    g.translate((width - bevel * 2) / 2, 0, 0);
    return g;
  };

  const b = new THREE.Shape();
  b.moveTo(-2.1, 0.34);
  b.lineTo(-2.16, 0.6);
  b.quadraticCurveTo(-2.18, 0.9, -1.92, 0.93);
  b.lineTo(-1.35, 0.96);
  b.quadraticCurveTo(-0.2, 1.0, 0.8, 0.92);
  b.quadraticCurveTo(1.65, 0.85, 2.0, 0.66);
  b.quadraticCurveTo(2.19, 0.56, 2.16, 0.42);
  b.lineTo(2.08, 0.32);
  b.lineTo(1.81, 0.32);
  b.absarc(1.35, 0.34, 0.46, 0, Math.PI, false);
  b.lineTo(-0.89, 0.32);
  b.absarc(-1.35, 0.34, 0.46, 0, Math.PI, false);
  b.closePath();
  add(extrudeSide(b, 1.86, 0.09), paint);

  const c = new THREE.Shape();
  c.moveTo(-1.5, 0.93);
  c.quadraticCurveTo(-1.2, 1.24, -0.72, 1.27);
  c.lineTo(-0.05, 1.27);
  c.quadraticCurveTo(0.28, 1.25, 0.5, 1.12);
  c.lineTo(0.92, 0.9);
  c.closePath();
  add(extrudeSide(c, 1.5, 0.14), glass);
  add(rbox(1.16, 0.05, 0.86, 0.02), paint, 0, 1.375, -0.42);      // 지붕 패널

  add(new THREE.BoxGeometry(1.5, 0.42, 4.0), matte, 0, 0.5, 0);     // 바닥/휠하우스 안쪽
  add(rbox(1.84, 0.05, 0.5, 0.02), carbon, 0, 0.27, 2.02);          // 프런트 스플리터
  add(rbox(1.3, 0.2, 0.08), matte, 0, 0.46, 2.2);                   // 그릴
  for (const s of [1, -1]) {
    add(rbox(0.08, 0.1, 1.84, 0.02), carbon, s * 0.9, 0.31, 0);     // 사이드 스커트
    add(rbox(0.2, 0.11, 0.14, 0.04), paint, s * 0.98, 1.0, 0.62);   // 사이드 미러
    add(rbox(0.06, 0.28, 0.24, 0.02), carbon, s * 0.62, 1.1, -1.95);// 스포일러 기둥
  }
  add(rbox(1.76, 0.05, 0.4, 0.02), carbon, 0, 1.26, -1.97);         // 스포일러 날개
  for (const s of [1, -1]) add(rbox(0.03, 0.16, 0.44, 0.012), carbon, s * 0.88, 1.27, -1.97);  // 날개 끝판

  const lamp = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d0, emissiveIntensity: 3, roughness: 0.2 });
  for (const s of [1, -1]) {
    const h = add(rbox(0.46, 0.1, 0.2, 0.04), lamp, s * 0.6, 0.7, 2.02);
    h.rotation.x = 0.45;
    h.castShadow = false;
  }

  // ---- 후면부 ----
  // 가로로 길게 이어진 입체 LED 테일램프: 스모크 렌즈 하우징 + 발광 띠 + 양 끝 ㄱ자 그래픽
  brakeLightMat = new THREE.MeshStandardMaterial({ color: 0x1a0002, emissive: 0xff0814, emissiveIntensity: 1.2, roughness: 0.25 });
  const smoked = new THREE.MeshPhysicalMaterial({ color: 0x14040a, metalness: 0.2, roughness: 0.08, clearcoat: 1, envMapIntensity: 1.2 });
  add(rbox(1.76, 0.15, 0.07, 0.035), smoked, 0, 0.8, -2.215);
  const led = (w, h, x, y) => { const m = add(rbox(w, h, 0.035, Math.min(w, h) * 0.45), brakeLightMat, x, y, -2.255); m.castShadow = false; return m; };
  led(1.5, 0.032, 0, 0.815);                  // 가운데 가로 띠
  for (const s of [1, -1]) {
    led(0.26, 0.05, s * 0.72, 0.83);          // 양 끝 위쪽
    led(0.05, 0.12, s * 0.835, 0.78);         // 양 끝 세로
    led(0.18, 0.025, s * 0.7, 0.765);         // 양 끝 아래쪽
  }

  // 하단 리어 범퍼(무광) + 디퓨저(카본, 세로 핀)
  add(rbox(1.78, 0.17, 0.16, 0.04), matte, 0, 0.44, -2.17);
  const diffuser = add(rbox(1.56, 0.05, 0.5, 0.02), carbon, 0, 0.25, -2.0);
  diffuser.rotation.x = -0.22;
  for (const x of [-0.27, -0.13, 0, 0.13, 0.27]) {
    const fin = add(new THREE.BoxGeometry(0.022, 0.1, 0.42), carbon, x, 0.31, -2.03);
    fin.rotation.x = -0.22;
  }

  // 크롬 듀얼 머플러: 바깥 관 + 둥근 립 + 안쪽은 검은 그을음
  const pipeGeo = new THREE.CylinderGeometry(0.078, 0.07, 0.26, 28, 1, true);
  pipeGeo.rotateX(Math.PI / 2);
  const lipGeo = new THREE.TorusGeometry(0.078, 0.012, 10, 28);
  const soot = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1, side: THREE.DoubleSide });
  for (const s of [1, -1]) {
    const x = s * 0.5, y = 0.34;
    add(pipeGeo, new THREE.MeshStandardMaterial({ color: 0xeef1f5, metalness: 1, roughness: 0.12, envMapIntensity: 1.3, side: THREE.DoubleSide }), x, y, -2.17);
    add(lipGeo, chrome, x, y, -2.3);
    add(new THREE.CircleGeometry(0.068, 24), soot, x, y, -2.25).rotation.y = Math.PI;
    add(rbox(0.26, 0.2, 0.06, 0.04), matte, x, y, -2.16);             // 배기구 주변 검은 테두리
    const tip = new THREE.Object3D();
    tip.position.set(x, y, -2.34);
    carBody.add(tip);
    exhaustTips.push(tip);
  }

  // 차 바로 아래의 부드러운 접지 그림자 (차가 바닥에 붙어 보이게)
  const contactTex = canvasTex(256, (c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.9)'); g.addColorStop(0.5, 'rgba(0,0,0,0.65)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, s, s);
  });
  contactTex.wrapS = contactTex.wrapT = THREE.ClampToEdgeWrapping;
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 5.2),
    new THREE.MeshBasicMaterial({ map: contactTex, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.08;
  contact.renderOrder = 1;
  carObj.add(contact);

  // 바퀴
  const tireGeo = new THREE.LatheGeometry(
    [[0.2, -0.14], [0.31, -0.14], [0.36, -0.1], [0.365, 0], [0.36, 0.1], [0.31, 0.14], [0.2, 0.14]].map(([r, y]) => new THREE.Vector2(r, y)), 28);
  tireGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.235, 0.235, 0.2, 24);
  rimGeo.rotateZ(Math.PI / 2);
  const discGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.24, 20);
  discGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.3, 12);
  hubGeo.rotateZ(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(0.29, 0.21, 0.045);
  spokeGeo.translate(0, 0.125, 0);
  const rimDark = new THREE.MeshStandardMaterial({ color: 0x17191d, metalness: 0.8, roughness: 0.4 });
  for (const [x, z, front] of [[0.83, 1.35, 1], [-0.83, 1.35, 1], [0.83, -1.35, 0], [-0.83, -1.35, 0]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.365, z);
    const w = new THREE.Group();
    add(tireGeo, rubber, 0, 0, 0, w);
    add(rimGeo, rimDark, 0, 0, 0, w);
    add(discGeo, new THREE.MeshStandardMaterial({ color: 0x70757d, metalness: 1, roughness: 0.35 }), 0, 0, 0, w);
    add(hubGeo, chrome, 0, 0, 0, w);
    for (let k = 0; k < 5; k++) add(spokeGeo, chrome, 0, 0, 0, w).rotation.x = (k / 5) * Math.PI * 2;
    pivot.add(w);
    carObj.add(pivot);
    wheels.push(w);
    if (front) frontPivots.push(pivot);
  }
  carObj.add(carBody);
  scene.add(carObj);
}
buildCar();

// 출발 신호등: 카운트다운 동안 하나씩 켜지고, 출발하면 초록
function updateLamps() {
  let lit = 0, green = false;
  if (race.state === 'countdown') lit = clamp(Math.floor((3.2 - race.count) / 0.62), 0, 5);
  else if (race.state === 'racing' && goFlash > 0) { lit = 5; green = true; }
  startLamps.forEach((m, i) => {
    m.emissive.setHex(green ? 0x18ff5a : 0xff1a1a);
    m.emissiveIntensity = i < lit ? 12 : 0;   // Bloom 으로 번지도록 밝게
  });
}

// ====================================================================
// 변속기 · 차량 상태
// ====================================================================
// 기어: -1 = R, 0 = N, 1~5
const GEAR_TOP = { [-1]: 11, 1: 14, 2: 24, 3: 35, 4: 46, 5: 58 };       // 기어별 최고속도 (m/s)
const GEAR_FORCE = { [-1]: 7, 1: 9, 2: 6.6, 3: 4.7, 4: 3.5, 5: 2.6 };   // 기어별 가속력 (m/s²)
const IDLE = 900, REDLINE = 7000;

const car = {
  x: 0, z: 0, h: 0, v: 0,       // 위치, 방향(라디안), 전진 속도(m/s)
  steer: 0, throttle: 0, brake: 0,
  gear: 1, rpm: IDLE, shiftT: 0, // shiftT: 변속 중 동력 끊김 남은 시간
  mode: 'auto',                  // 'auto' | 'manual'
  idx: 0, prog: 0, lat: 0,       // 가장 가까운 중심선 샘플, 누적 진행량, 중심선에서 좌우 거리
  hitWall: false, slip: 0,
};

const race = { state: 'ready', count: 0, t: 0, lapStart: 0, lapsDone: 0, lapTimes: [], best: null };
try { race.best = JSON.parse(localStorage.getItem('car.bestLap')); } catch { /* 저장소 사용 불가 */ }

function placeCar(idx) {
  const i = ((idx % N) + N) % N;
  car.x = P[i].x; car.z = P[i].z;
  car.h = Math.atan2(T[i].x, T[i].z);
  car.v = 0; car.idx = i; car.lat = 0;
  car.steer = 0; car.rpm = IDLE; car.shiftT = 0;
  if (car.mode === 'auto' || car.gear < 1) car.gear = 1;
}

function resetRace() {
  placeCar(N - 10);
  car.prog = -10;
  car.gear = 1;
  Object.assign(race, { state: 'ready', count: 0, t: 0, lapStart: 0, lapsDone: 0, lapTimes: [] });
  $('result').style.display = 'none';
  camH = car.h;
}

function startCountdown() {
  if (race.state === 'countdown' || race.state === 'racing') return;
  if (race.state === 'finished') resetRace();
  race.state = 'countdown';
  race.count = 3.2;
}

// ---- 변속 ----
function setGear(g) {
  if (g === car.gear) return;
  car.gear = g;
  car.shiftT = 0.16;
}

function shift(dir) {
  const v = car.v;
  if (car.mode === 'auto') {
    // 자동: ▲ = 전진(D), ▼ = 후진(R) — 거의 멈췄을 때만
    if (Math.abs(v) > 2) return toast('멈춘 뒤에 전진/후진을 바꿀 수 있어요');
    if (dir > 0 && car.gear < 1) { setGear(1); toast('D 전진'); }
    if (dir < 0 && car.gear > -1) { setGear(-1); toast('R 후진'); }
    return;
  }
  const g = car.gear + dir;
  if (g > 5 || g < -1) return;
  if (g === -1 && v > 1.5) return toast('멈춘 뒤에 후진 기어를 넣을 수 있어요');
  if (g >= 1 && car.gear <= 0 && v < -1.5) return toast('멈춘 뒤에 전진 기어를 넣을 수 있어요');
  if (dir < 0 && g >= 1 && v > GEAR_TOP[g] * 1.04) { feedback({ vibrate: [30, 40, 30] }); return toast('속도가 너무 빨라요 — 먼저 줄이세요'); }
  setGear(g);
}

function setMode(mode) {
  if (mode !== 'auto' && mode !== 'manual') return;
  if (mode === car.mode) return;
  car.mode = mode;
  if (mode === 'auto' && car.gear === 0) car.gear = 1;
  toast(mode === 'auto' ? '자동 변속 (AT)' : '수동 변속 (MT) — ▲▼로 변속');
}

function autoShift() {
  if (car.gear < 1 || car.shiftT > 0) return;
  const v = car.v, g = car.gear;
  if (g < 5 && v > GEAR_TOP[g] * (car.throttle > 0.5 ? 0.9 : 0.6)) return setGear(g + 1);
  if (g > 1) {
    const low = GEAR_TOP[g - 1];
    if (v < low * 0.45 || (car.throttle > 0.9 && v < low * 0.78)) setGear(g - 1);
  }
}

const torque = (rpm) => {
  const x = rpm / REDLINE;
  return clamp(0.5 + 0.5 * (1 - ((x - 0.62) / 0.62) ** 2), 0.35, 1);
};

// ====================================================================
// 입력 (폰 + 키보드)
// ====================================================================
const phone = { steer: 0, throttle: 0, brake: 0, at: -1e9 };
const keys = new Set();
const input = { steer: 0, throttle: 0, brake: 0 };
let kbSteer = 0;

function readInput(dt, now) {
  const kl = keys.has('ArrowLeft') || keys.has('KeyA'), kr = keys.has('ArrowRight') || keys.has('KeyD');
  const ku = keys.has('ArrowUp') || keys.has('KeyW'), kd = keys.has('ArrowDown') || keys.has('KeyS') || keys.has('Space');
  const target = (kr ? 1 : 0) - (kl ? 1 : 0);
  kbSteer += clamp(target - kbSteer, -dt * (target === 0 ? 5 : 3), dt * (target === 0 ? 5 : 3));
  const live = now - phone.at < 500;   // 폰 신호가 끊기면 입력을 0으로
  input.steer = clamp((live ? phone.steer : 0) + kbSteer, -1, 1);
  input.throttle = Math.max(live ? phone.throttle : 0, ku ? 1 : 0);
  input.brake = Math.max(live ? phone.brake : 0, kd ? 1 : 0);
}

// ====================================================================
// 물리
// ====================================================================
function physics(dt) {
  const locked = race.state !== 'racing';
  const fin = race.state === 'finished';

  // 페달은 살짝 부드럽게 따라감
  car.throttle += clamp((fin ? 0 : input.throttle) - car.throttle, -dt * 8, dt * 5);
  car.brake += clamp((fin ? 1 : input.brake) - car.brake, -dt * 10, dt * 8);
  car.steer += clamp(input.steer - car.steer, -dt * 6, dt * 6);
  car.shiftT = Math.max(0, car.shiftT - dt);

  if (car.mode === 'auto' && !locked) autoShift();

  const g = car.gear;
  const dir = g < 0 ? -1 : 1;
  const top = g !== 0 ? GEAR_TOP[g] : 1;
  const vg = car.v * dir;                 // 기어 방향으로의 속도
  const offroad = Math.abs(car.lat) > ROAD_HALF + CURB;

  // RPM
  let rpmTarget;
  if (g === 0 || (locked && !fin)) rpmTarget = IDLE + car.throttle * (REDLINE - IDLE - 400);
  else rpmTarget = IDLE + clamp(Math.abs(car.v) / top, 0, 1.03) * (REDLINE - IDLE);
  car.rpm = lerp(car.rpm, rpmTarget, 1 - Math.exp(-dt * (g === 0 || locked ? 6 : 18)));

  if (locked && !fin) { car.v = 0; return; }   // 출발 전: 공회전만

  // 가속도
  let a = 0;
  if (g !== 0 && car.shiftT <= 0) {
    if (vg < top) a += dir * car.throttle * GEAR_FORCE[g] * torque(car.rpm) * (offroad ? 0.75 : 1);
    if (vg > top * 1.01) a -= dir * 7;                               // 과회전 → 강한 엔진 브레이크
    else if (car.throttle < 0.05 && Math.abs(car.v) > 0.3) a -= Math.sign(car.v) * 1.1;  // 엔진 브레이크
  }
  const sv = Math.sign(car.v);
  a -= sv * (0.25 + 0.00075 * car.v * car.v);                        // 구름 저항 + 공기 저항
  if (offroad) a -= car.v * 0.65;                                    // 잔디에서는 크게 감속
  const brakeA = car.brake * 17;

  let v = car.v + a * dt;
  if (brakeA > 0) {                                                  // 브레이크는 0을 넘어가지 않음
    const d = brakeA * dt;
    v = Math.abs(v) <= d ? 0 : v - Math.sign(v) * d;
  }
  if (sv !== 0 && Math.sign(v) === -sv && car.throttle < 0.05) v = 0; // 저항으로 뒤로 밀리지 않게
  car.v = v;

  // 조향: 저속은 바퀴 각도, 고속은 타이어 접지력이 한계
  const sp = Math.abs(car.v);
  const grip = offroad ? 7 : 13.5;
  const yawMax = sp < 0.05 ? 0 : 1 / (2.6 / (sp * 0.62) + sp / grip);
  car.h -= car.steer * yawMax * Math.sign(car.v) * dt;
  car.slip = sp > 14 ? clamp((Math.abs(car.steer) - 0.8) / 0.2, 0, 1) : 0;

  car.x += Math.sin(car.h) * car.v * dt;
  car.z += Math.cos(car.h) * car.v * dt;

  trackUpdate();

  // 방호벽
  const lim = WALL - 1.15;
  if (Math.abs(car.lat) > lim) {
    const i = car.idx, over = car.lat - Math.sign(car.lat) * lim;
    car.x -= L[i].x * over; car.z -= L[i].z * over;
    car.lat -= over;
    if (!car.hitWall) {
      if (Math.abs(car.v) > 4) { feedback({ vibrate: 120 }); bump = 1; }
      car.v *= 0.45;
    } else {
      car.v *= Math.exp(-dt * 1.5);
    }
    car.hitWall = true;
  } else {
    car.hitWall = false;
  }
}

function trackUpdate() {
  let best = car.idx, bd = Infinity;
  for (let d = -25; d <= 25; d++) {
    const k = (car.idx + d + N) % N;
    const dx = car.x - P[k].x, dz = car.z - P[k].z, q = dx * dx + dz * dz;
    if (q < bd) { bd = q; best = k; }
  }
  let delta = best - car.idx;
  if (delta > N / 2) delta -= N;
  if (delta < -N / 2) delta += N;
  car.idx = best;
  car.prog += delta;
  car.lat = (car.x - P[best].x) * L[best].x + (car.z - P[best].z) * L[best].z;
}

// ====================================================================
// 레이스 진행
// ====================================================================
function raceUpdate(dt) {
  if (race.state === 'countdown') {
    race.count -= dt;
    if (race.count <= 0) { race.state = 'racing'; race.t = 0; race.lapStart = 0; goFlash = 1; feedback({ vibrate: 200 }); }
  } else if (race.state === 'racing') {
    race.t += dt;
    if (car.prog >= (race.lapsDone + 1) * N) {
      const lap = race.t - race.lapStart;
      race.lapTimes.push(lap);
      race.lapStart = race.t;
      race.lapsDone++;
      const isBest = race.best == null || lap < race.best;
      if (isBest) { race.best = lap; try { localStorage.setItem('car.bestLap', JSON.stringify(lap)); } catch { /* 무시 */ } }
      if (race.lapsDone >= LAPS) finish();
      else { toast(`LAP ${race.lapsDone}  ${fmt(lap)}${isBest ? '  ★ 베스트!' : ''}`); feedback({ vibrate: 60 }); }
    }
  }
}

function finish() {
  race.state = 'finished';
  const bestLap = Math.min(...race.lapTimes);
  $('resTotal').textContent = fmt(race.t);
  $('resLaps').innerHTML = race.lapTimes.map((t, i) =>
    `<tr class="${t === bestLap ? 'best' : ''}"><td>LAP ${i + 1}</td><td class="num">${fmt(t)}</td></tr>`).join('') +
    `<tr><td>역대 베스트 랩</td><td class="num">${fmt(race.best)}</td></tr>`;
  $('result').style.display = 'block';
  feedback({ vibrate: [100, 60, 100, 60, 300], text: `완주! ${fmt(race.t)}` });
}

function fmt(t) {
  if (t == null) return '-';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

// ====================================================================
// 카메라
// ====================================================================
let camMode = 0;       // 0 추적, 1 운전석, 2 위에서
let camH = 0;
let bump = 0, goFlash = 0;
const CAM_NAMES = ['추적 시점', '운전석 시점', '위에서 보기'];
function nextCamera() { camMode = (camMode + 1) % 3; toast('🎥 ' + CAM_NAMES[camMode]); }

function updateCamera(dt) {
  let dh = car.h - camH;
  while (dh > Math.PI) dh -= Math.PI * 2;
  while (dh < -Math.PI) dh += Math.PI * 2;
  camH += dh * (1 - Math.exp(-dt * 5));
  const sp = Math.abs(car.v);
  const fx = Math.sin(car.h), fz = Math.cos(car.h);
  bump = Math.max(0, bump - dt * 3);
  const shake = bump * 0.35 * Math.sin(performance.now() * 0.08);
  camera.up.set(0, 1, 0);
  let fov;   // 속도가 오를수록 시야각이 조금씩 넓어져 속도감이 난다
  if (camMode === 0) {
    const cx = Math.sin(camH), cz = Math.cos(camH), dist = 7.5 + sp * 0.035;
    camera.position.set(car.x - cx * dist + shake, 3.1, car.z - cz * dist);
    camera.lookAt(car.x + fx * 5, 1.1, car.z + fz * 5);
    fov = 60 + sp * 0.22;
  } else if (camMode === 1) {
    camera.position.set(car.x + fx * 0.2 + shake, 1.22, car.z + fz * 0.2);
    camera.lookAt(car.x + fx * 20, 1.0, car.z + fz * 20);
    fov = 72 + sp * 0.16;
  } else {
    camera.up.set(Math.sin(camH), 0, Math.cos(camH));
    camera.position.set(car.x, 70, car.z);
    camera.lookAt(car.x, 0, car.z);
    fov = 55;
  }
  camera.fov = lerp(camera.fov, fov, 1 - Math.exp(-dt * 4));   // 부드럽게 따라감
  camera.updateProjectionMatrix();
  skyDome.position.copy(camera.position);
  sun.position.set(car.x + SUN_DIR.x * 200, SUN_DIR.y * 200, car.z + SUN_DIR.z * 200);
  sun.target.position.set(car.x, 0, car.z);
}

let wheelSpin = 0;
function updateCarModel(dt) {
  carObj.position.set(car.x, 0, car.z);
  carObj.rotation.y = car.h;
  carBody.visible = camMode !== 1;
  wheels.forEach((w) => { w.visible = camMode !== 1; });
  wheelSpin += (car.v / 0.36) * dt;
  for (const w of wheels) w.rotation.x = wheelSpin;
  for (const p of frontPivots) p.rotation.y = -car.steer * 0.45;
  const sp = Math.abs(car.v);
  const roll = clamp(car.steer * sp * 0.004, -0.07, 0.07) * Math.sign(car.v || 1);
  const pitch = clamp(car.brake * sp * 0.003 - car.throttle * 0.012, -0.03, 0.05);
  carBody.rotation.z = lerp(carBody.rotation.z, roll, 0.15);
  carBody.rotation.x = lerp(carBody.rotation.x, pitch, 0.15);
  // 테일램프: 평소엔 은은하게, 악셀을 떼고 감속하면 조금 밝게, 브레이크를 밟으면 강하게 (Bloom 으로 번짐)
  const coasting = car.throttle < 0.05 && sp > 3 && race.state === 'racing';
  const glow = car.brake > 0.05 ? 9 : coasting ? 3.2 : 1.2;
  brakeLightMat.emissiveIntensity = lerp(brakeLightMat.emissiveIntensity, glow, 1 - Math.exp(-dt * 18));
}

// ====================================================================
// 배기 연기 파티클
// ====================================================================
const SMOKE_MAX = 220;
const smoke = [];
const smokePos = new Float32Array(SMOKE_MAX * 3), smokeSize = new Float32Array(SMOKE_MAX), smokeAlpha = new Float32Array(SMOKE_MAX);
const smokeGeo = new THREE.BufferGeometry();
smokeGeo.setAttribute('position', new THREE.BufferAttribute(smokePos, 3).setUsage(THREE.DynamicDrawUsage));
smokeGeo.setAttribute('aSize', new THREE.BufferAttribute(smokeSize, 1).setUsage(THREE.DynamicDrawUsage));
smokeGeo.setAttribute('aAlpha', new THREE.BufferAttribute(smokeAlpha, 1).setUsage(THREE.DynamicDrawUsage));
const smokeTex = canvasTex(64, (c, s) => {
  const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,.8)'); g.addColorStop(0.4, 'rgba(255,255,255,.4)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, s, s);
});
smokeTex.wrapS = smokeTex.wrapT = THREE.ClampToEdgeWrapping;
const smokeMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { map: { value: smokeTex }, color: { value: new THREE.Color(0xc9ced6).multiplyScalar(1.25) }, uScale: { value: 500 } },
  vertexShader: /* glsl */`
    attribute float aSize; attribute float aAlpha; varying float vA; uniform float uScale;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = aSize * uScale / -mv.z;
      gl_Position = projectionMatrix * mv;
      vA = aAlpha;
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D map; uniform vec3 color; varying float vA;
    void main() { gl_FragColor = vec4(color, texture2D(map, gl_PointCoord).a * vA); }`,
});
const smokePoints = new THREE.Points(smokeGeo, smokeMat);
smokePoints.frustumCulled = false;
smokePoints.renderOrder = 2;
scene.add(smokePoints);

let smokeAcc = 0;
const tipPos = new THREE.Vector3();
function updateSmoke(dt) {
  carObj.updateMatrixWorld();
  // 악셀을 밟을수록, 회전수가 높을수록 많이 나온다
  const rate = car.throttle > 0.1 ? (14 + 70 * car.throttle * (car.rpm / REDLINE)) : (Math.abs(car.v) < 1 ? 3 : 0);
  smokeAcc += rate * dt;
  const fx = Math.sin(car.h), fz = Math.cos(car.h);
  while (smokeAcc >= 1) {
    smokeAcc -= 1;
    for (const tip of exhaustTips) {
      if (smoke.length >= SMOKE_MAX) smoke.shift();
      tip.getWorldPosition(tipPos);
      const back = 1.2 + rnd() * 1.5;
      smoke.push({
        x: tipPos.x, y: tipPos.y, z: tipPos.z,
        vx: fx * (car.v * 0.25 - back) + (rnd() - 0.5) * 0.6,
        vy: 0.25 + rnd() * 0.45,
        vz: fz * (car.v * 0.25 - back) + (rnd() - 0.5) * 0.6,
        age: 0, life: 0.9 + rnd() * 0.8, a0: 0.1 + 0.2 * car.throttle,
      });
    }
  }
  let n = 0;
  for (let i = smoke.length - 1; i >= 0; i--) {
    const p = smoke[i];
    p.age += dt;
    if (p.age >= p.life) { smoke.splice(i, 1); continue; }
    const drag = Math.exp(-dt * 2.2);
    p.vx *= drag; p.vz *= drag; p.vy += dt * 0.15;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    const t = p.age / p.life;
    smokePos[n * 3] = p.x; smokePos[n * 3 + 1] = p.y; smokePos[n * 3 + 2] = p.z;
    smokeSize[n] = 0.35 + t * 2.2;
    smokeAlpha[n] = p.a0 * Math.min(1, t * 8) * (1 - t) * (1 - t);
    n++;
  }
  smokeGeo.setDrawRange(0, n);
  smokeGeo.attributes.position.needsUpdate = true;
  smokeGeo.attributes.aSize.needsUpdate = true;
  smokeGeo.attributes.aAlpha.needsUpdate = true;
  // 화면 높이에 맞춘 점 크기 배율 (원근감)
  smokeMat.uniforms.uScale.value = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
}

// ====================================================================
// HUD
// ====================================================================
function gearLabel() {
  if (car.gear === -1) return 'R';
  if (car.gear === 0) return 'N';
  return car.mode === 'auto' ? 'D' + car.gear : String(car.gear);
}

function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 1800);
}

// 미니맵
const map = $('map'), mctx = map.getContext('2d');
const bounds = P.reduce((b, p) => ({ x0: Math.min(b.x0, p.x), x1: Math.max(b.x1, p.x), z0: Math.min(b.z0, p.z), z1: Math.max(b.z1, p.z) }),
  { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity });
const mScale = (map.width - 50) / Math.max(bounds.x1 - bounds.x0, bounds.z1 - bounds.z0);
// 위에서 내려다본 모습 그대로 (오른쪽 +x, 아래쪽 +z)
const mx = (x) => map.width / 2 + (x - (bounds.x0 + bounds.x1) / 2) * mScale;
const mz = (z) => map.height / 2 + (z - (bounds.z0 + bounds.z1) / 2) * mScale;
function drawMap() {
  mctx.clearRect(0, 0, map.width, map.height);
  mctx.lineJoin = 'round';
  mctx.beginPath();
  P.forEach((p, i) => (i ? mctx.lineTo(mx(p.x), mz(p.z)) : mctx.moveTo(mx(p.x), mz(p.z))));
  mctx.closePath();
  mctx.strokeStyle = 'rgba(255,255,255,.9)'; mctx.lineWidth = 12; mctx.stroke();
  mctx.strokeStyle = '#3b3f47'; mctx.lineWidth = 8; mctx.stroke();
  mctx.fillStyle = '#fff';
  mctx.fillRect(mx(P[0].x) - 3, mz(P[0].z) - 9, 6, 18);
  mctx.beginPath();
  mctx.arc(mx(car.x), mz(car.z), 9, 0, Math.PI * 2);
  mctx.fillStyle = '#e63946'; mctx.fill();
  mctx.strokeStyle = '#fff'; mctx.lineWidth = 3; mctx.stroke();
}

function updateHUD() {
  const kmh = Math.abs(car.v) * 3.6;
  $('speed').textContent = kmh.toFixed(0);
  $('gear').textContent = gearLabel();
  $('mode').textContent = car.mode === 'auto' ? '자동 AT' : '수동 MT';
  $('rpm').textContent = `${Math.round(car.rpm / 50) * 50} rpm`;
  $('rpmFill').style.width = clamp(car.rpm / (REDLINE + 300), 0, 1) * 100 + '%';
  $('shiftHint').classList.toggle('on', car.mode === 'manual' && car.gear >= 1 && car.gear < 5 && car.rpm > 6300);
  $('pThr').style.width = car.throttle * 100 + '%';
  $('pBrk').style.width = car.brake * 100 + '%';

  $('lap').textContent = Math.min(LAPS, race.lapsDone + 1);
  $('laps').textContent = LAPS;
  $('time').textContent = fmt(race.t);
  $('cur').textContent = race.state === 'racing' ? fmt(race.t - race.lapStart) : '-';
  $('last').textContent = race.lapTimes.length ? fmt(race.lapTimes[race.lapTimes.length - 1]) : '-';
  $('best').textContent = fmt(race.best);

  let big = '', sub = '';
  if (race.state === 'ready') {
    sub = phoneConnected ? '폰에서 <b>시작하기</b>를 누르면 출발합니다' : '폰으로 QR을 찍어 연결하거나 <b>Enter</b> 키로 시작';
  } else if (race.state === 'countdown') {
    big = race.count > 3 ? '' : String(Math.ceil(race.count));
    sub = '준비!';
  } else if (goFlash > 0) {
    big = 'GO!';
  }
  $('big').textContent = big;
  $('big').style.color = big === 'GO!' ? '#06d6a0' : '#fff';
  if ($('sub').innerHTML !== sub) $('sub').innerHTML = sub;

  const wrong = race.state === 'racing' && car.v > 3 &&
    Math.sin(car.h) * T[car.idx].x + Math.cos(car.h) * T[car.idx].z < -0.25;
  $('wrong').style.display = wrong ? 'block' : 'none';
  drawMap();
}

// ====================================================================
// 소리 (RPM에 맞춰 변하는 엔진음)
// ====================================================================
let audio = null, soundOn = true;
function initAudio() {
  if (audio) { if (audio.ac.state === 'suspended') audio.ac.resume(); return; }
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const o1 = ac.createOscillator(), o2 = ac.createOscillator();
    const f = ac.createBiquadFilter(), g = ac.createGain();
    o1.type = 'sawtooth'; o2.type = 'square';
    f.type = 'lowpass'; g.gain.value = 0;
    o1.connect(f); o2.connect(f); f.connect(g); g.connect(ac.destination);
    o1.start(); o2.start();
    audio = { ac, o1, o2, f, g };
  } catch { /* 소리 없이 진행 */ }
}
function updateAudio() {
  if (!audio) return;
  const t = audio.ac.currentTime, r = car.rpm / REDLINE;
  const freq = 32 + r * 150;
  audio.o1.frequency.setTargetAtTime(freq, t, 0.03);
  audio.o2.frequency.setTargetAtTime(freq / 2, t, 0.03);
  audio.f.frequency.setTargetAtTime(280 + r * 1500 + car.throttle * 900, t, 0.05);
  audio.g.gain.setTargetAtTime(soundOn ? 0.035 + car.throttle * 0.06 + r * 0.02 : 0, t, 0.05);
}

// ====================================================================
// 통신
// ====================================================================
let ws = null, phoneConnected = false;
function feedback(obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'feedback', ...obj }));
}
function handleEvent(name, value) {
  if (name === 'shiftUp') shift(1);
  else if (name === 'shiftDown') shift(-1);
  else if (name === 'setMode') setMode(value);
  else if (name === 'camera') nextCamera();
  else if (name === 'reset') { if (race.state === 'racing') { placeCar(car.idx); toast('트랙으로 복귀'); } }
  else if (name === 'restart') { resetRace(); startCountdown(); }
  else if (name === 'start') startCountdown();
}
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', role: 'display' }));
  ws.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === 'status') {
      phoneConnected = !!m.phone;
      $('connect').classList.toggle('hidden', phoneConnected);
      $('phoneState').classList.toggle('on', phoneConnected);
    } else if (m.type === 'car') {
      phone.steer = clamp(+m.steer || 0, -1, 1);
      phone.throttle = clamp(+m.throttle || 0, 0, 1);
      phone.brake = clamp(+m.brake || 0, 0, 1);
      phone.at = performance.now();
    } else if (m.type === 'carEvent') {
      handleEvent(m.name, m.value);
    }
  };
  ws.onclose = () => setTimeout(connect, 1000);
  ws.onerror = () => ws.close();
}
connect();

// 폰에 차량 상태를 10Hz로 알려 줌
setInterval(() => {
  feedback({ car: {
    kmh: Math.round(Math.abs(car.v) * 3.6), gear: gearLabel(), rpm: clamp(car.rpm / REDLINE, 0, 1),
    mode: car.mode, lap: Math.min(LAPS, race.lapsDone + 1), laps: LAPS, state: race.state,
  } });
}, 100);

fetch('/api/info').then((r) => r.json()).then((info) => {
  $('qr').innerHTML = info.carPhoneQR || '';
  $('url').textContent = info.carPhone || '';
}).catch(() => { $('url').textContent = '서버 정보를 가져오지 못했습니다'; });

// ====================================================================
// 키보드
// ====================================================================
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  initAudio();
  keys.add(e.code);
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.code === 'KeyE') shift(1);
  else if (e.code === 'KeyQ') shift(-1);
  else if (e.code === 'KeyT') setMode(car.mode === 'auto' ? 'manual' : 'auto');
  else if (e.code === 'KeyC') nextCamera();
  else if (e.code === 'KeyR') handleEvent('reset');
  else if (e.code === 'KeyM') { soundOn = !soundOn; toast(soundOn ? '🔊 소리 켬' : '🔇 소리 끔'); }
  else if (e.code === 'Enter') { if (race.state === 'ready') startCountdown(); else handleEvent('restart'); }
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
addEventListener('pointerdown', initAudio);

// ====================================================================
// 메인 루프
// ====================================================================
resetRace();
let prev = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;
  goFlash = Math.max(0, goFlash - dt);
  readInput(dt, now);
  raceUpdate(dt);
  physics(dt);
  updateCarModel(dt);
  updateLamps();
  updateCamera(dt);
  updateSmoke(dt);
  updateHUD();
  updateAudio();
  composer.render(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 테스트/디버깅용
window.__car = { car, race, phone, startCountdown, resetRace, shift, setMode, TRACK_LEN, P, T, N, input, physics, raceUpdate, camera, scene, renderer, composer, bloom, brakeLightMat: () => brakeLightMat, smoke, updateSmoke, updateCarModel, updateCamera };
