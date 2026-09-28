// Procedural PBR texture generation (albedo + normal + roughness) on canvas.
// Every texture is generated at load time: no external image assets.
import * as THREE from 'three';

let ANISO = 8;
export function setAnisotropy(n) { ANISO = n; }

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const P = 256, PM = P - 1;
export class ValueNoise {
  constructor(seed) {
    const r = rng(seed);
    this.t = new Float32Array(P * P);
    for (let i = 0; i < P * P; i++) this.t[i] = r();
  }
  // Periodic on [0,1) when f is an integer.
  n(u, v, f, o = 0) {
    const x = u * f, y = v * f;
    const xi = Math.floor(x), yi = Math.floor(y);
    let tx = x - xi, ty = y - yi;
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    const x0 = ((xi % f) + f) % f, y0 = ((yi % f) + f) % f;
    const x1 = (x0 + 1) % f, y1 = (y0 + 1) % f;
    const ox = (o * 37) & PM, oy = (o * 91) & PM, t = this.t;
    const r0 = ((y0 + oy) & PM) * P, r1 = ((y1 + oy) & PM) * P;
    const c0 = (x0 + ox) & PM, c1 = (x1 + ox) & PM;
    const a = t[r0 + c0], b = t[r0 + c1], c = t[r1 + c0], d = t[r1 + c1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  }
  fbm(u, v, f, oct, g = 0.5) {
    let s = 0, amp = 1, norm = 0;
    for (let i = 0; i < oct; i++) { s += this.n(u, v, f, i) * amp; norm += amp; amp *= g; f *= 2; }
    return s / norm;
  }
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function canvasFrom(size, fill) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  fill(img.data);
  ctx.putImageData(img, 0, 0);
  return c;
}

function toTex(canvas, srgb) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = ANISO;
  return t;
}

