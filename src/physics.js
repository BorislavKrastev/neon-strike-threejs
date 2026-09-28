// Axis-aligned collision world: static level boxes, dynamic props and swept bodies.
// Character movement follows the GoldSrc model (see combatant.js); this module only
// resolves collisions, step-ups, bounces and ray casts.

export const GRAVITY = 20.3;          // 800 u/s^2 in metres
export const STEP_HEIGHT = 0.46;      // 18 units
const EPS = 0.001;

export class Box {
  constructor(minX, minY, minZ, maxX, maxY, maxZ, surface = 'stone') {
    this.minX = minX; this.minY = minY; this.minZ = minZ;
    this.maxX = maxX; this.maxY = maxY; this.maxZ = maxZ;
    this.surface = surface;
    this.prop = null;
    this.penetrable = surface === 'wood' || surface === 'metal';
  }
}

export class PhysicsWorld {
  constructor() {
    this.boxes = [];
    this.props = [];
    this.cell = 8;
    this.grid = new Map();
    this._q = [];
    this._stamp = null;
    this._sid = 0;
  }

  add(box) { this.boxes.push(box); return box; }

  build() {
    this.grid.clear();
    const c = this.cell;
    this.boxes.forEach((b, i) => {
      for (let ix = Math.floor(b.minX / c); ix <= Math.floor(b.maxX / c); ix++)
        for (let iz = Math.floor(b.minZ / c); iz <= Math.floor(b.maxZ / c); iz++) {
          const k = (ix + 512) * 4096 + (iz + 512);
          let a = this.grid.get(k); if (!a) this.grid.set(k, a = []);
          a.push(i);
        }
    });
    this._stamp = new Int32Array(this.boxes.length);
  }

  query(minX, minZ, maxX, maxZ) {
    const out = this._q; out.length = 0;
    const c = this.cell, id = ++this._sid;
    for (let ix = Math.floor(minX / c); ix <= Math.floor(maxX / c); ix++)
      for (let iz = Math.floor(minZ / c); iz <= Math.floor(maxZ / c); iz++) {
        const a = this.grid.get((ix + 512) * 4096 + (iz + 512));
        if (!a) continue;
        for (let j = 0; j < a.length; j++) {
          const bi = a[j];
          if (this._stamp[bi] !== id) { this._stamp[bi] = id; out.push(this.boxes[bi]); }
        }
      }
    return out;
  }

