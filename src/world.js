// データ（ikebukuro.json と mall.bin）から、立体の世界（three.js）と当たり判定を作る。
// 座標: データは x 東・y 北・z 上（m）。three.js は y が上なので (x, z, -y) に置く。

import * as THREE from 'three';

export const EYE = 1.6;      // 目の高さ
export const RADIUS = 0.25;  // 体の半径（壁との当たり）
export const STEP = 0.6;     // 上れる段差（JR の地下 1 階と東側の地下街の床が約 0.5 m 食い違うので、それを越えられる高さ）
export const DROP = 0.7;     // 下りられる段差（これより深い所へは進めない）

const V = (x, y, z) => [x, z, -y];

// ---------- 見た目 ----------
function tileTexture(base, line, size = 128, lines = 2) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  // ほんの少しのむら
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.03})`;
    g.fillRect(Math.random() * size, Math.random() * size, 3, 3);
  }
  g.strokeStyle = line;
  g.lineWidth = 2;
  for (let k = 0; k < lines; k++) {
    const p = (k * size) / lines;
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, size); g.stroke();
    g.beginPath(); g.moveTo(0, p); g.lineTo(size, p); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// 壁の模様（横 1 m × 高さ 3 m）: 下に濃い幅木、腰（1.1 m まで）はタイル、上は明るい壁
function wallTexture(upper, lower, joint, base = '#5d5a55') {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 384;
  const g = c.getContext('2d');
  const H = 384, px = (m) => H - (m / 3) * H; // 床からの高さ m → 画像の y
  g.fillStyle = upper; g.fillRect(0, 0, 128, H);
  g.fillStyle = 'rgba(0,0,0,0.06)'; g.fillRect(0, px(2.6), 128, 2); // 上のほうの継ぎ目
  g.fillStyle = lower; g.fillRect(0, px(1.1), 128, px(0) - px(1.1));
  g.strokeStyle = joint; g.lineWidth = 2;
  for (let y = 0.1; y < 1.1; y += 0.25) { g.beginPath(); g.moveTo(0, px(y)); g.lineTo(128, px(y)); g.stroke(); }
  for (const x of [0, 64]) { g.beginPath(); g.moveTo(x, px(1.1)); g.lineTo(x, px(0)); g.stroke(); }
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, px(1.1) - 3, 128, 3); // 腰の見切り
  g.fillStyle = base; g.fillRect(0, px(0.1), 128, px(0) - px(0.1)); // 幅木
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
// 縦横の継ぎ目だけの板（駅務の壁・地下街の壁）
function panelTexture(color, joint, w = 1.2) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = color; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = joint; g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, 125, 125);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / w, 1 / w);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
// 改札機の面: 端（進む向き）は緑の矢印、上面は黒い板に青い IC の読み取り部、横は銀に黒い帯
function gateTextures() {
  const mk = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  const end = mk(64, 128, (g, w, h) => {
    g.fillStyle = '#c9ced3'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1d2328'; g.fillRect(8, 10, w - 16, 36);
    g.fillStyle = '#3ddc68'; g.beginPath(); g.moveTo(w / 2, 14); g.lineTo(w - 14, 30); g.lineTo(w / 2 + 6, 30); g.lineTo(w / 2 + 6, 42); g.lineTo(w / 2 - 6, 42); g.lineTo(w / 2 - 6, 30); g.lineTo(14, 30); g.fill();
  });
  const top = mk(256, 64, (g, w, h) => {
    g.fillStyle = '#2b3036'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1e88e5'; g.fillRect(w * 0.12, h * 0.2, w * 0.2, h * 0.6);
    g.fillStyle = '#90caf9'; g.fillRect(w * 0.15, h * 0.32, w * 0.14, h * 0.36);
    g.fillStyle = '#4a5058'; g.fillRect(w * 0.7, h * 0.3, w * 0.18, h * 0.4); // 切符の入れ口
  });
  const side = mk(256, 128, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#eef1f4'); gr.addColorStop(1, '#b9bfc5');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = '#30363c'; g.fillRect(0, h * 0.18, w, h * 0.16);
    g.fillStyle = '#2f6fb7'; g.fillRect(0, h * 0.34, w, h * 0.04);
  });
  return { end, top, side };
}

function materials() {
  const lam = (o) => new THREE.MeshLambertMaterial(o);
  return {
    concourse: lam({ map: tileTexture('#d9d2c3', '#c4bba9') }),
    platform: lam({ map: tileTexture('#b9b9b4', '#a5a5a0', 128, 1) }),
    toilet: lam({ map: tileTexture('#dfe6ea', '#c3cdd3', 128, 4) }),
    elev: lam({ color: '#a8adb2' }),
    ceiling: lam({ color: '#f1f0ec', emissive: '#b9b6ae', side: THREE.FrontSide }), // 照明の入った天井のつもりで少し光らせる
    ceilTop: lam({ color: '#6d6a62' }),          // 下の階の天井を上から見たところ（線路の砂利のつもり）
    roof: lam({ color: '#e6e4de', emissive: '#8f8c86', side: THREE.DoubleSide }),
    wall: lam({ map: wallTexture('#f1ede4', '#c9d3d8', '#b3bec4'), side: THREE.DoubleSide }),
    staff: lam({ map: panelTexture('#d2d5d8', '#b2b6ba', 1.0), side: THREE.DoubleSide }),
    elevWall: lam({ map: panelTexture('#b7bec5', '#8e969e', 0.9), emissive: '#30363c', side: THREE.DoubleSide }), // ステンレスのエレベーター
    shop: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    glass: new THREE.MeshLambertMaterial({ color: '#9fc6d6', transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
    frame: lam({ color: '#7d858c' }),
    stair: lam({ color: '#b4afa5' }),
    nosing: lam({ color: '#e0b419' }),
    esc: lam({ color: '#8b9197' }),
    rail: lam({ color: '#5b5f63' }),
    side: lam({ color: '#cfc9bd', side: THREE.DoubleSide }),
    gate: lam({ color: '#e9eaec' }),
    mallFloor: lam({ map: tileTexture('#d6d0c6', '#c0b8aa') }),
    mallWall: lam({ map: panelTexture('#e9e3d8', '#cdc5b6', 1.2), side: THREE.DoubleSide }),
    mallCeil: lam({ color: '#f3f2ee', emissive: '#b9b6ae', side: THREE.DoubleSide }),
    mallInst: lam({ color: '#a9a49b', side: THREE.DoubleSide }),
    mallDoor: new THREE.MeshLambertMaterial({ color: '#b5d3df', transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }),
    track: lam({ color: '#8a7f70' }),
    apron: lam({ map: tileTexture('#b9b5ad', '#a29d94', 128, 2), side: THREE.DoubleSide }), // 向きが辺ごとに違うので両面
  };
}

// 位置の配列（three.js の座標）から面を作る。uv: true は床（真上から 1.2 m ごと）、'side' は縦の面（横に沿って m、高さ m）、配列はそのまま
function meshOf(pos, mat, { uv = false, colors = null } = {}) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (Array.isArray(uv) || uv instanceof Float32Array) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  else if (uv === 'side') { // 三角形ごとに、横の向きで模様を貼る（地下街の壁）
    const u = new Float32Array((pos.length / 3) * 2);
    for (let i = 0; i < pos.length; i += 9) {
      // 法線の x・z 成分（辺 e × 辺 f）
      const ex = pos[i + 3] - pos[i], ey = pos[i + 4] - pos[i + 1], ez = pos[i + 5] - pos[i + 2];
      const fx = pos[i + 6] - pos[i], fy = pos[i + 7] - pos[i + 1], fz = pos[i + 8] - pos[i + 2];
      const nX = ey * fz - ez * fy, nZ = ex * fy - ey * fx;
      const alongZ = Math.abs(nX) > Math.abs(nZ); // 法線が x 寄りの面は z に沿って貼る
      for (let k = 0; k < 3; k++) { const p = i + k * 3, j = (p / 3) * 2; u[j] = alongZ ? pos[p + 2] : pos[p]; u[j + 1] = pos[p + 1]; }
    }
    g.setAttribute('uv', new THREE.BufferAttribute(u, 2));
  } else if (uv) {
    const u = new Float32Array((pos.length / 3) * 2);
    for (let i = 0, j = 0; i < pos.length; i += 3, j += 2) { u[j] = pos[i] / 1.2; u[j + 1] = pos[i + 2] / 1.2; }
    g.setAttribute('uv', new THREE.BufferAttribute(u, 2));
  }
  if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

// ---------- 当たり判定 ----------
class Grid {
  constructor(cell) { this.cell = cell; this.m = new Map(); }
  add(i, x0, y0, x1, y1) {
    const c = this.cell;
    for (let gx = Math.floor(Math.min(x0, x1) / c); gx <= Math.floor(Math.max(x0, x1) / c); gx++)
      for (let gy = Math.floor(Math.min(y0, y1) / c); gy <= Math.floor(Math.max(y0, y1) / c); gy++) {
        const k = gx * 100003 + gy;
        let a = this.m.get(k);
        if (!a) this.m.set(k, (a = []));
        a.push(i);
      }
  }
  near(x, y, r = 0) {
    const c = this.cell, out = new Set();
    for (let gx = Math.floor((x - r) / c); gx <= Math.floor((x + r) / c); gx++)
      for (let gy = Math.floor((y - r) / c); gy <= Math.floor((y + r) / c); gy++)
        for (const i of this.m.get(gx * 100003 + gy) || []) out.add(i);
    return out;
  }
}

export class Physics {
  constructor() {
    this.floors = []; // [ax,ay,az,bx,by,bz,cx,cy,cz]
    this.segs = [];   // {ax,ay,bx,by,z0a,z0b,z1a,z1b}（下の端・上の端の高さは a→b で直線的に変わる）
    this.wtris = [];  // 地下街の壁（その場で水平に切って線にする）
    this.fg = new Grid(3); this.sg = new Grid(3); this.wg = new Grid(3);
  }
  addFloor(a, b, c) {
    const i = this.floors.push([...a, ...b, ...c]) - 1;
    this.fg.add(i, Math.min(a[0], b[0], c[0]), Math.min(a[1], b[1], c[1]), Math.max(a[0], b[0], c[0]), Math.max(a[1], b[1], c[1]));
  }
  addSeg(ax, ay, bx, by, z0, z1a, z1b = z1a, z0b = z0) {
    const i = this.segs.push({ ax, ay, bx, by, z0a: z0, z0b, z1a, z1b }) - 1;
    this.sg.add(i, ax, ay, bx, by);
  }
  addWallTri(t) {
    const i = this.wtris.push(t) - 1;
    this.wg.add(i, Math.min(t[0], t[3], t[6]), Math.min(t[1], t[4], t[7]), Math.max(t[0], t[3], t[6]), Math.max(t[1], t[4], t[7]));
  }
  // (x, y) の真下で、いまの足の高さ z から上り下りできるいちばん高い床。無ければ null
  groundAt(x, y, z) {
    let best = null;
    for (const i of this.fg.near(x, y)) {
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = this.floors[i];
      const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(d) < 1e-9) continue;
      const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d;
      const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue;
      const h = l1 * az + l2 * bz + l3 * cz;
      if (h <= z + STEP && h >= z - DROP && (best == null || h > best)) best = h;
    }
    return best;
  }
  // (x, y) の真下と真上にある床の高さすべて（地図でタップした所の床を探す）
  surfacesAt(x, y) {
    const out = [];
    for (const i of this.fg.near(x, y)) {
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = this.floors[i];
      const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(d) < 1e-9) continue;
      const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d;
      const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d;
      if (l1 < -1e-4 || l2 < -1e-4 || 1 - l1 - l2 < -1e-4) continue;
      out.push(l1 * az + l2 * bz + (1 - l1 - l2) * cz);
    }
    return out;
  }
  // 胸の高さで当たる線の一覧（JR の壁・手すり・改札機と、地下街の壁を切ったもの）
  segsNear(x, y, h, r) {
    const out = [];
    for (const i of this.sg.near(x, y, r)) {
      const s = this.segs[i];
      const dx = s.bx - s.ax, dy = s.by - s.ay, L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / L)) : 0;
      if (h < s.z0a + (s.z0b - s.z0a) * t || h > s.z1a + (s.z1b - s.z1a) * t) continue;
      out.push([s.ax, s.ay, s.bx, s.by]);
    }
    for (const i of this.wg.near(x, y, r)) {
      const t = this.wtris[i];
      const pts = [];
      for (let k = 0; k < 3; k++) {
        const p = k * 3, q = ((k + 1) % 3) * 3;
        const z1 = t[p + 2] - h, z2 = t[q + 2] - h;
        if ((z1 < 0) !== (z2 < 0)) {
          const u = z1 / (z1 - z2);
          pts.push(t[p] + (t[q] - t[p]) * u, t[p + 1] + (t[q + 1] - t[p + 1]) * u);
        }
      }
      if (pts.length === 4) out.push(pts);
    }
    return out;
  }
  // 体（円）を線から押し出す
  collide(x, y, feet) {
    // すね・胸・頭の高さ（頭は階段の下をくぐれるかどうか）
    const segs = [...this.segsNear(x, y, feet + 0.9, 1.5), ...this.segsNear(x, y, feet + 0.3, 1.5), ...this.segsNear(x, y, feet + 1.75, 1.5)];
    for (let it = 0; it < 4; it++) {
      let moved = false;
      for (const [ax, ay, bx, by] of segs) {
        const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
        const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
        const px = ax + dx * t, py = ay + dy * t;
        const ex = x - px, ey = y - py, d = Math.hypot(ex, ey);
        if (d < RADIUS && d > 1e-6) { x = px + (ex / d) * RADIUS; y = py + (ey / d) * RADIUS; moved = true; }
      }
      if (!moved) break;
    }
    return [x, y];
  }
}

// 多角形（平らな [x0,y0,x1,y1,...] の輪の配列）を三角形に分ける
function triangulate(rings) {
  const toV = (r) => { const a = []; for (let i = 0; i < r.length; i += 2) a.push(new THREE.Vector2(r[i], r[i + 1])); return a; };
  const contour = toV(rings[0]), holes = rings.slice(1).map(toV);
  const faces = THREE.ShapeUtils.triangulateShape(contour, holes);
  const all = [contour, ...holes].flat();
  return faces.map((f) => f.map((i) => all[i]));
}

// 多角形（[[x,y],...]）から凸多角形（反時計回り）を引いた残りを、凸の多角形の配列で返す。
// 凸の各辺について「その辺の外側 ∩ それまでの辺の内側」を切り出していく（Sutherland–Hodgman）
const side = (p, q, v) => (q[0] - p[0]) * (v[1] - p[1]) - (q[1] - p[1]) * (v[0] - p[0]);
function clipHalf(poly, p, q, keepLeft) {
  const out = [], sg = keepLeft ? 1 : -1;
  for (let i = 0; i < poly.length; i++) {
    const A = poly[i], B = poly[(i + 1) % poly.length];
    const sa = side(p, q, A) * sg, sb = side(p, q, B) * sg;
    if (sa >= 0) out.push(A);
    if ((sa >= 0) !== (sb >= 0)) { const t = sa / (sa - sb); out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]); }
  }
  return out;
}
const polyArea = (p) => { let s = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]); return Math.abs(s / 2); };
function minusConvex(poly, R) {
  const out = [];
  let inside = poly;
  for (let i = 0; i < R.length && inside.length >= 3; i++) {
    const p = R[i], q = R[(i + 1) % R.length];
    const outer = clipHalf(inside, p, q, false);
    if (outer.length >= 3 && polyArea(outer) > 1e-4) out.push(outer);
    inside = clipHalf(inside, p, q, true);
  }
  return out;
}
const fan = (p) => { const t = []; for (let i = 1; i + 1 < p.length; i++) t.push([p[0], p[i], p[i + 1]]); return t; };
const bboxOf = (p) => p.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const inConvex = (x, y, R) => R.every((p, i) => side(p, R[(i + 1) % R.length], [x, y]) >= 0);

// ---------- 世界を作る ----------
export function buildWorld(data, mallBuf, scene) {
  const M = materials();
  const phys = new Physics();
  const lz = (l) => data.levels[l].z;
  const buckets = {}; // 材質ごとの位置の配列
  const push = (key, ...pts) => { (buckets[key] = buckets[key] || []).push(...pts.flat()); };
  const colors = []; // 店先の色

  // 坂（階段・エスカレーター）の真上の長方形。下の階の天井（low）と、上の階の床（high、上の端の 0.6 m は残す）から切り抜く
  const rampRects = data.ramps.map((r) => {
    const [ax, ay] = r.a, [bx, by] = r.b;
    const len = Math.hypot(bx - ax, by - ay), dx = (bx - ax) / len, dy = (by - ay) / len;
    const rect = (s0, s1, hw) => { // 反時計回りの 4 隅
      const nx = -dy * hw, ny = dx * hw, p0 = [ax + dx * s0, ay + dy * s0], p1 = [ax + dx * s1, ay + dy * s1];
      return [[p0[0] - nx, p0[1] - ny], [p1[0] - nx, p1[1] - ny], [p1[0] + nx, p1[1] + ny], [p0[0] + nx, p0[1] + ny]];
    };
    return { la: r.la, lb: r.lb, low: rect(-0.3, len + 0.4, r.w / 2 + 0.3), high: rect(-0.3, len - 0.6, r.w / 2 + 0.05) };
  });
  const cut = (tris, rects) => {
    let pieces = tris;
    for (const R of rects) {
      const rb = bboxOf(R);
      pieces = pieces.flatMap((p) => (overlaps(bboxOf(p), rb) ? minusConvex(p, R) : [p]));
    }
    return pieces.flatMap(fan);
  };

  // 床と天井
  for (const f of data.floors) {
    const z = lz(f.l), lv = data.levels[f.l];
    const mat = f.k === 'plat' ? 'platform' : f.k === 'toilet' ? 'toilet' : f.k === 'elev' ? 'elev' : 'concourse';
    const tris = triangulate(f.r).map((t) => t.map((v) => [v.x, v.y]));
    for (const [a, b, c] of cut(tris, rampRects.filter((r) => r.lb === f.l).map((r) => r.high))) {
      phys.addFloor([a[0], a[1], z], [b[0], b[1], z], [c[0], c[1], z]);
      push(mat, V(a[0], a[1], z), V(b[0], b[1], z), V(c[0], c[1], z));
    }
    if (f.u) continue; // 階段の下の端は吹き抜け
    const h = z + (f.k === 'plat' ? 4.4 : lv.ceil);
    for (const [a, b, c] of cut(tris, rampRects.filter((r) => r.la === f.l).map((r) => r.low))) {
      if (f.k === 'plat') push('roof', V(a[0], a[1], h), V(c[0], c[1], h), V(b[0], b[1], h));
      else {
        push('ceiling', V(a[0], a[1], h), V(c[0], c[1], h), V(b[0], b[1], h)); // 下から見える向き
        if (f.l === -1) push('ceilTop', V(a[0], a[1], h + 0.02), V(b[0], b[1], h + 0.02), V(c[0], c[1], h + 0.02));
      }
    }
  }

  // 出口の外の床（改札口から街・隣の建物へ 8 m。改札口の点が面の外に数 m 離れていることがある）
  for (const [x0, y0, x1, y1, nx, ny, l] of data.aprons || []) {
    const z = lz(l), q = [[x0, y0], [x1, y1], [x1 + nx * 8, y1 + ny * 8], [x0 + nx * 8, y0 + ny * 8]];
    for (const [a, b, c] of [[q[0], q[1], q[2]], [q[0], q[2], q[3]]]) {
      phys.addFloor([...a, z], [...b, z], [...c, z]);
      push('apron', V(a[0], a[1], z), V(c[0], c[1], z), V(b[0], b[1], z));
    }
  }

  // 壁: w 壁、s 店先、f 駅務、p ホームドア、r 手すり
  // 壁の模様の位置: 横は壁に沿って m、縦は床から（wall は 3 m で 1、板の模様は m）
  const uvs = {};
  const quad = (key, ax, ay, bx, by, z0, z1) => {
    push(key, V(ax, ay, z0), V(bx, by, z0), V(bx, by, z1), V(ax, ay, z0), V(bx, by, z1), V(ax, ay, z1));
    if (key !== 'wall' && key !== 'staff' && key !== 'elevWall') return;
    const L = Math.hypot(bx - ax, by - ay), v = key === 'wall' ? (z1 - z0) / 3 : z1 - z0;
    (uvs[key] = uvs[key] || []).push(0, 0, L, 0, L, v, 0, 0, L, v, 0, v);
  };
  const SHOP = ['#ffe9c2', '#fff4dc', '#ffdcb8', '#e8f3ff', '#fff0f0', '#f2ffe8'];
  const BAND = ['#c0392b', '#1f6fb2', '#2e8b57', '#d68910', '#6c3483', '#17202a', '#b03a2e'];
  let shopN = 0;
  for (const [ax, ay, bx, by, l, k] of data.walls) {
    const z = lz(l), ceil = data.levels[l].ceil;
    if (k === 'w' || k === 'f' || k === 'e') {
      quad({ w: 'wall', f: 'staff', e: 'elevWall' }[k], ax, ay, bx, by, z, z + ceil);
      phys.addSeg(ax, ay, bx, by, z, z + ceil);
    } else if (k === 's') {
      // 店先: 下は明るいガラス、上は色の帯
      const win = new THREE.Color(SHOP[shopN % SHOP.length]), band = new THREE.Color(BAND[(shopN * 3) % BAND.length]);
      shopN++;
      const top = z + Math.min(ceil, 2.9);
      quad('shop', ax, ay, bx, by, z, z + 2.3);
      for (let i = 0; i < 6; i++) colors.push(win.r, win.g, win.b);
      quad('shop', ax, ay, bx, by, z + 2.3, top);
      for (let i = 0; i < 6; i++) colors.push(band.r, band.g, band.b);
      phys.addSeg(ax, ay, bx, by, z, top);
    } else if (k === 'p' || k === 'r') {
      const h = k === 'p' ? 1.3 : 1.05;
      quad('glass', ax, ay, bx, by, z + 0.1, z + h);
      // 上の手すりの棒
      const len = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / len, uy = (by - ay) / len;
      const nx = uy * 0.04, ny = -ux * 0.04;
      quad('frame', ax - nx, ay - ny, bx - nx, by - ny, z + h - 0.06, z + h);
      quad('frame', ax + nx, ay + ny, bx + nx, by + ny, z + h - 0.06, z + h);
      phys.addSeg(ax, ay, bx, by, z, z + h);
      if (k === 'p') { // ホームドアの外の線路（ホームのふちから 1.0 m と 2.07 m）
        const ox = uy, oy = -ux, rz = z - 1.05;
        for (const off of [1.0, 2.07]) {
          const p0 = [ax + ox * off, ay + oy * off], p1 = [bx + ox * off, by + oy * off];
          push('rail', V(p0[0], p0[1], rz + 0.15), V(p1[0], p1[1], rz + 0.15), V(p1[0] + ox * 0.07, p1[1] + oy * 0.07, rz + 0.15),
            V(p0[0], p0[1], rz + 0.15), V(p1[0] + ox * 0.07, p1[1] + oy * 0.07, rz + 0.15), V(p0[0] + ox * 0.07, p0[1] + oy * 0.07, rz + 0.15));
        }
        const q0 = [ax + ox * 0.3, ay + oy * 0.3], q1 = [bx + ox * 0.3, by + oy * 0.3], q2 = [bx + ox * 3.2, by + oy * 3.2], q3 = [ax + ox * 3.2, ay + oy * 3.2];
        push('track', V(...q0, rz), V(...q1, rz), V(...q2, rz), V(...q0, rz), V(...q2, rz), V(...q3, rz));
        // ホームのふちの側面
        quad('side', ax + ox * 0.01, ay + oy * 0.01, bx + ox * 0.01, by + oy * 0.01, rz, z);
      }
    }
  }

  // 階段・エスカレーター
  for (const r of data.ramps) {
    const [ax, ay, az] = r.a, [bx, by, bz] = r.b;
    const len = Math.hypot(bx - ax, by - ay), dx = (bx - ax) / len, dy = (by - ay) / len;
    const nx = -dy * (r.w / 2), ny = dx * (r.w / 2); // 左
    const A = [ax - dx * 0.4, ay - dy * 0.4], B = [bx + dx * 0.4, by + dy * 0.4];
    // 当たりの床: 下の平ら・坂・上の平ら
    const P = (p, s, z) => [p[0] + nx * s, p[1] + ny * s, z];
    const fl = (p0, p1, z0, z1) => {
      phys.addFloor(P(p0, 1, z0), P(p0, -1, z0), P(p1, -1, z1));
      phys.addFloor(P(p0, 1, z0), P(p1, -1, z1), P(p1, 1, z1));
    };
    fl(A, [ax, ay], az, az); fl([ax, ay], [bx, by], az, bz); fl([bx, by], B, bz, bz);
    if (r.t === 's') {
      const n = Math.max(2, Math.round((bz - az) / 0.17));
      for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1) / n;
        const p0 = [ax + (bx - ax) * t0, ay + (by - ay) * t0], p1 = [ax + (bx - ax) * t1, ay + (by - ay) * t1];
        const zt = az + ((bz - az) * (i + 1)) / n, zb = az + ((bz - az) * i) / n;
        // 蹴上げ（立ち上がり）と踏み面
        push('stair', V(...P(p0, 1, zb)), V(...P(p0, -1, zb)), V(...P(p0, -1, zt)), V(...P(p0, 1, zb)), V(...P(p0, -1, zt)), V(...P(p0, 1, zt)));
        push('stair', V(...P(p0, 1, zt)), V(...P(p0, -1, zt)), V(...P(p1, -1, zt)), V(...P(p0, 1, zt)), V(...P(p1, -1, zt)), V(...P(p1, 1, zt)));
        const e = [p0[0] + dx * 0.05, p0[1] + dy * 0.05];
        push('nosing', V(...P(p0, 1, zt + 0.005)), V(...P(p0, -1, zt + 0.005)), V(...P(e, -1, zt + 0.005)), V(...P(p0, 1, zt + 0.005)), V(...P(e, -1, zt + 0.005)), V(...P(e, 1, zt + 0.005)));
      }
    } else {
      push('esc', V(...P([ax, ay], 1, az)), V(...P([ax, ay], -1, az)), V(...P([bx, by], -1, bz)), V(...P([ax, ay], 1, az)), V(...P([bx, by], -1, bz)), V(...P([bx, by], 1, bz)));
    }
    // 段の下は厚み 0.4 m の板。両側の帯は板の下から段の 1 m 上まで。
    // 高い側の下は、頭がつかえない所（板の下が床から 1.75 m 以上）までくぐれる。その先はふさぐ
    const TH = 0.4, rise = Math.max(0.01, bz - az);
    const tk = Math.min(1, TH / rise), th = Math.min(1, (1.75 + TH) / rise);
    const zAt = (t) => az + rise * t, at = (t) => [ax + (bx - ax) * t, ay + (by - ay) * t];
    const sideMat = r.t === 's' ? 'side' : 'glass';
    const band = (q0, q1, b0, b1, u0, u1) => push(sideMat, V(q0[0], q0[1], b0), V(q1[0], q1[1], b1), V(q1[0], q1[1], u1), V(q0[0], q0[1], b0), V(q1[0], q1[1], u1), V(q0[0], q0[1], u0));
    for (const s of [1, -1]) {
      const p0 = P([ax, ay], s, 0), pk = P(at(tk), s, 0), p1 = P([bx, by], s, 0);
      band(p0, pk, az, az, az + 1, zAt(tk) + 1);
      band(pk, p1, az, bz - TH, zAt(tk) + 1, bz + 1);
      push('rail', V(p0[0], p0[1], az + 0.95), V(p1[0], p1[1], bz + 0.95), V(p1[0], p1[1], bz + 1.02), V(p0[0], p0[1], az + 0.95), V(p1[0], p1[1], bz + 1.02), V(p0[0], p0[1], az + 1.02));
      phys.addSeg(p0[0], p0[1], pk[0], pk[1], az - 0.5, az + 1.05, zAt(tk) + 1.05);
      phys.addSeg(pk[0], pk[1], p1[0], p1[1], az - 0.05, zAt(tk) + 1.05, bz + 1.05, bz - TH);
    }
    // 板の下面（下の階から見上げたところ）
    const L0 = P(at(tk), 1, 0), R0 = P(at(tk), -1, 0), L1 = P([bx, by], 1, 0), R1 = P([bx, by], -1, 0);
    push('side', V(L0[0], L0[1], az), V(R0[0], R0[1], az), V(R1[0], R1[1], bz - TH), V(L0[0], L0[1], az), V(R1[0], R1[1], bz - TH), V(L1[0], L1[1], bz - TH));
    // 頭がつかえる所から低い側はふさぐ（下の階から段の下にもぐり込まないように）
    if (th < 1) {
      const q0 = P(at(th), 1, 0), q1 = P(at(th), -1, 0), uz = zAt(th) - TH;
      push('side', V(q0[0], q0[1], az), V(q1[0], q1[1], az), V(q1[0], q1[1], uz), V(q0[0], q0[1], az), V(q1[0], q1[1], uz), V(q0[0], q0[1], uz));
      phys.addSeg(q0[0], q0[1], q1[0], q1[1], az - 0.5, uz);
    }
  }

  // 改札機
  // 面ごとに材質（箱の面の順: +x・-x 端、+y 上、-y 下、+z・-z 横）
  const gateGeo = new THREE.BoxGeometry(1, 1, 1);
  const GT = gateTextures();
  const gEnd = new THREE.MeshLambertMaterial({ map: GT.end }), gTop = new THREE.MeshLambertMaterial({ map: GT.top }), gSide = new THREE.MeshLambertMaterial({ map: GT.side });
  const gates = new THREE.InstancedMesh(gateGeo, [gEnd, gEnd, gTop, M.gate, gSide, gSide], data.gates.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  data.gates.forEach(([cx, cy, l, len, wid, ang], i) => {
    const z = lz(l);
    q.setFromAxisAngle(up, ang);
    m4.compose(new THREE.Vector3(...V(cx, cy, z + 0.5)), q, new THREE.Vector3(len, 1.0, wid));
    gates.setMatrixAt(i, m4);
    // 当たりは改札機の真ん中の 1 本の線（データの改札機の中心どうしは 0.55 m ほどで、厚みを入れると体が通れない）
    const ux = Math.cos(ang) * len / 2, uy = Math.sin(ang) * len / 2;
    phys.addSeg(cx - ux, cy - uy, cx + ux, cy + uy, z, z + 1.0);
    phys.segs[phys.segs.length - 1].gate = true; // 道を探すマス目ではふさがない
  });
  scene.add(gates);

  // 地下街（PLATEAU）
  const L = data.mall.layout;
  const get = (k) => new Float32Array(mallBuf, L[k][0], L[k][1]); // [バイトの位置, 数の個数]
  const toThree = (src) => { const o = new Float32Array(src.length); for (let i = 0; i < src.length; i += 3) { o[i] = src[i]; o[i + 1] = src[i + 2]; o[i + 2] = -src[i + 1]; } return o; };
  const mf = get('floor');
  for (let i = 0; i < mf.length; i += 9) phys.addFloor([mf[i], mf[i + 1], mf[i + 2]], [mf[i + 3], mf[i + 4], mf[i + 5]], [mf[i + 6], mf[i + 7], mf[i + 8]]);
  for (const k of ['wall', 'inst']) { const w = get(k); for (let i = 0; i < w.length; i += 9) phys.addWallTri(w.subarray(i, i + 9)); }
  const mallMeshes = [
    meshOf(toThree(mf), M.mallFloor, { uv: true }), meshOf(toThree(get('wall')), M.mallWall, { uv: 'side' }), meshOf(toThree(get('ceil')), M.mallCeil),
    meshOf(toThree(get('inst')), M.mallInst), meshOf(toThree(get('door')), M.mallDoor),
  ];
  ['mallFloor', 'mallWall', 'mallCeil', 'mallInst', 'mallDoor'].forEach((n, i) => { mallMeshes[i].name = n; });
  scene.add(...mallMeshes);

  // 天井の蛍光灯: 駅の向き（階段の向きの平均）にそろえ、3.6 m × 2.4 m ごとに細長い光る板を並べる
  let sx = 0, sy = 0;
  for (const r of data.ramps) { const a = Math.atan2(r.b[1] - r.a[1], r.b[0] - r.a[0]) * 2; sx += Math.cos(a); sy += Math.sin(a); }
  const axis = Math.atan2(sy, sx) / 2, ax = Math.cos(axis), ay = Math.sin(axis);
  const lights = [];
  const grid = (x0, y0, x1, y1, fn) => { // 駅の向きの格子の点
    const c = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => [x * ax + y * ay, -x * ay + y * ax]);
    const u0 = Math.min(...c.map((p) => p[0])), u1 = Math.max(...c.map((p) => p[0])), v0 = Math.min(...c.map((p) => p[1])), v1 = Math.max(...c.map((p) => p[1]));
    for (let u = Math.ceil(u0 / 3.6) * 3.6; u < u1; u += 3.6) for (let v = Math.ceil(v0 / 2.4) * 2.4; v < v1; v += 2.4) fn(u * ax - v * ay, u * ay + v * ax);
  };
  const inRing = (x, y, r) => { let s = false; for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) { if ((r[i + 1] > y) !== (r[j + 1] > y) && x < ((r[j] - r[i]) * (y - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) s = !s; } return s; };
  const edgeDist = (x, y, r) => { let d = Infinity; for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) { const dx = r[i] - r[j], dy = r[i + 1] - r[j + 1], L = dx * dx + dy * dy; const t = L ? Math.max(0, Math.min(1, ((x - r[j]) * dx + (y - r[j + 1]) * dy) / L)) : 0; d = Math.min(d, Math.hypot(x - r[j] - dx * t, y - r[j + 1] - dy * t)); } return d; };
  for (const f of data.floors) {
    if (!['walk', 'room', 'toilet', 'plat'].includes(f.k) || f.u) continue;
    const r0 = f.r[0];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < r0.length; i += 2) { x0 = Math.min(x0, r0[i]); x1 = Math.max(x1, r0[i]); y0 = Math.min(y0, r0[i + 1]); y1 = Math.max(y1, r0[i + 1]); }
    const h = lz(f.l) + (f.k === 'plat' ? 4.4 : data.levels[f.l].ceil) - 0.03;
    grid(x0, y0, x1, y1, (x, y) => {
      if (!inRing(x, y, r0) || f.r.slice(1).some((hr) => inRing(x, y, hr))) return;
      if (f.r.some((r) => edgeDist(x, y, r) < 0.8)) return;
      if (rampRects.some((r) => r.la === f.l && inConvex(x, y, r.low))) return; // 天井を抜いた所
      lights.push([x, y, h]);
    });
  }
  // 地下街: 床の真上のいちばん低い天井に
  const zAt = (tris, g) => (x, y) => {
    const out = [];
    for (const i of g.near(x, y)) {
      const t = tris.subarray(i * 9, i * 9 + 9);
      const d = (t[4] - t[7]) * (t[0] - t[6]) + (t[6] - t[3]) * (t[1] - t[7]);
      if (Math.abs(d) < 1e-9) continue;
      const l1 = ((t[4] - t[7]) * (x - t[6]) + (t[6] - t[3]) * (y - t[7])) / d, l2 = ((t[7] - t[1]) * (x - t[6]) + (t[0] - t[6]) * (y - t[7])) / d;
      if (l1 >= 0 && l2 >= 0 && l1 + l2 <= 1) out.push(l1 * t[2] + l2 * t[5] + (1 - l1 - l2) * t[8]);
    }
    return out;
  };
  const triIndex = (tris) => { const g = new Grid(4); for (let i = 0; i < tris.length / 9; i++) { const t = tris.subarray(i * 9, i * 9 + 9); g.add(i, Math.min(t[0], t[3], t[6]), Math.min(t[1], t[4], t[7]), Math.max(t[0], t[3], t[6]), Math.max(t[1], t[4], t[7])); } return zAt(tris, g); };
  const mallFloorZ = triIndex(mf), mallCeilZ = triIndex(get('ceil'));
  let mx0 = Infinity, my0 = Infinity, mx1 = -Infinity, my1 = -Infinity;
  for (let i = 0; i < mf.length; i += 3) { mx0 = Math.min(mx0, mf[i]); mx1 = Math.max(mx1, mf[i]); my0 = Math.min(my0, mf[i + 1]); my1 = Math.max(my1, mf[i + 1]); }
  grid(mx0, my0, mx1, my1, (x, y) => {
    const fz = mallFloorZ(x, y);
    if (!fz.length) return;
    const f0 = Math.min(...fz);
    const cz = mallCeilZ(x, y).filter((z) => z > f0 + 1.8 && z < f0 + 6);
    if (cz.length) lights.push([x, y, Math.min(...cz) - 0.03]);
  });
  const lamp = new THREE.InstancedMesh(new THREE.BoxGeometry(1.25, 0.04, 0.16), new THREE.MeshBasicMaterial({ color: '#ffffff' }), lights.length);
  const lq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), axis), lm = new THREE.Matrix4(), ls = new THREE.Vector3(1, 1, 1);
  lights.forEach(([x, y, z], i) => { lm.compose(new THREE.Vector3(...V(x, y, z)), lq, ls); lamp.setMatrixAt(i, lm); });
  scene.add(lamp);

  // まとめて置く
  const UV = new Set(['concourse', 'platform', 'toilet', 'apron']);
  for (const [k, pos] of Object.entries(buckets)) {
    const mesh = meshOf(pos, M[k], { uv: uvs[k] || UV.has(k), colors: k === 'shop' ? colors : null });
    mesh.name = k; // 確かめ用（どの部品か）
    if (k === 'glass') mesh.renderOrder = 2;
    scene.add(mesh);
  }
  return { phys };
}
