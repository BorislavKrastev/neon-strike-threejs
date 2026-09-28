// 2 m navigation grid with A* path finding and line-of-walk smoothing for bots.

export class NavGrid {
  constructor(size = 144, res = 2) {
    this.res = res;
    this.n = Math.round(size / res);
    this.half = size / 2;
    this.blocked = new Uint8Array(this.n * this.n);
    this._g = new Float32Array(this.n * this.n);
    this._f = new Float32Array(this.n * this.n);
    this._from = new Int32Array(this.n * this.n);
    this._state = new Uint32Array(this.n * this.n);
    this._gen = 1;
  }

  build(physics) {
    const n = this.n, r = this.res, pad = 0.45, hs = 0.5;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = -this.half + r / 2 + i * r, z = -this.half + r / 2 + j * r;
      let blocked = 0;
      const list = physics.query(x - 2, z - 2, x + 2, z + 2);
      for (const b of list) {
        if (b.maxY < 0.35 || b.minY > 1.7) continue;
        if (x - hs < b.maxX + pad && x + hs > b.minX - pad && z - hs < b.maxZ + pad && z + hs > b.minZ - pad) { blocked = 1; break; }
      }
      this.blocked[j * n + i] = blocked;
    }
  }

  idx(x, z) {
    const i = Math.floor((x + this.half) / this.res), j = Math.floor((z + this.half) / this.res);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return -1;
    return j * this.n + i;
  }
  center(k) {
    const i = k % this.n, j = (k / this.n) | 0;
    return { x: -this.half + this.res / 2 + i * this.res, z: -this.half + this.res / 2 + j * this.res };
  }
  walkable(x, z) { const k = this.idx(x, z); return k >= 0 && !this.blocked[k]; }

  nearestFree(x, z) {
    let k = this.idx(x, z);
    if (k >= 0 && !this.blocked[k]) return k;
    const n = this.n;
    const i0 = Math.floor((x + this.half) / this.res), j0 = Math.floor((z + this.half) / this.res);
    for (let rad = 1; rad < 8; rad++) {
      let best = -1, bd = 1e9;
      for (let dj = -rad; dj <= rad; dj++) for (let di = -rad; di <= rad; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== rad) continue;
        const i = i0 + di, j = j0 + dj;
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        const kk = j * n + i;
        if (this.blocked[kk]) continue;
        const c = this.center(kk), d = (c.x - x) ** 2 + (c.z - z) ** 2;
        if (d < bd) { bd = d; best = kk; }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  // grid line walk test
  clearLine(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az), steps = Math.ceil(d / 0.5);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      if (!this.walkable(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }

  findPath(ax, az, bx, bz) {
    const n = this.n;
    const start = this.nearestFree(ax, az), goal = this.nearestFree(bx, bz);
    if (start < 0 || goal < 0) return null;
    const gen = (this._gen += 2);
    const OPEN = gen, CLOSED = gen + 1;
    const g = this._g, f = this._f, from = this._from, st = this._state;
    const heap = [start];
    const gi = goal % n, gj = (goal / n) | 0;
    const H = k => { const dx = Math.abs(k % n - gi), dz = Math.abs(((k / n) | 0) - gj); return (dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz)); };
    g[start] = 0; f[start] = H(start); from[start] = -1; st[start] = OPEN;
    const push = k => {
      heap.push(k); let i = heap.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (f[heap[p]] <= f[heap[i]]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last; let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1; let m = i;
          if (l < heap.length && f[heap[l]] < f[heap[m]]) m = l;
          if (r < heap.length && f[heap[r]] < f[heap[m]]) m = r;
          if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
        }
      }
      return top;
    };
    let found = false, iter = 0;
    while (heap.length && iter++ < 12000) {
      const cur = pop();
      if (st[cur] === CLOSED) continue;
      st[cur] = CLOSED;
      if (cur === goal) { found = true; break; }
      const ci = cur % n, cj = (cur / n) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
        const nk = nj * n + ni;
        if (this.blocked[nk] || st[nk] === CLOSED) continue;
        if (di && dj && (this.blocked[cj * n + ni] || this.blocked[nj * n + ci])) continue;
        const ng = g[cur] + (di && dj ? Math.SQRT2 : 1);
        if (st[nk] === OPEN && ng >= g[nk]) continue;
        g[nk] = ng; f[nk] = ng + H(nk); from[nk] = cur; st[nk] = OPEN; push(nk);
      }
    }
    if (!found) return null;
    const raw = [];
    for (let k = goal; k !== -1; k = from[k]) raw.push(this.center(k));
    raw.reverse();
    raw[raw.length - 1] = { x: bx, z: bz };
    // string pulling
    const out = [];
    let i = 0, px = ax, pz = az;
    while (i < raw.length) {
      let j = raw.length - 1;
      while (j > i && !this.clearLine(px, pz, raw[j].x, raw[j].z)) j--;
      out.push(raw[j]); px = raw[j].x; pz = raw[j].z; i = j + 1;
    }
    return out;
  }
}
