// エキさんぽ: JR池袋駅と地下街を人の目線で歩き回る。
// 操作（PC）: WASD・矢印キーで歩く、ドラッグで見回す。（スマホ）左下を押して動かすと歩く、右側をなぞると見回す。

import * as THREE from 'three';
import { buildWorld, EYE } from './world.js';
import { encodeTrack, decodeTrack, startVideo, SAMPLE_MS, MAX_SAMPLES } from './record.js';
import { addTrains } from './trains.js';

const $ = (id) => document.getElementById(id);
const touchUI = matchMedia('(pointer: coarse)').matches;
if (touchUI) document.body.classList.add('touch');

const [data, mallBuf] = await Promise.all([
  fetch('data/ikebukuro.json').then((r) => r.json()),
  fetch('data/mall.bin').then((r) => r.arrayBuffer()),
]);
$('credit').textContent = '出典: ' + data.credits.join(' ／ ');
$('helpCredit').textContent = '出典: ' + data.credits.join(' ／ ');
const LV = data.levels;
const levelOf = (z) => Number(Object.keys(LV).reduce((b, k) => (Math.abs(LV[k].z - z) < Math.abs(LV[b].z - z) ? k : b)));

// ---------- 描画 ----------
const renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color('#c3c8cc');
scene.fog = new THREE.Fog('#c3c8cc', 30, 170);
scene.add(new THREE.HemisphereLight('#ffffff', '#b3ada2', 1.3));
const sun = new THREE.DirectionalLight('#ffffff', 0.55);
sun.position.set(40, 90, 25);
scene.add(sun);
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 600);
camera.rotation.order = 'YXZ';
const V3 = (x, y, z) => new THREE.Vector3(x, z, -y);

