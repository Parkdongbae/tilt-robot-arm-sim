// 3축 로봇팔 시뮬레이터 (PC 화면)
import * as THREE from 'three';
import { THEMES, applyTheme } from './themes.js';
import { buildMission, COLORS, polar } from './missions.js';

const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;

// ---------------- 기본 장면 ----------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 200);
camera.position.set(0, 5, 6);

const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(4, 9, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 25 });
sun.shadow.bias = -0.0005;
scene.add(sun);

const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const arena = new THREE.Mesh(new THREE.CircleGeometry(3.55, 64), new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.85 }));
arena.rotation.x = -Math.PI / 2;
arena.position.y = 0.004;
arena.receiveShadow = true;
scene.add(arena);
// 작업 영역 격자 (동심원 + 방사선)
const grid = (() => {
  const pts = [];
  for (let r = 1; r <= 3; r += 1) {
    for (let i = 0; i < 64; i++) {
      const a1 = (i / 64) * Math.PI * 2, a2 = ((i + 1) / 64) * Math.PI * 2;
      pts.push(Math.cos(a1) * r, 0, Math.sin(a1) * r, Math.cos(a2) * r, 0, Math.sin(a2) * r);
    }
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    pts.push(Math.cos(a) * 0.7, 0, Math.sin(a) * 0.7, Math.cos(a) * 3.5, 0, Math.sin(a) * 3.5);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x555555, transparent: true, opacity: 0.55 }));
  l.position.y = 0.008;
  return l;
})();
scene.add(grid);

const decor = new THREE.Group();
scene.add(decor);
const themeCtx = { scene, decor, floor, arena, grid, hemi, sun };

// ---------------- 로봇팔 ----------------
const SHOULDER_Y = 0.75;
const L1 = 1.6;          // 위팔 길이
const L2 = 1.45;         // 아래팔 길이
const TIP = 0.56;        // 손목 ~ 집게 끝
const GRAB = 0.42;       // 손목 ~ 집는 지점
const MAX_GAP = 0.62;    // 집게 최대 벌림

const LIMITS = {
  yaw: [-175 * DEG, 175 * DEG],
  shoulder: [-5 * DEG, 165 * DEG],
  elbow: [-160 * DEG, 35 * DEG],
};
const joint = { yaw: 0, shoulder: 85 * DEG, elbow: -95 * DEG };
const HOME = { ...joint };

const mat = {
  arm: new THREE.MeshStandardMaterial({ color: 0xff8a1f, metalness: 0.35, roughness: 0.45 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x2a2f3a, metalness: 0.6, roughness: 0.4 }),
  steel: new THREE.MeshStandardMaterial({ color: 0xc9ced8, metalness: 0.8, roughness: 0.25 }),
};
function mesh(geo, m, shadow = true) {
  const o = new THREE.Mesh(geo, m);
  o.castShadow = shadow;
  o.receiveShadow = shadow;
  return o;
}

const armRoot = new THREE.Group();
scene.add(armRoot);
const base = mesh(new THREE.CylinderGeometry(0.6, 0.68, 0.22, 40), mat.dark);
base.position.y = 0.11;
armRoot.add(base);

const yawG = new THREE.Group();
armRoot.add(yawG);
const turret = mesh(new THREE.CylinderGeometry(0.38, 0.45, 0.5, 32), mat.arm);
turret.position.y = 0.47;
yawG.add(turret);
const shJoint = mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.56, 24), mat.dark);
shJoint.rotation.x = Math.PI / 2;
shJoint.position.y = SHOULDER_Y;
yawG.add(shJoint);

const shG = new THREE.Group();
shG.position.y = SHOULDER_Y;
yawG.add(shG);
const upper = mesh(new THREE.BoxGeometry(L1, 0.22, 0.26), mat.arm);
upper.position.x = L1 / 2;
shG.add(upper);
const elJoint = mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.4, 24), mat.dark);
elJoint.rotation.x = Math.PI / 2;
elJoint.position.x = L1;
shG.add(elJoint);

const elG = new THREE.Group();
elG.position.x = L1;
shG.add(elG);
const fore = mesh(new THREE.BoxGeometry(L2, 0.17, 0.2), mat.arm);
fore.position.x = L2 / 2;
elG.add(fore);

