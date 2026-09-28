// Procedural soldier model with walk / crouch / aim / death animation.
import * as THREE from 'three';
import { buildWeaponModel } from './weapons.js';

const geoCache = {};
const G = (key, make) => geoCache[key] || (geoCache[key] = make());

export class SoldierModel {
  constructor(team, mats) {
    this.team = team;
    this.mats = mats;
    const tm = mats.team[team];
    const root = this.root = new THREE.Group();
    root.rotation.order = 'YXZ';
    const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m; };

    const hips = this.hips = new THREE.Group(); hips.position.y = 0.95; root.add(hips);
    hips.add(mesh(G('pelvis', () => new THREE.BoxGeometry(0.34, 0.18, 0.2)), tm.pants, 0, 0.02, 0));

    // legs
    this.legs = [];
    for (const s of [-1, 1]) {
      const thigh = new THREE.Group(); thigh.position.set(s * 0.1, -0.02, 0); hips.add(thigh);
      thigh.add(mesh(G('thigh', () => new THREE.CapsuleGeometry(0.075, 0.3, 4, 10)), tm.pants, 0, -0.22, 0));
      const knee = new THREE.Group(); knee.position.y = -0.45; thigh.add(knee);
      knee.add(mesh(G('shin', () => new THREE.CapsuleGeometry(0.062, 0.32, 4, 10)), tm.pants, 0, -0.21, 0));
      knee.add(mesh(G('boot', () => new THREE.BoxGeometry(0.11, 0.1, 0.25)), mats.glove, 0, -0.44, -0.05));
      knee.add(mesh(G('kneepad', () => new THREE.BoxGeometry(0.1, 0.1, 0.05)), tm.vest, 0, 0, -0.065));
      this.legs.push({ thigh, knee });
    }

    // spine / torso
    const spine = this.spine = new THREE.Group(); spine.position.y = 0.08; hips.add(spine);
    spine.add(mesh(G('torso', () => new THREE.BoxGeometry(0.4, 0.5, 0.23)), tm.shirt, 0, 0.26, 0));
    spine.add(mesh(G('vest', () => new THREE.BoxGeometry(0.42, 0.38, 0.27)), tm.vest, 0, 0.26, 0));
    for (let k = 0; k < 3; k++) spine.add(mesh(G('pouch', () => new THREE.BoxGeometry(0.08, 0.1, 0.05)), tm.vest, -0.12 + k * 0.12, 0.16, -0.16));
    if (this.team === 'T') spine.add(mesh(G('pack', () => new THREE.BoxGeometry(0.3, 0.34, 0.14)), tm.accent, 0, 0.3, 0.19));
    else spine.add(mesh(G('radio', () => new THREE.BoxGeometry(0.16, 0.24, 0.1)), tm.vest, 0.06, 0.32, 0.17));

    // head
    const neck = this.neck = new THREE.Group(); neck.position.y = 0.55; spine.add(neck);
    neck.add(mesh(G('neck', () => new THREE.CylinderGeometry(0.055, 0.06, 0.08, 10)), mats.skin, 0, 0.02, 0));
    const head = this.head = mesh(G('head', () => new THREE.SphereGeometry(0.115, 18, 14)), this.team === 'T' ? tm.head : mats.skin, 0, 0.14, 0);
    head.scale.set(0.95, 1.08, 1.02);
    neck.add(head);
    if (this.team === 'CT') {
      const helmet = mesh(G('helmet', () => new THREE.SphereGeometry(0.135, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55)), tm.head, 0, 0.16, 0.005);
      neck.add(helmet);
      neck.add(mesh(G('goggles', () => new THREE.BoxGeometry(0.2, 0.05, 0.06)), mats.lens, 0, 0.19, -0.1));
      neck.add(mesh(G('jaw', () => new THREE.BoxGeometry(0.16, 0.05, 0.08)), tm.vest, 0, 0.05, -0.06));
    } else {
      neck.add(mesh(G('eyes', () => new THREE.BoxGeometry(0.16, 0.035, 0.03)), mats.skin, 0, 0.16, -0.1));
      neck.add(mesh(G('cap', () => new THREE.SphereGeometry(0.12, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.4)), tm.accent, 0, 0.17, 0));
    }

    // arms (posed to hold a rifle)
    this.arms = [];
    for (const s of [-1, 1]) {
      const sh = new THREE.Group(); sh.position.set(s * 0.25, 0.45, 0); spine.add(sh);
      sh.add(mesh(G('upperarm', () => new THREE.CapsuleGeometry(0.058, 0.2, 4, 10)), tm.sleeve, 0, -0.15, 0));
      const el = new THREE.Group(); el.position.y = -0.3; sh.add(el);
      el.add(mesh(G('forearm', () => new THREE.CapsuleGeometry(0.05, 0.2, 4, 10)), tm.sleeve, 0, -0.14, 0));
      el.add(mesh(G('hand', () => new THREE.BoxGeometry(0.08, 0.1, 0.06)), mats.glove, 0, -0.3, 0));
      this.arms.push({ sh, el, s });
    }

