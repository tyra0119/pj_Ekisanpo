// エキさんぽ: JR の駅（池袋・東京・新宿・渋谷・品川・高輪ゲートウェイ）と地下街を人の目線で歩き回る。駅は URL の ?st=<駅>。
// 操作（PC）: WASD・矢印キーで歩く、ドラッグで見回す。（スマホ）左下の十字キー、右側をなぞると見回す。

import * as THREE from 'three';
import { buildWorld, addGateRow, EYE, STEP } from './world.js?v=mvrrhtpm';
import { encodeTrack, decodeTrack, startVideo, SAMPLE_MS, MAX_SAMPLES } from './record.js?v=mvrrhtpm';
import { addTrains } from './trains.js?v=mvrrhtpm';

const $ = (id) => document.getElementById(id);
const touchUI = matchMedia('(pointer: coarse)').matches;
if (touchUI) document.body.classList.add('touch');

const VER = '?v=mvrrhtpm'; // 公開用に書き出すとき、版の印（?v=…）に置きかえる（tools/publish.mjs）
const STATIONS = await fetch(`data/stations.json${VER}`).then((r) => r.json());
const ST = STATIONS.find((s) => s.key === new URLSearchParams(location.search).get('st')) || STATIONS[0];
const [data, mallBuf] = await Promise.all([
  fetch(`data/${ST.key}.json${VER}`).then((r) => r.json()),
  ST.mall ? fetch(`data/${ST.key}-mall.bin${VER}`).then((r) => r.arrayBuffer()) : null,
]);
const GL = data.mall ? data.mall.level : null; // 地下街をつなぐ階（マス目で道を探す階）。地下街の無い駅は null
$('credit').textContent = '出典: ' + data.credits.join(' ／ ');
$('helpCredit').textContent = '出典: ' + data.credits.join(' ／ ');
document.title = `エキさんぽ ${data.station.replace(/^JR/, '')}`;
$('stationName').textContent = `${data.station}駅`;
$('helpStation').textContent = `${data.station}駅`;
// 駅の切り替え（左上の駅名）
$('stationBtn').onclick = () => {
  const list = $('stationList');
  list.innerHTML = '';
  for (const s of STATIONS) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'item' + (s.key === ST.key ? ' sel' : '');
    b.innerHTML = `<span class="dot" style="background:#0b8f4d">駅</span>${s.name}駅<span class="tag">${s.mall ? '地下街も' : ''}</span>`;
    b.onclick = () => { location.href = `${location.pathname}?st=${s.key}`; };
    list.append(b);
  }
  $('stationPanel').hidden = false;
};
$('stationClose').onclick = () => { $('stationPanel').hidden = true; };
$('stationPanel').onclick = (e) => { if (e.target === $('stationPanel')) $('stationPanel').hidden = true; };
const LV = data.levels;
const levelOf = (z) => Number(Object.keys(LV).reduce((b, k) => (Math.abs(LV[k].z - z) < Math.abs(LV[b].z - z) ? k : b)));

// ---------- 描画 ----------
const renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color('#c3c8cc');
scene.fog = new THREE.Fog('#c3c8cc', 30, 170);
// 横からの光を強めにして、壁の向きで明るさが変わるように（一色に見えない）
scene.add(new THREE.HemisphereLight('#ffffff', '#b3ada2', 1.0));
const sun = new THREE.DirectionalLight('#ffffff', 1.0);
sun.position.set(40, 60, 25);
scene.add(sun);
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 600);
camera.rotation.order = 'YXZ';
const V3 = (x, y, z) => new THREE.Vector3(x, z, -y);

const { phys } = buildWorld(data, mallBuf, scene);
const trains = addTrains(scene, data);

// ---------- ほかの会社の改札（推定） ----------
// 構内のデータが無いので、推定の点にいちばん近い地下 1 階の JR の壁（店先・駅務・壁。JR のデータでは向こう側が描かれない）の
// 手前に、壁に向かう改札機を 5 台並べ、壁を会社の色の板にする。行き先の点は改札機の前へ
const OP_COLOR = (n) => (/東武/.test(n) ? '#1d50a2' : /丸ノ内/.test(n) ? '#e60012' : /有楽町/.test(n) ? '#c1a470' : /副都心/.test(n) ? '#9c5e31' : /西武/.test(n) ? '#00a0e9' : '#6b5ba8');
for (const d of data.dest.filter((x) => x.t === 'ogate')) {
  let best = null;
  for (const w of data.walls) {
    if (w[4] !== d.level || !'swf'.includes(w[5])) continue;
    const dx = w[2] - w[0], dy = w[3] - w[1], L = Math.hypot(dx, dy);
    if (L < 4.6) continue; // 5 台並ぶ長さのある壁だけ
    const t = Math.max(2.3, Math.min(L - 2.3, ((d.x - w[0]) * dx + (d.y - w[1]) * dy) / L));
    const px = w[0] + (dx / L) * t, py = w[1] + (dy / L) * t, dist = Math.hypot(d.x - px, d.y - py);
    if (!best || dist < best.dist) best = { dist, px, py, ux: dx / L, uy: dy / L };
  }
  if (!best || best.dist > 12) continue;
  const { px, py, ux, uy } = best;
  let nx = -uy, ny = ux;
  if ((d.x - px) * nx + (d.y - py) * ny < 0) { nx = -nx; ny = -ny; } // 推定の点の側へ
  const z = LV[d.level].z, ang = Math.atan2(ny, nx);
  addGateRow(scene, phys, [-2, -1, 0, 1, 2].map((k) => [px + ux * k * 0.9 + nx * 0.9, py + uy * k * 0.9 + ny * 0.9, z, 1.4, 0.2, ang]));
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.6), new THREE.MeshLambertMaterial({ color: OP_COLOR(d.name), emissive: '#222' }));
  panel.position.copy(V3(px + nx * 0.03, py + ny * 0.03, z + 1.3));
  panel.rotation.y = Math.atan2(nx, -ny); // 板の表（+z）を推定の点の側へ（データの (nx, ny) は three.js の (nx, 0, -ny)）
  scene.add(panel);
  d.x = Math.round((px + nx * 2.6) * 100) / 100; d.y = Math.round((py + ny * 2.6) * 100) / 100;
  d.est = 1;
}

// ---------- 札（看板） ----------
// badge: 丸の中の文字（番線など）。badges: [[文字, 色], ...] で複数並べる。arrow: 文字の前に矢印（'up' | 'down'）
function sign(text, { bg = '#f5c400', fg = '#111', badge = null, badgeColor = null, badges = null, arrow = null, h = 0.55 } = {}) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = 'bold 64px system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif';
  g.font = font;
  const bl = badges || (badge ? [[badge, badgeColor]] : []);
  const aw = arrow ? 70 : 0, bw = bl.length * 86 + (bl.length ? 10 : 0);
  c.width = Math.ceil(g.measureText(text).width + 56 + aw + bw);
  c.height = 104;
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.lineWidth = 4;
  g.strokeRect(2, 2, c.width - 4, c.height - 4);
  let x = 24;
  if (arrow) { // 上り・下りの矢印
    g.fillStyle = fg;
    g.beginPath();
    if (arrow === 'up') { g.moveTo(x + 28, 18); g.lineTo(x + 56, 52); g.lineTo(x + 38, 52); g.lineTo(x + 38, 86); g.lineTo(x + 18, 86); g.lineTo(x + 18, 52); g.lineTo(x, 52); }
    else { g.moveTo(x + 28, 86); g.lineTo(x + 56, 52); g.lineTo(x + 38, 52); g.lineTo(x + 38, 18); g.lineTo(x + 18, 18); g.lineTo(x + 18, 52); g.lineTo(x, 52); }
    g.fill();
    x += aw;
  }
  for (const [t, col] of bl) {
    g.fillStyle = col || '#333';
    g.beginPath(); g.arc(x + 40, 52, 38, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold 50px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(t, x + 40, 54);
    x += 86;
  }
  if (bl.length) x += 10;
  g.font = font; g.fillStyle = fg; g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillText(text, x, 55);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: true }));
  s.scale.set((h * c.width) / c.height, h, 1);
  return s;
}
const placed = [];
const addSign = (s, x, y, z) => {
  if (placed.some((p) => Math.hypot(p[0] - x, p[1] - y) < 2.5 && Math.abs(p[2] - z) < 1 && p[3] === s.userData.key)) return;
  placed.push([x, y, z, s.userData.key]);
  s.position.copy(V3(x, y, z));
  scene.add(s);
};
// 駅の設備（構内地図の Facility）の札の記号と色
const FAC_LABEL = { ticket: 'きっぷ売り場', fare: '精算所', locker: 'コインロッカー', atm: 'ATM', kiosk: '売店', info: '案内所', nursing: '授乳室', exchange: '両替所' };
const FAC_WORDS = { ticket: '券売機 みどりの窓口 切符 きっぷ', fare: '精算機 のりこし', locker: 'ロッカー 荷物', atm: '銀行 お金', kiosk: 'キオスク コンビニ', info: 'インフォメーション 案内', nursing: '赤ちゃん おむつ ベビー', exchange: '外貨 お金' }; // 名前で探すときの言いかえ
const FAC_ICON = { ticket: ['券', '#0b8f4d'], fare: ['精', '#0b8f4d'], locker: ['ロ', '#6b737b'], atm: ['¥', '#c46a2b'], kiosk: ['売', '#d0344a'], info: ['i', '#1f6fd1'], nursing: ['授', '#d0607a'], exchange: ['両', '#c46a2b'] };
for (const d of data.dest) {
  const z = LV[d.level].z;
  if (d.t === 'gate') for (const [x, y] of d.pts) { const s = sign(d.name, { bg: '#f5c400' }); s.userData.key = d.name; addSign(s, x, y, z + 2.45); }
  if (d.t === 'toilet') { // 扉の上（扉が分かれば少し外側）
    const s = sign(d.name, { bg: '#1c3f74', fg: '#fff', badge: d.kind === 'M' ? '♂' : d.kind === 'F' ? '♀' : '♿', badgeColor: d.kind === 'M' ? '#1f6fd1' : d.kind === 'F' ? '#d0344a' : '#2f8f5b' });
    s.userData.key = d.name;
    const [sx, sy] = d.door ? [d.door[0] + (d.out[0] - d.door[0]) * 0.35, d.door[1] + (d.out[1] - d.door[1]) * 0.35] : [d.x, d.y];
    addSign(s, sx, sy, z + 2.35);
  }
  // 地下街: 出口は黄色、ほかの会社の改札は薄紫、お店・地下街は白い小さな札（通路から遠いものは置かない）
  if (d.t === 'exit' || d.t === 'ogate') { const s = sign(d.name, { bg: d.t === 'exit' ? '#f5c400' : '#e4d8f3' }); s.userData.key = d.name; addSign(s, d.x, d.y, z + 2.25); }
  if (d.t === 'fac') { const [ch, col] = FAC_ICON[d.kind]; const s = sign(FAC_LABEL[d.kind], { bg: '#1c3f74', fg: '#fff', badge: ch, badgeColor: col, h: 0.42 }); s.userData.key = 'fac' + d.kind; addSign(s, d.sign[0], d.sign[1], z + 2.3); }
  if (d.t === 'spot' && !d.near) { const s = sign(d.name, { bg: '#fff', h: 0.38 }); s.userData.key = d.name; addSign(s, d.x, d.y, z + 2.15); }
  // 階段の上の端の近くには置かない（上ってくる途中で目の前に大きく出る）
  if (d.t === 'plat') for (const [x, y] of d.signs) { if (data.ramps.some((r) => r.lb === d.level && Math.hypot(r.b[0] - x, r.b[1] - y) < 6)) continue; const s = sign(`${d.name.replace(/^\d+番線 /, '')} ${d.dir || ''}`.trim(), { bg: '#fff', badge: String(d.code), badgeColor: d.color }); s.userData.key = d.name; addSign(s, x, y, z + 2.7); }
}
// 階段・エスカレーターの下に、上った先の番線（ホームに着かないものは上の階の改札）
const ROUTE_NAME = Object.fromEntries(data.dest.filter((d) => d.t === 'plat').map((d) => [d.route, [d.name.replace(/^\d+番線 /, ''), d.color]]));
for (const r of data.ramps) {
  const len = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]), dx = (r.b[0] - r.a[0]) / len, dy = (r.b[1] - r.a[1]) / len;
  let s;
  if (r.to && r.to.length) {
    const routes = [...new Set(r.to.map((t) => t.route))], dirs = [...new Set(r.to.map((t) => t.dir).filter(Boolean))];
    s = sign(`${routes.map((k) => ROUTE_NAME[k]?.[0] || k).join('・')} ${dirs.join('／')}`.trim(), { bg: '#fff', arrow: 'up', badges: r.to.map((t) => [String(t.code), ROUTE_NAME[t.route]?.[1]]) });
    s.userData.key = 'to' + r.to.map((t) => t.code).join();
  } else {
    const g = data.dest.filter((d) => d.t === 'gate' && d.level === r.lb).sort((p, q) => Math.hypot(p.x - r.b[0], p.y - r.b[1]) - Math.hypot(q.x - r.b[0], q.y - r.b[1]))[0];
    if (!g) continue;
    s = sign(g.name, { bg: '#f5c400', arrow: 'up' });
    s.userData.key = 'to' + g.name;
  }
  addSign(s, r.a[0] - dx * 0.8, r.a[1] - dy * 0.8, r.a[2] + 2.4);
}
// 行けない所の札（地下街のデータの範囲外への口、改札口の外の歩道の先、地下街の出口の階段の下）
for (const [x, y, z, text] of data.noEntry || []) { const s = sign(text, { bg: '#4b5563', fg: '#fff', badge: '×', badgeColor: '#d93025', h: 0.4 }); s.userData.key = 'ne' + text; addSign(s, x, y, z); }
for (const e of data.elevs) { const s = sign('エレベーター', { bg: '#555', fg: '#fff', h: 0.4 }); s.userData.key = 'ev'; addSign(s, e.x, e.y, LV[e.l].z + 2.3); }