function finish(size, A, H, R, strength = 4) {
  const n = size * size;
  const col = canvasFrom(size, d => {
    for (let i = 0; i < n; i++) {
      d[i * 4] = A[i * 3] * 255; d[i * 4 + 1] = A[i * 3 + 1] * 255; d[i * 4 + 2] = A[i * 3 + 2] * 255; d[i * 4 + 3] = 255;
    }
  });
  const nor = canvasFrom(size, d => {
    for (let y = 0; y < size; y++) {
      const yu = ((y - 1 + size) % size) * size, yd = ((y + 1) % size) * size, yr = y * size;
      for (let x = 0; x < size; x++) {
        const xl = (x - 1 + size) % size, xr = (x + 1) % size;
        let nx = (H[yr + xl] - H[yr + xr]) * strength;
        let ny = (H[yd + x] - H[yu + x]) * strength;
        const l = Math.hypot(nx, ny, 1);
        const i = (yr + x) * 4;
        d[i] = (nx / l * 0.5 + 0.5) * 255; d[i + 1] = (ny / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
      }
    }
  });
  const rou = canvasFrom(size, d => {
    for (let i = 0; i < n; i++) { const v = R[i] * 255; d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
  });
  return { map: toTex(col, true), normalMap: toTex(nor, false), roughnessMap: toTex(rou, false) };
}

function buffers(size) {
  return [new Float32Array(size * size * 3), new Float32Array(size * size), new Float32Array(size * size)];
}

export function sandTexture(size = 512) {
  const N = new ValueNoise(11), r = rng(5);
  const [A, H, R] = buffers(size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, i = y * size + x;
    const big = N.fbm(u, v, 3, 4);
    const mid = N.fbm(u, v, 12, 3);
    const fine = N.fbm(u, v, 64, 2);
    const rip = Math.sin((u * 5 + v * 3) * Math.PI * 2 + big * 7) * 0.5 + 0.5;
    const pb = N.n(u, v, 48, 7);
    const pebble = pb > 0.8 ? (pb - 0.8) * 5 : 0;
    const g = r();
    const k = 0.8 + big * 0.26 + mid * 0.1 - pebble * 0.3 + (g - 0.5) * 0.07;
    A[i * 3] = 0.80 * k + pebble * 0.04; A[i * 3 + 1] = 0.655 * k; A[i * 3 + 2] = 0.46 * k - pebble * 0.03;
    H[i] = rip * 0.12 + mid * 0.5 + fine * 0.35 + pebble * 1.0 + g * 0.1;
    R[i] = 0.86 + g * 0.12 - pebble * 0.25;
  }
  return finish(size, A, H, R, 5);
}

export function sandstoneTexture(size = 512, seed = 3, base = [0.80, 0.66, 0.48]) {
  const N = new ValueNoise(seed), r = rng(seed + 1);
  const [A, H, R] = buffers(size);
  const rows = 6, rowData = [];
  for (let j = 0; j < rows; j++) {
    const n = 2 + Math.floor(r() * 2);
    const ws = []; for (let k = 0; k < n; k++) ws.push(0.7 + r() * 0.6);
    const sum = ws.reduce((a, b) => a + b, 0);
    const cum = [0]; for (let k = 0; k < n; k++) cum.push(cum[k] + ws[k] / sum);
    rowData.push({ off: r(), cum, tint: ws.map(() => 0.84 + r() * 0.26), hue: ws.map(() => (r() - 0.5) * 0.06) });
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, i = y * size + x;
    const j = Math.min(rows - 1, Math.floor(v * rows)); const fv = v * rows - j;
    const rd = rowData[j];
    const w = ((u - rd.off) % 1 + 1) % 1;
    let k = 0; while (k < rd.cum.length - 2 && w >= rd.cum[k + 1]) k++;
    const dx = Math.min(w - rd.cum[k], rd.cum[k + 1] - w);
    const dy = Math.min(fv, 1 - fv) / rows;
    const edge = Math.min(dx, dy);
    const erosion = N.fbm(u, v, 32, 3);
    const m = 0.006 + erosion * 0.008;
    const surf = N.fbm(u, v, 24, 4);
    const streak = N.fbm(u, v * 0.25, 16, 3);
    const pit = N.n(u, v, 96, 5);
    const g = r();
    if (edge < m) {
      const c = 0.5 + surf * 0.15 + g * 0.05;
      A[i * 3] = c * 1.02; A[i * 3 + 1] = c * 0.92; A[i * 3 + 2] = c * 0.78;
      H[i] = 0.05 + g * 0.05; R[i] = 0.95;
    } else {
      const bev = smooth(m, m + 0.014, edge);
      const t = rd.tint[k] * (0.86 + surf * 0.26) - streak * 0.1 - (pit > 0.83 ? 0.12 : 0) + (g - 0.5) * 0.04;
      A[i * 3] = base[0] * t + rd.hue[k]; A[i * 3 + 1] = base[1] * t; A[i * 3 + 2] = base[2] * t - rd.hue[k] * 0.5;
      H[i] = 0.35 + bev * 0.45 + surf * 0.25 - (pit > 0.83 ? 0.25 : 0) + g * 0.04;
      R[i] = 0.78 + surf * 0.15 + g * 0.05;
    }
  }
  return finish(size, A, H, R, 4);
}

export function plasterTexture(size = 512, seed = 7, base = [0.86, 0.79, 0.65]) {
  const N = new ValueNoise(seed), r = rng(seed + 3);
  const [A, H, R] = buffers(size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, i = y * size + x;
    const big = N.fbm(u, v, 3, 4);
    const mid = N.fbm(u, v, 16, 3);
    const cr = 1 - Math.abs(N.fbm(u, v, 6, 5, 0.55) * 2 - 1);
    const crack = smooth(0.972, 0.992, cr) * 0.7;
    const patchN = N.fbm(u, v, 4, 4, 0.5);
    const g = r();
    const patch = smooth(0.74, 0.77, patchN);
    // exposed brick under plaster
    const br = 10, bj = Math.floor(v * br), bu = (u * 5 + (bj % 2) * 0.5) % 1, bv = v * br - bj;
    const mort = (bu < 0.04 || bu > 0.96 || bv < 0.08 || bv > 0.92) ? 1 : 0;
    const pc = 0.86 + big * 0.2 + mid * 0.06 - crack * 0.35 + (g - 0.5) * 0.03;
    let cr0 = base[0] * pc, cg0 = base[1] * pc, cb0 = base[2] * pc;
    const bc = mort ? 0.5 : 0.62 + mid * 0.2;
    const brk = [bc * 0.92, bc * 0.7, bc * 0.52];
    A[i * 3] = cr0 * (1 - patch) + brk[0] * patch;
    A[i * 3 + 1] = cg0 * (1 - patch) + brk[1] * patch;
    A[i * 3 + 2] = cb0 * (1 - patch) + brk[2] * patch;
    H[i] = (0.62 + mid * 0.15 + big * 0.1 - crack * 0.35) * (1 - patch) + (mort ? 0.05 : 0.3) * patch + g * 0.03;
    R[i] = 0.88 + g * 0.08 - patch * 0.05;
  }
  return finish(size, A, H, R, 5);
}

export function tileTexture(size = 512, seed = 31) {
  const N = new ValueNoise(seed), r = rng(seed);
  const [A, H, R] = buffers(size);
  const T = 4, tints = [];
  for (let k = 0; k < T * T; k++) tints.push([0.72 + r() * 0.12, 0.6 + r() * 0.1, 0.46 + r() * 0.08, r()]);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, i = y * size + x;
    const tx = Math.floor(u * T), ty = Math.floor(v * T);
    const fu = u * T - tx, fv = v * T - ty;
    const e = Math.min(fu, 1 - fu, fv, 1 - fv);
    const tc = tints[ty * T + tx];
    const wear = N.fbm(u, v, 8, 4);
    const surf = N.fbm(u, v, 48, 3);
    const g = r();
    const chip = N.n(u, v, 64, 3) > 0.85 && e < 0.08;
    if (e < 0.022 || chip) {
      const c = 0.36 + surf * 0.12;
      A[i * 3] = c; A[i * 3 + 1] = c * 0.92; A[i * 3 + 2] = c * 0.8;
      H[i] = 0.05; R[i] = 0.95;
    } else {
      const k = 0.85 + wear * 0.25 + (g - 0.5) * 0.05 - (tc[3] > 0.8 ? 0.08 : 0);
      A[i * 3] = tc[0] * k; A[i * 3 + 1] = tc[1] * k; A[i * 3 + 2] = tc[2] * k;
      H[i] = 0.5 + smooth(0.022, 0.05, e) * 0.3 + surf * 0.12;
      R[i] = 0.62 + wear * 0.3;
    }
  }
  return finish(size, A, H, R, 4);
}

export function concreteTexture(size = 512, seed = 41) {
  const N = new ValueNoise(seed), r = rng(seed);
  const [A, H, R] = buffers(size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, i = y * size + x;
    const big = N.fbm(u, v, 4, 4), mid = N.fbm(u, v, 24, 3), g = r();
    const pit = N.n(u, v, 128, 2) > 0.86 ? 1 : 0;
    const stain = smooth(0.55, 0.8, N.fbm(u, v * 0.3, 8, 3));
    const c = 0.52 + big * 0.18 + mid * 0.08 - pit * 0.15 - stain * 0.12 + (g - 0.5) * 0.05;
    A[i * 3] = c * 1.0; A[i * 3 + 1] = c * 0.97; A[i * 3 + 2] = c * 0.92;
    H[i] = 0.5 + mid * 0.3 - pit * 0.4 + g * 0.06;
    R[i] = 0.85 + g * 0.1;
  }
  return finish(size, A, H, R, 4);
}

export function crateTexture(size = 512, seed = 21) {
  const N = new ValueNoise(seed), r = rng(seed);
  const [A, H, R] = buffers(size);
  const planks = 5, ptint = []; for (let k = 0; k < planks; k++) ptint.push(0.85 + r() * 0.25);
  const B = 0.1;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, i = y * size + x;
    const g = r();
    const horiz = v < B || v > 1 - B, vert = u < B || u > 1 - B;
    const dd = Math.abs(u - v) / Math.SQRT2;
    const brace = !horiz && !vert && dd < 0.055;
    let grain, tint = 1, h = 0.5, gap = 0;
    if (horiz) { grain = N.fbm(u * 0.4, v * 6, 16, 4); tint = 0.8; h = 0.85; gap = Math.min(Math.abs(v - B), Math.abs(v - (1 - B))) < 0.004 ? 1 : 0; }
    else if (vert) { grain = N.fbm(u * 6, v * 0.4, 16, 4); tint = 0.8; h = 0.85; gap = Math.min(Math.abs(u - B), Math.abs(u - (1 - B))) < 0.004 ? 1 : 0; }
    else if (brace) { grain = N.fbm((u + v) * 0.3, (u - v) * 6, 16, 4); tint = 0.78; h = 0.75; gap = dd > 0.051 ? 1 : 0; }
    else {
      const k = Math.floor(u * planks); const fu = u * planks - k;
      grain = N.fbm(u * 6, v * 0.35, 16, 4) + k * 0.13; tint = ptint[k]; h = 0.45;
      gap = (fu < 0.03 || fu > 0.97) ? 1 : 0;
    }
    const rings = Math.sin(grain * 60) * 0.5 + 0.5;
    const dirt = N.fbm(u, v, 4, 3);
    const nail = (horiz || vert) && ((Math.hypot((u % 0.2) - 0.1, (v < 0.5 ? v : 1 - v) - 0.05) < 0.012) || (Math.hypot((u < 0.5 ? u : 1 - u) - 0.05, (v % 0.2) - 0.1) < 0.012));
    let c = tint * (0.78 + rings * 0.14 + (g - 0.5) * 0.05) - dirt * 0.12;
    if (gap) c *= 0.35;
    if (nail) { A[i * 3] = 0.35; A[i * 3 + 1] = 0.33; A[i * 3 + 2] = 0.3; H[i] = 1; R[i] = 0.4; continue; }
    A[i * 3] = 0.60 * c; A[i * 3 + 1] = 0.42 * c; A[i * 3 + 2] = 0.24 * c;
    H[i] = gap ? 0 : h + rings * 0.06;
    R[i] = 0.75 + g * 0.1;
  }
  return finish(size, A, H, R, 3);
}