    this.gunMount = new THREE.Group(); this.gunMount.position.set(0.1, 0.32, -0.3); spine.add(this.gunMount);
    this.gun = null; this.gunId = null;
    this.phase = Math.random() * 10;
    this.crouch = 0;
    this.dead = false; this.deathT = 0;
    this.flash = null;
  }

  setWeapon(id) {
    if (id === this.gunId) return;
    if (this.gun) this.gunMount.remove(this.gun);
    this.gunId = id;
    this.gun = id ? buildWeaponModel(id, this.mats) : null;
    if (this.gun) { this.gun.scale.setScalar(1.05); this.gunMount.add(this.gun); }
  }

  update(dt, s) {
    // s: { speed, crouch, pitch, yaw, onGround, walkRatio, pos }
    this.root.position.set(s.pos.x, s.pos.y, s.pos.z);
    if (this.dead) { this._death(dt); return; }
    this.root.rotation.set(0, s.yaw, 0);
    this.crouch += ((s.crouch ? 1 : 0) - this.crouch) * Math.min(1, dt * 12);
    const c = this.crouch;
    const spd = Math.min(1.2, s.speed / 5.5);
    this.phase += dt * (3 + spd * 7.5) * (spd > 0.05 ? 1 : 0);
    const sw = Math.sin(this.phase) * 0.65 * spd;
    this.hips.position.y = 0.95 - c * 0.38 + Math.abs(Math.cos(this.phase)) * 0.035 * spd;
    for (let i = 0; i < 2; i++) {
      const L = this.legs[i], sgn = i ? 1 : -1;
      const a = s.onGround ? sw * sgn : -0.5;
      L.thigh.rotation.x = -a - c * 1.25;
      L.knee.rotation.x = Math.max(0, (s.onGround ? Math.sin(this.phase + (i ? Math.PI : 0) + 1.2) : 0.8)) * 0.9 * spd + c * 2.0 + (s.onGround ? 0 : 0.6);
    }
    const pitch = s.pitch;
    this.spine.rotation.x = -pitch * 0.55 + c * 0.25;
    this.neck.rotation.x = -pitch * 0.35 - c * 0.2;
    // right arm grips pistol grip, left arm handguard
    const R = this.arms[1], Lf = this.arms[0];
    R.sh.rotation.set(-1.05, 0, -0.1); R.el.rotation.set(-0.85, 0, 0);
    Lf.sh.rotation.set(-1.35, 0, 0.55); Lf.el.rotation.set(-0.35, 0.3, 0);
    this.gunMount.rotation.x = -pitch * 0.1;
    if (this.flash) { this.flash.t -= dt; if (this.flash.t <= 0) { this.flash.mesh.visible = false; } }
  }

  die(dirX, dirZ, headshot) {
    this.dead = true; this.deathT = 0;
    this.fallAxis = Math.random() < 0.5 ? 'x' : 'z';
    const fwdX = -Math.sin(this.root.rotation.y), fwdZ = -Math.cos(this.root.rotation.y);
    // fall away from the shot direction
    const dot = dirX * fwdX + dirZ * fwdZ;
    this.fallSign = dot > 0 ? -1 : 1;
    this.fallVel = headshot ? 3.2 : 1.8;
    this.fallAngle = 0;
    this.slide = { x: dirX * 1.6, z: dirZ * 1.6 };
    this.slideOff = { x: 0, z: 0 };
  }

  _death(dt) {
    this.deathT += dt;
    if (this.fallAngle < Math.PI / 2) {
      this.fallVel += 9 * dt;
      this.fallAngle = Math.min(Math.PI / 2, this.fallAngle + this.fallVel * dt);
    }
    this.slideOff.x += this.slide.x * dt; this.slideOff.z += this.slide.z * dt;
    this.slide.x *= Math.exp(-dt * 5); this.slide.z *= Math.exp(-dt * 5);
    this.root.position.x += this.slideOff.x; this.root.position.z += this.slideOff.z;
    this.root.rotation.x = this.fallAngle * this.fallSign;
    const k = Math.min(1, this.deathT * 2.5);
    this.hips.position.y = 0.95 - k * 0.7;
    for (const L of this.legs) { L.thigh.rotation.x += (-0.2 - L.thigh.rotation.x) * k * 0.2; L.knee.rotation.x += (0.3 - L.knee.rotation.x) * k * 0.2; }
    for (const A of this.arms) { A.sh.rotation.x += (-2.6 * A.s * 0.3 - 1.4 - A.sh.rotation.x) * k * 0.1; A.sh.rotation.z += (A.s * 1.1 - A.sh.rotation.z) * k * 0.1; }
    this.spine.rotation.x += (0 - this.spine.rotation.x) * k * 0.2;
  }

  reset() {
    this.dead = false; this.deathT = 0; this.root.rotation.set(0, 0, 0);
  }
}