// ---------- 自分 ----------
const me = { x: 0, y: 0, z: 0, yaw: 0, pitch: -0.05, eye: 0 };
(function start() { // はじめは改札の近く（池袋は中央改札1、ほかの駅は一覧の最初の改札）
  const g = data.dest.find((d) => d.name === '中央改札1') || data.dest.find((d) => d.t === 'gate') || data.dest[0];
  me.z = LV[g.level].z;
  const z = LV[g.level].z;
  for (const r of [4, 6, 3, 8]) for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2, x = g.x + Math.sin(a) * r, y = g.y + Math.cos(a) * r;
    const gz = phys.groundAt(x, y, z);
    if (gz == null) continue;
    const [cx, cy] = phys.collide(x, y, gz);
    if (Math.hypot(cx - x, cy - y) > 0.01) continue;
    Object.assign(me, { x, y, z: gz, yaw: Math.atan2(g.x - x, g.y - y) });
    return;
  }
  Object.assign(me, { x: g.x, y: g.y, z });
})();
me.eye = me.z + EYE;

// 1 歩ずつ動かす: 壁から押し出し、床があるときだけ進む（無ければ x・y の片方だけで滑らせる）
function tryAt(x, y) {
  const [cx, cy] = phys.collide(x, y, me.z);
  const gz = phys.groundAt(cx, cy, me.z);
  return gz == null ? null : [cx, cy, gz];
}
function move(dx, dy) {
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 0.12));
  for (let i = 0; i < n; i++) {
    const sx = dx / n, sy = dy / n;
    const r = tryAt(me.x + sx, me.y + sy) || tryAt(me.x + sx, me.y) || tryAt(me.x, me.y + sy);
    if (!r) break;
    [me.x, me.y, me.z] = r;
  }
}

// ---------- 操作 ----------
const keys = new Set();
addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('input,textarea')) return;
  keys.add(e.code);
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const view = $('view');
const ptrs = new Map(); // id → {mode: 'look' | 'stick', x, y, ox, oy}
const stick = { id: null, vx: 0, vy: 0 };
view.addEventListener('pointerdown', (e) => {
  view.setPointerCapture(e.pointerId);
  const W = innerWidth, H = innerHeight;
  const isStick = e.pointerType === 'touch' && stick.id == null && e.clientX < W * 0.45 && e.clientY > H * 0.35;
  ptrs.set(e.pointerId, { mode: isStick ? 'stick' : 'look', x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY });
  if (isStick) {
    stick.id = e.pointerId;
    Object.assign($('stick').style, { left: e.clientX + 'px', top: e.clientY + 'px' });
    $('stick').hidden = false;
  }
});
view.addEventListener('pointermove', (e) => {
  const p = ptrs.get(e.pointerId);
  if (!p) return;
  if (p.mode === 'look') {
    pauseReplay('止めました（ここから歩けます）');
    // 写真を手でずらす向き（ストリートビューと同じ）
    me.yaw -= (e.clientX - p.x) * 0.0045;
    me.pitch = Math.max(-1.2, Math.min(1.2, me.pitch + (e.clientY - p.y) * 0.0045));
  } else {
    let dx = e.clientX - p.ox, dy = e.clientY - p.oy;
    const d = Math.hypot(dx, dy), R = 50;
    if (d > R) { dx *= R / d; dy *= R / d; }
    stick.vx = dx / R; stick.vy = -dy / R;
    $('stick').querySelector('.knob').style.transform = `translate(${dx}px, ${dy}px)`;
  }
  p.x = e.clientX; p.y = e.clientY;
});
const endPtr = (e) => {
  const p = ptrs.get(e.pointerId);
  if (!p) return;
  ptrs.delete(e.pointerId);
  if (p.mode === 'stick') {
    stick.id = null; stick.vx = stick.vy = 0;
    $('stick').hidden = true;
    $('stick').querySelector('.knob').style.transform = '';
  }
};
view.addEventListener('pointerup', endPtr);
view.addEventListener('pointercancel', endPtr);
view.addEventListener('contextmenu', (e) => e.preventDefault());

// 十字キー（スマホ）: ↑↓ で前後、←→ で向きを変える。押している間ずっと。「走る」は切り替え
let running = false;
for (const b of document.querySelectorAll('#dpad [data-k]')) {
  const k = b.dataset.k;
  const on = (e) => {
    e.preventDefault();
    try { b.setPointerCapture(e.pointerId); } catch { /* つかめなくても押している間は動く */ }
    keys.add(k); b.classList.add('on');
  };
  const off = () => { keys.delete(k); b.classList.remove('on'); };
  b.addEventListener('pointerdown', on);
  b.addEventListener('pointerup', off);
  b.addEventListener('pointercancel', off);
  b.addEventListener('contextmenu', (e) => e.preventDefault());
}
$('runBtn').onclick = () => { running = !running; $('runBtn').classList.toggle('on', running); };

// ---------- 経路（GTFS-Pathways） ----------
const GN = data.graph.n;
const adj = GN.map(() => []);
for (const [i, j, len, mode, bi] of data.graph.e) { adj[i].push([j, len, mode]); if (bi) adj[j].push([i, len, mode]); }
const MODE = { 2: '階段', 4: 'エスカレーター', 5: 'エレベーター' };

// 経路網で、いまいる所に近い 6 点から targets（点の番号の集合）のどれかへ。[{ v: 点の番号, mode: その点へ入る経路の種類 }]
function graphChain(px, py, pl, targets) {
  const n = GN.length, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), pmode = new Int8Array(n), done = new Uint8Array(n);
  GN.map((g, i) => [i, Math.hypot(g[0] - px, g[1] - py) + (g[2] === pl ? 0 : 80)]).sort((a, b) => a[1] - b[1]).slice(0, 6).forEach(([i, c]) => { dist[i] = c; });
  for (;;) {
    let u = -1, best = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
    if (u < 0) return null;
    if (targets.has(u)) {
      const chain = [];
      for (let v = u; v >= 0; v = prev[v]) chain.push({ v, mode: pmode[v] || 1 });
      return chain.reverse();
    }
    done[u] = 1;
    for (const [v, len, mode] of adj[u]) {
      const nd = dist[u] + len + (mode === 5 ? 20 : 0);
      if (nd < dist[v]) { dist[v] = nd; prev[v] = u; pmode[v] = mode; }
    }
  }
}

// 道筋: 階をまたぐ所は経路網、地下 1 階の経路網の外（地下街）はマス目（gridPath）でつなぐ
function findRoute(px, py, pl, d) {
  const B1 = GL, P = (x, y, l, mode = 1) => ({ x, y, l, mode }); // B1: マス目の階（地下街の無い駅は null）
  const gridLeg = (ax, ay, bx, by) => gridPath(ax, ay, bx, by)?.map(([x, y]) => P(x, y, B1));
  const fromChain = (chain) => [P(px, py, pl), ...chain.map(({ v, mode }) => P(GN[v][0], GN[v][1], GN[v][2], mode))];
  if (!d.nodes) { // 地下街の行き先（経路網の外）
    if (pl === B1) return gridLeg(px, py, d.x, d.y) || [P(px, py, pl), P(d.x, d.y, B1)];
    // ほかの階からは、経路網で行き先に近い地下 1 階の点まで行き、そこからマス目
    const near = GN.map((g, i) => [i, g]).filter(([, g]) => g[2] === B1).sort((a, b) => Math.hypot(a[1][0] - d.x, a[1][1] - d.y) - Math.hypot(b[1][0] - d.x, b[1][1] - d.y)).slice(0, 3).map(([i]) => i);
    const chain = graphChain(px, py, pl, new Set(near));
    if (!chain) return null;
    const pts = fromChain(chain), last = pts[pts.length - 1], leg = gridLeg(last.x, last.y, d.x, d.y);
    return leg ? [...pts, ...leg.slice(1)] : [...pts, P(d.x, d.y, B1)];
  }
  const chain = graphChain(px, py, pl, new Set(d.nodes));
  if (!chain) return null;
  let pts = fromChain(chain);
  // 地下 1 階で最初の点まで遠い（地下街にいる）ときは、最初の区間をマス目で
  if (B1 != null && pl === B1 && pts.length > 1 && pts[1].l === B1 && Math.hypot(pts[1].x - px, pts[1].y - py) > 5) {
    const leg = gridLeg(px, py, pts[1].x, pts[1].y);
    if (leg) pts = [P(px, py, pl), ...leg.slice(1), ...pts.slice(2)];
  }
  // トイレは 扉の外 → 扉 → 中 の順にたどる（扉が分からないものはトイレの点へ）
  if (d.t === 'toilet') for (const [x, y] of d.door ? [d.out, d.door, d.in] : [[d.x, d.y]]) pts.push(P(x, y, d.level));
  if (d.t === 'elev' || d.t === 'fac') pts.push(P(d.x, d.y, d.level)); // 箱の中まで・設備の前の通路まで
  return pts;
}