export function metalTexture(size = 256, seed = 51, base = [0.22, 0.32, 0.26]) {
  const N = new ValueNoise(seed), r = rng(seed);
  const [A, H, R] = buffers(size);
  const scratches = [];
  for (let k = 0; k < 60; k++) scratches.push([r(), r(), (r() - 0.5) * 0.5, r() * 0.25]);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, i = y * size + x;
    const rust = smooth(0.58, 0.72, N.fbm(u, v, 6, 5));
    const mid = N.fbm(u, v, 20, 3), g = r();
    let sc = 0;
    for (const s of scratches) {
      const du = u - s[0], dv = v - s[1];
      const along = du * Math.cos(s[2]) + dv * Math.sin(s[2]);
      const across = -du * Math.sin(s[2]) + dv * Math.cos(s[2]);
      if (Math.abs(across) < 0.0025 && along > 0 && along < s[3]) { sc = 1; break; }
    }
    const k = 0.85 + mid * 0.2 + (g - 0.5) * 0.04;
    let cr = base[0] * k, cg = base[1] * k, cb = base[2] * k;
    const rc = [0.42 + mid * 0.1, 0.22, 0.1];
    cr = cr * (1 - rust) + rc[0] * rust; cg = cg * (1 - rust) + rc[1] * rust; cb = cb * (1 - rust) + rc[2] * rust;
    if (sc) { cr = cg = cb = 0.6; }
    A[i * 3] = cr; A[i * 3 + 1] = cg; A[i * 3 + 2] = cb;
    H[i] = 0.5 + rust * 0.2 * mid - sc * 0.2;
    R[i] = sc ? 0.3 : 0.55 + rust * 0.4 + g * 0.05;
  }
  return finish(size, A, H, R, 3);
}

