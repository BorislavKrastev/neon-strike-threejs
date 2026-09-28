// Visual effects: particles, decals, tracers, flashes, shell casings, explosions, smoke clouds.
import * as THREE from 'three';
import * as TX from './textures.js';

class Particles {
  constructor(max, tex, additive) {
    this.max = max; this.n = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.alpha = new Float32Array(max); this.size = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, scale: { value: 800 } },
      vertexShader: `attribute float alpha; attribute float size; attribute vec3 color; varying float vA; varying vec3 vC; uniform float scale;
        void main(){ vA = alpha; vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = min(512.0, size * scale / max(0.1, -mv.z)); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying float vA; varying vec3 vC;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC * t.rgb, t.a * vA); }`,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
    this.p = [];
    for (let i = 0; i < max; i++) this.p.push({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 0, grow: 0, r: 1, g: 1, b: 1, a: 1, grav: 0, drag: 0 });
    this.cursor = 0;
  }
  spawn(x, y, z, vx, vy, vz, life, size, r, g, b, a = 1, grav = 0, drag = 0, grow = 0) {
    const p = this.p[this.cursor]; this.cursor = (this.cursor + 1) % this.max;
    Object.assign(p, { life, max: life, x, y, z, vx, vy, vz, s: size, grow, r, g, b, a, grav, drag });
  }
  update(dt) {
    let n = 0;
    for (let i = 0; i < this.max; i++) {
      const p = this.p[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= p.grav * dt;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy *= d; p.vz *= d;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.01 && p.grav > 0) { p.y = 0.01; p.vy *= -0.3; p.vx *= 0.5; p.vz *= 0.5; }
      p.s += p.grow * dt;
      const t = p.life / p.max;
      this.pos[n * 3] = p.x; this.pos[n * 3 + 1] = p.y; this.pos[n * 3 + 2] = p.z;
      this.col[n * 3] = p.r; this.col[n * 3 + 1] = p.g; this.col[n * 3 + 2] = p.b;
      this.alpha[n] = p.a * Math.min(1, t * 2.5);
      this.size[n] = p.s;
      n++;
    }
    this.geo.setDrawRange(0, n);
    for (const k of ['position', 'color', 'alpha', 'size']) this.geo.attributes[k].needsUpdate = true;
  }
}