// ---------- 地下 1 階のマス目（経路網の無い地下街の中の道） ----------
// 0.5 m 角。床の無いマスと、胸の高さの壁の線が通るマスはふさぐ（改札機は通れるのでふさがない。階段の下は板の高さで決まる）
let grid = null;
function getGrid() {
  if (grid || GL == null) return grid;
  const C = 0.5, z0 = LV[GL].z, h = z0 + 1.0, lo = z0 - 1.2, hi = z0 + 0.9;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const t of phys.floors) {
    if (Math.min(t[2], t[5], t[8]) < lo || Math.max(t[2], t[5], t[8]) > hi) continue;
    x0 = Math.min(x0, t[0], t[3], t[6]); x1 = Math.max(x1, t[0], t[3], t[6]); y0 = Math.min(y0, t[1], t[4], t[7]); y1 = Math.max(y1, t[1], t[4], t[7]);
  }
  // マスごとの床の高さ（地下 1 階に近い面）
  const W = Math.ceil((x1 - x0) / C) + 1, H = Math.ceil((y1 - y0) / C) + 1, ok = new Uint8Array(W * H), zc = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const zs = phys.surfacesAt(x0 + (i + 0.5) * C, y0 + (j + 0.5) * C).filter((z) => z > lo && z < hi);
    if (!zs.length) continue;
    ok[j * W + i] = 1;
    zc[j * W + i] = zs.reduce((b, v) => (Math.abs(v - z0) < Math.abs(b - z0) ? v : b));
  }
  // 壁: そのマスの床から、すね〜頭（0.3〜1.75 m。当たり判定と同じ）の高さにかかればふさぐ
  const mark = (x, y, za, zb) => {
    const i = Math.floor((x - x0) / C), j = Math.floor((y - y0) / C);
    if (i < 0 || j < 0 || i >= W || j >= H) return;
    const c = j * W + i, f = zc[c];
    if (ok[c] && zb >= f + 0.3 && za <= f + 1.75) ok[c] = 0;
  };
  for (const s of phys.segs) {
    if (s.gate) continue;
    const L = Math.hypot(s.bx - s.ax, s.by - s.ay), n = Math.max(1, Math.ceil(L / 0.2));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      mark(s.ax + (s.bx - s.ax) * t, s.ay + (s.by - s.ay) * t, s.z0a + (s.z0b - s.z0a) * t, s.z1a + (s.z1b - s.z1a) * t);
    }
  }
  for (const t of phys.wtris) { // 地下街の壁: 0.25 m ごとの高さで水平に切った線
    const tz0 = Math.min(t[2], t[5], t[8]), tz1 = Math.max(t[2], t[5], t[8]);
    for (let hs = Math.max(tz0, lo + 0.3); hs <= Math.min(tz1, hi + 1.75); hs += 0.25) {
      const p = [];
      for (let k = 0; k < 3; k++) {
        const a = k * 3, b = ((k + 1) % 3) * 3, za = t[a + 2] - hs, zb = t[b + 2] - hs;
        if ((za < 0) !== (zb < 0)) { const u = za / (za - zb); p.push([t[a] + (t[b] - t[a]) * u, t[a + 1] + (t[b + 1] - t[a + 1]) * u]); }
      }
      if (p.length !== 2) continue;
      const L = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]), n = Math.max(1, Math.ceil(L / 0.2));
      for (let k = 0; k <= n; k++) mark(p[0][0] + ((p[1][0] - p[0][0]) * k) / n, p[0][1] + ((p[1][1] - p[0][1]) * k) / n, hs, hs);
    }
  }
  // 改札機の列: 改札機の線はふさぎ、となり合う改札機のあいだ（通路）の中心線だけ開ける（斜めに横切らないように）
  const B1gates = data.gates.filter((g) => g[2] === GL);
  const line = (ax, ay, bx, by, v) => {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.1));
    for (let k = 0; k <= n; k++) { const i = Math.floor((ax + ((bx - ax) * k) / n - x0) / C), j = Math.floor((ay + ((by - ay) * k) / n - y0) / C); if (i >= 0 && j >= 0 && i < W && j < H) ok[j * W + i] = v; }
  };
  for (const [cx, cy, , len, , ang] of B1gates) { const ux = Math.cos(ang) * len / 2, uy = Math.sin(ang) * len / 2; line(cx - ux, cy - uy, cx + ux, cy + uy, 0); }
  for (let a = 0; a < B1gates.length; a++) for (let b = a + 1; b < B1gates.length; b++) {
    const [ax, ay, , len, , ang] = B1gates[a], [bx, by] = B1gates[b];
    const ux = Math.cos(ang), uy = Math.sin(ang), dx = bx - ax, dy = by - ay;
    const along = dx * ux + dy * uy, perp = Math.abs(-dx * uy + dy * ux);
    if (Math.abs(along) > 0.6 || perp < 0.45 || perp > 1.3) continue;
    const mx = (ax + bx) / 2, my = (ay + by) / 2, h2 = len / 2 + 0.6; // 改札機の前後 0.6 m まで
    line(mx - ux * h2, my - uy * h2, mx + ux * h2, my + uy * h2, 1);
  }
  // 壁ぎわ（となりにふさいだマスがある）のマスと、つながりの番号（いちばん大きいものに出発・行き先を寄せる）
  const near = new Uint8Array(W * H), comp = new Int32Array(W * H).fill(-1);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (!ok[j * W + i]) continue;
    for (let dj = -1; dj <= 1 && !near[j * W + i]; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= W || jj >= H || !ok[jj * W + ii]) { near[j * W + i] = 1; break; }
    }
  }
  let main = -1, mainSize = 0;
  for (let s = 0, id = 0; s < W * H; s++) {
    if (!ok[s] || comp[s] >= 0) continue;
    const q = [s]; comp[s] = id; let n = 0;
    while (q.length) {
      const c = q.pop(), i = c % W, j = (c / W) | 0; n++;
      for (const nc of [i + 1 < W ? c + 1 : -1, i > 0 ? c - 1 : -1, j + 1 < H ? c + W : -1, j > 0 ? c - W : -1]) if (nc >= 0 && ok[nc] && comp[nc] < 0 && Math.abs(zc[nc] - zc[c]) <= STEP) { comp[nc] = id; q.push(nc); }
    }
    if (n > mainSize) { mainSize = n; main = id; }
    id++;
  }
  grid = { C, x0, y0, W, H, ok, near, comp, main, zc };
  // 地下街の行き先のうち、つながった部分に寄せられないものは行けない（一覧から外す）
  for (const d of data.dest) if (!d.nodes && snapCell(d.x, d.y) < 0) d.unreach = 1;
  return grid;
}
// 出発地に降りるマス: いちばん大きくつながった部分で、まわり 1 m（±2 マス）がすべて歩けるいちばん近いマス（12 m まで）。
// 出口の階段の下のような狭いすみに降りて、目の前が壁や階段にならないように
function openCell(x, y) {
  const { C, x0, y0, W, H, ok, comp, main } = grid;
  const ci = Math.floor((x - x0) / C), cj = Math.floor((y - y0) / C);
  const open = (i, j) => { for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= W || jj >= H || !ok[jj * W + ii]) return false; } return true; };
  for (let r = 0; r <= 24; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
    const i = ci + di, j = cj + dj;
    if (i >= 0 && j >= 0 && i < W && j < H && comp[j * W + i] === main && open(i, j)) return j * W + i;
  }
  return snapCell(x, y);
}
// いちばん大きくつながった部分の、いちばん近いマス（12 m まで。壁ぎわでないマスを先に）
function snapCell(x, y) {
  if (!grid) return -1;
  const { C, x0, y0, W, H, ok, near, comp, main } = grid;
  const ci = Math.floor((x - x0) / C), cj = Math.floor((y - y0) / C);
  let fallback = -1;
  for (let r = 0; r <= 24; r++) {
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const i = ci + di, j = cj + dj, c = j * W + i;
      if (i < 0 || j < 0 || i >= W || j >= H || !ok[c] || comp[c] !== main) continue;
      if (!near[c]) return c;
      if (fallback < 0) fallback = c;
    }
    if (fallback >= 0 && r >= 2) return fallback;
  }
  return fallback;
}
// マス目の上の最短の道（A*、斜めは角をかすめない）。見通せる所はまっすぐにつなぐ。[[x, y], ...] か null
function gridPath(ax, ay, bx, by) {
  if (!getGrid()) return null; // 地下街の無い駅
  const { C, x0, y0, W, H, ok, near, zc } = grid;
  const s = snapCell(ax, ay), t = snapCell(bx, by);
  if (s < 0 || t < 0) return null;
  const N = W * H, g = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const ti = t % W, tj = (t / W) | 0;
  const hfn = (c) => { const dx = Math.abs((c % W) - ti), dy = Math.abs(((c / W) | 0) - tj); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
  const heap = [], push = (f, c) => { heap.push([f, c]); let k = heap.length - 1; while (k) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  g[s] = 0; push(hfn(s), s);
  const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  let found = false;
  while (heap.length) {
    const [, c] = pop();
    if (closed[c]) continue;
    if (c === t) { found = true; break; }
    closed[c] = 1;
    const ci = c % W, cj = (c / W) | 0;
    for (const [di, dj, w] of NB) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= W || j >= H) continue;
      const nc = j * W + i;
      if (!ok[nc] || closed[nc] || Math.abs(zc[nc] - zc[c]) > STEP) continue; // 上れない段差
      if (di && dj && (!ok[cj * W + i] || !ok[j * W + ci])) continue; // 角をかすめない
      const ng = g[c] + w + (near[nc] ? 2 : 0); // 壁ぎわは通りにくく（通路の真ん中を通る）
      if (ng < g[nc]) { g[nc] = ng; came[nc] = c; push(ng + hfn(nc), nc); }
    }
  }
  if (!found) return null;
  const cells = [];
  for (let c = t; c >= 0; c = came[c]) cells.push(c);
  cells.reverse();
  const xy = (c) => [x0 + ((c % W) + 0.5) * C, y0 + (((c / W) | 0) + 0.5) * C];
  const see = (a, b) => { // 2 つのマスのあいだが全部歩けて、壁ぎわを通らないか
    const [ax2, ay2] = xy(a), [bx2, by2] = xy(b), n = Math.ceil(Math.hypot(bx2 - ax2, by2 - ay2) / (C * 0.4));
    for (let k = 1; k < n; k++) {
      const c = Math.floor((ay2 + ((by2 - ay2) * k) / n - y0) / C) * W + Math.floor((ax2 + ((bx2 - ax2) * k) / n - x0) / C);
      if (!ok[c] || (near[c] && c !== a && c !== b) || Math.abs(zc[c] - zc[a]) > STEP + 0.15) return false;
    }
    return true;
  };
  const out = [xy(cells[0])];
  for (let a = 0; a < cells.length - 1;) {
    let b = a + 1;
    while (b + 1 < cells.length && see(cells[a], cells[b + 1])) b++;
    out.push(xy(cells[b]));
    a = b;
  }
  return out;
}
setTimeout(() => getGrid(), 1500); // 最初の案内で待たないように、読み込みのあとで作っておく

