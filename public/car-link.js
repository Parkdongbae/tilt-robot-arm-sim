// 자동차 게임: 폰 ↔ PC 연결
// - 로컬 서버(npm start)에서 열면: 기존 WebSocket 중계 (server.js)
// - 그 밖(Vercel 같은 정적 호스팅)에서 열면: WebRTC P2P (PeerJS 무료 공개 신호 서버로 처음 연결만 주선)
//   PC 화면이 방 번호를 만들고, QR 주소(car-phone.html?room=번호)로 폰이 그 방에 접속한다.
// 주고받는 메시지 형식은 두 방식이 같다:
//   폰 → PC  {type:'car', steer, throttle, brake} / {type:'carEvent', name, value}
//   PC → 폰  {type:'feedback', car, vibrate?, text?}

const PEERJS_URL = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
const QR_URL = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
const PREFIX = 'tilt-car-';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('스크립트를 불러오지 못했습니다: ' + src));
    document.head.appendChild(s);
  });
}

// 로컬 서버가 있으면 접속 정보를 돌려주고, 없으면 null (→ P2P)
async function localServerInfo() {
  try {
    const r = await fetch('/api/info', { cache: 'no-store' });
    if (r.ok && (r.headers.get('content-type') || '').includes('json')) return await r.json();
  } catch { /* 서버 없음 */ }
  return null;
}

function makeRoom() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';   // 헷갈리는 글자(0/o, 1/l/i) 제외
  let s = '';
  for (let i = 0; i < 6; i++) s += abc[(Math.random() * abc.length) | 0];
  return s;
}

function wsUrl() {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

// ====================================================================
// PC 화면 쪽
//   onMessage(m): 폰이 보낸 메시지,  onPhone(bool): 폰 연결 상태
//   onQR({ svg, url }): 폰이 찍을 QR (방식이 정해지면 한 번, P2P 방 번호가 바뀌면 다시)
// ====================================================================
export async function createDisplayLink({ onMessage, onPhone, onQR, onError }) {
  const info = await localServerInfo();
  if (info) return displayWS(info, { onMessage, onPhone, onQR });
  return displayP2P({ onMessage, onPhone, onQR, onError });
}

function displayWS(info, { onMessage, onPhone, onQR }) {
  let ws = null;
  onQR({ svg: info.carPhoneQR || '', url: info.carPhone || '', mode: 'ws' });
  (function connect() {
    ws = new WebSocket(wsUrl());
    ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', role: 'display' }));
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'status') onPhone(!!m.phone);
      else onMessage(m);
    };
    ws.onclose = () => setTimeout(connect, 1000);
    ws.onerror = () => ws.close();
  })();
  return {
    mode: 'ws',
    send: (obj) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); },
  };
}

async function displayP2P({ onMessage, onPhone, onQR, onError }) {
  await Promise.all([loadScript(PEERJS_URL), loadScript(QR_URL)]);
  let peer = null, conn = null, room = null;

  function showQR() {
    const url = `${location.origin}${location.pathname.replace(/[^/]*$/, '')}car-phone.html?room=${room}`;
    const q = window.qrcode(0, 'M');
    q.addData(url);
    q.make();
    onQR({ svg: q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }), url, room, mode: 'p2p' });
  }

  function open() {
    room = makeRoom();
    peer = new window.Peer(PREFIX + room, { debug: 0 });
    peer.on('open', showQR);
    peer.on('connection', (c) => {
      if (conn) conn.close();             // 폰은 한 대만: 새 폰이 들어오면 이전 연결을 끊음
      conn = c;
      c.on('open', () => onPhone(true));
      c.on('data', (d) => {
        let m = d;
        if (typeof d === 'string') { try { m = JSON.parse(d); } catch { return; } }
        if (m && typeof m === 'object') onMessage(m);
      });
      c.on('close', () => { if (conn === c) { conn = null; onPhone(false); } });
      c.on('error', () => {});
    });
    // 신호 서버와의 연결만 끊긴 것: 방 번호 그대로 다시 접속 (폰과의 연결은 유지됨)
    peer.on('disconnected', () => { if (!peer.destroyed) setTimeout(() => peer.reconnect(), 1000); });
    peer.on('error', (e) => {
      if (e.type === 'unavailable-id') { peer.destroy(); open(); return; }      // 방 번호가 겹침 → 새 번호
      if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error' || e.type === 'socket-closed') {
        onError && onError('연결 서버에 접속하지 못했습니다. 인터넷 연결을 확인해 주세요. (다시 시도 중)');
        setTimeout(() => { if (peer.destroyed || peer.disconnected) { peer.destroy(); open(); } }, 3000);
      }
    });
  }
  open();

  return {
    mode: 'p2p',
    send: (obj) => { if (conn && conn.open) conn.send(obj); },
  };
}

