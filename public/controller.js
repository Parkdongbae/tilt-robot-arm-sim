// 스마트폰 조종기 공통 코드: 서버 연결, 센서 권한, 화면 꺼짐 방지, 영점 보정
export function createController({ role, onStatus, onFeedback }) {
  let ws = null;
  let open = false;
  const listeners = [];

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      open = true;
      ws.send(JSON.stringify({ type: 'hello', role }));
      onStatus && onStatus({ server: true, display: false });
    };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'status') onStatus && onStatus({ server: true, display: !!m.display });
      if (m.type === 'feedback') {
        if (m.vibrate && navigator.vibrate) navigator.vibrate(m.vibrate);
        onFeedback && onFeedback(m);
      }
    };
    ws.onclose = () => {
      open = false;
      onStatus && onStatus({ server: false, display: false });
      setTimeout(connect, 1000);
    };
    ws.onerror = () => ws.close();
  }
  connect();

  function send(obj) {
    if (open && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  // ---- 센서 ----
  const raw = { alpha: 0, beta: 0, gamma: 0, ok: false };
  function onOrient(e) {
    if (e.beta == null) return;
    raw.alpha = e.alpha || 0;
    raw.beta = e.beta;
    raw.gamma = e.gamma;
    raw.ok = true;
    listeners.forEach((f) => f(raw));
  }

  async function start() {
    // iOS 13+ 는 사용자 터치 후 권한 요청이 필요
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') throw new Error('기울기 센서 권한이 거부되었습니다.');
    }
    if (!window.isSecureContext) {
      throw new Error('HTTPS 주소(https://...)로 접속해야 센서를 쓸 수 있습니다.');
    }
    window.addEventListener('deviceorientation', onOrient);
    // 화면 꺼짐 방지
    try {
      if ('wakeLock' in navigator) {
        let lock = await navigator.wakeLock.request('screen');
        document.addEventListener('visibilitychange', async () => {
          if (document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen');
        });
      }
    } catch { /* 지원하지 않는 기기 */ }
    // 세로 화면 고정 시도 (전체화면일 때만 되는 기기가 많음)
    try {
      if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('portrait');
    } catch { /* 무시 */ }

    // 1.5초 안에 센서 값이 안 들어오면 알려줌
    await new Promise((r) => setTimeout(r, 1500));
    if (!raw.ok) throw new Error('기울기 센서 값이 들어오지 않습니다. 이 기기/브라우저는 센서를 지원하지 않을 수 있어요.');
  }

  return {
    send,
    start,
    raw,
    onSensor: (f) => listeners.push(f),
  };
}

// 데드존과 최대 각도를 적용해 -1 ~ 1 로 변환
export function axis(deg, dead, max) {
  const s = Math.sign(deg);
  const a = Math.abs(deg);
  if (a < dead) return 0;
  return s * Math.min(1, (a - dead) / (max - dead));
}

// 각도 차이를 -180~180 으로
export function angleDiff(a, b) {
  let d = a - b;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}