// ---------- 改札の内と外 ----------
// 経路網の点のうち、ホームの乗車位置から改札（経路の種類 6・7）を通らずにたどれる点が改札内
const paid = new Uint8Array(GN.length);
{
  const nb = GN.map(() => []);
  for (const [i, j, , mode] of data.graph.e) if (mode !== 6 && mode !== 7) { nb[i].push(j); nb[j].push(i); }
  const q = data.dest.filter((d) => d.t === 'plat').flatMap((d) => d.nodes);
  q.forEach((i) => { paid[i] = 1; });
  while (q.length) { const u = q.pop(); for (const v of nb[u]) if (!paid[v]) { paid[v] = 1; q.push(v); } }
}
// 改札機の列の線: となり合う改札機の中心をつなぐ。列の両端の改札機からは、列の向きに 0.8 m のばす（壁とのすき間をふさぐ）
const fareLines = [];
{
  const G = data.gates, deg = new Map();
  for (let a = 0; a < G.length; a++) for (let b = a + 1; b < G.length; b++) {
    if (G[a][2] !== G[b][2]) continue;
    const ux = Math.cos(G[a][5]), uy = Math.sin(G[a][5]), dx = G[b][0] - G[a][0], dy = G[b][1] - G[a][1];
    const along = dx * ux + dy * uy, perp = Math.abs(-dx * uy + dy * ux);
    if (Math.abs(along) > 0.6 || perp < 0.3 || perp > 1.3) continue;
    fareLines.push([G[a][0], G[a][1], G[b][0], G[b][1], G[a][2]]);
    for (const [k, o] of [[a, b], [b, a]]) { if (!deg.has(k)) deg.set(k, []); deg.get(k).push(o); }
  }
  for (const [k, os] of deg) {
    if (os.length !== 1) continue;
    const [x, y, l] = G[k], o = G[os[0]], L = Math.hypot(x - o[0], y - o[1]);
    fareLines.push([x, y, x + ((x - o[0]) / L) * 0.8, y + ((y - o[1]) / L) * 0.8, l]);
  }
}
const crosses = (p, q, a, b) => {
  const o = (u, v, w) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
  return o(a, b, p) * o(a, b, q) < 0 && o(p, q, a) * o(p, q, b) < 0;
};
// 改札機の列から 1 m 以内の点は判定に使わない（南改札の内側の点が列のちょうど上にあり、外からも列を横切らずに届いた）
const onFare = GN.map((g) => fareLines.some((f) => {
  if (f[4] !== g[2]) return false;
  const dx = f[2] - f[0], dy = f[3] - f[1], L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((g[0] - f[0]) * dx + (g[1] - f[1]) * dy) / L)) : 0;
  return Math.hypot(g[0] - f[0] - dx * t, g[1] - f[1] - dy * t) < 1;
}));
// 改札機の列ごとに、どちら側が改札内か。列は、となり合う改札機をつないでできるまとまり。向きは改札機に直角。
// 改札内の側は、列の近く（6 m 以内）を通る改札の経路（種類 6）の改札内の点が、列のどちら側にあるかの多数決（点が列から 0.3 m 以内なら反対の点で）
const fareRows = [];
{
  const G = data.gates, parent = G.map((_, i) => i), find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let a = 0; a < G.length; a++) for (let b = a + 1; b < G.length; b++) {
    if (G[a][2] !== G[b][2]) continue;
    const ux = Math.cos(G[a][5]), uy = Math.sin(G[a][5]), dx = G[b][0] - G[a][0], dy = G[b][1] - G[a][1];
    if (Math.abs(dx * ux + dy * uy) <= 0.6 && Math.abs(-dx * uy + dy * ux) <= 1.3) parent[find(a)] = find(b);
  }
  const groups = {};
  G.forEach((g, i) => (groups[find(i)] = groups[find(i)] || []).push(g));
  for (const ms of Object.values(groups)) {
    if (ms.length < 2) continue;
    const l = ms[0][2], ang = ms[0][5], rx = -Math.sin(ang), ry = Math.cos(ang); // 列の向き
    const cx = ms.reduce((s, g) => s + g[0], 0) / ms.length, cy = ms.reduce((s, g) => s + g[1], 0) / ms.length;
    const pr = ms.map((g) => (g[0] - cx) * rx + (g[1] - cy) * ry), t0 = Math.min(...pr), t1 = Math.max(...pr);
    const side = (x, y) => (x - cx) * -ry + (y - cy) * rx; // 列からの符号つきの距離
    let vote = 0;
    for (const [i, j, , mode] of data.graph.e) {
      if (mode !== 6 || GN[i][2] !== l) continue;
      const mx = (GN[i][0] + GN[j][0]) / 2, my = (GN[i][1] + GN[j][1]) / 2;
      if (Math.hypot(mx - cx, my - cy) > 6 + (t1 - t0) / 2) continue;
      const [pi, ui] = paid[i] ? [i, j] : [j, i], sp = side(GN[pi][0], GN[pi][1]), su = side(GN[ui][0], GN[ui][1]);
      vote += Math.abs(sp) > 0.3 ? Math.sign(sp) : -Math.sign(su);
    }
    if (vote) fareRows.push({ l, cx, cy, rx, ry, t0, t1, side, inSign: Math.sign(vote) });
  }
}
// いまいる所: 改札機の列の前後 4 m 以内なら、列のどちら側か。そうでなければ、改札機の列も壁も横切らずにまっすぐ行ける、
// いちばん近い経路網の点（30 m まで）の内・外。無ければ改札外（地下街など）
function fareSide(x, y, l) {
  for (const r of fareRows) {
    if (r.l !== l) continue;
    const t = (x - r.cx) * r.rx + (y - r.cy) * r.ry, s = r.side(x, y);
    if (t > r.t0 - 1.5 && t < r.t1 + 1.5 && Math.abs(s) < 4) return Math.sign(s) === r.inSign ? 'in' : 'out';
  }
  const cand = [];
  GN.forEach((g, i) => { if (g[2] === l && !onFare[i]) { const d = Math.hypot(g[0] - x, g[1] - y); if (d < 30) cand.push([i, d]); } });
  cand.sort((a, b) => a[1] - b[1]);
  for (const [i] of cand.slice(0, 12)) {
    const p = [x, y], q = [GN[i][0], GN[i][1]];
    if (fareLines.some((f) => f[4] === l && crosses(p, q, [f[0], f[1]], [f[2], f[3]]))) continue;
    if (data.walls.some((w) => w[4] === l && w[5] !== 'r' && crosses(p, q, [w[0], w[1]], [w[2], w[3]]))) continue;
    return paid[i] ? 'in' : 'out';
  }
  return 'out';
}

// 床の矢印
const chevGeo = (() => {
  const s = new THREE.Shape();
  s.moveTo(0, 0.32); s.lineTo(0.3, -0.05); s.lineTo(0.16, -0.05); s.lineTo(0, 0.13); s.lineTo(-0.16, -0.05); s.lineTo(-0.3, -0.05); s.closePath();
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(-Math.PI / 2);
  return g;
})();
const chevs = new THREE.InstancedMesh(chevGeo, new THREE.MeshBasicMaterial({ color: '#00a6ff', transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }), 800);
chevs.count = 0;
chevs.renderOrder = 3;
chevs.frustumCulled = false; // 矢印の置き場所は案内のたびに変わるので、範囲で間引かない
scene.add(chevs);

const nav = { dest: null, pts: null, at: null, lastCalc: 0, arrived: false };
function drawChevrons() {
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  let k = 0;
  const pts = nav.pts || [];
  for (let i = 1; i < pts.length && k < 800; i++) {
    const a = pts[i - 1], b = pts[i];
    if (b.mode === 5) continue; // エレベーターの中は描かない
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const bearing = Math.atan2(b.x - a.x, b.y - a.y);
    q.setFromAxisAngle(yAxis, -bearing);
    const za = LV[a.l].z, zb = LV[b.l].z, lift = a.l !== b.l ? 0.3 : 0.06;
    for (let t = i === 1 ? 1.2 : 0.4; t < len && k < 800; t += 1.6) {
      const f = t / len;
      m4.compose(V3(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, za + (zb - za) * f + lift), q, one);
      chevs.setMatrixAt(k++, m4);
    }
  }
  chevs.count = k;
  chevs.instanceMatrix.needsUpdate = true;
}
function setDest(d) {
  nav.dest = d; nav.arrived = false; nav.lastCalc = 0; nav.at = null;
  $('guide').hidden = !d;
  if (!d) { nav.pts = null; drawChevrons(); return; }
  $('gName').textContent = d.name + (d.t === 'toilet' ? `（${LV[d.level].name}）` : d.dir ? ` ${d.dir}` : '') + (d.near ? '（近くの通路まで）' : '');
  recalc();
}
function recalc() {
  const pl = levelOf(me.z);
  nav.pts = findRoute(me.x, me.y, pl, nav.dest);
  if (!nav.pts) { $('gDist').textContent = 'ここからの道が見つかりません'; $('gHint').textContent = 'データの上で通路がつながっていません'; }
  nav.at = { x: me.x, y: me.y, l: pl };
  nav.lastCalc = performance.now();
  drawChevrons();
}
// 道筋の上で、いまいる所に近い位置と、そこから先の長さ
function progress() {
  const pts = nav.pts, pl = levelOf(me.z);
  let best = { d: Infinity, i: 1, t: 0 };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (a.l !== pl && b.l !== pl) continue;
    const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((me.x - a.x) * dx + (me.y - a.y) * dy) / L)) : 0;
    const d = Math.hypot(me.x - a.x - dx * t, me.y - a.y - dy * t);
    if (d < best.d) best = { d, i, t };
  }
  return best;
}
function updateGuide() {
  if (!nav.dest) return;
  if (!nav.pts) { if (performance.now() - nav.lastCalc > 1500) recalc(); return; } // 道が無いときは、歩いてつながった所へ来たら見つかる
  const now = performance.now();
  const pl = levelOf(me.z);
  const pr = progress();
  if (now - nav.lastCalc > 1000 && (pr.d > 5 || nav.at.l !== pl || Math.hypot(me.x - nav.at.x, me.y - nav.at.y) > 25)) { recalc(); return updateGuide(); }
  const pts = nav.pts;
  // 先の長さと、4 m 先の点
  let remain = 0, look = null, acc = 0;
  for (let i = pr.i; i < pts.length; i++) {
    const a = i === pr.i ? { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * pr.t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * pr.t } : pts[i - 1];
    const L = Math.hypot(pts[i].x - a.x, pts[i].y - a.y);
    if (!look && acc + L >= 4) { const f = (4 - acc) / L; look = { x: a.x + (pts[i].x - a.x) * f, y: a.y + (pts[i].y - a.y) * f }; }
    acc += L;
    remain += L;
  }
  const end = pts[pts.length - 1];
  look = look || end;
  const bearing = Math.atan2(look.x - me.x, look.y - me.y);
  $('arrow').style.transform = `rotate(${((bearing - me.yaw) * 180) / Math.PI}deg)`;
  $('gDist').textContent = `あと 約${Math.max(1, Math.round(remain + pr.d))} m`;
  // この先の上り下り
  let hint = '';
  let before = 0;
  for (let i = pr.i; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (a.l !== b.l) {
      hint = `${before < 5 ? 'この' : `約${Math.round(before)} m 先の`}${MODE[b.mode] || '階段'}で ${LV[b.l].name} へ${b.l > a.l ? '上る' : '下りる'}`;
      break;
    }
    before += Math.hypot(b.x - a.x, b.y - a.y) * (i === pr.i ? 1 - pr.t : 1);
  }
  if (!hint && end.l !== pl) hint = `${LV[end.l].name} へ`;
  $('gHint').textContent = hint;
  if (!nav.arrived && Math.hypot(end.x - me.x, end.y - me.y) < 3 && end.l === pl) {
    nav.arrived = true;
    toast(`到着しました（${nav.dest.name}）` + (nav.dest.est ? '。駅の中のデータが無いので、改札の位置と形は推定です' : ''));
    setTimeout(() => { if (nav.arrived) setDest(null); }, 2500);
  }
}

