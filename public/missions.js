// 미션(단계) 정의
// 각도는 로봇팔 정면(화면 안쪽)을 0°, 오른쪽을 + 로 둡니다. r 은 로봇팔 중심에서의 거리.
// 로봇팔이 닿는 거리는 대략 1.0 ~ 2.8 입니다.

export const COLORS = {
  red:    { hex: 0xe8414f, name: '빨강' },
  blue:   { hex: 0x3a7bff, name: '파랑' },
  yellow: { hex: 0xffc531, name: '노랑' },
  green:  { hex: 0x34c96b, name: '초록' },
  purple: { hex: 0xa25bff, name: '보라' },
};
const SHAPE_NAME = { box: '상자', cyl: '원기둥', ball: '공' };

export function polar(deg, r) {
  const a = (deg * Math.PI) / 180;
  return [r * Math.sin(a), -r * Math.cos(a)];
}

// 간단한 시드 난수 (같은 단계는 다시 해도 같은 배치)
function rng(seed) {
  let s = seed * 9301 + 49297;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function obj(id, shape, color, deg, r) {
  return { id, shape, color, pos: polar(deg, r), label: `${COLORS[color].name} ${SHAPE_NAME[shape]}` };
}
function zone(id, color, deg, r, radius, extra = {}) {
  return { id, color, pos: polar(deg, r), r: radius, height: 0, move: null, ...extra };
}
// 로봇팔 중심에서 바깥으로 뻗은 벽 (deg 방향, r1~r2 구간)
function radialWall(deg, r1, r2, h, t = 0.14) {
  const mid = (r1 + r2) / 2;
  const [x, z] = polar(deg, mid);
  return { pos: [x, z], size: [t, h, r2 - r1], rotY: (-deg * Math.PI) / 180 };
}
// 로봇팔 중심을 둘러싼 호 방향 벽 (deg 방향, 거리 r 에서 길이 len)
function arcWall(deg, r, len, h, t = 0.14) {
  const [x, z] = polar(deg, r);
  return { pos: [x, z], size: [len, h, t], rotY: (-deg * Math.PI) / 180 };
}

const toZone = (o, z) => ({ type: 'zone', obj: o, zone: z });
const stack = (o, on) => ({ type: 'stack', obj: o, on });

const HAND_MADE = [
  // 1단계: 기본
  () => ({
    title: '첫 번째 운반',
    desc: '빨간 상자를 집어서 초록색 목표 구역에 내려놓으세요. 바닥의 빨간 점이 집게가 내려갈 위치예요.',
    time: 0,
    objects: [obj('a', 'box', 'red', -35, 1.9)],
    zones: [zone('z1', 'green', 35, 1.9, 0.62)],
    walls: [],
    tasks: [toZone('a', 'z1')],
  }),
  // 2단계: 회전 연습
  () => ({
    title: '빙글 돌려서 옮기기',
    desc: '노란 원기둥을 로봇팔 옆쪽 구역까지 옮기세요. 베이스를 크게 돌려야 해요.',
    time: 0,
    objects: [obj('a', 'cyl', 'yellow', 70, 2.2)],
    zones: [zone('z1', 'yellow', -95, 1.6, 0.55)],
    walls: [],
    tasks: [toZone('a', 'z1')],
  }),
  // 3단계부터 난이도 상승
  () => ({
    title: '색깔 분류',
    desc: '물건을 같은 색 구역에 나눠 담으세요. 이번 단계부터 제한 시간이 있어요!',
    time: 120,
    objects: [obj('a', 'box', 'red', -20, 2.3), obj('b', 'cyl', 'blue', 15, 1.4)],
    zones: [zone('z1', 'red', 75, 1.9, 0.45), zone('z2', 'blue', -75, 2.0, 0.45)],
    walls: [],
    tasks: [toZone('a', 'z1'), toZone('b', 'z2')],
  }),
  () => ({
    title: '장애물 넘기',
    desc: '벽에 부딪히지 않도록 물건을 높이 들어 넘겨야 해요.',
    time: 120,
    objects: [obj('a', 'box', 'green', -55, 1.9), obj('b', 'ball', 'purple', -20, 2.4)],
    zones: [zone('z1', 'green', 50, 2.0, 0.42), zone('z2', 'purple', 20, 2.5, 0.4)],
    walls: [radialWall(0, 1.1, 2.9, 0.9)],
    tasks: [toZone('a', 'z1'), toZone('b', 'z2')],
  }),
  () => ({
    title: '높은 선반',
    desc: '보라 구역은 높은 받침대 위에 있어요. 팔을 높이 들어 올려 내려놓으세요.',
    time: 140,
    objects: [obj('a', 'box', 'purple', 40, 1.5), obj('b', 'cyl', 'yellow', -40, 2.3), obj('c', 'box', 'blue', 0, 2.5)],
    zones: [zone('z1', 'purple', -70, 1.8, 0.4, { height: 0.75 }), zone('z2', 'yellow', 80, 2.1, 0.4), zone('z3', 'blue', 140, 1.6, 0.42)],
    walls: [arcWall(-25, 1.45, 0.9, 0.55)],
    tasks: [toZone('a', 'z1'), toZone('b', 'z2'), toZone('c', 'z3')],
  }),
  () => ({
    title: '탑 쌓기',
    desc: '빨강 → 파랑 → 노랑 순서로 상자를 초록 구역에 쌓아 올리세요. 아래 상자가 먼저 완료되어야 위에 쌓을 수 있어요.',
    time: 160,
    objects: [obj('a', 'box', 'red', -60, 1.8), obj('b', 'box', 'blue', 60, 1.8), obj('c', 'box', 'yellow', -10, 2.5)],
    zones: [zone('z1', 'green', 0, 1.6, 0.36)],
    walls: [],
    tasks: [toZone('a', 'z1'), stack('b', 'a'), stack('c', 'b')],
  }),
  () => ({
    title: '움직이는 컨베이어',
    desc: '목표 구역이 좌우로 움직여요. 타이밍을 맞춰 내려놓으세요.',
    time: 130,
    objects: [obj('a', 'cyl', 'red', -80, 1.7), obj('b', 'box', 'blue', 80, 1.7)],
    zones: [
      zone('z1', 'red', -20, 2.3, 0.42, { move: { axis: 'arc', amp: 35, speed: 0.6 } }),
      zone('z2', 'blue', 160, 1.7, 0.42),
    ],
    walls: [arcWall(0, 1.25, 1.0, 0.45)],
    tasks: [toZone('a', 'z1'), toZone('b', 'z2')],
  }),
];

// 8단계 이후: 자동 생성 (단계가 오를수록 물건↑, 구역 크기↓, 시간↓, 장애물·움직임↑)
function generated(level) {
  const R = rng(level);
  const k = level - HAND_MADE.length;            // 1, 2, 3 ...
  const n = Math.min(2 + Math.ceil(k / 2), 5);   // 물건 수
  const colorKeys = Object.keys(COLORS);
  const shapes = ['box', 'cyl', 'ball'];
  const zoneR = Math.max(0.3, 0.44 - k * 0.02);
  const objects = [];
  const zones = [];
  const tasks = [];

  // 먼저 벽을 놓고, 물건·구역은 벽과 서로에게서 떨어진 곳에 무작위로 배치
  const walls = [];
  const wallSegs = [];
  const wallCount = Math.min(1 + Math.floor(k / 2), 4);
  for (let i = 0; i < wallCount; i++) {
    const a = -150 + R() * 300;
    const r2 = 2.2 + R() * 0.6;
    walls.push(radialWall(a, 1.15, r2, 0.5 + R() * 0.5));
    wallSegs.push([polar(a, 1.15), polar(a, r2)]);
  }
  const placed = []; // {p:[x,z], r}
  const segDist = (p, [a, b]) => {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz));
  };
  const findSpot = (radius, rMin, rMax) => {
    for (let tries = 0; tries < 200; tries++) {
      const deg = -165 + R() * 330;
      const r = rMin + R() * (rMax - rMin);
      const p = polar(deg, r);
      if (placed.some((q) => Math.hypot(p[0] - q.p[0], p[1] - q.p[1]) < radius + q.r + 0.15)) continue;
      if (wallSegs.some((s) => segDist(p, s) < radius + 0.18)) continue;
      placed.push({ p, r: radius });
      return deg + ':' + r;
    }
    return null;
  };

  for (let i = 0; i < n; i++) {
    const color = colorKeys[i % colorKeys.length];
    const id = 'o' + i;
    const zid = 'z' + i;
    const os = findSpot(0.25, 1.4, 2.6);
    const zs = findSpot(zoneR, 1.45, 2.5);
    if (!os || !zs) break; // 자리가 없으면 물건 수를 줄임
    const [oa, or] = os.split(':').map(Number);
    const [za, zr] = zs.split(':').map(Number);
    objects.push(obj(id, shapes[Math.floor(R() * 3)], color, oa, or));
    const extra = {};
    if (R() < Math.min(0.15 + k * 0.08, 0.5)) extra.height = 0.5 + R() * 0.4;
    else if (R() < Math.min(0.1 + k * 0.07, 0.45)) extra.move = { axis: 'arc', amp: 12 + R() * 10, speed: 0.4 + R() * 0.3 + k * 0.03 };
    zones.push(zone(zid, color, za, zr, zoneR, extra));
    tasks.push(toZone(id, zid));
  }
  return {
    title: `도전 ${k}단계`,
    desc: `물건 ${objects.length}개를 같은 색 구역으로! 구역이 더 작아지고, 높거나 움직이는 구역과 벽이 늘어나요.`,
    time: Math.round(Math.max(30, 48 - k * 2) * objects.length),
    objects, zones, walls, tasks,
  };
}

export function buildMission(level) {
  const m = level <= HAND_MADE.length ? HAND_MADE[level - 1]() : generated(level);
  m.level = level;
  m.stars = level <= 2 ? 1 : Math.min(5, 1 + Math.ceil((level - 2) / 1.5));
  return m;
}
