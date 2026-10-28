// ホームの電車: 番線ごとに、入ってくる → 止まる → 出ていく → しばらく来ない をくり返す。
// 線路は、その番線の乗車位置の点からいちばん近いホームドア（壁 p）の外 1.5 m（軌道の中心）に置く。

import * as THREE from 'three';

const V3 = (x, y, z) => new THREE.Vector3(x, z, -y);
const CAR = 20;             // 1 両の長さ（m）
const CARS = { JY: 11, JA: 10, JS: 15 };
const BAND = { JY: ['#80c241', null], JA: ['#00ac9a', null], JS: ['#f68b1e', '#2e9f4a'] }; // 帯の色（湘南新宿ラインは橙と緑）

function carTexture(route) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#eef1f3'); grad.addColorStop(0.5, '#c9ced2'); grad.addColorStop(1, '#a9afb4');
  g.fillStyle = grad; g.fillRect(0, 0, 1024, 256);
  const [b1, b2] = BAND[route] || ['#888', null];
  // 窓の上の帯と、窓の下の帯
  g.fillStyle = b1; g.fillRect(0, 40, 1024, 14);
  g.fillStyle = b2 || b1; g.fillRect(0, 172, 1024, b2 ? 10 : 16);
  if (b2) { g.fillStyle = b1; g.fillRect(0, 184, 1024, 10); }
  // 扉 4 か所と、そのあいだの窓
  const doors = [110, 370, 630, 890];
  g.fillStyle = '#26323b';
  for (let i = 0; i < 5; i++) {
    const x0 = i === 0 ? 10 : doors[i - 1] + 50, x1 = i === 4 ? 1014 : doors[i] - 50;
    g.fillRect(x0 + 8, 66, x1 - x0 - 16, 90);
  }
  for (const x of doors) {
    g.fillStyle = '#b6bcc1'; g.fillRect(x - 44, 58, 88, 190);
    g.strokeStyle = '#7f878d'; g.lineWidth = 3; g.strokeRect(x - 44, 58, 88, 190);
    g.beginPath(); g.moveTo(x, 58); g.lineTo(x, 248); g.stroke();
    g.fillStyle = '#26323b'; g.fillRect(x - 36, 72, 28, 70); g.fillRect(x + 8, 72, 28, 70);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function addTrains(scene, data) {
  const N = data.graph.n, LV = data.levels;
  const pw = data.walls.filter((w) => w[5] === 'p');
  const tracks = [];
  for (const d of data.dest.filter((x) => x.t === 'plat')) {
    // 乗車位置の点ごとに、いちばん近いホームドアの外 1.5 m の点
    const pts = [];
    for (const i of d.nodes) {
      const [x, y, l] = N[i];
      let best = null;
      for (const w of pw) {
        if (w[4] !== l) continue;
        const dx = w[2] - w[0], dy = w[3] - w[1], L = dx * dx + dy * dy;
        const t = Math.max(0, Math.min(1, ((x - w[0]) * dx + (y - w[1]) * dy) / L));
        const px = w[0] + dx * t, py = w[1] + dy * t, dist = Math.hypot(x - px, y - py);
        if (!best || dist < best.dist) { const len = Math.sqrt(L); best = { dist, px, py, nx: dy / len, ny: -dx / len }; }
      }
      if (best && best.dist < 6) pts.push([best.px + best.nx * 1.53, best.py + best.ny * 1.53]);
    }
    if (pts.length < 2) continue;
    // 主軸で直線にする
    const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length, my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    let sxx = 0, sxy = 0, syy = 0;
    for (const [x, y] of pts) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); syy += (y - my) ** 2; }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(ang), uy = Math.sin(ang);
    // ホームの長さ: 乗車位置の点がいちばん多く入っているホームの面を、線路の向きに測る（乗車位置の点はホームの一部にしか無い）
    const inRing = (x, y, r) => { let s = false; for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) if ((r[i + 1] > y) !== (r[j + 1] > y) && x < ((r[j] - r[i]) * (y - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) s = !s; return s; };
    const plats = data.floors.filter((f) => f.k === 'plat' && f.l === d.level);
    const plat = plats.map((f) => [f, d.nodes.filter((i) => inRing(N[i][0], N[i][1], f.r[0])).length]).sort((p, q) => q[1] - p[1])[0]?.[0];
    let along = pts.map(([x, y]) => (x - mx) * ux + (y - my) * uy);
    if (plat) { along = []; const r = plat.r[0]; for (let i = 0; i < r.length; i += 2) along.push((r[i] - mx) * ux + (r[i + 1] - my) * uy); }
    const a0 = Math.min(...along), a1 = Math.max(...along);
    const platLen = a1 - a0;
    const cars = Math.max(4, Math.min(CARS[d.route] || 10, Math.floor(platLen / CAR)));
    const cx = mx + ux * (a0 + a1) / 2, cy = my + uy * (a0 + a1) / 2;
    tracks.push({ d, cx, cy, ux, uy, ang, cars, z: LV[d.level].z - 0.9, dir: d.code % 2 ? 1 : -1 });
  }

  const geo = new THREE.BoxGeometry(CAR - 0.6, 3.55, 2.9);
  const mats = {};
  const trains = tracks.map((tr, k) => {
    const mat = mats[tr.d.route] || (mats[tr.d.route] = [
      new THREE.MeshLambertMaterial({ map: carTexture(tr.d.route) }), // 横（+x の面は使わないが同じ）
      new THREE.MeshLambertMaterial({ color: '#d4d8db' }),
    ]);
    const group = new THREE.Group();
    for (let i = 0; i < tr.cars; i++) {
      const m = new THREE.Mesh(geo, [mat[1], mat[1], mat[1], mat[1], mat[0], mat[0]]);
      m.position.set((i - (tr.cars - 1) / 2) * CAR, 0, 0);
      group.add(m);
    }
    // 屋根の上の機器
    const roof = new THREE.Mesh(new THREE.BoxGeometry(tr.cars * CAR - 2, 0.25, 1.6), new THREE.MeshLambertMaterial({ color: '#8d9399' }));
    roof.position.y = 1.9;
    group.add(roof);
    group.rotation.y = tr.ang; // データの角（東から反時計回り）は three.js の y 回りと同じ向き
    group.visible = false;
    scene.add(group);
    // 番線ごとに時間をずらす（はじめから半分は止まっている）
    return k % 2 ? { tr, group, phase: 'away', t: -(5 + k * 6) } : { tr, group, phase: 'stop', t: k * 3 };
  });

  const ARRIVE = 14, STOP = 30, LEAVE = 14;
  const place = (o, s) => { // s: 止まる位置からの距離（m、進む向きが正）
    const { tr } = o;
    const x = tr.cx + tr.ux * s * tr.dir, y = tr.cy + tr.uy * s * tr.dir;
    o.group.position.copy(V3(x, y, tr.z + 1.95));
    o.group.visible = true;
  };
  return {
    count: trains.length,
    list: trains,
    update(dt) {
      for (const o of trains) {
        o.t += dt;
        const len = o.tr.cars * CAR;
        if (o.phase === 'away') {
          o.group.visible = false;
          if (o.t > 0) { o.phase = 'arrive'; o.t = 0; }
        } else if (o.phase === 'arrive') {
          const u = Math.min(1, o.t / ARRIVE), ease = 1 - (1 - u) ** 2; // だんだん遅く
          o.group.visible = true;
          place(o, -(len + 120) * (1 - ease));
          if (u >= 1) { o.phase = 'stop'; o.t = 0; }
        } else if (o.phase === 'stop') {
          place(o, 0);
          if (o.t > STOP) { o.phase = 'leave'; o.t = 0; }
        } else if (o.phase === 'leave') {
          const u = Math.min(1, o.t / LEAVE);
          place(o, (len + 120) * u * u); // だんだん速く
          if (u >= 1) { o.phase = 'away'; o.t = -(25 + Math.random() * 50); }
        }
      }
    },
  };
}