// 出発地・行き先を選ぶ。出発地を選ぶとそこへ移動し、続けて行き先を選べる
let destMode = 'to', startName = null;
// 出発地に降りる点。トイレは扉の外。改札口は、改札口の点から経路網で 1 つ中に入った、床の上の点（改札口の点は構内の外側に置かれていることがある。渋谷の西口）
const startPoint = (d) => {
  if (d.t === 'toilet' && d.out) return d.out;
  if (d.t === 'gate') for (const i of d.nodes) for (const [j] of adj[i]) { const [x, y, l] = GN[j]; if (l === d.level && phys.groundAt(x, y, LV[l].z) != null) return [x, y]; }
  return [d.x, d.y];
};
function startAt(d, animate = true) {
  const [x, y] = startPoint(d);
  startName = d.name;
  if (animate) { jumpTo(x, y, d.level, true); return; }
  const p = landingAt(x, y, d.level, true);
  if (p) { [me.x, me.y, me.z] = p; me.eye = me.z + EYE; me.yaw = openYaw(...p); }
}
// いちばん開けている向き: 32 方向で、いちばん遠くまで見通せる向き（地下 1 階はマス目の壁ぎわでないマス、ほかの階は当たり判定で歩いてみる）
function openYaw(x, y, z) {
  let best = [0, -1];
  const B1 = GL != null && levelOf(z) === GL && grid;
  for (let k = 0; k < 32; k++) {
    const a = (k / 32) * Math.PI * 2, sx = Math.sin(a) * 0.25, sy = Math.cos(a) * 0.25;
    let px = x, py = y, pz = z, d = 0;
    for (; d < 80; d++) {
      if (B1) {
        const c = Math.floor((py + sy - grid.y0) / grid.C) * grid.W + Math.floor((px + sx - grid.x0) / grid.C);
        if (!grid.ok[c] || grid.near[c]) break;
        px += sx; py += sy;
      } else {
        const [cx, cy] = phys.collide(px + sx, py + sy, pz), gz = phys.groundAt(cx, cy, pz);
        if (gz == null || Math.hypot(cx - px, cy - py) < 0.12) break;
        px = cx; py = cy; pz = gz;
      }
    }
    if (d > best[1]) best = [a, d];
  }
  return best[0];
}
// 「出発・行き先」の画面: 上の 2 行（出発・行き先）のうち選んでいる行の一覧を出す。選んだものはこの画面の中だけで覚え、
// 「案内を始める」（行き先が無ければ「ここへ移動」）で出発地へ移動し、行き先の案内を始める
const pend = { from: null, to: null }; // from: null はいまいる所
function renderRows() {
  for (const b of document.querySelectorAll('#routeRows .rrow')) b.classList.toggle('on', b.dataset.m === destMode);
  $('fromVal').textContent = pend.from ? pend.from.name : 'いまいる所';
  $('toVal').textContent = pend.to ? pend.to.name + (pend.to.dir ? ` ${pend.to.dir}` : '') : '選んでください';
  $('toVal').classList.toggle('empty', !pend.to);
  $('goBtn').disabled = !pend.from && !pend.to;
  $('goBtn').textContent = pend.from && !pend.to ? 'ここへ移動' : '案内を始める';
}
function openDest(mode = destMode) {
  destMode = mode;
  renderRows();
  const list = $('destList');
  list.innerHTML = '';
  const pl = levelOf(me.z);
  const q = $('destFilter').value.trim();
  const add = (title, items) => {
    items = items.filter(([d]) => !d.unreach); // マス目でつながらない地下街の場所は出さない
    if (q) items = items.filter(([d]) => d.name.includes(q) || (d.kind || '').includes(q) || (d.dir || '').includes(q) || (d.t === 'fac' && FAC_WORDS[d.kind].includes(q)));
    if (!items.length) return;
    const h = document.createElement('div'); h.className = 'grp'; h.textContent = title; list.append(h);
    for (const [d, html, tag] of items) {
      const b = document.createElement('button');
      b.className = 'item' + (pend[destMode] === d ? ' sel' : ''); b.type = 'button';
      b.innerHTML = html + (tag ? `<span class="tag">${tag}</span>` : '');
      b.onclick = () => {
        pend[destMode] = d;
        // 出発を選んだら行き先の一覧へ。行き先を選んだらそのまま（出発を変えるときは上の行を押す）
        openDest('to');
        $('destList').scrollTop = 0;
      };
      list.append(b);
    }
  };
  if (mode === 'from' && !q) { // いまいる所（移動しない）
    const b = document.createElement('button');
    b.className = 'item' + (!pend.from ? ' sel' : ''); b.type = 'button';
    b.innerHTML = '<span class="dot" style="background:#1a73e8">今</span>いまいる所<span class="tag">移動しない</span>';
    b.onclick = () => { pend.from = null; openDest('to'); };
    list.append(b);
  }
  const dist = (d) => Math.hypot(d.x - me.x, d.y - me.y) + Math.abs(d.level - pl) * 30;
  const gates = data.dest.filter((d) => d.t === 'gate');
  add('改札', gates.map((d) => [d, `<span class="dot" style="background:#f5c400;color:#111">改</span>${d.name}`, LV[d.level].name]));
  add('ホーム', data.dest.filter((d) => d.t === 'plat').map((d) => [d, `<span class="dot" style="background:${d.color}">${d.code}</span><span>${d.name} <b>${d.dir || ''}</b>${d.heads?.length ? `<br><small>主な行き先: ${d.heads.join('・')}</small>` : ''}</span>`, '']));
  const toilets = data.dest.filter((d) => d.t === 'toilet').sort((a, b) => dist(a) - dist(b));
  const elevs = data.dest.filter((d) => d.t === 'elev' && d.level === pl).sort((a, b) => dist(a) - dist(b));
  if (elevs.length) add(`エレベーター（${LV[pl].name}・近い順）`, elevs.map((d) => [d, `<span class="dot" style="background:#6b737b">EV</span>${d.name.replace(/^エレベーター（(.*)）$/, '$1')}`, `約${Math.round(dist(d))} m`]));
  add('トイレ（近い順）', toilets.map((d) => [d, `<span class="dot" style="background:${d.kind === 'M' ? '#1f6fd1' : d.kind === 'F' ? '#d0344a' : '#2f8f5b'}">${d.kind === 'M' ? '♂' : d.kind === 'F' ? '♀' : '♿'}</span>${d.name}`, `${LV[d.level].name}・約${Math.round(dist(d))} m`]));
  // 駅の設備（種類ごとに近い順）
  for (const k of Object.keys(FAC_LABEL)) {
    const fs = data.dest.filter((d) => d.t === 'fac' && d.kind === k).sort((a, b) => dist(a) - dist(b));
    add(`${FAC_LABEL[k]}（近い順）`, fs.map((d) => [d, `<span class="dot" style="background:${FAC_ICON[k][1]}">${FAC_ICON[k][0]}</span>${d.name}`, `${LV[d.level].name}・約${Math.round(dist(d))} m`]));
  }
  // 地下街（Machiawase の OpenStreetMap の場所）
  const near = (d) => (d.near ? '<br><small>近くの通路まで</small>' : '');
  add('ほかの会社の改札', data.dest.filter((d) => d.t === 'ogate').map((d) => [d, `<span class="dot" style="background:#7a5ea8">改</span><span>${d.name}${near(d)}</span>`, `約${Math.round(dist(d))} m`]));
  const num = (d) => parseInt(d.name.replace(/\D/g, ''), 10) || 0;
  add('地下街の出口', data.dest.filter((d) => d.t === 'exit').sort((a, b) => num(a) - num(b)).map((d) => [d, `<span class="dot" style="background:#f5c400;color:#111">出</span><span>${d.name}${near(d)}</span>`, `約${Math.round(dist(d))} m`]));
  add('地下街・お店（近い順）', data.dest.filter((d) => d.t === 'spot').sort((a, b) => dist(a) - dist(b)).map((d) => [d, `<span class="dot" style="background:#c46a2b">${d.kind === 'カフェ・飲食' ? '食' : d.kind === '店' ? '店' : '街'}</span><span>${d.name}<br><small>${d.kind}${d.near ? '・近くの通路まで' : ''}</small></span>`, `約${Math.round(dist(d))} m`]));
  if (!list.children.length) list.innerHTML = '<p class="note">見つかりませんでした</p>';
  $('destPanel').hidden = false;
}
$('destBtn').onclick = () => {
  $('destFilter').value = '';
  pend.from = null; pend.to = nav.dest; // 出発はいまいる所、行き先はいまの案内
  openDest('to');
};
$('destFilter').addEventListener('input', () => openDest(destMode));
for (const b of document.querySelectorAll('#routeRows .rrow')) b.onclick = () => { $('destFilter').value = ''; openDest(b.dataset.m); };
$('goBtn').onclick = () => {
  $('destPanel').hidden = true;
  const { from, to } = pend;
  if (from) {
    startAt(from);
    if (jump && to) jump.after = () => setDest(to); // 出発地に着いてから道筋を探す
    else if (to) setDest(to);
  } else if (to) setDest(to);
};
// 案内を共有: 出発地（選んでいれば）と行き先を URL に
$('gShare').onclick = async () => {
  if (!nav.dest) return;
  const q = new URLSearchParams({ st: ST.key });
  if (startName) q.set('from', startName);
  q.set('to', nav.dest.name);
  const url = `${location.origin}${location.pathname}?${q}`;
  if (navigator.share) { try { await navigator.share({ title: 'エキさんぽの案内', text: `${startName ? startName + ' から ' : ''}${nav.dest.name} への案内`, url }); return; } catch { /* 取り消し */ } }
  copy(url);
};
$('destClose').onclick = () => { $('destPanel').hidden = true; };
$('destPanel').onclick = (e) => { if (e.target === $('destPanel')) $('destPanel').hidden = true; };
$('gClose').onclick = () => setDest(null);