export class Effects {
  constructor(engine, physics) {
    this.engine = engine; this.scene = engine.scene; this.physics = physics;
    const soft = TX.softParticleTexture();
    this.smokeTex = TX.smokeTexture();
    this.flareTex = TX.flareTexture();
    this.dust = new Particles(900, this.smokeTex, false);
    this.sparks = new Particles(500, soft, true);
    this.scene.add(this.dust.points, this.sparks.points);

    // decals
    this.decalGeo = new THREE.PlaneGeometry(1, 1);
    const decalMat = (tex, extra = {}) => new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: 0.9, ...extra });
    this.decalMats = { hole: decalMat(TX.bulletHoleTexture()), blood: decalMat(TX.bloodTexture(), { roughness: 0.4 }), scorch: decalMat(TX.scorchTexture()) };
    this.decals = []; this.decalCursor = 0; this.maxDecals = 180;
    for (let i = 0; i < this.maxDecals; i++) {
      const m = new THREE.Mesh(this.decalGeo, this.decalMats.hole);
      m.visible = false; m.receiveShadow = true; m.matrixAutoUpdate = false;
      this.scene.add(m); this.decals.push(m);
    }

    // tracers
    this.tracers = [];
    const tg = new THREE.BoxGeometry(0.012, 0.012, 1); tg.translate(0, 0, 0.5);
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false; m.userData.t = 0; this.scene.add(m); this.tracers.push(m);
    }

    // muzzle flash sprites for third person
    this.flashSprites = [];
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flareTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.visible = false; s.userData.t = 0; this.scene.add(s); this.flashSprites.push(s);
    }
    // persistent dynamic lights (constant count keeps shaders stable)
    this.lights = [];
    for (let i = 0; i < 3; i++) {
      const L = new THREE.PointLight(0xffb060, 0, 9, 2);
      L.userData.t = 0; L.userData.max = 1; L.userData.base = 0;
      this.scene.add(L); this.lights.push(L);
    }
    this.lightCursor = 0;

    // shell casings
    this.shells = [];
    const sg = new THREE.CylinderGeometry(0.005, 0.005, 0.03, 6); sg.rotateZ(Math.PI / 2);
    const brass = new THREE.MeshStandardMaterial({ color: 0xc9a045, metalness: 1, roughness: 0.3 });
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(sg, brass); m.visible = false; this.scene.add(m);
      this.shells.push({ m, vx: 0, vy: 0, vz: 0, t: 0, bounced: 0 });
    }
    this.shellCursor = 0;

    // smoke / fire sprites
    this.clouds = [];
    this.cloudCursor = 0;
    for (let i = 0; i < 140; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex, transparent: true, depthWrite: false, color: 0xcfcfcf }));
      s.visible = false; s.userData = { t: 0 };
      this.scene.add(s); this.clouds.push(s);
    }

    // ambient dust motes
    const motes = new THREE.BufferGeometry(), N = 500, mp = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { mp[i * 3] = (Math.random() - 0.5) * 40; mp[i * 3 + 1] = Math.random() * 6; mp[i * 3 + 2] = (Math.random() - 0.5) * 40; }
    motes.setAttribute('position', new THREE.BufferAttribute(mp, 3));
    this.motes = new THREE.Points(motes, new THREE.PointsMaterial({ size: 0.035, map: soft, color: 0xfff0d0, transparent: true, opacity: 0.55, depthWrite: false }));
    this.motes.frustumCulled = false;
    this.scene.add(this.motes);
    this.moteT = 0;

    this.shake = 0;
  }

  light(x, y, z, color, intensity, dist, time) {
    const L = this.lights[this.lightCursor]; this.lightCursor = (this.lightCursor + 1) % this.lights.length;
    L.position.set(x, y, z); L.color.setHex(color); L.distance = dist;
    L.userData.base = intensity; L.userData.t = time; L.userData.max = time; L.intensity = intensity;
  }

  decal(kind, x, y, z, nx, ny, nz, size) {
    const m = this.decals[this.decalCursor]; this.decalCursor = (this.decalCursor + 1) % this.maxDecals;
    m.material = this.decalMats[kind];
    m.position.set(x + nx * 0.006, y + ny * 0.006, z + nz * 0.006);
    m.lookAt(x + nx, y + ny, z + nz);
    m.rotateZ(Math.random() * Math.PI * 2);
    m.scale.setScalar(size);
    m.visible = true; m.updateMatrix();
  }

  impact(surface, x, y, z, nx, ny, nz) {
    const r = Math.random;
    if (surface === 'metal') {
      for (let i = 0; i < 10; i++) this.sparks.spawn(x, y, z, nx * 3 + (r() - 0.5) * 6, ny * 3 + r() * 4, nz * 3 + (r() - 0.5) * 6, 0.25 + r() * 0.3, 0.05, 1, 0.75, 0.35, 1, 14, 1);
      this.dust.spawn(x, y, z, nx * 0.5, 0.3, nz * 0.5, 0.6, 0.15, 0.4, 0.4, 0.4, 0.4, 0, 1, 0.6);
    } else {
      const col = surface === 'wood' ? [0.45, 0.32, 0.2] : surface === 'sand' ? [0.78, 0.66, 0.48] : [0.72, 0.62, 0.48];
      for (let i = 0; i < 4; i++) this.dust.spawn(x, y, z, nx * (1 + r() * 2) + (r() - 0.5), ny * (1 + r() * 2) + r() * 0.8, nz * (1 + r() * 2) + (r() - 0.5), 0.6 + r() * 0.6, 0.12 + r() * 0.12, col[0], col[1], col[2], 0.75, 1.5, 2.5, 0.7);
      for (let i = 0; i < 6; i++) this.sparks.spawn(x, y, z, nx * 3 + (r() - 0.5) * 4, ny * 3 + r() * 3, nz * 3 + (r() - 0.5) * 4, 0.35 + r() * 0.3, 0.03, col[0] * 0.5, col[1] * 0.5, col[2] * 0.5, 1, 12, 0.5);
    }
    if (surface !== 'flesh') this.decal('hole', x, y, z, nx, ny, nz, 0.07 + Math.random() * 0.03);
  }

  blood(x, y, z, dx, dy, dz, heavy) {
    const r = Math.random;
    for (let i = 0; i < (heavy ? 14 : 7); i++)
      this.dust.spawn(x, y, z, dx * 2 + (r() - 0.5) * 2, dy * 2 + r() * 1.2, dz * 2 + (r() - 0.5) * 2, 0.4 + r() * 0.4, 0.08 + r() * 0.12, 0.45, 0.02, 0.02, 0.9, 6, 2, 0.5);
    // blood splat on the wall/floor behind the victim
    const hit = this.physics.raycast(x, y, z, dx, dy - 0.3, dz, 3, false);
    if (hit) this.decal('blood', hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, 0.5 + r() * 0.6);
  }

  tracer(x0, y0, z0, x1, y1, z1) {
    const t = this.tracers.find(m => !m.visible) || this.tracers[0];
    const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    if (len < 2) return;
    t.position.set(x0, y0, z0);
    t.lookAt(x1, y1, z1);
    t.userData = { t: 0, len, x0, y0, z0, dx: (x1 - x0) / len, dy: (y1 - y0) / len, dz: (z1 - z0) / len };
    t.scale.set(1, 1, Math.min(len, 6));
    t.visible = true;
  }

  muzzle(x, y, z, big = 1) {
    const s = this.flashSprites.find(m => !m.visible) || this.flashSprites[0];
    s.position.set(x, y, z); s.scale.setScalar(0.35 * big); s.material.rotation = Math.random() * 6.28;
    s.visible = true; s.userData.t = 0.05;
    this.light(x, y, z, 0xffa850, 3.5 * big, 7, 0.06);
    this.dust.spawn(x, y, z, 0, 0.3, 0, 0.5, 0.12, 0.6, 0.58, 0.55, 0.25, 0, 1, 0.6);
  }

  shell(x, y, z, vx, vy, vz) {
    const s = this.shells[this.shellCursor]; this.shellCursor = (this.shellCursor + 1) % this.shells.length;
    s.m.position.set(x, y, z); s.vx = vx; s.vy = vy; s.vz = vz; s.t = 2.5; s.bounced = 0; s.m.visible = true;
    s.m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    return s;
  }

  cloud(x, y, z, size, color, opacity, life, vx = 0, vy = 0, vz = 0, grow = 0, additive = false) {
    const s = this.clouds[this.cloudCursor]; this.cloudCursor = (this.cloudCursor + 1) % this.clouds.length;
    s.position.set(x, y, z); s.scale.setScalar(size);
    s.material.color.setHex(color); s.material.opacity = opacity; s.material.rotation = Math.random() * 6.28;
    s.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    s.material.map = additive ? this.flareTex : this.smokeTex;
    s.userData = { t: life, max: life, op: opacity, vx, vy, vz, grow, size };
    s.visible = true;
    return s;
  }

  explosion(x, y, z) {
    const r = Math.random;
    this.light(x, y + 1, z, 0xff9a40, 60, 26, 0.5);
    for (let i = 0; i < 10; i++) this.cloud(x + (r() - 0.5) * 1.5, y + 0.6 + r() * 1.5, z + (r() - 0.5) * 1.5, 2 + r() * 2, 0xffa050, 1, 0.35 + r() * 0.2, (r() - 0.5) * 4, 2 + r() * 3, (r() - 0.5) * 4, 7, true);
    for (let i = 0; i < 14; i++) this.cloud(x + (r() - 0.5) * 2, y + 0.8 + r() * 2, z + (r() - 0.5) * 2, 2.5 + r() * 2, 0x3a3530, 0.75, 2.5 + r() * 2, (r() - 0.5) * 3, 1 + r() * 2, (r() - 0.5) * 3, 1.8);
    for (let i = 0; i < 70; i++) {
      const a = r() * Math.PI * 2, e = r() * 1.2, sp = 8 + r() * 16;
      this.sparks.spawn(x, y + 0.3, z, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp + 2, Math.sin(a) * Math.cos(e) * sp, 0.6 + r() * 0.8, 0.06, 1, 0.6, 0.2, 1, 16, 0.6);
    }
    for (let i = 0; i < 30; i++) this.dust.spawn(x, y + 0.2, z, (r() - 0.5) * 12, r() * 9, (r() - 0.5) * 12, 1 + r(), 0.3 + r() * 0.3, 0.55, 0.47, 0.36, 0.8, 9, 1.5, 0.8);
    this.decal('scorch', x, 0.01, z, 0, 1, 0, 4.5);
  }

  smokeGrenade(x, y, z) {
    const puffs = [];
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2, d = Math.random() * 3.2;
      const s = this.cloud(x, y + 0.3, z, 1.2, 0xbfbcb5, 0.9, 17 + Math.random() * 2, Math.cos(a) * d * 0.5, 0.25 + Math.random() * 0.3, Math.sin(a) * d * 0.5, 0.9);
      s.userData.target = { x: x + Math.cos(a) * d, y: 0.8 + Math.random() * 2.4, z: z + Math.sin(a) * d };
      puffs.push(s);
    }
    return puffs;
  }

  update(dt, camera) {
    const h = this.engine.renderer.domElement.height;
    const scale = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    this.dust.mat.uniforms.scale.value = scale; this.sparks.mat.uniforms.scale.value = scale;
    this.dust.update(dt); this.sparks.update(dt);
    for (const t of this.tracers) {
      if (!t.visible) continue;
      const u = t.userData; u.t += dt;
      const d = u.t * 380;
      if (d > u.len) { t.visible = false; continue; }
      t.position.set(u.x0 + u.dx * d, u.y0 + u.dy * d, u.z0 + u.dz * d);
      t.scale.z = Math.min(6, u.len - d, 1 + d);
      t.material.opacity = 0.9;
    }
    for (const s of this.flashSprites) if (s.visible && (s.userData.t -= dt) <= 0) s.visible = false;
    for (const L of this.lights) {
      if (L.userData.t > 0) { L.userData.t -= dt; L.intensity = L.userData.base * Math.max(0, L.userData.t / L.userData.max); }
      else L.intensity = 0;
    }
    for (const s of this.shells) {
      if (!s.m.visible) continue;
      s.t -= dt; if (s.t <= 0) { s.m.visible = false; continue; }
      if (s.bounced < 3) {
        s.vy -= 20 * dt;
        s.m.position.x += s.vx * dt; s.m.position.y += s.vy * dt; s.m.position.z += s.vz * dt;
        s.m.rotation.x += dt * 20; s.m.rotation.y += dt * 13;
        if (s.m.position.y < 0.01) { s.m.position.y = 0.01; s.vy = -s.vy * 0.35; s.vx *= 0.5; s.vz *= 0.5; s.bounced++; if (this.onShellBounce && s.bounced === 1) this.onShellBounce(s.m.position); }
      }
    }
    for (const c of this.clouds) {
      if (!c.visible) continue;
      const u = c.userData; u.t -= dt;
      if (u.t <= 0) { c.visible = false; continue; }
      if (u.target) {
        c.position.x += (u.target.x - c.position.x) * Math.min(1, dt * 1.5);
        c.position.y += (u.target.y - c.position.y) * Math.min(1, dt * 1.2);
        c.position.z += (u.target.z - c.position.z) * Math.min(1, dt * 1.5);
        u.size = Math.min(4.2, u.size + dt * 3);
      } else {
        c.position.x += u.vx * dt; c.position.y += u.vy * dt; c.position.z += u.vz * dt;
        const dmp = Math.exp(-dt * 2); u.vx *= dmp; u.vy *= dmp; u.vz *= dmp;
        u.size += u.grow * dt;
      }
      c.scale.setScalar(u.size);
      const k = u.t / u.max;
      c.material.opacity = u.op * (u.target ? Math.min(1, k * 6) : k);
      c.material.rotation += dt * 0.1;
    }
    // motes follow the camera
    this.moteT += dt;
    const p = this.motes.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i) + Math.sin(this.moteT * 0.3 + i) * dt * 0.15 + dt * 0.12, y = p.getY(i) + Math.cos(this.moteT * 0.2 + i * 1.3) * dt * 0.08, z = p.getZ(i);
      const cx = camera.position.x, cz = camera.position.z;
      if (x - cx > 20) x -= 40; if (x - cx < -20) x += 40;
      if (z - cz > 20) z -= 40; if (z - cz < -20) z += 40;
      if (y > 7) y = 0.2; if (y < 0.1) y = 6.5;
      p.setXYZ(i, x, y, z);
    }
    p.needsUpdate = true;
    this.shake = Math.max(0, this.shake - dt * 2.5);
  }

  clearRound() {
    for (const d of this.decals) d.visible = false;
    for (const c of this.clouds) c.visible = false;
  }
}