// ====================================================================
// 폰 조종기 쪽
//   onMessage(m): PC가 보낸 메시지,  onStatus({ server, display }): 연결 상태
// ====================================================================
export async function createPhoneLink({ onMessage, onStatus }) {
  const room = new URLSearchParams(location.search).get('room');
  if (!room) {
    const info = await localServerInfo();
    if (info) return phoneWS({ onMessage, onStatus });
    return { mode: 'none', error: 'PC 화면의 QR 코드를 찍어서 들어와 주세요.', send: () => {} };
  }
  return phoneP2P(room, { onMessage, onStatus });
}

function phoneWS({ onMessage, onStatus }) {
  let ws = null;
  (function connect() {
    ws = new WebSocket(wsUrl());
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'hello', role: 'phone' }));
      onStatus({ server: true, display: false });
    };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'status') onStatus({ server: true, display: !!m.display });
      else onMessage(m);
    };
    ws.onclose = () => { onStatus({ server: false, display: false }); setTimeout(connect, 1000); };
    ws.onerror = () => ws.close();
  })();
  return {
    mode: 'ws',
    send: (obj) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); },
  };
}

async function phoneP2P(room, { onMessage, onStatus }) {
  await loadScript(PEERJS_URL);
  const target = PREFIX + room.toLowerCase().replace(/[^a-z0-9]/g, '');
  let peer = null, conn = null, retry = null;

  function dial() {
    clearTimeout(retry);
    if (!peer || peer.destroyed || peer.disconnected) return;
    const c = peer.connect(target, { serialization: 'json', reliable: true });
    c.on('open', () => { conn = c; onStatus({ server: true, display: true }); });
    c.on('data', (m) => { if (m && typeof m === 'object') onMessage(m); });
    c.on('close', () => {
      if (conn === c) conn = null;
      onStatus({ server: !peer.disconnected, display: false });
      retry = setTimeout(dial, 1500);
    });
    c.on('error', () => {});
  }

  function open() {
    peer = new window.Peer({ debug: 0 });
    peer.on('open', () => {                        // 처음 접속 또는 신호 서버 재접속
      if (conn && conn.open) { onStatus({ server: true, display: true }); return; }
      onStatus({ server: true, display: false });
      dial();
    });
    peer.on('disconnected', () => {
      onStatus({ server: false, display: !!(conn && conn.open) });
      if (!peer.destroyed) setTimeout(() => peer.reconnect(), 1000);
    });
    peer.on('error', (e) => {
      if (e.type === 'peer-unavailable') {         // PC 화면이 아직 없거나 새로고침됨 → 잠시 후 재시도
        onStatus({ server: true, display: false });
        retry = setTimeout(dial, 2000);
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type)) {
        onStatus({ server: false, display: false });
        setTimeout(() => { if (peer.destroyed || peer.disconnected) { peer.destroy(); open(); } }, 3000);
      }
    });
  }
  open();

  return {
    mode: 'p2p',
    room,
    send: (obj) => { if (conn && conn.open) conn.send(obj); },
  };
}