let toastTimer = 0;
function toast(msg) {
  $('toast').textContent = msg; $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 2200);
}

// ---------- エレベーター ----------
let elevHere = null;
function updateElev() {
  const pl = levelOf(me.z);
  const e = data.elevs.find((v) => v.l === pl && Math.hypot(v.x - me.x, v.y - me.y) < 1.4 && v.pair.length);
  if (e === elevHere) return;
  elevHere = e;
  const box = $('elev');
  box.hidden = !e;
  if (!e) return;
  box.innerHTML = '<span>エレベーター</span>';
  for (const l of [...e.pair, e.l].sort((a, b) => b - a)) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = LV[l].name;
    b.disabled = l === e.l;
    if (l === e.l) b.style.opacity = 0.4;
    b.onclick = () => {
      const t = data.elevs.find((v) => v.l === l && Math.hypot(v.x - e.x, v.y - e.y) < 3);
      if (!t) return;
      // 扉が閉まって（画面を少し暗く）、2.5 秒かけて上り下りする
      elevHere = null; box.hidden = true;
      toast(l > e.l ? '上へまいります' : '下へまいります');
      document.body.classList.add('riding');
      jump = { from: [me.x, me.y, me.z], to: [t.x, t.y, LV[l].z], t: 0, dur: 2.5, msg: `${LV[l].name} に着きました`, yaw0: me.yaw };
    };
    box.append(b);
  }
}