  // Returns boxes overlapping the given volume (static + props).
  overlaps(minX, minY, minZ, maxX, maxY, maxZ, ignore, withProps = true, out = []) {
    out.length = 0;
    const list = this.query(minX, minZ, maxX, maxZ);
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (minX < b.maxX && maxX > b.minX && minY < b.maxY && maxY > b.minY && minZ < b.maxZ && maxZ > b.minZ) out.push(b);
    }
    if (withProps) for (const p of this.props) {
      const b = p.box; if (b === ignore) continue;
      if (minX < b.maxX && maxX > b.minX && minY < b.maxY && maxY > b.minY && minZ < b.maxZ && maxZ > b.minZ) out.push(b);
    }
    return out;
  }

  // Ray cast against level (and props). Returns nearest hit or null.
  raycast(ox, oy, oz, dx, dy, dz, maxDist, withProps = true, ignoreBox = null) {
    if (Math.abs(dx) < 1e-9) dx = 1e-9;
    if (Math.abs(dy) < 1e-9) dy = 1e-9;
    if (Math.abs(dz) < 1e-9) dz = 1e-9;
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    let best = maxDist, bestBox = null, bestAxis = 0;
    const test = (b) => {
      let t1 = (b.minX - ox) * ix, t2 = (b.maxX - ox) * ix;
      let tmin = t1 < t2 ? t1 : t2, tmax = t1 < t2 ? t2 : t1, axis = 0;
      t1 = (b.minY - oy) * iy; t2 = (b.maxY - oy) * iy;
      let a = t1 < t2 ? t1 : t2, c = t1 < t2 ? t2 : t1;
      if (a > tmin) { tmin = a; axis = 1; } if (c < tmax) tmax = c;
      t1 = (b.minZ - oz) * iz; t2 = (b.maxZ - oz) * iz;
      a = t1 < t2 ? t1 : t2; c = t1 < t2 ? t2 : t1;
      if (a > tmin) { tmin = a; axis = 2; } if (c < tmax) tmax = c;
      if (tmax < tmin || tmin < 0 || tmin >= best) return;
      best = tmin; bestBox = b; bestAxis = axis;
    };
    // traverse the broadphase cells covering the ray's bounding box
    const ex = ox + dx * maxDist, ez = oz + dz * maxDist;
    const list = this.query(Math.min(ox, ex), Math.min(oz, ez), Math.max(ox, ex), Math.max(oz, ez));
    for (let i = 0; i < list.length; i++) test(list[i]);
    if (withProps) for (const p of this.props) if (p.box !== ignoreBox) test(p.box);
    if (!bestBox) return null;
    const n = [0, 0, 0];
    n[bestAxis] = bestAxis === 0 ? -Math.sign(dx) : bestAxis === 1 ? -Math.sign(dy) : -Math.sign(dz);
    return { dist: best, box: bestBox, nx: n[0], ny: n[1], nz: n[2], x: ox + dx * best, y: oy + dy * best, z: oz + dz * best };
  }

  // Distance a ray travels inside a given box starting from entry point.
  exitDistance(box, ox, oy, oz, dx, dy, dz) {
    const tx = dx > 0 ? (box.maxX - ox) / dx : (box.minX - ox) / dx;
    const ty = dy > 0 ? (box.maxY - oy) / dy : (box.minY - oy) / dy;
    const tz = dz > 0 ? (box.maxZ - oz) / dz : (box.minZ - oz) / dz;
    return Math.min(Math.abs(tx), Math.abs(ty), Math.abs(tz));
  }

  // ------- swept body --------
  // body: { pos:{x,y,z} (feet centre), vel:{x,y,z}, hx, hz, h, onGround, bounce, step, box(self), solidProps, pushes }
  _blocked(body, axis, delta) {
    const p = body.pos;
    const hits = this.overlaps(p.x - body.hx, p.y, p.z - body.hz, p.x + body.hx, p.y + body.h, p.z + body.hz,
      body.box, body.solidProps !== false, this._ov || (this._ov = []));
    if (!hits.length) return null;
    let hit = null;
    for (const b of hits) {
      if (axis === 0) {
        if (delta > 0) p.x = Math.min(p.x, b.minX - body.hx - EPS); else p.x = Math.max(p.x, b.maxX + body.hx + EPS);
      } else if (axis === 1) {
        if (delta > 0) p.y = Math.min(p.y, b.minY - body.h - EPS); else p.y = Math.max(p.y, b.maxY + EPS);
      } else {
        if (delta > 0) p.z = Math.min(p.z, b.minZ - body.hz - EPS); else p.z = Math.max(p.z, b.maxZ + body.hz + EPS);
      }
      hit = b;
    }
    return hit;
  }

  _sweep(body, axis, delta) {
    if (delta === 0) return null;
    if (axis === 0) body.pos.x += delta; else if (axis === 1) body.pos.y += delta; else body.pos.z += delta;
    return this._blocked(body, axis, delta);
  }

  _free(body, yOff) {
    const p = body.pos;
    return this.overlaps(p.x - body.hx, p.y + yOff, p.z - body.hz, p.x + body.hx, p.y + yOff + body.h, p.z + body.hz,
      body.box, body.solidProps !== false, this._ov2 || (this._ov2 = [])).length === 0;
  }

  moveBody(body, dt) {
    const v = body.vel;
    const maxD = Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)) * dt;
    const steps = Math.min(8, Math.max(1, Math.ceil(maxD / 0.25)));
    const h = dt / steps;
    let landed = false;
    body.hitWall = false;
    for (let s = 0; s < steps; s++) {
      // horizontal
      const sx = body.pos.x, sy = body.pos.y, sz = body.pos.z;
      let bx = this._sweep(body, 0, v.x * h);
      let bz = this._sweep(body, 2, v.z * h);
      if ((bx || bz) && body.step && body.onGround) {
        const ax = body.pos.x, az = body.pos.z;
        body.pos.x = sx; body.pos.y = sy; body.pos.z = sz;
        if (this._free(body, STEP_HEIGHT)) {
          body.pos.y += STEP_HEIGHT;
          const bx2 = this._sweep(body, 0, v.x * h), bz2 = this._sweep(body, 2, v.z * h);
          this._sweep(body, 1, -STEP_HEIGHT);
          const d1 = (ax - sx) ** 2 + (az - sz) ** 2, d2 = (body.pos.x - sx) ** 2 + (body.pos.z - sz) ** 2;
          if (d2 > d1 + 1e-6) { bx = bx2; bz = bz2; }
          else { body.pos.x = ax; body.pos.y = sy; body.pos.z = az; }
        } else { body.pos.x = ax; body.pos.z = az; }
      }
      if (bx) { this._contact(body, bx, 0); v.x = body.bounce ? -v.x * body.bounce : 0; body.hitWall = true; }
      if (bz) { this._contact(body, bz, 2); v.z = body.bounce ? -v.z * body.bounce : 0; body.hitWall = true; }
      // vertical
      const vy = v.y * h;
      const by = this._sweep(body, 1, vy);
      if (by) {
        if (vy < 0) {
          landed = true;
          body.impactSpeed = -v.y;
          if (body.bounce && v.y < -2.5) { v.y = -v.y * body.bounce; body.bounced = true; }
          else v.y = 0;
          if (by.prop && body.carry !== false) { body.pos.x += by.prop.vel.x * h; body.pos.z += by.prop.vel.z * h; }
        } else { v.y = Math.min(0, v.y); }
      }
    }
    if (!landed && v.y <= 0 && body.onGround) {
      // stay grounded when walking over tiny gaps
      if (!this._free(body, -0.02)) landed = true;
    }
    body.onGround = landed;
  }

  _contact(body, box, axis) {
    if (!box.prop || !body.pushes) return;
    const p = box.prop, v = body.vel;
    if (axis === 0) p.vel.x += (v.x * 1.1 - p.vel.x) * 0.5;
    else p.vel.z += (v.z * 1.1 - p.vel.z) * 0.5;
    p.spin += (Math.random() - 0.5) * 2;
    p.sleep = 0;
  }

  // ------- dynamic props (barrels, small crates) --------
  addProp(prop) {
    // prop: { pos, vel, hx, hy, hz, mass, mesh, surface }
    prop.box = new Box(0, 0, 0, 0, 0, 0, prop.surface || 'metal');
    prop.box.prop = prop;
    prop.body = { pos: prop.pos, vel: prop.vel, hx: prop.hx, hz: prop.hz, h: prop.hy * 2, onGround: false, bounce: 0.25, step: false, box: prop.box, pushes: false, carry: false };
    prop.spin = 0; prop.yaw = Math.random() * Math.PI * 2; prop.tilt = 0; prop.sleep = 0;
    this.props.push(prop);
    this._syncProp(prop);
    return prop;
  }

  _syncProp(p) {
    const b = p.box;
    b.minX = p.pos.x - p.hx; b.maxX = p.pos.x + p.hx;
    b.minY = p.pos.y; b.maxY = p.pos.y + p.hy * 2;
    b.minZ = p.pos.z - p.hz; b.maxZ = p.pos.z + p.hz;
  }

  updateProps(dt) {
    for (const p of this.props) {
      if (p.dead) continue;
      const v = p.vel;
      const moving = Math.abs(v.x) + Math.abs(v.y) + Math.abs(v.z) > 0.02 || !p.body.onGround;
      if (!moving) { p.sleep += dt; if (p.sleep > 0.5) { this._syncMesh(p, dt); continue; } } else p.sleep = 0;
      v.y -= GRAVITY * dt;
      this.moveBody(p.body, dt);
      if (p.body.onGround) {
        const f = Math.exp(-5 * dt);
        v.x *= f; v.z *= f;
        if (Math.abs(v.x) < 0.02) v.x = 0; if (Math.abs(v.z) < 0.02) v.z = 0;
        if (p.body.bounced && p.onBounce) { p.onBounce(p, p.body.impactSpeed); }
        p.body.bounced = false;
      }
      this._syncProp(p);
      this._syncMesh(p, dt);
    }
  }

  _syncMesh(p, dt) {
    p.yaw += p.spin * dt;
    p.spin *= Math.exp(-2 * dt);
    const hs = Math.hypot(p.vel.x, p.vel.z);
    p.tilt += ((p.body.onGround ? 0 : Math.min(0.3, hs * 0.05)) - p.tilt) * Math.min(1, dt * 5);
    if (p.mesh) {
      p.mesh.position.set(p.pos.x, p.pos.y + p.hy, p.pos.z);
      p.mesh.rotation.set(p.tilt, p.yaw, 0);
    }
  }

  impulseProp(p, ix, iy, iz) {
    p.vel.x += ix / p.mass; p.vel.y += iy / p.mass; p.vel.z += iz / p.mass;
    p.spin += (Math.random() - 0.5) * 6 * Math.min(1, Math.hypot(ix, iz) / p.mass);
    p.sleep = 0; p.body.onGround = false;
  }
}

// ray vs sphere; returns distance or -1
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return -1;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  if (d2 > r * r) return -1;
  return tca - Math.sqrt(r * r - d2);
}

// ray vs AABB given by centre-half extents; returns distance or -1
export function rayAABB(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ) {
  const ix = 1 / (dx || 1e-9), iy = 1 / (dy || 1e-9), iz = 1 / (dz || 1e-9);
  let t1 = (minX - ox) * ix, t2 = (maxX - ox) * ix;
  let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2);
  t1 = (minY - oy) * iy; t2 = (maxY - oy) * iy;
  tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
  t1 = (minZ - oz) * iz; t2 = (maxZ - oz) * iz;
  tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
  if (tmax < tmin || tmax < 0) return -1;
  return tmin < 0 ? 0 : tmin;
}

// segment vs sphere test for smoke occlusion
export function segmentHitsSphere(ax, ay, az, bx, by, bz, cx, cy, cz, r) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  let t = len2 > 0 ? ((cx - ax) * dx + (cy - ay) * dy + (cz - az) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const px = ax + dx * t - cx, py = ay + dy * t - cy, pz = az + dz * t - cz;
  return px * px + py * py + pz * pz < r * r;
}