const wrG = new THREE.Group();      // 손목: 집게가 항상 바닥을 향하도록 자동 수평 유지
wrG.position.x = L2;
elG.add(wrG);
wrG.add(mesh(new THREE.SphereGeometry(0.13, 20, 14), mat.dark));
const palm = mesh(new THREE.BoxGeometry(0.12, 0.18, 0.72), mat.steel);
palm.position.x = 0.14;
wrG.add(palm);
const fingerGeo = new THREE.BoxGeometry(0.38, 0.1, 0.06);
const fingerL = mesh(fingerGeo, mat.steel);
const fingerR = mesh(fingerGeo, mat.steel);
fingerL.position.x = fingerR.position.x = 0.2 + 0.19;
wrG.add(fingerL, fingerR);
const grabPoint = new THREE.Object3D();
grabPoint.position.x = GRAB;
wrG.add(grabPoint);
const tipPoint = new THREE.Object3D();
tipPoint.position.x = TIP;
wrG.add(tipPoint);

// 집게 아래로 떨어지는 안내선 + 착지 표시
const guideLine = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1, 6),
  new THREE.MeshBasicMaterial({ color: 0xff3344, transparent: true, opacity: 0.7 }));
scene.add(guideLine);
const guideDot = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.09, 24),
  new THREE.MeshBasicMaterial({ color: 0xff3344, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
guideDot.rotation.x = -Math.PI / 2;
scene.add(guideDot);

function applyJoints(j) {
  yawG.rotation.y = Math.PI / 2 + j.yaw;
  shG.rotation.z = j.shoulder;
  elG.rotation.z = j.elbow;
  wrG.rotation.z = -(j.shoulder + j.elbow) - Math.PI / 2;
  armRoot.updateMatrixWorld(true);
}

// ---------------- 미션 상태 ----------------
const state = {
  level: 1,
  score: 0,
  mission: null,
  objects: [],       // {id, mesh, hx, hy, hz, held, resting, vy, locked, color}
  zones: [],         // {id, group, r, height, base:[x,z], move, pos:[x,z]}
  obstacles: [],     // {cx, cz, by, h, hx, hz, rot}
  tasks: [],
  timeLeft: 0,
  running: false,
  phase: 'intro',    // intro | play | success | fail
  held: null,
  grip: 0,
  gripVis: 0,
  themeIndex: 0,
  camMode: 0,
  clock: 0,
};
const missionGroup = new THREE.Group();
scene.add(missionGroup);

function disposeGroup(g) {
  g.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
  });
  g.clear();
}