// ---------- 小さな地図 ----------
// floor: 地図に出している階（null なら自分のいる階）
const mini = { cx: me.x, cy: me.y, s: 1.6, rot: 0, follow: true, floor: null };
const mcv = $('miniCv'), mg = mcv.getContext('2d');
const paths = {}; // 階ごとの Path2D
for (const l of Object.keys(LV)) {
  const floor = new Path2D(), block = new Path2D(), wall = new Path2D(), mall = new Path2D();
  const ring = (P, r) => { P.moveTo(r[0], r[1]); for (let i = 2; i < r.length; i += 2) P.lineTo(r[i], r[i + 1]); P.closePath(); };
  for (const f of data.floors) if (String(f.l) === l) f.r.forEach((r) => ring(floor, r));
  for (const f of data.blocks) if (String(f.l) === l) f.r.forEach((r) => ring(block, r));
  for (const w of data.walls) if (String(w[4]) === l) { wall.moveTo(w[0], w[1]); wall.lineTo(w[2], w[3]); }
  if (GL != null && Number(l) === GL) {
    const L = data.mall.layout.floor, f = new Float32Array(mallBuf, L[0], L[1]);
    for (let i = 0; i < f.length; i += 9) if (Math.abs(f[i + 2] - LV[l].z) < 2.5) { mall.moveTo(f[i], f[i + 1]); mall.lineTo(f[i + 3], f[i + 4]); mall.lineTo(f[i + 6], f[i + 7]); mall.closePath(); }
  }
  paths[l] = { floor, block, wall, mall };
}
const ramps2d = data.ramps;
function miniSize() {
  const r = mcv.getBoundingClientRect();
  mcv.width = Math.round(r.width * devicePixelRatio);
  mcv.height = Math.round(r.height * devicePixelRatio);
}
const W2S = (x, y) => {
  const W = mcv.clientWidth, H = mcv.clientHeight, c = Math.cos(mini.rot), s = Math.sin(mini.rot);
  const dx = x - mini.cx, dy = y - mini.cy;
  return [W / 2 + mini.s * (c * dx - s * dy), H / 2 - mini.s * (s * dx + c * dy)];
};
const S2W = (sx, sy) => {
  const W = mcv.clientWidth, H = mcv.clientHeight, c = Math.cos(mini.rot), s = Math.sin(mini.rot);
  const u = (sx - W / 2) / mini.s, v = -(sy - H / 2) / mini.s;
  return [mini.cx + c * u + s * v, mini.cy - s * u + c * v];
};
function drawMini() {
  if (mini.follow) { mini.cx = me.x; mini.cy = me.y; }
  const W = mcv.clientWidth, H = mcv.clientHeight, dpr = devicePixelRatio;
  const c = Math.cos(mini.rot), s = Math.sin(mini.rot), k = mini.s;
  mg.setTransform(dpr, 0, 0, dpr, 0, 0);
  mg.fillStyle = '#e9e6df';
  mg.fillRect(0, 0, W, H);
  const cur = String(levelOf(me.z));
  const pl = mini.floor ?? cur;
  const P = paths[pl];
  mg.setTransform(dpr * k * c, -dpr * k * s, -dpr * k * s, -dpr * k * c, dpr * (W / 2 - k * (c * mini.cx - s * mini.cy)), dpr * (H / 2 + k * (s * mini.cx + c * mini.cy)));
  mg.fillStyle = '#fbfaf6'; mg.fill(P.mall);
  mg.fillStyle = '#ffffff'; mg.fill(P.floor);
  mg.fillStyle = '#d5cfc4'; mg.fill(P.block);
  mg.strokeStyle = '#8a8378'; mg.lineWidth = 1.2 / k; mg.stroke(P.wall);
  mg.fillStyle = 'rgba(224,152,40,0.55)';
  for (const r of ramps2d) if (String(r.la) === pl || String(r.lb) === pl) {
    const len = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]), nx = (-(r.b[1] - r.a[1]) / len) * r.w / 2, ny = ((r.b[0] - r.a[0]) / len) * r.w / 2;
    mg.beginPath(); mg.moveTo(r.a[0] + nx, r.a[1] + ny); mg.lineTo(r.b[0] + nx, r.b[1] + ny); mg.lineTo(r.b[0] - nx, r.b[1] - ny); mg.lineTo(r.a[0] - nx, r.a[1] - ny); mg.fill();
  }
  // 道筋
  if (nav.pts) {
    mg.strokeStyle = '#0a84ff'; mg.lineWidth = 3.5 / k; mg.lineJoin = 'round'; mg.lineCap = 'round';
    mg.beginPath();
    for (let i = 1; i < nav.pts.length; i++) {
      const a = nav.pts[i - 1], b = nav.pts[i];
      if (String(a.l) !== pl && String(b.l) !== pl) continue;
      mg.moveTo(a.x, a.y); mg.lineTo(b.x, b.y);
    }
    mg.stroke();
  }
  // 再生中の足あと
  if (replay.samples) {
    mg.strokeStyle = '#f08c00'; mg.lineWidth = 3 / k; mg.lineJoin = 'round'; mg.lineCap = 'round';
    mg.beginPath();
    const S = replay.samples, z0 = LV[pl].z;
    for (let i = 1; i < S.length; i++) {
      if (Math.abs(S[i].z - z0) > 2.9 || Math.abs(S[i - 1].z - z0) > 2.9 || Math.hypot(S[i].x - S[i - 1].x, S[i].y - S[i - 1].y) > 8) continue;
      mg.moveTo(S[i - 1].x, S[i - 1].y); mg.lineTo(S[i].x, S[i].y);
    }
    mg.stroke();
  }
  mg.setTransform(dpr, 0, 0, dpr, 0, 0);
  // 改札・トイレの名前
  mg.font = 'bold 10px system-ui, sans-serif'; mg.textAlign = 'center'; mg.textBaseline = 'middle';
  for (const d of data.dest) {
    if (String(d.level) !== pl || d.t === 'plat' || d.t === 'elev' || d.t === 'spot') continue;
    const [x, y] = W2S(d.x, d.y);
    if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
    const t = d.t === 'gate' || d.t === 'exit' || d.t === 'ogate' ? d.name : d.t === 'fac' ? FAC_ICON[d.kind][0] : d.kind === 'M' ? '♂' : d.kind === 'F' ? '♀' : '♿';
    mg.fillStyle = d.t === 'gate' || d.t === 'exit' ? '#f5c400' : d.t === 'ogate' ? '#e4d8f3' : d.t === 'fac' ? FAC_ICON[d.kind][1] : '#1c3f74';
    const w = mg.measureText(t).width + 6;
    mg.fillRect(x - w / 2, y - 7, w, 14);
    mg.fillStyle = d.t === 'toilet' || d.t === 'fac' ? '#fff' : '#111';
    mg.fillText(t, x, y);
  }
  if (nav.dest) {
    const [x, y] = W2S(nav.dest.x, nav.dest.y);
    mg.fillStyle = '#e8453c'; mg.beginPath(); mg.arc(x, y - 9, 6, 0, Math.PI * 2); mg.moveTo(x - 5, y - 6); mg.lineTo(x, y); mg.lineTo(x + 5, y - 6); mg.fill();
  }
  // 移動先
  if (jump) {
    const [x, y] = W2S(jump.to[0], jump.to[1]);
    mg.strokeStyle = '#1a73e8'; mg.lineWidth = 2.5;
    mg.beginPath(); mg.arc(x, y, 8, 0, Math.PI * 2); mg.stroke();
  }
  // 自分（向きつき）。ほかの階を出しているときは薄く
  const [px, py] = W2S(me.x, me.y);
  const a = me.yaw - mini.rot;
  mg.save(); mg.translate(px, py); mg.rotate(a);
  if (pl !== cur) mg.globalAlpha = 0.35;
  mg.fillStyle = 'rgba(26,115,232,0.18)'; mg.beginPath(); mg.moveTo(0, 0); mg.arc(0, 0, 26, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); mg.fill();
  mg.fillStyle = '#1a73e8'; mg.strokeStyle = '#fff'; mg.lineWidth = 2;
  mg.beginPath(); mg.moveTo(0, -9); mg.lineTo(6, 6); mg.lineTo(0, 3); mg.lineTo(-6, 6); mg.closePath(); mg.fill(); mg.stroke();
  mg.restore();
  for (const b of floorBtns) { b.classList.toggle('on', b.dataset.l === pl); b.classList.toggle('me', b.dataset.l === cur); }
  $('needle').setAttribute('transform', `rotate(${(-mini.rot * 180) / Math.PI} 12 12)`);
  $('mLocate').classList.toggle('on', mini.follow);
}
// 地図の操作（Google マップと同じ: 左ドラッグ・指 1 本で移動、右ドラッグで回転、ホイールで拡大・縮小、2 本指でひねる・広げる・動かす）
const mp = new Map();
const zoomAt = (sx, sy, f) => {
  const [wx, wy] = S2W(sx, sy);
  mini.s = Math.max(0.3, Math.min(14, mini.s * f));
  const [nx, ny] = W2S(wx, wy);
  const [ax, ay] = S2W(nx, ny), [bx, by] = S2W(sx, sy);
  mini.cx += ax - bx; mini.cy += ay - by;
};
const rotateAt = (sx, sy, da) => {
  const [wx, wy] = S2W(sx, sy);
  mini.rot += da;
  const [nx, ny] = W2S(wx, wy);
  const [ax, ay] = S2W(nx, ny), [bx, by] = S2W(sx, sy);
  mini.cx += ax - bx; mini.cy += ay - by;
};
const panBy = (dx, dy) => {
  const [ax, ay] = S2W(0, 0), [bx, by] = S2W(dx, dy);
  mini.cx -= bx - ax; mini.cy -= by - ay;
};
const local = (e) => { const r = mcv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
// 指 1 本・左クリックで、ほとんど動かさずに離したら「タップ」（その場所へ移動）
let tap = null;
mcv.addEventListener('pointerdown', (e) => {
  mcv.setPointerCapture(e.pointerId);
  const [x, y] = local(e);
  mp.set(e.pointerId, { x, y, btn: e.button });
  tap = mp.size === 1 && e.button === 0 ? { id: e.pointerId, x, y, t: performance.now(), moved: false } : null;
});
mcv.addEventListener('pointermove', (e) => {
  const p = mp.get(e.pointerId);
  if (!p) return;
  const [x, y] = local(e);
  if (tap && tap.id === e.pointerId && !tap.moved) {
    if (Math.hypot(x - tap.x, y - tap.y) < 6) return; // まだタップかもしれない
    tap.moved = true;
    p.x = tap.x; p.y = tap.y;
  }
  if (mp.size === 1) {
    mini.follow = false;
    if (p.btn === 2) rotateAt(mcv.clientWidth / 2, mcv.clientHeight / 2, (x - p.x) * 0.01);
    else panBy(x - p.x, y - p.y);
  } else if (mp.size === 2) {
    const [q] = [...mp.entries()].filter(([id]) => id !== e.pointerId).map(([, v]) => v);
    const ox = (p.x + q.x) / 2, oy = (p.y + q.y) / 2, nx = (x + q.x) / 2, ny = (y + q.y) / 2;
    const d0 = Math.hypot(p.x - q.x, p.y - q.y), d1 = Math.hypot(x - q.x, y - q.y);
    const a0 = Math.atan2(p.y - q.y, p.x - q.x), a1 = Math.atan2(y - q.y, x - q.x);
    mini.follow = false;
    panBy(nx - ox, ny - oy);
    if (d0 > 10) zoomAt(nx, ny, d1 / d0);
    rotateAt(nx, ny, -(a1 - a0));
  }
  p.x = x; p.y = y;
});
const mEnd = (e) => {
  mp.delete(e.pointerId);
  if (tap && tap.id === e.pointerId) {
    if (e.type === 'pointerup' && !tap.moved && performance.now() - tap.t < 600) jumpTo(...S2W(tap.x, tap.y), Number(mini.floor ?? levelOf(me.z)));
    tap = null;
  }
};
mcv.addEventListener('pointerup', mEnd);
mcv.addEventListener('pointercancel', mEnd);
mcv.addEventListener('contextmenu', (e) => e.preventDefault());
mcv.addEventListener('wheel', (e) => { e.preventDefault(); const [x, y] = local(e); zoomAt(x, y, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
$('mCompass').onclick = () => { mini.rot = 0; };
$('mLocate').onclick = () => { mini.follow = true; mini.floor = null; };

// 階の切り替え（地図の左に、上の階から）
const floorBtns = Object.keys(LV).sort((p, q) => q - p).map((l) => {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = LV[l].name; b.dataset.l = l;
  b.setAttribute('aria-label', `${LV[l].name} の地図`);
  b.onclick = () => { mini.floor = l === String(levelOf(me.z)) ? null : l; };
  $('floorPick').append(b);
  return b;
});
let lastLevel = levelOf(me.z);
function watchLevel() { // 歩いて階が変わったら、地図も自分の階に戻す
  const l = levelOf(me.z);
  if (l !== lastLevel) { lastLevel = l; if (mini.follow) mini.floor = null; }
}

// 地図でタップした所へ移動（ストリートビューのように）。歩けない所なら 3 m 以内の歩ける所へ寄せる
let jump = null;
function landingAt(x, y, level, open = false) {
  const z0 = LV[level].z;
  // 地下 1 階は、マス目のいちばん大きくつながった部分のいちばん近い所へ（囲まれた小さな区画に降りて出られなくならないように）。
  // 出発地（open）は開けたマスへ
  if (level === GL && getGrid()) {
    const c = open ? openCell(x, y) : snapCell(x, y);
    if (c >= 0) { x = grid.x0 + ((c % grid.W) + 0.5) * grid.C; y = grid.y0 + (((c / grid.W) | 0) + 0.5) * grid.C; }
  }
  let lo = z0 - 1.5, hi = z0 + (level === GL ? 2.5 : 0.6);
  const pick = (px, py) => {
    const zs = phys.surfacesAt(px, py).filter((z) => z > lo && z < hi);
    if (!zs.length) return null;
    const z = zs.reduce((b, v) => (Math.abs(v - z0) < Math.abs(b - z0) ? v : b));
    const [cx, cy] = phys.collide(px, py, z);
    const gz = phys.groundAt(cx, cy, z);
    return gz == null ? null : [cx, cy, gz];
  };
  // 出発地（open）は 12 m まで探す（渋谷の西口のように、改札口の点が通路の面の外にあることがある）。地図のタップは 3 m まで
  for (let r = 0; r <= (open ? 12 : 3); r += 0.5) for (let k = 0; k < (r ? 12 : 1); k++) {
    const a = (k / 12) * Math.PI * 2, p = pick(x + Math.sin(a) * r, y + Math.cos(a) * r);
    if (p) return p;
  }
  // 出発地で見つからないときは、高さを広げてその場所のいちばん近い床へ（新宿の京王口は、GTFS では地下 1 階だが構内地図の床は地下 2 階）
  if (open) {
    lo = z0 - 7; hi = z0 + 7;
    for (let r = 0; r <= 6; r += 0.5) for (let k = 0; k < (r ? 12 : 1); k++) {
      const a = (k / 12) * Math.PI * 2, p = pick(x + Math.sin(a) * r, y + Math.cos(a) * r);
      if (p) return p;
    }
  }
  return null;
}
function jumpTo(x, y, level, faceOpen = false) {
  const to = landingAt(x, y, level, faceOpen);
  if (!to) { toast('そこへは行けません'); return; }
  pauseReplay('止めました（ここから歩けます）');
  jump = { from: [me.x, me.y, me.z], to, t: 0, dur: Math.min(1.2, 0.35 + Math.hypot(to[0] - me.x, to[1] - me.y) / 120) };
  // 出発地は開けている向き、地図のタップは進む向きを向く（真上をタップしたときはそのまま）
  if (faceOpen) jump.yaw = openYaw(...to);
  else if (Math.hypot(to[0] - me.x, to[1] - me.y) > 1) jump.yaw = Math.atan2(to[0] - me.x, to[1] - me.y);
  jump.yaw0 = me.yaw;
}
function updateJump(dt) {
  if (!jump) return false;
  jump.t += dt / jump.dur;
  const u = Math.min(1, jump.t), e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
  const [fx, fy, fz] = jump.from, [tx, ty, tz] = jump.to;
  me.x = fx + (tx - fx) * e; me.y = fy + (ty - fy) * e; me.z = fz + (tz - fz) * e;
  if (jump.yaw != null) { const d = Math.atan2(Math.sin(jump.yaw - jump.yaw0), Math.cos(jump.yaw - jump.yaw0)); me.yaw = jump.yaw0 + d * Math.min(1, u * 2); }
  if (u >= 1) {
    const msg = jump.msg || (levelOf(me.z) !== levelOf(fz) ? `${LV[levelOf(me.z)].name} に移動しました` : ''), after = jump.after;
    jump = null;
    mini.floor = null;
    mini.follow = true;
    document.body.classList.remove('riding');
    if (msg) toast(msg);
    if (after) after();
  }
  return true;
}
$('mIn').onclick = () => zoomAt(mcv.clientWidth / 2, mcv.clientHeight / 2, 1.4);
$('mOut').onclick = () => zoomAt(mcv.clientWidth / 2, mcv.clientHeight / 2, 1 / 1.4);

// ---------- 録画と再生 ----------
const rec = { on: false, samples: [], last: 0, t0: 0, video: null };
const trail = new THREE.InstancedMesh(chevGeo, new THREE.MeshBasicMaterial({ color: '#f08c00', transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }), 1500);
trail.count = 0;
trail.renderOrder = 3;
trail.frustumCulled = false;
scene.add(trail);
const replay = { samples: null, t: 0, playing: false };

function sampleNow() { return { x: me.x, y: me.y, z: me.z, yaw: me.yaw, pitch: me.pitch }; }
async function toggleRec() {
  if (!rec.on) {
    Object.assign(rec, { on: true, samples: [sampleNow()], last: performance.now(), t0: performance.now(), video: startVideo(renderer.domElement) });
    $('recBtn').classList.add('on');
    return;
  }
  rec.on = false;
  $('recBtn').classList.remove('on');
  $('recLabel').textContent = '録画';
  rec.samples.push(sampleNow());
  const blob = rec.video ? await rec.video.stop() : null;
  const destIndex = nav.dest ? data.dest.indexOf(nav.dest) : 255;
  const code = await encodeTrack(rec.samples, destIndex);
  openShare(code, blob, (rec.samples.length * SAMPLE_MS) / 1000);
}
$('recBtn').onclick = toggleRec;

let videoURL = null;
function openShare(code, blob, sec) {
  const url = `${location.origin}${location.pathname}?st=${ST.key}#rec=${code}`;
  const mmss = `${Math.floor(sec / 60)}分${String(Math.round(sec % 60)).padStart(2, '0')}秒`;
  $('shareInfo').textContent = `${mmss}の録画です。` + (nav.dest ? `行き先: ${nav.dest.name}` : '');
  $('linkShare').onclick = async () => {
    if (navigator.share) { try { await navigator.share({ title: 'エキさんぽの足あと', text: `${data.station}駅で歩いた道すじです。` + '開くと同じ道を再生できます。', url }); return; } catch { /* 取り消し */ } }
    copy(url);
  };
  $('linkCopy').onclick = () => copy(url);
  $('videoBox').hidden = !blob;
  if (blob) {
    if (videoURL) URL.revokeObjectURL(videoURL);
    videoURL = URL.createObjectURL(blob);
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
    const d = new Date(), pad = (n) => String(n).padStart(2, '0');
    const name = `ekisanpo-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.${ext}`;
    $('videoPrev').src = videoURL;
    $('videoSave').href = videoURL;
    $('videoSave').download = name;
    $('videoShare').onclick = async () => {
      const file = new File([blob], name, { type: blob.type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: 'エキさんぽの録画' }); return; } catch { /* 取り消し */ } }
      $('videoSave').click();
    };
  }
  $('sharePanel').hidden = false;
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('リンクをコピーしました'); } catch { prompt('このリンクをコピーしてください', text); }
}
$('shareClose').onclick = () => { $('sharePanel').hidden = true; };
$('sharePanel').onclick = (e) => { if (e.target === $('sharePanel')) $('sharePanel').hidden = true; };

function drawTrail(samples) {
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  let k = 0, acc = 0;
  for (let i = 1; i < samples.length && k < 1500; i++) {
    const a = samples[i - 1], b = samples[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > 8) { acc = 0; continue; } // エレベーターの飛び
    acc += len;
    if (acc < 2) continue;
    acc = 0;
    q.setFromAxisAngle(yAxis, -Math.atan2(b.x - a.x, b.y - a.y));
    m4.compose(V3(b.x, b.y, b.z + 0.08), q, one);
    trail.setMatrixAt(k++, m4);
  }
  trail.count = k;
  trail.instanceMatrix.needsUpdate = true;
}
function setReplayPose(t) {
  const S = replay.samples, f = Math.max(0, Math.min(S.length - 1, t / SAMPLE_MS)), i = Math.floor(f), u = f - i;
  const a = S[i], b = S[Math.min(S.length - 1, i + 1)];
  let dyaw = b.yaw - a.yaw;
  dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
  const jump = Math.hypot(b.x - a.x, b.y - a.y) > 8;
  const w = jump ? 0 : u;
  Object.assign(me, { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w, z: a.z + (b.z - a.z) * w, yaw: a.yaw + dyaw * w, pitch: a.pitch + (b.pitch - a.pitch) * w });
  $('replayProg').style.width = `${(100 * f) / Math.max(1, S.length - 1)}%`;
}
function pauseReplay(msg) {
  if (!replay.playing) return;
  replay.playing = false;
  $('replayPlay').textContent = '▶';
  if (msg) $('replayTitle').textContent = msg;
}
$('replayPlay').onclick = () => {
  if (replay.playing) { pauseReplay('一時停止中'); return; }
  if (replay.t >= (replay.samples.length - 1) * SAMPLE_MS) replay.t = 0;
  replay.playing = true;
  $('replayPlay').textContent = '❚❚';
  $('replayTitle').textContent = '足あとを再生中';
};
$('replayEnd').onclick = () => {
  replay.playing = false; replay.samples = null;
  $('replayBar').hidden = true;
  trail.count = 0;
  history.replaceState(null, '', location.pathname + location.search);
};
async function loadReplay() {
  const m = location.hash.match(/^#rec=(.+)$/);
  if (!m) return false;
  try {
    const { samples, destIndex } = await decodeTrack(m[1]);
    if (samples.length < 2) return false;
    Object.assign(replay, { samples, t: 0, playing: true });
    drawTrail(samples);
    setReplayPose(0);
    me.eye = me.z + EYE;
    $('replayBar').hidden = false;
    if (destIndex < data.dest.length) $('replayTitle').textContent = `足あとを再生中（${data.dest[destIndex].name}へ）`;
    return true;
  } catch (e) {
    toast('足あとを開けませんでした');
    console.warn(e);
    return false;
  }
}
const replaying = await loadReplay();
// URL の ?from=出発地&to=行き先（名前。「5番線」のように先頭だけでもよい）
if (!replaying) {
  const q = new URLSearchParams(location.search);
  const find = (s) => s && (data.dest.find((d) => d.name === s) || data.dest.find((d) => d.name.startsWith(s)));
  const from = find(q.get('from')), to = find(q.get('to'));
  if (from) startAt(from, false);
  else { // はじめの位置も、出発地と同じ降り方で（改札口の点が通路の外にある駅で、動けない所に立っていた。渋谷の西口）
    // 改札は駅ごとに決めた広いコンコースに面したもの（data.start。東京で京葉地下丸の内口改札の脇の、エスカレーターの開口に近い狭い所に立っていた）
    const g = data.dest.find((d) => d.t === 'gate' && d.name === data.start) || data.dest.find((d) => d.t === 'gate' && /改札$/.test(d.name)) || data.dest.find((d) => d.t === 'gate');
    if (g) { startAt(g, false); startName = null; }
  }
  if (to) setDest(to);
  if (from && to && nav.pts) { const p = nav.pts.find((t, i) => i > 0 && Math.hypot(t.x - me.x, t.y - me.y) > 3); if (p) me.yaw = Math.atan2(p.x - me.x, p.y - me.y); }
}

// ---------- はじめの説明 ----------
const seen = (() => { try { return localStorage.getItem('ekisanpo.help') === '1'; } catch { return false; } })();
$('help').hidden = seen || replaying;
$('helpOk').onclick = () => { $('help').hidden = true; try { localStorage.setItem('ekisanpo.help', '1'); } catch { /* 保存できなくてもよい */ } };

// ---------- 方角の帯 ----------
// 向いている方向の左右 75° を帯の幅に。東西南北と、駅のまわりの目印（data.marks）の方向を出す（地下で方向が分からなくならないように）。
// 帯の外の目印は、左右の端に「◀ 名前」で近い方から 1 つずつ
const cmp = { cv: $('compassCv'), key: '' };
function drawCompass() {
  const cv = cmp.cv, w = cv.clientWidth, h = cv.clientHeight, dpr = devicePixelRatio || 1;
  const key = `${w}|${Math.round(me.yaw * 200)}|${Math.round(me.x)}|${Math.round(me.y)}`;
  if (key === cmp.key || !w) return;
  cmp.key = key;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const SPAN = (75 * Math.PI) / 180, cx = w / 2, px = (w / 2 - 6) / SPAN;
  const rel = (b) => Math.atan2(Math.sin(b - me.yaw), Math.cos(b - me.yaw));
  g.textAlign = 'center'; g.textBaseline = 'middle';
  // 目盛り（15° ごと）と東西南北
  for (let d = 0; d < 360; d += 15) {
    const a = rel((d * Math.PI) / 180);
    if (Math.abs(a) > SPAN) continue;
    const x = cx + a * px, card = d % 90 === 0;
    if (card) {
      g.font = 'bold 13px system-ui, sans-serif';
      g.fillStyle = d === 0 ? '#ff6b5e' : '#fff';
      g.fillText('北東南西'[d / 90], x, h / 2 + 1);
    } else {
      g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, h - (d % 45 === 0 ? 9 : 6)); g.lineTo(x, h); g.stroke();
    }
  }
  // 目印: 帯の外のものは左右の端に「◀ 名前」（近い方から 1 つ）。先に描いて場所を取り、帯の中の名前の札はそこと重ならないように
  // （札どうしが重なるときは、一覧の先のものを残す）
  const marks = (data.marks || []).map(([name, mx, my]) => [name, rel(Math.atan2(mx - me.x, my - me.y))]);
  const used = [], side = { l: null, r: null };
  for (const [name, a] of marks) if (Math.abs(a) > SPAN) { const k = a < 0 ? 'l' : 'r'; if (!side[k] || Math.abs(a) < Math.abs(side[k][1])) side[k] = [name, a]; }
  g.font = '11px system-ui, sans-serif'; g.fillStyle = 'rgba(255,255,255,0.85)';
  if (side.l) { const t = `◀ ${side.l[0]}`; g.textAlign = 'left'; g.fillText(t, 8, h / 2 + 0.5); used.push([0, g.measureText(t).width + 14]); }
  if (side.r) { const t = `${side.r[0]} ▶`; g.textAlign = 'right'; g.fillText(t, w - 8, h / 2 + 0.5); used.push([w - g.measureText(t).width - 14, w]); }
  g.font = 'bold 11px system-ui, sans-serif'; g.textAlign = 'center';
  for (const [name, a] of marks) {
    if (Math.abs(a) > SPAN) continue;
    const tw = g.measureText(name).width + 12, x = Math.max(tw / 2 + 2, Math.min(w - tw / 2 - 2, cx + a * px));
    if (used.some(([l, r]) => x + tw / 2 > l && x - tw / 2 < r)) continue;
    used.push([x - tw / 2, x + tw / 2]);
    g.fillStyle = '#0b8f4d';
    g.beginPath(); g.roundRect(x - tw / 2, 5, tw, h - 10, 8); g.fill();
    g.fillStyle = '#fff'; g.fillText(name, x, h / 2 + 0.5);
  }
  // 真ん中（向いている方向）の印
  g.fillStyle = '#ffd24a';
  g.beginPath(); g.moveTo(cx - 5, 0); g.lineTo(cx + 5, 0); g.lineTo(cx, 6); g.fill();
}

// ---------- ループ ----------
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  miniSize();
}
addEventListener('resize', resize);
resize();

