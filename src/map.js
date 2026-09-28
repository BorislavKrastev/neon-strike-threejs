// Level: "de_sandstone" — an original desert town with two bomb sites, a mid lane,
// a long lane and roofed tunnels. Built from a cell grid, merged into a few draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Box } from './physics.js';
import { NavGrid } from './nav.js';
import { ValueNoise, letterTexture, makeCanvasTexture } from './textures.js';

export const CELL = 4, GW = 36, GH = 36, WORLD = GW * CELL, HALF = WORLD / 2;
export const wx = c => (c - GW / 2) * CELL;
export const wz = r => (r - GH / 2) * CELL;
export const P = (c, r) => ({ x: wx(c), z: wz(r) });

function hash(a, b) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function buildLayout() {
  const g = [];
  for (let r = 0; r < GH; r++) g.push(new Array(GW).fill('#'));
  const carve = (c0, r0, c1, r1, ch = '.') => { for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) g[r][c] = ch; };
  carve(13, 1, 22, 6);      // CT spawn
  carve(2, 2, 11, 11);      // B site
  carve(24, 2, 33, 11);     // A site
  carve(11, 3, 13, 5);      // CT -> B
  carve(22, 3, 24, 5);      // CT -> A
  carve(16, 6, 19, 27);     // mid
  g[13][16] = '#'; g[13][19] = '#';           // mid doors
  carve(20, 8, 23, 10);     // catwalk / short A
  carve(30, 12, 33, 27);    // long A
  g[20][30] = '#'; g[20][31] = '#';           // long doors
  carve(3, 12, 6, 26, 'r'); // B tunnels (roofed)
  carve(7, 18, 15, 19, 'r');// upper tunnel -> mid
  carve(3, 27, 33, 29);     // T corridor
  carve(12, 30, 23, 34);    // T spawn
  g[28][10] = '#'; g[28][25] = '#';           // pillars in T corridor
  return g;
}

function greedy(grid, ch) {
  const used = grid.map(row => row.map(() => false));
  const rects = [];
  for (let r = 0; r < GH; r++) for (let c = 0; c < GW; c++) {
    if (grid[r][c] !== ch || used[r][c]) continue;
    let w = 1; while (c + w < GW && grid[r][c + w] === ch && !used[r][c + w]) w++;
    let h = 1;
    outer: while (r + h < GH) {
      for (let k = 0; k < w; k++) if (grid[r + h][c + k] !== ch || used[r + h][c + k]) break outer;
      h++;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) used[r + y][c + x] = true;
    rects.push({ c, r, w, h });
  }
  return rects;
}