export function fabricTexture(size = 256, seed = 61) {
  const N = new ValueNoise(seed), r = rng(seed);
  const [A, H, R] = buffers(size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, i = y * size + x;
    const weave = (Math.sin(u * Math.PI * 2 * 64) * Math.sin(v * Math.PI * 2 * 64)) * 0.5 + 0.5;
    const n = N.fbm(u, v, 8, 4), g = r();
    const c = 0.85 + n * 0.25 + weave * 0.05 + (g - 0.5) * 0.04;
    A[i * 3] = c; A[i * 3 + 1] = c; A[i * 3 + 2] = c;
    H[i] = weave * 0.3 + n * 0.3; R[i] = 0.9;
  }
  return finish(size, A, H, R, 2);
}

// ---------- simple canvas sprites / decals ----------
export function makeCanvasTexture(size, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function softParticleTexture() {
  return makeCanvasTexture(128, (g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.4, 'rgba(255,255,255,.5)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  });
}

export function smokeTexture() {
  const N = new ValueNoise(99);
  return makeCanvasTexture(128, (g, s) => {
    const img = g.createImageData(s, s);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const dx = x / s - 0.5, dy = y / s - 0.5, d = Math.hypot(dx, dy) * 2;
      const n = N.fbm(x / s, y / s, 4, 5);
      const a = Math.max(0, 1 - d) ** 1.5 * (0.4 + n * 0.9);
      const i = (y * s + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.min(255, a * 255);
    }
    g.putImageData(img, 0, 0);
  });
}

export function bulletHoleTexture() {
  return makeCanvasTexture(64, (g, s) => {
    const c = s / 2;
    let gr = g.createRadialGradient(c, c, 0, c, c, c);
    gr.addColorStop(0, 'rgba(0,0,0,1)');
    gr.addColorStop(0.18, 'rgba(10,8,6,1)');
    gr.addColorStop(0.3, 'rgba(40,32,24,.85)');
    gr.addColorStop(0.6, 'rgba(60,50,40,.35)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
    g.strokeStyle = 'rgba(20,15,10,.6)'; g.lineWidth = 1;
    for (let k = 0; k < 7; k++) {
      const a = Math.random() * Math.PI * 2;
      g.beginPath(); g.moveTo(c + Math.cos(a) * 5, c + Math.sin(a) * 5);
      g.lineTo(c + Math.cos(a) * (10 + Math.random() * 12), c + Math.sin(a) * (10 + Math.random() * 12)); g.stroke();
    }
  });
}

export function bloodTexture() {
  return makeCanvasTexture(128, (g, s) => {
    const c = s / 2;
    for (let k = 0; k < 22; k++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * s * 0.32, r = 4 + Math.random() * 16 * (1 - d / (s * 0.4));
      g.fillStyle = `rgba(${90 + Math.random() * 40},${4 + Math.random() * 10},${4},${0.6 + Math.random() * 0.35})`;
      g.beginPath(); g.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, Math.max(2, r), 0, Math.PI * 2); g.fill();
    }
  });
}

export function scorchTexture() {
  return makeCanvasTexture(128, (g, s) => {
    const c = s / 2;
    const gr = g.createRadialGradient(c, c, 0, c, c, c);
    gr.addColorStop(0, 'rgba(5,4,3,.95)'); gr.addColorStop(0.5, 'rgba(15,12,10,.7)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  });
}

export function letterTexture(letter) {
  return makeCanvasTexture(256, (g, s) => {
    g.clearRect(0, 0, s, s);
    g.font = 'bold 200px Arial Black, Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(120, 20, 10, 0.85)';
    g.fillText(letter, s / 2, s / 2 + 10);
    // weathering: knock out random specks
    g.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 900; k++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.8})`; g.fillRect(Math.random() * s, Math.random() * s, 2 + Math.random() * 4, 2 + Math.random() * 4); }
    g.globalCompositeOperation = 'source-over';
    g.strokeStyle = 'rgba(120,20,10,.6)'; g.lineWidth = 8;
    g.beginPath(); g.moveTo(s * 0.62, s * 0.86); g.lineTo(s * 0.9, s * 0.86); g.lineTo(s * 0.84, s * 0.8); g.stroke();
  });
}

export function flareTexture() {
  return makeCanvasTexture(128, (g, s) => {
    const c = s / 2;
    const gr = g.createRadialGradient(c, c, 0, c, c, c);
    gr.addColorStop(0, 'rgba(255,255,230,1)');
    gr.addColorStop(0.15, 'rgba(255,220,140,.9)');
    gr.addColorStop(0.45, 'rgba(255,140,40,.35)');
    gr.addColorStop(1, 'rgba(255,100,20,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = 'rgba(255,220,160,.5)'; g.lineWidth = 3;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + Math.random() * 0.3;
      g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.cos(a) * c * 0.95, c + Math.sin(a) * c * 0.95); g.stroke();
    }
  });
}