function makeLabel(text, colorHex) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(10,14,24,0.78)';
  g.beginPath();
  g.roundRect(4, 14, 248, 68, 34);
  g.fill();
  g.fillStyle = '#' + colorHex.toString(16).padStart(6, '0');
  g.beginPath();
  g.arc(44, 48, 18, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.font = 'bold 36px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
  g.textBaseline = 'middle';
  g.fillText(text, 76, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(0.95, 0.36, 1);
  s.renderOrder = 10;
  return s;
}

function obstacleFromBox(cx, cz, by, h, hx, hz, rot) {
  return { cx, cz, by, h, hx, hz, rot, c: Math.cos(rot), s: Math.sin(rot) };
}
// 점이 장애물(회전된 상자) 안에 있는지
function inObstacle(p, o, pad = 0) {
  if (p.y < o.by - pad || p.y > o.by + o.h + pad) return false;
  const dx = p.x - o.cx, dz = p.z - o.cz;
  const lx = dx * o.c - dz * o.s;   // 상자 기준 좌표 (rotation.y = rot)
  const lz = dx * o.s + dz * o.c;
  return Math.abs(lx) < o.hx + pad && Math.abs(lz) < o.hz + pad;
}

function loadMission(level) {
  if (state.held) { missionGroup.attach(state.held.mesh); state.held = null; }
  disposeGroup(missionGroup);
  const m = buildMission(level);
  state.mission = m;
  state.objects = [];
  state.zones = [];
  state.obstacles = [];
  state.tasks = m.tasks.map((t) => ({ ...t, done: false }));
  state.timeLeft = m.time;

  // 벽
  const wallM = new THREE.MeshStandardMaterial({ color: 0x8a94a8, roughness: 0.6, metalness: 0.2, transparent: true, opacity: 0.92 });
  const hazardM = new THREE.MeshStandardMaterial({ color: 0xffc531, roughness: 0.6 });
  for (const w of m.walls) {
    const [sx, sy, sz] = w.size;
    const wall = mesh(new THREE.BoxGeometry(sx, sy, sz), wallM);
    wall.position.set(w.pos[0], sy / 2, w.pos[1]);
    wall.rotation.y = w.rotY;
    missionGroup.add(wall);
    const cap = mesh(new THREE.BoxGeometry(sx + 0.02, 0.05, sz + 0.02), hazardM);
    cap.position.set(w.pos[0], sy, w.pos[1]);
    cap.rotation.y = w.rotY;
    missionGroup.add(cap);
    state.obstacles.push(obstacleFromBox(w.pos[0], w.pos[1], 0, sy, sx / 2, sz / 2, w.rotY));
  }

  // 목표 구역
  for (const z of m.zones) {
    const col = COLORS[z.color].hex;
    const g = new THREE.Group();
    if (z.height > 0) {
      const side = z.r * 2 + 0.12;
      const ped = mesh(new THREE.BoxGeometry(side, z.height, side), new THREE.MeshStandardMaterial({ color: 0x59606e, roughness: 0.7 }));
      ped.position.y = z.height / 2;
      g.add(ped);
      state.obstacles.push(obstacleFromBox(z.pos[0], z.pos[1], 0, z.height, side / 2, side / 2, 0));
    }
    const disc = new THREE.Mesh(new THREE.CircleGeometry(z.r, 48),
      new THREE.MeshStandardMaterial({ color: col, transparent: true, opacity: 0.45, roughness: 0.6 }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = z.height + 0.012;
    disc.receiveShadow = true;
    const ring = new THREE.Mesh(new THREE.RingGeometry(z.r - 0.05, z.r, 48),
      new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide, transparent: true }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = z.height + 0.016;
    const label = makeLabel(z.move ? '이동 구역' : '목표', col);
    label.position.y = z.height + 0.75;
    g.add(disc, ring, label);
    g.position.set(z.pos[0], 0, z.pos[1]);
    missionGroup.add(g);
    // 원래 각도/거리 (움직이는 구역용)
    const baseDeg = Math.atan2(z.pos[0], -z.pos[1]) / DEG;
    const baseR = Math.hypot(z.pos[0], z.pos[1]);
    state.zones.push({ id: z.id, group: g, ring, r: z.r, height: z.height, move: z.move, baseDeg, baseR, pos: [...z.pos], color: z.color });
  }

  // 물건
  for (const o of m.objects) {
    const col = COLORS[o.color].hex;
    const om = new THREE.MeshStandardMaterial({ color: col, roughness: 0.45, metalness: 0.1, emissive: 0x000000 });
    let geo, hx, hy, hz;
    if (o.shape === 'box') { geo = new THREE.BoxGeometry(0.36, 0.36, 0.36); hx = hy = hz = 0.18; }
    else if (o.shape === 'cyl') { geo = new THREE.CylinderGeometry(0.16, 0.16, 0.44, 28); hx = hz = 0.16; hy = 0.22; }
    else { geo = new THREE.SphereGeometry(0.19, 28, 20); hx = hy = hz = 0.19; }
    const om2 = mesh(geo, om);
    om2.position.set(o.pos[0], hy, o.pos[1]);
    om2.rotation.y = Math.random() * Math.PI;
    missionGroup.add(om2);
    state.objects.push({ id: o.id, label: o.label, color: o.color, mesh: om2, hx, hy, hz, held: false, resting: true, vy: 0, locked: false, supportId: null });
  }

  // 화면 표시
  $('stageNo').textContent = `STAGE ${level}`;
  $('mTitle').textContent = m.title;
  $('mDesc').textContent = m.desc;
  $('diff').textContent = '난이도 ' + '★'.repeat(m.stars) + '☆'.repeat(5 - m.stars);
  renderTasks();
  updateTimer();
}

function objById(id) { return state.objects.find((o) => o.id === id); }
function zoneById(id) { return state.zones.find((z) => z.id === id); }

function renderTasks() {
  const ul = $('tasks');
  ul.innerHTML = '';
  for (const t of state.tasks) {
    const o = objById(t.obj);
    const li = document.createElement('li');
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.style.background = '#' + COLORS[o.color].hex.toString(16).padStart(6, '0');
    li.appendChild(chip);
    let text;
    if (t.type === 'zone') {
      const z = zoneById(t.zone);
      const where = z.height > 0 ? '높은 ' : z.move ? '움직이는 ' : '';
      text = `${o.label} → ${where}${COLORS[z.color].name} 구역`;
    } else {
      text = `${o.label} → ${objById(t.on).label} 위에 쌓기`;
    }
    li.appendChild(document.createTextNode(text));
    if (t.done) li.classList.add('done');
    ul.appendChild(li);
  }
}

function updateTimer() {
  const el = $('timer');
  if (!state.mission || !state.mission.time) { el.textContent = '시간 제한 없음'; el.classList.remove('low'); return; }
  const s = Math.max(0, Math.ceil(state.timeLeft));
  el.textContent = `⏱ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  el.classList.toggle('low', s <= 15);
}

// ---------------- 충돌/지지 계산 ----------------
const _v = new THREE.Vector3();
const _box = new THREE.Box3();

function objBox(o, out = new THREE.Box3()) {
  const p = o.mesh.getWorldPosition(_v);
  out.min.set(p.x - o.hx, p.y - o.hy, p.z - o.hz);
  out.max.set(p.x + o.hx, p.y + o.hy, p.z + o.hz);
  return out;
}

// (x,z) 아래에서 y 이하로 가장 높은 받침 높이와 받침 물건
function supportBelow(x, z, y, exclude, hx = 0, hz = 0) {
  let best = 0, bestObj = null;
  for (const ob of state.obstacles) {
    const top = ob.by + ob.h;
    if (top <= y + 0.02 && top > best && inObstacle({ x, y: top - 0.01, z }, ob, 0)) { best = top; bestObj = null; }
  }
  for (const o of state.objects) {
    if (o === exclude || o.held) continue;
    const p = o.mesh.position;
    const top = p.y + o.hy;
    if (top > y + 0.02 || top <= best) continue;
    if (Math.abs(p.x - x) < (o.hx + hx) * 0.8 && Math.abs(p.z - z) < (o.hz + hz) * 0.8) { best = top; bestObj = o; }
  }
  return { y: best, obj: bestObj };
}

const samplePts = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
// 현재 관절 자세가 바닥/벽/다른 물건과 부딪히는지
function poseInvalid() {
  const tip = tipPoint.getWorldPosition(new THREE.Vector3());
  if (tip.y < 0.02) return true;
  // 팔 링크 위 샘플 점들
  shG.getWorldPosition(_a);
  elG.getWorldPosition(_b);
  const wrist = wrG.getWorldPosition(new THREE.Vector3());
  if (_b.y < 0.1 || wrist.y < 0.1) return true;
  const pts = [];
  for (let i = 1; i <= 4; i++) pts.push(_a.clone().lerp(_b, i / 4));
  for (let i = 1; i <= 5; i++) pts.push(_b.clone().lerp(wrist, i / 5));
  pts.push(tip, grabPoint.getWorldPosition(new THREE.Vector3()));
  for (const ob of state.obstacles) {
    for (const p of pts) if (inObstacle(p, ob, 0.07)) return true;
  }
  // 집게가 고정된(완료된) 물건이나 다른 물건 속으로 파고들지 않게
  // (집게 끝이 물건 안에 있어도, 손가락 사이로 물건을 감싸는 위치면 허용)
  for (const o of state.objects) {
    if (o.held) continue;
    objBox(o, _box).expandByScalar(-0.03);
    if (_box.containsPoint(tip) && Math.hypot(tip.x - o.mesh.position.x, tip.z - o.mesh.position.z) > 0.12) return true;
  }
  // 들고 있는 물건
  if (state.held) {
    const h = state.held;
    objBox(h, _box);
    if (_box.min.y < -0.005) return true;
    const corners = [];
    for (const x of [_box.min.x, _box.max.x]) for (const y of [_box.min.y, _box.max.y]) for (const z of [_box.min.z, _box.max.z]) corners.push(new THREE.Vector3(x, y, z));
    corners.push(_box.getCenter(new THREE.Vector3()));
    for (const ob of state.obstacles) for (const p of corners) if (inObstacle(p, ob, 0.0)) return true;
    const hb = _box.clone().expandByScalar(-0.02);
    for (const o of state.objects) {
      if (o === h) continue;
      if (objBox(o, new THREE.Box3()).intersectsBox(hb)) return true;
    }
  }
  return false;
}

// ---------------- 입력 ----------------
const input = {
  left: { yaw: 0, shoulder: 0, elbow: 0, speed: 1, t: 0 },
  right: { grip: 0, t: 0 },
  keys: new Set(),
  keyLock: false,
};
const conn = { left: false, right: false };

function feedback(to, data) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'feedback', to, ...data }));
}

let ws;
function connectWS() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', role: 'display' }));
  ws.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    const now = performance.now();
    if (m.type === 'status') {
      conn.left = m.left; conn.right = m.right;
      $('dLeft').classList.toggle('on', m.left);
      $('dRight').classList.toggle('on', m.right);
      $('qLeft').classList.toggle('on', m.left);
      $('qRight').classList.toggle('on', m.right);
      if (m.right) feedback('right', { background: THEMES[state.themeIndex].name });
      // 폰 2대가 모두 연결되면 자동으로 시작
      if (m.left && m.right && state.phase === 'intro') setTimeout(startFromIntro, 1200);
    } else if (m.type === 'arm') {
      Object.assign(input.left, { yaw: +m.yaw || 0, shoulder: +m.shoulder || 0, elbow: +m.elbow || 0, speed: +m.speed || 1, t: now });
    } else if (m.type === 'grip') {
      input.right.grip = Math.max(0, Math.min(1, +m.value || 0));
      input.right.t = now;
    } else if (m.type === 'event') {
      handleEvent(m.name);
    }
  };
  ws.onclose = () => setTimeout(connectWS, 1000);
}
connectWS();

function handleEvent(name) {
  if (name === 'bg_next') setTheme(state.themeIndex + 1);
  else if (name === 'bg_prev') setTheme(state.themeIndex - 1);
  else if (name === 'camera') setCam(state.camMode + 1);
  else if (name === 'restart') restartMission();
}

addEventListener('keydown', (e) => {
  if (e.repeat) { input.keys.add(e.code); return; }
  input.keys.add(e.code);
  if (e.code === 'KeyQ') setTheme(state.themeIndex - 1);
  if (e.code === 'KeyE') setTheme(state.themeIndex + 1);
  if (e.code === 'KeyC') setCam(state.camMode + 1);
  if (e.code === 'KeyG') input.keyLock = !input.keyLock;
  if (e.code === 'Backspace') restartMission();
  if (e.code === 'KeyN') nextMission(true);
  if (e.code === 'KeyH') $('help').classList.toggle('hidden');
  if (e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', (e) => input.keys.delete(e.code));
addEventListener('blur', () => input.keys.clear());

// ---------------- 배경 / 카메라 ----------------
function setTheme(i) {
  state.themeIndex = (i + THEMES.length) % THEMES.length;
  const name = applyTheme(themeCtx, state.themeIndex);
  $('theme').textContent = `배경: ${name}  (${state.themeIndex + 1}/${THEMES.length})`;
  feedback('right', { background: name });
  if (state.phase === 'play') showBanner(name, '배경 전환', '', 1100);
}

const CAMS = ['기본', '위에서', '옆에서', '집게 따라가기'];
function setCam(i) {
  state.camMode = (i + CAMS.length) % CAMS.length;
  $('jCam').textContent = CAMS[state.camMode];
}
const camTarget = new THREE.Vector3(0, 0.5, -1);
const camLook = new THREE.Vector3(0, 0.5, -1);
function updateCamera(dt) {
  const tip = tipPoint.getWorldPosition(new THREE.Vector3());
  const want = new THREE.Vector3();
  const look = new THREE.Vector3();
  if (state.camMode === 0) { want.set(0, 5.2, 5.6); look.set(0, 0.2, -0.9); }
  else if (state.camMode === 1) { want.set(0, 9.5, 0.6); look.set(0, 0, 0); }
  else if (state.camMode === 2) { want.set(6.8, 3.6, -0.4); look.set(0, 0.6, -0.6); }
  else {
    const d = new THREE.Vector3(tip.x, 0, tip.z);
    if (d.lengthSq() < 0.01) d.set(0, 0, -1);
    d.normalize();
    want.copy(tip).addScaledVector(d, -1.6).add(new THREE.Vector3(0, 1.8, 0));
    look.copy(tip);
  }
  const k = 1 - Math.exp(-dt * 4);
  camera.position.lerp(want, k);
  camLook.lerp(look, k);
  camera.lookAt(camLook);
}

// ---------------- 배너 / 소리 ----------------
let bannerTimer;
function showBanner(big, small, cls = '', ms = 1800) {
  const b = $('banner');
  $('bBig').textContent = big;
  $('bSmall').textContent = small;
  b.className = 'show ' + cls;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { b.className = cls; }, ms);
}

let audio;
function beep(freq = 660, dur = 0.12, type = 'sine', vol = 0.15) {
  try {
    audio = audio || new AudioContext();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + dur);
  } catch { /* 소리 없음 */ }
}
const chord = (notes) => notes.forEach((f, i) => setTimeout(() => beep(f, 0.2, 'triangle'), i * 110));

// 완료 효과: 반짝이는 조각
const sparks = [];
function burst(pos, color) {
  const m = new THREE.MeshBasicMaterial({ color });
  for (let i = 0; i < 24; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), m);
    s.position.copy(pos);
    s.userData.v = new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 3 + 1, (Math.random() - 0.5) * 3);
    s.userData.life = 1;
    scene.add(s);
    sparks.push(s);
  }
}

// ---------------- 진행 ----------------
function startMission() {
  state.phase = 'play';
  Object.assign(joint, HOME);
  applyJoints(joint);
  const m = state.mission;
  const big = `STAGE ${m.level}`;
  if (m.level === 3) showBanner(big, '⚠ 난이도 상승! 이제부터 제한 시간이 있어요', 'warn', 2600);
  else if (m.level > 3 && m.stars > buildMission(m.level - 1).stars) showBanner(big, `${m.title} · 난이도 상승!`, 'warn', 2200);
  else showBanner(big, m.title, '', 2000);
}

function restartMission() {
  if (state.phase === 'intro') return;
  loadMission(state.level);
  startMission();
}

function nextMission(skip = false) {
  if (state.phase === 'intro') return;
  state.level += 1;
  loadMission(state.level);
  startMission();
  if (skip) showBanner(`STAGE ${state.level}`, '건너뛰었어요 (테스트용)', '', 1500);
}

function completeTask(t, o) {
  t.done = true;
  o.locked = true;
  o.mesh.material.emissive.setHex(COLORS[o.color].hex);
  o.mesh.material.emissiveIntensity = 0.35;
  burst(o.mesh.position.clone().add(new THREE.Vector3(0, o.hy, 0)), COLORS[o.color].hex);
  chord([660, 880]);
  feedback('right', { vibrate: 60, text: '✔ 성공!' });
  state.score += 100;
  renderTasks();
  if (state.tasks.every((x) => x.done)) missionSuccess();
}

function missionSuccess() {
  state.phase = 'success';
  const bonus = state.mission.time ? Math.round(state.timeLeft * 2) : 50;
  state.score += bonus;
  chord([523, 659, 784, 1046]);
  showBanner('미션 성공!', `시간 보너스 +${bonus} · 다음 단계로 이동합니다`, 'success', 2600);
  feedback('left', { vibrate: [100, 60, 100], text: '미션 성공!' });
  feedback('right', { vibrate: [100, 60, 100], text: '미션 성공!' });
  setTimeout(() => nextMission(), 2800);
}

function missionFail() {
  state.phase = 'fail';
  beep(220, 0.5, 'sawtooth', 0.1);
  if (state.held) releaseHeld();
  showBanner('시간 초과!', '같은 단계를 다시 시작합니다', 'fail', 2600);
  feedback('left', { vibrate: 300, text: '시간 초과' });
  feedback('right', { vibrate: 300, text: '시간 초과' });
  setTimeout(() => restartMission(), 2800);
}

// 물건이 착지했을 때만 완료 판정 (움직이는 구역이 지나가며 자동 완료되는 것 방지)
function onLanded(o, support) {
  for (const t of state.tasks) {
    if (t.done || t.obj !== o.id) continue;
    const p = o.mesh.position;
    if (t.type === 'zone') {
      const z = zoneById(t.zone);
      const d = Math.hypot(p.x - z.pos[0], p.z - z.pos[1]);
      const bottom = p.y - o.hy;
      if (d <= z.r - 0.04 && Math.abs(bottom - z.height) < 0.06) completeTask(t, o);
    } else if (t.type === 'stack') {
      const below = objById(t.on);
      if (support.obj === below && below.locked) completeTask(t, o);
      else if (support.obj === below && !below.locked) showBanner('순서!', '아래 물건부터 먼저 완료해 주세요', 'warn', 1600);
    }
  }
}

// ---------------- 집기 ----------------
function tryGrab() {
  const gp = grabPoint.getWorldPosition(new THREE.Vector3());
  let best = null, bestD = 1e9;
  for (const o of state.objects) {
    if (o.held || o.locked) continue;
    const p = o.mesh.position;
    const dh = Math.hypot(gp.x - p.x, gp.z - p.z);
    const inY = gp.y > p.y - o.hy - 0.02 && gp.y < p.y + o.hy + 0.06;
    if (dh < 0.2 && inY && dh < bestD) { best = o; bestD = dh; }
  }
  if (!best) return;
  // 위에 다른 물건이 올려져 있으면 같이 떨어지도록 그냥 집음
  best.held = true;
  best.resting = false;
  best.vy = 0;
  wrG.attach(best.mesh);
  state.held = best;
  beep(880, 0.08, 'square', 0.06);
  feedback('right', { vibrate: 40 });
}

function releaseHeld() {
  const o = state.held;
  if (!o) return;
  missionGroup.attach(o.mesh);
  const e = new THREE.Euler().setFromQuaternion(o.mesh.quaternion, 'YXZ');
  o.mesh.rotation.set(0, e.y, 0);
  o.held = false;
  o.resting = false;
  o.vy = 0;
  state.held = null;
  beep(440, 0.08, 'square', 0.05);
}

// ---------------- 메인 루프 ----------------
const RATE = { yaw: 75 * DEG, shoulder: 48 * DEG, elbow: 65 * DEG };
const vel = { yaw: 0, shoulder: 0, elbow: 0 };
let last = performance.now();

function frame(now) {
  tick(now);
  requestAnimationFrame(frame);
}

function tick(now) {
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = Math.max(last, now);
  state.clock += dt;

  // 입력 합치기 (폰 신호가 0.5초 이상 끊기면 정지)
  const L = now - input.left.t < 500 ? input.left : { yaw: 0, shoulder: 0, elbow: 0, speed: 1 };
  const k = input.keys;
  const key = (a, b) => (k.has(a) ? 1 : 0) - (k.has(b) ? 1 : 0);
  const target = {
    yaw: -(L.yaw + key('KeyD', 'KeyA')) * L.speed,           // 오른쪽 기울임 → 오른쪽 회전
    shoulder: -(L.shoulder + key('KeyW', 'KeyS')) * L.speed, // 앞으로 숙임 → 팔이 앞/아래로
    elbow: -(L.elbow + key('KeyF', 'KeyR')) * L.speed,       // 앞으로 숙임 → 팔뚝이 아래로
  };
  const playing = state.phase === 'play' || state.phase === 'success';
  const sm = 1 - Math.exp(-dt * 10);
  for (const j of ['yaw', 'shoulder', 'elbow']) {
    vel[j] += ((playing ? Math.max(-1.6, Math.min(1.6, target[j])) : 0) - vel[j]) * sm;
  }

  // 관절을 하나씩 움직여 보고, 부딪히면 그 관절만 되돌림 (벽을 따라 미끄러지듯)
  // 이미 끼어 있는 자세라면 빠져나올 수 있도록 검사를 건너뜀
  const moving = ['yaw', 'shoulder', 'elbow'].some((j) => Math.abs(vel[j]) > 1e-4);
  const stuck = moving && poseInvalid();
  for (const j of ['yaw', 'shoulder', 'elbow']) {
    if (Math.abs(vel[j]) < 1e-4) continue;
    const prev = joint[j];
    joint[j] = Math.max(LIMITS[j][0], Math.min(LIMITS[j][1], prev + vel[j] * RATE[j] * dt));
    applyJoints(joint);
    if (!stuck && poseInvalid()) { joint[j] = prev; vel[j] = 0; applyJoints(joint); }
  }

  // 집게
  const R = now - input.right.t < 500 ? input.right.grip : 0;
  state.grip = playing ? Math.max(R, k.has('Space') ? 1 : 0, input.keyLock ? 1 : 0) : 0;
  state.gripVis += (state.grip - state.gripVis) * (1 - Math.exp(-dt * 14));
  if (!state.held && state.grip > 0.55) tryGrab();
  if (state.held && state.grip < 0.35) releaseHeld();
  let gap = MAX_GAP * (1 - state.gripVis) + 0.08;
  if (state.held) gap = Math.max(gap, Math.min(state.held.hx, state.held.hz) * 2 + 0.06);
  fingerL.position.z = gap / 2 + 0.03;
  fingerR.position.z = -gap / 2 - 0.03;

  // 물건 낙하 / 착지
  for (const o of state.objects) {
    if (o.held) continue;
    const p = o.mesh.position;
    const sup = supportBelow(p.x, p.z, p.y - o.hy, o, o.hx, o.hz);
    if (o.resting) {
      if (p.y - o.hy > sup.y + 0.01) o.resting = false;   // 아래 받침이 사라짐
      else continue;
    }
    o.vy -= 9.8 * dt;
    p.y += o.vy * dt;
    if (p.y - o.hy <= sup.y) {
      p.y = sup.y + o.hy;
      const hard = o.vy < -1;
      o.vy = 0;
      o.resting = true;
      if (hard) beep(160, 0.06, 'triangle', 0.08);
      if (state.phase === 'play') onLanded(o, sup);
    }
  }

  // 움직이는 구역
  for (const z of state.zones) {
    if (!z.move) continue;
    const deg = z.baseDeg + Math.sin(state.clock * z.move.speed) * z.move.amp;
    const [x, zz] = polar(deg, z.baseR);
    z.pos[0] = x; z.pos[1] = zz;
    z.group.position.set(x, 0, zz);
  }
  // 목표 구역 테두리 깜빡임
  for (const z of state.zones) z.ring.material.opacity = 0.6 + Math.sin(state.clock * 4) * 0.4;

  // 안내선
  const gp = grabPoint.getWorldPosition(new THREE.Vector3());
  const tip = tipPoint.getWorldPosition(new THREE.Vector3());
  const top = state.held ? objBox(state.held, _box).min.y : tip.y;
  const sup = supportBelow(gp.x, gp.z, top, state.held);
  const len = Math.max(0.001, top - sup.y);
  guideLine.scale.y = len;
  guideLine.position.set(gp.x, sup.y + len / 2, gp.z);
  guideDot.position.set(gp.x, sup.y + 0.02, gp.z);

  // 시간
  if (state.phase === 'play' && state.mission.time) {
    state.timeLeft -= dt;
    if (state.timeLeft <= 0) { state.timeLeft = 0; missionFail(); }
    updateTimer();
  }

  // 효과
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.userData.v.y -= 9.8 * dt;
    s.position.addScaledVector(s.userData.v, dt);
    s.userData.life -= dt;
    s.scale.setScalar(Math.max(0.01, s.userData.life));
    if (s.userData.life <= 0) { scene.remove(s); s.geometry.dispose(); sparks.splice(i, 1); }
  }
  if (decor.userData.update) decor.userData.update(state.clock, dt);

  // HUD
  $('jYaw').textContent = `${(joint.yaw / DEG).toFixed(0)}°`;
  $('jSh').textContent = `${(joint.shoulder / DEG).toFixed(0)}°`;
  $('jEl').textContent = `${(joint.elbow / DEG).toFixed(0)}°`;
  $('jGrip').textContent = `${Math.round(state.grip * 100)}%${state.held ? ' · 잡는 중' : ''}`;
  $('scoreVal').textContent = state.score;

  updateCamera(dt);
  renderer.render(scene, camera);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------- 시작 화면 ----------------
async function loadConnectInfo() {
  try {
    const info = await (await fetch('/api/info')).json();
    $('qrLeft').innerHTML = info.leftQR;
    $('qrRight').innerHTML = info.rightQR;
    $('urlLeft').textContent = info.left;
    $('urlRight').textContent = info.right;
    $('ipNote').textContent = info.ips.length > 1
      ? `QR로 접속이 안 되면 주소의 IP를 다음 중 하나로 바꿔 보세요: ${info.ips.join(', ')}`
      : '폰이 접속되지 않으면 PC 방화벽에서 Node.js 허용 여부를 확인하세요.';
  } catch {
    $('ipNote').textContent = '서버 정보를 가져오지 못했어요. node server.js 로 실행했는지 확인하세요.';
  }
}
loadConnectInfo();

function startFromIntro() {
  $('connect').classList.add('hidden');
  if (state.phase === 'intro') { beep(660, 0.1); startMission(); }
}
$('btnStart').onclick = () => { startFromIntro(); document.activeElement.blur(); };
$('btnConnect').onclick = () => { $('connect').classList.toggle('hidden'); document.activeElement.blur(); };

setTheme(0);
setCam(0);
applyJoints(joint);
loadMission(state.level);
requestAnimationFrame(frame);

// 디버그용 (브라우저 콘솔에서 상태 확인)
window.__sim = { state, joint, input, tipPoint, grabPoint, tick };