// Box geometry with world-space UVs and baked vertical ambient occlusion in vertex colours.
function worldBox(minX, minY, minZ, maxX, maxY, maxZ, { uvScale = 2, ao = true, tint = 1, faceUV = false, aoFloor = 0.5 } = {}) {
  const w = maxX - minX, h = maxY - minY, d = maxZ - minZ;
  const hseg = ao ? Math.max(1, Math.min(8, Math.round(h / 1.4))) : 1;
  const g = new THREE.BoxGeometry(w, h, d, 1, hseg, 1);
  g.translate((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
  const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
    if (!faceUV) {
      if (Math.abs(nx) > 0.5) uv.setXY(i, (nx > 0 ? -z : z) / uvScale, y / uvScale);
      else if (Math.abs(ny) > 0.5) uv.setXY(i, x / uvScale, z / uvScale);
      else uv.setXY(i, (nz > 0 ? x : -x) / uvScale, y / uvScale);
    }
    const a = ao ? aoFloor + (1 - aoFloor) * smooth(0, 1.5, y) : 1;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = a * tint;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function blur(arr, w, h, r) {
  const tmp = new Float32Array(arr.length);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      let s = 0; for (let x = -r; x <= r; x++) s += arr[y * w + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = s / (2 * r + 1);
        s += arr[y * w + Math.min(w - 1, x + r + 1)] - arr[y * w + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let s = 0; for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        arr[y * w + x] = s / (2 * r + 1);
        s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
  }
}

// Static crates: [c, r, sizeInCrates(x), sizeInCrates(z), stackHeightInCrates]
const CRATE = 1.2;
const STATIC_CRATES = [
  // B site
  [5.9, 6.2, 2, 2, 2], [6.62, 6.2, 1, 1, 1], [4.1, 9.4, 1, 1, 1], [9.4, 4.1, 2, 1, 1], [9.0, 8.8, 2, 2, 2], [3.2, 4.0, 1, 2, 1],
  // A site
  [28.5, 6.0, 2, 2, 2], [29.22, 6.0, 1, 1, 1], [26.0, 9.5, 1, 1, 1], [32.2, 3.4, 2, 1, 1], [31.2, 8.6, 2, 2, 2], [25.1, 3.0, 1, 1, 1],
  // mid
  [17.0, 9.4, 1, 1, 1], [19.2, 16.2, 1, 1, 1], [16.9, 24.0, 2, 1, 1], [18.6, 7.0, 1, 1, 1],
  // long
  [33.3, 14.0, 1, 1, 1], [30.8, 24.5, 2, 2, 2], [33.2, 21.8, 1, 1, 1],
  // T corridor
  [8.0, 28.2, 1, 1, 1], [22.0, 29.4, 2, 1, 1], [28.0, 27.6, 1, 1, 1], [14.0, 27.5, 1, 1, 1],
  // CT spawn
  [14.2, 2.0, 1, 1, 1], [21.4, 5.6, 2, 1, 1],
  // catwalk
  [22.0, 8.6, 1, 1, 1],
  // tunnels
  [3.4, 15.0, 1, 1, 1], [6.5, 22.0, 1, 1, 1], [12.0, 18.3, 1, 1, 1],
];

const BARRELS = [
  [2.6, 10.8, 'blue'], [2.6, 10.1, 'olive'], [10.8, 2.6, 'red'], [33.4, 11.0, 'blue'], [24.6, 7.4, 'red'],
  [19.6, 21.0, 'olive'], [16.4, 11.5, 'blue'], [33.5, 26.4, 'red'], [3.4, 26.4, 'olive'], [30.5, 17.0, 'blue'],
  [12.6, 34.5, 'olive'], [23.4, 30.5, 'red'], [13.5, 5.6, 'blue'], [7.0, 11.5, 'red'],
];
const SMALL_CRATES = [[7.2, 3.0], [27.2, 10.8], [18.9, 26.3], [31.8, 12.8], [4.2, 27.4], [20.5, 3.0]];

export function buildMap(scene, physics, mats, quality, effects) {
  const grid = buildLayout();
  const buckets = new Map();
  const add = (mat, geo) => { let a = buckets.get(mat); if (!a) buckets.set(mat, a = []); a.push(geo); };
  const cellTop = grid.map(row => row.map(() => 0));
  const group = new THREE.Group();
  scene.add(group);

  // AO canvas for ground (2 px per metre)
  const AOR = 2, AOS = WORLD * AOR;
  const occ = new Float32Array(AOS * AOS);
  const occRect = (minX, minZ, maxX, maxZ, v) => {
    const x0 = Math.max(0, Math.floor((minX + HALF) * AOR)), x1 = Math.min(AOS - 1, Math.ceil((maxX + HALF) * AOR) - 1);
    const z0 = Math.max(0, Math.floor((minZ + HALF) * AOR)), z1 = Math.min(AOS - 1, Math.ceil((maxZ + HALF) * AOR) - 1);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) occ[z * AOS + x] = Math.max(occ[z * AOS + x], v);
  };

  // ---- buildings ----
  const rects = greedy(grid, '#');
  for (const rc of rects) {
    const border = rc.c === 0 || rc.r === 0 || rc.c + rc.w === GW || rc.r + rc.h === GH;
    const H = border ? 10.5 : 6.2 + Math.floor(hash(rc.c, rc.r) * 4) * 0.9;
    const minX = wx(rc.c), maxX = wx(rc.c + rc.w), minZ = wz(rc.r), maxZ = wz(rc.r + rc.h);
    physics.add(new Box(minX, 0, minZ, maxX, H, maxZ, 'stone'));
    const plaster = hash(rc.r + 3, rc.c + 7) > 0.55;
    add(plaster ? mats.plaster : mats.sandstone, worldBox(minX, 0, minZ, maxX, H, maxZ, { tint: 0.92 + hash(rc.c, rc.r + 11) * 0.1 }));
    add(mats.trim, worldBox(minX - 0.18, H - 0.4, minZ - 0.18, maxX + 0.18, H, maxZ + 0.18, { ao: false, tint: 0.9 }));
    add(mats.trim, worldBox(minX - 0.08, 0, minZ - 0.08, maxX + 0.08, 0.4, maxZ + 0.08, { aoFloor: 0.45 }));
    if (plaster) add(mats.trim, worldBox(minX - 0.05, H - 1.5, minZ - 0.05, maxX + 0.05, H - 1.3, maxZ + 0.05, { ao: false, tint: 0.85 }));
    for (let r = rc.r; r < rc.r + rc.h; r++) for (let c = rc.c; c < rc.c + rc.w; c++) cellTop[r][c] = H;
    occRect(minX, minZ, maxX, maxZ, 1);
  }

  // Wooden roof beams ("vigas") sticking out of some building faces for silhouette detail
  const vigaGeos = [];
  for (let r = 1; r < GH - 1; r++) for (let c = 1; c < GW - 1; c++) {
    if (grid[r][c] !== '#' || hash(c * 3, r * 5) > 0.32) continue;
    const top = cellTop[r][c];
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dc, dr] of dirs) {
      const nc = c + dc, nr = r + dr;
      if (grid[nr][nc] === '#' ) continue;
      for (let k = 0; k < 3; k++) {
        const t = 0.7 + k * 1.3, y = top - 1.0;
        if (dc) {
          const x0 = dc > 0 ? wx(c + 1) : wx(c) - 0.6;
          vigaGeos.push(worldBox(x0, y, wz(r) + t, x0 + 0.6, y + 0.22, wz(r) + t + 0.22, { ao: false, faceUV: true }));
        } else {
          const z0 = dr > 0 ? wz(r + 1) : wz(r) - 0.6;
          vigaGeos.push(worldBox(wx(c) + t, y, z0, wx(c) + t + 0.22, y + 0.22, z0 + 0.6, { ao: false, faceUV: true }));
        }
      }
    }
  }
  for (const g of vigaGeos) add(mats.darkWood, g);

  // ---- tunnel roofs ----
  const lamps = [];
  for (const rc of greedy(grid, 'r')) {
    const minX = wx(rc.c), maxX = wx(rc.c + rc.w), minZ = wz(rc.r), maxZ = wz(rc.r + rc.h);
    physics.add(new Box(minX, 3.6, minZ, maxX, 4.2, maxZ, 'stone'));
    add(mats.concrete, worldBox(minX, 3.6, minZ, maxX, 4.2, maxZ, { ao: false, tint: 0.8 }));
    const alongZ = rc.h >= rc.w;
    const len = alongZ ? maxZ - minZ : maxX - minX;
    for (let t = 2.5; t < len; t += 5) {
      if (alongZ) add(mats.darkWood, worldBox(minX, 3.25, minZ + t, maxX, 3.6, minZ + t + 0.3, { ao: false }));
      else add(mats.darkWood, worldBox(minX + t, 3.25, minZ, minX + t + 0.3, 3.6, maxZ, { ao: false }));
    }
    for (let t = 6; t < len - 2; t += 14) {
      lamps.push(alongZ ? new THREE.Vector3((minX + maxX) / 2, 3.2, minZ + t) : new THREE.Vector3(minX + t, 3.2, (minZ + maxZ) / 2));
    }
    // soft darkening of ground inside tunnels
    occRect(minX, minZ, maxX, maxZ, 0.55);
  }

  // ---- door frames (mid + long) ----
  const doorBoxes = [
    // mid doors lintel
    [wx(17), 4.7, wz(13), wx(19), 6.2, wz(14), 'stone', mats.trim],
    // long doors lintel
    [wx(32), 4.7, wz(20), wx(34), 6.2, wz(21), 'stone', mats.trim],
    // mid door leaves (opened toward T side)
    [wx(17) + 0.05, 0, wz(14), wx(17) + 0.2, 4.4, wz(14) + 2.0, 'wood', mats.door],
    [wx(19) - 0.2, 0, wz(14), wx(19) - 0.05, 4.4, wz(14) + 2.0, 'wood', mats.door],
    // long door leaf
    [wx(32) + 0.05, 0, wz(21), wx(32) + 0.2, 4.4, wz(21) + 2.0, 'wood', mats.door],
    [wx(34) - 0.2, 0, wz(21), wx(34) - 0.05, 4.4, wz(21) + 1.4, 'wood', mats.door],
  ];
  for (const [a, b, c, d, e, f, s, m] of doorBoxes) {
    physics.add(new Box(a, b, c, d, e, f, s));
    add(m, worldBox(a, b, c, d, e, f, { uvScale: 2.2, aoFloor: 0.6 }));
    occRect(a, c, d, f, 0.8);
  }

  // ---- static crates ----
  for (const [c, r, nx, nz, ny] of STATIC_CRATES) {
    const cx = wx(c), cz = wz(r);
    const sx = nx * CRATE, sz = nz * CRATE, sy = ny * CRATE;
    const minX = cx - sx / 2, minZ = cz - sz / 2;
    physics.add(new Box(minX, 0, minZ, minX + sx, sy, minZ + sz, 'wood'));
    for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
      const x0 = minX + ix * CRATE, z0 = minZ + iz * CRATE, y0 = iy * CRATE;
      const inset = 0.004;
      const g = worldBox(x0 + inset, y0, z0 + inset, x0 + CRATE - inset, y0 + CRATE - inset, z0 + CRATE - inset, { faceUV: true, aoFloor: iy === 0 ? 0.55 : 0.85, tint: 0.9 + hash(ix + c * 10, iz + r * 10 + iy) * 0.15 });
      add(mats.crate, g);
    }
    occRect(minX - 0.2, minZ - 0.2, minX + sx + 0.2, minZ + sz + 0.2, 0.8);
  }

  // ---- merge + create meshes ----
  for (const [mat, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    geos.forEach(g => g.dispose());
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    group.add(mesh);
  }

  // ---- ground ----
  blur(occ, AOS, AOS, 3);
  const aoCanvas = document.createElement('canvas'); aoCanvas.width = aoCanvas.height = AOS;
  const actx = aoCanvas.getContext('2d'); const img = actx.createImageData(AOS, AOS);
  for (let i = 0; i < AOS * AOS; i++) { const v = (1 - occ[i] * 0.75) * 255; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  actx.putImageData(img, 0, 0);
  const aoTex = new THREE.CanvasTexture(aoCanvas);
  aoTex.channel = 1;
  const groundGeo = new THREE.PlaneGeometry(WORLD, WORLD, 72, 72);
  groundGeo.rotateX(-Math.PI / 2);
  {
    const pos = groundGeo.attributes.position, n = pos.count;
    const uv = new Float32Array(n * 2), uv1 = new Float32Array(n * 2), col = new Float32Array(n * 3);
    const N = new ValueNoise(77);
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      uv[i * 2] = x / 4; uv[i * 2 + 1] = -z / 4;
      uv1[i * 2] = (x + HALF) / WORLD; uv1[i * 2 + 1] = 1 - (z + HALF) / WORLD;
      const k = 0.86 + N.fbm((x + HALF) / WORLD, (z + HALF) / WORLD, 6, 4) * 0.26;
      col[i * 3] = k * 1.02; col[i * 3 + 1] = k; col[i * 3 + 2] = k * 0.96;
    }
    groundGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    groundGeo.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
    groundGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const groundMat = mats.ground;
  groundMat.aoMap = aoTex; groundMat.aoMapIntensity = 1;
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.receiveShadow = true;
  group.add(ground);
  physics.add(new Box(-HALF - 10, -5, -HALF - 10, HALF + 10, 0, HALF + 10, 'sand'));

  // tiled plazas
  const tileAreas = [[3, 3, 10, 10], [25, 3, 33, 10], [14, 1.5, 22, 6], [12.5, 30.5, 23.5, 34.5]];
  for (const [c0, r0, c1, r1] of tileAreas) {
    const w = wx(c1) - wx(c0), d = wz(r1) - wz(r0);
    const g = new THREE.PlaneGeometry(w, d, 1, 1); g.rotateX(-Math.PI / 2);
    g.translate((wx(c0) + wx(c1)) / 2, 0.01, (wz(r0) + wz(r1)) / 2);
    const pos = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 2, -pos.getZ(i) / 2);
    const uv1 = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) { uv1[i * 2] = (pos.getX(i) + HALF) / WORLD; uv1[i * 2 + 1] = 1 - (pos.getZ(i) + HALF) / WORLD; }
    g.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
    const m = new THREE.Mesh(g, mats.tile);
    m.receiveShadow = true;
    group.add(m);
  }
  mats.tile.aoMap = aoTex;

  // ---- site letters ----
  const letter = (ch, x, z, ry, y = 3.3) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), new THREE.MeshStandardMaterial({ map: letterTexture(ch), transparent: true, roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.position.set(x, y, z); m.rotation.y = ry;
    m.receiveShadow = true;
    group.add(m);
  };
  letter('B', wx(6.5), wz(2) + 0.02, 0);
  letter('A', wx(29), wz(2) + 0.02, 0);
  letter('A', wx(34) - 0.02, wz(14), -Math.PI / 2);
  letter('B', wx(3) + 0.02, wz(24), Math.PI / 2, 1.9);

  // ---- tunnel lamps ----
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x221a10, emissive: 0xffc070, emissiveIntensity: 4 });
  lamps.slice(0, quality === 'low' ? 2 : 5).forEach(p => {
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), lampMat);
    bulb.position.copy(p); group.add(bulb);
    const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 6), mats.metalDark);
    cage.position.set(p.x, p.y + 0.22, p.z); group.add(cage);
    const L = new THREE.PointLight(0xffb060, 14, 16, 2);
    L.position.copy(p); group.add(L);
  });

  // ---- domes / towers (skyline) ----
  const domeSpots = [[11, 14], [25, 17], [25, 23], [10, 22], [8, 32], [29, 32], [2, 16]];
  for (const [c, r] of domeSpots) {
    if (grid[r][c] !== '#') continue;
    const top = cellTop[r][c], x = wx(c + 0.5), z = wz(r + 0.5);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 1.4, 28), mats.plasterSolid);
    drum.position.set(x, top + 0.7, z);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(2.6, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), mats.dome);
    dome.position.set(x, top + 1.4, z);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(0.12, 1.2, 8), mats.metalDark);
    spire.position.set(x, top + 4.5, z);
    for (const m of [drum, dome, spire]) { m.castShadow = true; m.receiveShadow = true; group.add(m); }
  }
  const towers = [[-86, -40, 26], [60, -95, 32], [95, 30, 22], [-40, 96, 28]];
  for (const [x, z, h] of towers) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.8, h, 16), mats.plasterSolid);
    t.position.set(x, h / 2, z);
    const b = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 1, 16), mats.trimSolid); b.position.set(x, h - 3, z);
    const d = new THREE.Mesh(new THREE.SphereGeometry(2.4, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mats.dome); d.position.set(x, h, z);
    for (const m of [t, b, d]) { m.castShadow = true; group.add(m); }
  }
  // distant dunes ring
  {
    const g = new THREE.CylinderGeometry(420, 420, 1, 64, 1, true);
    const pos = g.attributes.position;
    const N = new ValueNoise(5);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y > 0) { const a = Math.atan2(pos.getZ(i), pos.getX(i)) / (Math.PI * 2) + 0.5; pos.setY(i, 8 + N.fbm(a, 0.3, 8, 4) * 45); }
      else pos.setY(i, -2);
    }
    g.computeVertexNormals();
    const dunes = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xc8a472, roughness: 1, side: THREE.BackSide, fog: true }));
    group.add(dunes);
  }

  // ---- palms ----
  const palms = [[13.7, 1.7], [22.4, 1.6], [33.3, 2.8], [2.8, 2.8], [12.6, 33.8], [23.2, 33.6]];
  for (const [c, r] of palms) {
    const x = wx(c), z = wz(r);
    group.add(buildPalm(x, z, mats, hash(c * 7, r * 3)));
    physics.add(new Box(x - 0.22, 0, z - 0.22, x + 0.22, 6, z + 0.22, 'wood'));
    occRect(x - 1.5, z - 1.5, x + 1.5, z + 1.5, 0.25);
  }

  // ---- awnings ----
  const awnings = [
    [wx(29), wz(2), 5, 'z+'], [wx(8), wz(2), 4, 'z+'], [wx(2), wz(8), 4, 'x+'], [wx(15), wz(35), 5, 'z-'], [wx(20), wz(35), 4, 'z-'],
    [wx(30), wz(16), 4, 'x+'], [wx(16), wz(22), 4, 'x+'],
  ];
  for (const [x, z, w, dir] of awnings) group.add(buildAwning(x, z, w, dir, mats));

  // ---- hanging cables ----
  const cableMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 });
  const cables = [[16, 10, 20, 10.6], [16, 21, 20, 20.2], [30, 16, 34, 15.4], [30, 25, 34, 25.8], [13, 30.6, 24, 30.2], [2, 7, 12, 7.4], [24, 6.4, 34, 6.8]];
  for (const [c0, r0, c1, r1] of cables) {
    const a = new THREE.Vector3(wx(c0), 5.6, wz(r0)), b = new THREE.Vector3(wx(c1), 5.8, wz(r1));
    const mid = a.clone().lerp(b, 0.5); mid.y -= 1.2;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.02, 4, false), cableMat);
    group.add(m);
  }

  // ---- dynamic props ----
  const barrelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.9, 20, 1);
  const ribGeo = new THREE.TorusGeometry(0.305, 0.015, 4, 20); ribGeo.rotateX(Math.PI / 2);
  const props = [];
  for (const [c, r, kind] of BARRELS) {
    const mesh = new THREE.Group();
    const body = new THREE.Mesh(barrelGeo, mats.barrel[kind]);
    body.castShadow = body.receiveShadow = true;
    mesh.add(body);
    for (const y of [-0.28, 0.28]) { const rib = new THREE.Mesh(ribGeo, mats.barrel[kind]); rib.position.y = y; mesh.add(rib); }
    group.add(mesh);
    const p = physics.addProp({ pos: { x: wx(c), y: 0.01, z: wz(r) }, vel: { x: 0, y: 0, z: 0 }, hx: 0.3, hy: 0.45, hz: 0.3, mass: kind === 'red' ? 35 : 28, mesh, surface: 'metal' });
    p.explosive = kind === 'red'; p.hp = 45; p.kind = 'barrel';
    props.push(p);
  }
  const smallCrateGeo = worldBox(-0.35, -0.35, -0.35, 0.35, 0.35, 0.35, { faceUV: true, aoFloor: 0.8 });
  for (const [c, r] of SMALL_CRATES) {
    const mesh = new THREE.Mesh(smallCrateGeo, mats.crate);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    const p = physics.addProp({ pos: { x: wx(c), y: 0.01, z: wz(r) }, vel: { x: 0, y: 0, z: 0 }, hx: 0.35, hy: 0.35, hz: 0.35, mass: 14, mesh, surface: 'wood' });
    p.kind = 'crate';
    props.push(p);
  }

  physics.build();
  const nav = new NavGrid(WORLD, 2);
  nav.build(physics);

  // ---- gameplay metadata ----
  const spawnGrid = (c0, r0, c1, r1, step) => {
    const pts = [];
    for (let z = wz(r0); z <= wz(r1); z += step) for (let x = wx(c0); x <= wx(c1); x += step) if (nav.walkable(x, z)) pts.push({ x, z });
    return pts;
  };
  const sites = {
    A: { name: 'A', minX: wx(25.5), maxX: wx(32.5), minZ: wz(3), maxZ: wz(9.8), center: P(28.8, 7.8),
      plantSpots: [P(27.2, 7.6), P(30.2, 5.2), P(29.6, 9.2), P(26.8, 4.5)],
      entrances: [P(32, 12.5), P(23.5, 9.5), P(23.8, 4)],
      holdCT: [P(26, 3.2), P(29.5, 3.2), P(32.8, 6), P(26.8, 7.5), P(30.2, 7.2)],
      holdT: [P(27.5, 5), P(32.6, 9.5), P(25.6, 10.5), P(29.3, 4.5)] },
    B: { name: 'B', minX: wx(3.2), maxX: wx(10), minZ: wz(3), maxZ: wz(10), center: P(6.8, 7.8),
      plantSpots: [P(7.6, 7.6), P(4.8, 7.2), P(8.2, 5.2), P(5.2, 4.6)],
      entrances: [P(4.5, 12.5), P(11.8, 4)],
      holdCT: [P(3, 3), P(10.5, 6.5), P(8, 3), P(10.6, 10.6), P(7.8, 6)],
      holdT: [P(4.8, 3), P(10.4, 3.2), P(9.8, 7), P(7, 10.6)] },
  };
  const routes = {
    T: {
      A: [[P(31.5, 26), P(32.9, 20.5), P(31.8, 14)], [P(18, 24), P(17.9, 13.5), P(18, 9.4), P(22.5, 9.6)]],
      B: [[P(5, 25.5), P(5, 17), P(4.8, 12.6)], [P(18, 24), P(17.8, 18.8), P(10, 18.9), P(5, 17), P(4.8, 12.6)]],
    },
    CT: { mid: [P(18, 8.5)], A: [P(23, 4)], B: [P(12, 4)] },
  };
  const holdMidCT = [P(17.2, 8), P(19.2, 7.2)];
  const spawns = { T: spawnGrid(12.8, 30.8, 23.2, 34.2, 2.2), CT: spawnGrid(13.8, 1.8, 22.2, 5.4, 2.2) };

  // radar image
  const radar = document.createElement('canvas');
  radar.width = radar.height = 288;
  const rc = radar.getContext('2d');
  rc.fillStyle = 'rgba(20,18,14,0.0)'; rc.fillRect(0, 0, 288, 288);
  for (let r = 0; r < GH; r++) for (let c = 0; c < GW; c++) {
    const ch = grid[r][c];
    if (ch === '#') continue;
    rc.fillStyle = ch === 'r' ? 'rgba(120,110,90,0.85)' : 'rgba(170,158,128,0.85)';
    rc.fillRect(c * 8, r * 8, 8, 8);
  }
  rc.fillStyle = 'rgba(60,45,25,0.9)';
  for (const [c, r, nx, nz] of STATIC_CRATES) rc.fillRect((c - nx * 0.15) * 8, (r - nz * 0.15) * 8, nx * 2.4, nz * 2.4);
  rc.font = 'bold 28px Arial'; rc.fillStyle = 'rgba(255,90,60,.85)'; rc.textAlign = 'center'; rc.textBaseline = 'middle';
  rc.fillText('A', 29 * 8, 7 * 8); rc.fillText('B', 6.5 * 8, 7 * 8);

  return { group, grid, nav, sites, routes, spawns, props, radar, holdMidCT, cellTop };
}