let last = performance.now();
let floorShown = '', fareShown = 'out', fareAt = 0;
function frame(now) {
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); // 最初のコマは now が last より前のことがある
  last = now;
  // 歩く
  let f = 0, s = 0, turn = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
  if (keys.has('KeyA')) s -= 1;
  if (keys.has('KeyD')) s += 1;
  if (keys.has('ArrowLeft')) turn -= 1;
  if (keys.has('ArrowRight')) turn += 1;
  me.yaw += turn * 1.9 * dt;
  const RUN = 5.0, WALK = 1.5; // 走る・歩く速さ（m/秒）
  let speed = keys.has('ShiftLeft') || keys.has('ShiftRight') || running ? RUN : WALK;
  if (stick.id != null) {
    f += stick.vy; s += stick.vx;
    // スティックは大きく倒すと走る
    speed = running ? RUN : WALK + Math.max(0, Math.hypot(stick.vx, stick.vy) - 0.85) * ((RUN - WALK) / 0.15);
  }
  const mag = Math.hypot(f, s);
  if (updateJump(dt)) {
    // 地図で選んだ所へ移動中は、歩く操作を受けない
  } else if (replay.playing) {
    if (mag > 0.01 || turn) pauseReplay('止めました（ここから歩けます）');
    else {
      replay.t += dt * 1000;
      const end = (replay.samples.length - 1) * SAMPLE_MS;
      setReplayPose(Math.min(replay.t, end));
      if (replay.t >= end) pauseReplay('再生おわり（ここから歩けます）');
    }
  } else if (mag > 0.01) {
    const k = (speed * dt) / Math.max(1, mag);
    const fx = Math.sin(me.yaw), fy = Math.cos(me.yaw);
    move((fx * f + fy * s) * k, (fy * f - fx * s) * k);
  }
  if (rec.on && now - rec.last >= SAMPLE_MS) {
    rec.last += SAMPLE_MS;
    rec.samples.push(sampleNow());
    const sec = Math.floor((now - rec.t0) / 1000);
    $('recLabel').textContent = `止める ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    if (rec.samples.length >= MAX_SAMPLES) toggleRec();
  }
  me.eye += (me.z + EYE - me.eye) * Math.min(1, dt * 10);
  camera.position.copy(V3(me.x, me.y, me.eye));
  camera.rotation.set(me.pitch, -me.yaw, 0);
  const fl = LV[levelOf(me.z)].name;
  if (fl !== floorShown) { $('floor').textContent = fl; floorShown = fl; }
  if (now - fareAt > 300) { // 改札の内・外（0.3 秒ごと）
    fareAt = now;
    const side = fareSide(me.x, me.y, levelOf(me.z));
    if (side !== fareShown) { fareShown = side; $('fare').textContent = side === 'in' ? '改札内' : '改札外'; $('fare').className = `pill fare ${side}`; }
  }
  trains.update(dt);
  watchLevel();
  updateGuide();
  updateElev();
  drawMini();
  drawCompass();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
$('loading').hidden = true;
requestAnimationFrame(frame);

// 確かめ用（コンソールから位置を見る・動かす）
window.ekisanpo = { me, phys, setDest, data, move, nav, rec, replay, encodeTrack, decodeTrack, trains, mini, jumpTo, W2S, S2W, getGrid, gridPath, startAt, scene, camera, THREE, fareSide };