const { phys } = buildWorld(data, mallBuf, scene);
const trains = addTrains(scene, data);

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
for (const d of data.dest) {
  const z = LV[d.level].z;
  if (d.t === 'gate') for (const [x, y] of d.pts) { const s = sign(d.name, { bg: '#f5c400' }); s.userData.key = d.name; addSign(s, x, y, z + 2.45); }
  if (d.t === 'toilet') { // 扉の上（扉が分かれば少し外側）
    const s = sign(d.name, { bg: '#1c3f74', fg: '#fff', badge: d.kind === 'M' ? '♂' : d.kind === 'F' ? '♀' : '♿', badgeColor: d.kind === 'M' ? '#1f6fd1' : d.kind === 'F' ? '#d0344a' : '#2f8f5b' });
    s.userData.key = d.name;
    const [sx, sy] = d.door ? [d.door[0] + (d.out[0] - d.door[0]) * 0.35, d.door[1] + (d.out[1] - d.door[1]) * 0.35] : [d.x, d.y];
    addSign(s, sx, sy, z + 2.35);
  }
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
for (const e of data.elevs) { const s = sign('エレベーター', { bg: '#555', fg: '#fff', h: 0.4 }); s.userData.key = 'ev'; addSign(s, e.x, e.y, LV[e.l].z + 2.3); }

// ---------- 自分 ----------
const me = { x: 0, y: 0, z: LV['-1'].z, yaw: 0, pitch: -0.05, eye: 0 };
(function start() {
  const g = data.dest.find((d) => d.name === '中央改札1') || data.dest[0];
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

function findRoute(px, py, pl, d) {
  const n = GN.length, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), pmode = new Int8Array(n), done = new Uint8Array(n);
  GN.map((g, i) => [i, Math.hypot(g[0] - px, g[1] - py) + (g[2] === pl ? 0 : 80)]).sort((a, b) => a[1] - b[1]).slice(0, 6).forEach(([i, c]) => { dist[i] = c; });
  const T = new Set(d.nodes);
  for (;;) {
    let u = -1, best = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
    if (u < 0) return null;
    if (T.has(u)) {
      const chain = [];
      for (let v = u; v >= 0; v = prev[v]) chain.push(v);
      chain.reverse();
      const pts = [{ x: px, y: py, l: pl, mode: 1 }, ...chain.map((v) => ({ x: GN[v][0], y: GN[v][1], l: GN[v][2], mode: pmode[v] || 1 }))];
      // トイレは 扉の外 → 扉 → 中 の順にたどる（扉が分からないものはトイレの点へ）
      if (d.t === 'toilet') for (const [x, y] of d.door ? [d.out, d.door, d.in] : [[d.x, d.y]]) pts.push({ x, y, l: d.level, mode: 1 });
      if (d.t === 'elev') pts.push({ x: d.x, y: d.y, l: d.level, mode: 1 }); // 箱の中まで
      return pts;
    }
    done[u] = 1;
    for (const [v, len, mode] of adj[u]) {
      const nd = dist[u] + len + (mode === 5 ? 20 : 0);
      if (nd < dist[v]) { dist[v] = nd; prev[v] = u; pmode[v] = mode; }
    }
  }
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
  $('gName').textContent = d.name + (d.t === 'toilet' ? `（${LV[d.level].name}）` : d.dir ? ` ${d.dir}` : '');
  recalc();
}
function recalc() {
  const pl = levelOf(me.z);
  nav.pts = findRoute(me.x, me.y, pl, nav.dest);
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
  if (!nav.dest || !nav.pts) return;
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
    toast(`到着しました（${nav.dest.name}）`);
    setTimeout(() => { if (nav.arrived) setDest(null); }, 2500);
  }
}

// 出発地・行き先を選ぶ。出発地を選ぶとそこへ移動し、続けて行き先を選べる
let destMode = 'to', startName = null;
const startPoint = (d) => (d.t === 'toilet' && d.out ? d.out : [d.x, d.y]);
function startAt(d, animate = true) {
  const [x, y] = startPoint(d);
  startName = d.name;
  if (animate) { jumpTo(x, y, d.level); return; }
  const p = landingAt(x, y, d.level);
  if (p) { [me.x, me.y, me.z] = p; me.eye = me.z + EYE; }
}
function openDest(mode = destMode) {
  destMode = mode;
  for (const b of document.querySelectorAll('#destSeg button')) b.classList.toggle('on', b.dataset.m === mode);
  $('destNote').textContent = mode === 'from' ? '選んだ所へ移動します（右下の地図をタップしても移動できます）' : startName ? `出発地: ${startName}` : '';
  const list = $('destList');
  list.innerHTML = '';
  const pl = levelOf(me.z);
  const add = (title, items) => {
    const h = document.createElement('div'); h.className = 'grp'; h.textContent = title; list.append(h);
    for (const [d, html, tag] of items) {
      const b = document.createElement('button');
      b.className = 'item'; b.type = 'button';
      b.innerHTML = html + (tag ? `<span class="tag">${tag}</span>` : '');
      b.onclick = () => {
        if (destMode === 'from') { startAt(d); openDest('to'); return; }
        $('destPanel').hidden = true; setDest(d);
      };
      list.append(b);
    }
  };
  const dist = (d) => Math.hypot(d.x - me.x, d.y - me.y) + Math.abs(d.level - pl) * 30;
  const gates = data.dest.filter((d) => d.t === 'gate');
  add('改札', gates.map((d) => [d, `<span class="dot" style="background:#f5c400;color:#111">改</span>${d.name}`, LV[d.level].name]));
  add('ホーム', data.dest.filter((d) => d.t === 'plat').map((d) => [d, `<span class="dot" style="background:${d.color}">${d.code}</span><span>${d.name} <b>${d.dir || ''}</b>${d.heads?.length ? `<br><small>主な行き先: ${d.heads.join('・')}</small>` : ''}</span>`, '']));
  const toilets = data.dest.filter((d) => d.t === 'toilet').sort((a, b) => dist(a) - dist(b));
  const elevs = data.dest.filter((d) => d.t === 'elev' && d.level === pl).sort((a, b) => dist(a) - dist(b));
  if (elevs.length) add(`エレベーター（${LV[pl].name}・近い順）`, elevs.map((d) => [d, `<span class="dot" style="background:#6b737b">EV</span>${d.name.replace(/^エレベーター（(.*)）$/, '$1')}`, `約${Math.round(dist(d))} m`]));
  add('トイレ（近い順）', toilets.map((d) => [d, `<span class="dot" style="background:${d.kind === 'M' ? '#1f6fd1' : d.kind === 'F' ? '#d0344a' : '#2f8f5b'}">${d.kind === 'M' ? '♂' : d.kind === 'F' ? '♀' : '♿'}</span>${d.name}`, `${LV[d.level].name}・約${Math.round(dist(d))} m`]));
  $('destPanel').hidden = false;
}
$('destBtn').onclick = () => openDest('to');
for (const b of document.querySelectorAll('#destSeg button')) b.onclick = () => openDest(b.dataset.m);
// 案内を共有: 出発地（選んでいれば）と行き先を URL に
$('gShare').onclick = async () => {
  if (!nav.dest) return;
  const q = new URLSearchParams();
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
  if (l === '-1') {
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
    if (String(d.level) !== pl || d.t === 'plat') continue;
    const [x, y] = W2S(d.x, d.y);
    if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
    const t = d.t === 'gate' ? d.name : d.kind === 'M' ? '♂' : d.kind === 'F' ? '♀' : '♿';
    mg.fillStyle = d.t === 'gate' ? '#f5c400' : '#1c3f74';
    const w = mg.measureText(t).width + 6;
    mg.fillRect(x - w / 2, y - 7, w, 14);
    mg.fillStyle = d.t === 'gate' ? '#111' : '#fff';
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
function landingAt(x, y, level) {
  const z0 = LV[level].z;
  const pick = (px, py) => {
    const zs = phys.surfacesAt(px, py).filter((z) => z > z0 - 1.5 && z < z0 + (level === -1 ? 2.5 : 0.6));
    if (!zs.length) return null;
    const z = zs.reduce((b, v) => (Math.abs(v - z0) < Math.abs(b - z0) ? v : b));
    const [cx, cy] = phys.collide(px, py, z);
    const gz = phys.groundAt(cx, cy, z);
    return gz == null ? null : [cx, cy, gz];
  };
  for (let r = 0; r <= 3; r += 0.5) for (let k = 0; k < (r ? 12 : 1); k++) {
    const a = (k / 12) * Math.PI * 2, p = pick(x + Math.sin(a) * r, y + Math.cos(a) * r);
    if (p) return p;
  }
  return null;
}
function jumpTo(x, y, level) {
  const to = landingAt(x, y, level);
  if (!to) { toast('そこへは行けません'); return; }
  pauseReplay('止めました（ここから歩けます）');
  jump = { from: [me.x, me.y, me.z], to, t: 0, dur: Math.min(1.2, 0.35 + Math.hypot(to[0] - me.x, to[1] - me.y) / 120) };
  // 進む向きを向く（真上をタップしたときはそのまま）
  if (Math.hypot(to[0] - me.x, to[1] - me.y) > 1) jump.yaw = Math.atan2(to[0] - me.x, to[1] - me.y);
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
    const msg = jump.msg || (levelOf(me.z) !== levelOf(fz) ? `${LV[levelOf(me.z)].name} に移動しました` : '');
    jump = null;
    mini.floor = null;
    mini.follow = true;
    document.body.classList.remove('riding');
    if (msg) toast(msg);
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
  const url = `${location.origin}${location.pathname}#rec=${code}`;
  const mmss = `${Math.floor(sec / 60)}分${String(Math.round(sec % 60)).padStart(2, '0')}秒`;
  $('shareInfo').textContent = `${mmss}の録画です。` + (nav.dest ? `行き先: ${nav.dest.name}` : '');
  $('linkShare').onclick = async () => {
    if (navigator.share) { try { await navigator.share({ title: 'エキさんぽの足あと', text: 'JR池袋駅で歩いた道すじです。開くと同じ道を再生できます。', url }); return; } catch { /* 取り消し */ } }
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
  if (to) setDest(to);
  if (from && to && nav.pts) { const p = nav.pts.find((t, i) => i > 0 && Math.hypot(t.x - me.x, t.y - me.y) > 3); if (p) me.yaw = Math.atan2(p.x - me.x, p.y - me.y); }
}

// ---------- はじめの説明 ----------
const seen = (() => { try { return localStorage.getItem('ekisanpo.help') === '1'; } catch { return false; } })();
$('help').hidden = seen || replaying;
$('helpOk').onclick = () => { $('help').hidden = true; try { localStorage.setItem('ekisanpo.help', '1'); } catch { /* 保存できなくてもよい */ } };

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
let floorShown = '';
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
  trains.update(dt);
  watchLevel();
  updateGuide();
  updateElev();
  drawMini();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
$('loading').hidden = true;
requestAnimationFrame(frame);

// 確かめ用（コンソールから位置を見る・動かす）
window.ekisanpo = { me, phys, setDest, data, move, nav, rec, replay, encodeTrack, decodeTrack, trains, mini, jumpTo, W2S, S2W };