function buildPalm(x, z, mats, seed) {
  const g = new THREE.Group();
  const h = 5.5 + seed * 2.5, lean = (seed - 0.5) * 0.6;
  const segs = 8;
  let px = 0, py = 0;
  for (let i = 0; i < segs; i++) {
    const t = i / segs, len = h / segs;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.17 - t * 0.05, 0.2 - t * 0.05, len, 8), mats.palmTrunk);
    const ang = lean * t * t;
    m.position.set(px + Math.sin(ang) * len / 2, py + len / 2, 0);
    m.rotation.z = -ang;
    px += Math.sin(ang) * len; py += Math.cos(ang) * len;
    m.castShadow = true;
    g.add(m);
  }
  const frondGeo = new THREE.PlaneGeometry(0.9, 3.6, 1, 6);
  frondGeo.translate(0, 1.8, 0);
  const pos = frondGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); pos.setZ(i, -((y / 3.6) ** 2) * 1.4); }
  frondGeo.computeVertexNormals();
  for (let k = 0; k < 11; k++) {
    const f = new THREE.Mesh(frondGeo, mats.palmLeaf);
    f.position.set(px, py, 0);
    f.rotation.set(-1.0 - Math.random() * 0.5, (k / 11) * Math.PI * 2 + Math.random() * 0.3, 0, 'YXZ');
    f.castShadow = true;
    g.add(f);
  }
  g.position.set(x, 0, z);
  g.rotation.y = seed * 6.28;
  return g;
}

function buildAwning(x, z, w, dir, mats) {
  const g = new THREE.Group();
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(w, 2.2, 8, 4), mats.awning);
  const pos = cloth.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) { const u = pos.getX(i) / w + 0.5, v = pos.getY(i) / 2.2 + 0.5; pos.setZ(i, Math.sin(u * Math.PI * 3) * 0.03 - Math.sin(v * Math.PI) * 0.12); }
  cloth.geometry.computeVertexNormals();
  cloth.rotation.x = -Math.PI / 2 + 0.35;
  cloth.position.set(0, 3.25, 1.05);
  cloth.castShadow = true; cloth.receiveShadow = true;
  g.add(cloth);
  for (const s of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.2, 6), mats.metalDark);
    pole.rotation.x = -Math.PI / 2 + 0.35; pole.position.set(s * w / 2, 3.25, 1.05);
    g.add(pole);
  }
  g.position.set(x, 0, z);
  g.rotation.y = dir === 'z+' ? 0 : dir === 'z-' ? Math.PI : dir === 'x+' ? Math.PI / 2 : -Math.PI / 2;
  return g;
}

export function awningTexture() {
  return makeCanvasTexture(256, (g, s) => {
    const cols = ['#b8452f', '#e9dcc0'];
    for (let i = 0; i < 8; i++) { g.fillStyle = cols[i % 2]; g.fillRect(i * s / 8, 0, s / 8, s); }
    g.globalCompositeOperation = 'multiply';
    const gr = g.createLinearGradient(0, 0, 0, s);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#b8a890');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
    for (let k = 0; k < 400; k++) { g.fillStyle = `rgba(90,70,40,${Math.random() * 0.12})`; g.fillRect(Math.random() * s, Math.random() * s, 6, 6); }
  });
}

export function palmLeafTexture() {
  return makeCanvasTexture(128, (g, s) => {
    g.clearRect(0, 0, s, s);
    g.strokeStyle = '#6b5a2a'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(s / 2, s); g.lineTo(s / 2, 0); g.stroke();
    for (let y = 4; y < s; y += 5) {
      const w = (s / 2) * Math.sin((1 - y / s) * Math.PI * 0.95 + 0.1);
      const c = 60 + Math.random() * 40;
      g.strokeStyle = `rgb(${c * 0.8},${c + 50},${c * 0.4})`; g.lineWidth = 3;
      g.beginPath(); g.moveTo(s / 2, y); g.lineTo(s / 2 - w, y - 12); g.stroke();
      g.beginPath(); g.moveTo(s / 2, y); g.lineTo(s / 2 + w, y - 12); g.stroke();
    }
  });
}
