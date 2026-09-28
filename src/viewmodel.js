// First-person weapon + arms with bob, sway, recoil, draw, reload, knife and throw animations.
import * as THREE from 'three';
import { buildWeaponModel } from './weapons.js';

const HOLD = {
  rifle: { pos: [0.15, -0.175, -0.4], grip: [0, -0.08, 0.08], fore: [0, -0.025, -0.27] },
  smg: { pos: [0.14, -0.17, -0.37], grip: [0, -0.07, 0.08], fore: [0, -0.02, -0.24] },
  shotgun: { pos: [0.15, -0.175, -0.38], grip: [0, -0.08, 0.1], fore: [0, -0.03, -0.28] },
  sniper: { pos: [0.15, -0.18, -0.42], grip: [0, -0.08, 0.12], fore: [0, -0.03, -0.28] },
  pistol: { pos: [0.12, -0.14, -0.36], grip: [0, -0.06, 0.02], fore: [-0.01, -0.07, 0.03] },
  melee: { pos: [0.14, -0.15, -0.3], grip: [0, 0, 0.04], fore: null },
  grenade: { pos: [0.13, -0.15, -0.3], grip: [0, -0.02, 0.02], fore: null },
  c4: { pos: [0.02, -0.2, -0.36], grip: [0.08, -0.02, 0.03], fore: [-0.08, -0.02, 0.03] },
};

function limb(a, b, r, mat) {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.01, len - r * 2), 4, 10), mat);
  m.position.copy(a).lerp(b, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

export class ViewModel {
  constructor(engine, mats, flareTex) {
    this.engine = engine; this.mats = mats;
    this.root = new THREE.Group();
    engine.vmCamera.add(this.root);
    this.holder = new THREE.Group(); this.root.add(this.holder);
    this.gun = null; this.id = null; this.team = 'CT';
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flareTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.visible = false; this.flash.scale.setScalar(0.18);
    this.flashLight = new THREE.PointLight(0xffa850, 0, 2, 2);
    engine.vmScene.add(this.flashLight);
    this.flashT = 0;
    this.kickZ = 0; this.kickR = 0; this.kickV = 0;
    this.bobPhase = 0; this.bobAmp = 0;
    this.swayX = 0; this.swayY = 0;
    this.meleeT = 0; this.throwT = 0; this.landT = 0;
  }

  setWeapon(id, team) {
    if (id === this.id && team === this.team) return;
    this.id = id; this.team = team;
    this.holder.clear();
    if (!id) { this.gun = null; return; }
    const gun = buildWeaponModel(id, this.mats);
    gun.traverse(o => { if (o.isMesh) o.castShadow = false; });
    const type = gun.userData.type = ({ ak47: 'rifle', m4a1: 'rifle', awp: 'sniper', mp5: 'smg', m3: 'shotgun', deagle: 'pistol', glock: 'pistol', usp: 'pistol', knife: 'melee', he: 'grenade', flash: 'grenade', smoke: 'grenade', c4: 'c4' })[id];
    const H = HOLD[type];
    this.holder.position.set(...H.pos);
    this.holder.rotation.set(0, 0.035, 0);
    this.holder.add(gun);
    // arms
    const sleeve = this.mats.team[team].sleeve, glove = this.mats.glove;
    const gp = new THREE.Vector3(...H.grip);
    // forearms run from the hands down/back toward the bottom edge of the screen
    const rightElbow = new THREE.Vector3(0.09, -0.19, 0.2);
    const rh = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.085), glove); rh.position.copy(gp); gun.add(rh);
    gun.add(limb(gp.clone().add(new THREE.Vector3(0.008, -0.02, 0.035)), rightElbow, 0.033, sleeve));
    gun.add(limb(rightElbow, new THREE.Vector3(0.16, -0.32, 0.36), 0.042, sleeve));
    if (H.fore) {
      const fp = new THREE.Vector3(...H.fore);
      const lh = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.055, 0.095), glove); lh.position.copy(fp).add(new THREE.Vector3(-0.012, -0.018, 0)); gun.add(lh);
      const le = new THREE.Vector3(-0.13, -0.17, Math.min(0.12, fp.z + 0.2));
      gun.add(limb(fp.clone().add(new THREE.Vector3(-0.02, -0.03, 0.03)), le, 0.032, sleeve));
      gun.add(limb(le, new THREE.Vector3(-0.2, -0.33, le.z + 0.2), 0.042, sleeve));
    }
    gun.add(this.flash);
    this.flash.position.copy(gun.userData.muzzle);
    this.gun = gun;
    this.type = type;
  }

  fire(strength = 1) {
    this.kickV += 1.0 * strength;
    this.kickR += 0.05 * strength;
    if (this.type !== 'melee' && this.type !== 'grenade') {
      this.flashT = 0.045;
      this.flash.visible = true;
      this.flash.material.rotation = Math.random() * 6.28;
      this.flash.scale.setScalar((this.type === 'sniper' || this.type === 'shotgun' ? 0.3 : 0.2) * (0.8 + Math.random() * 0.4));
    }
  }
  melee() { this.meleeT = 0.35; }
  throwAnim() { this.throwT = 0.45; }
  land(v) { this.landT = Math.min(1, v / 10); }

  muzzleWorld(out) {
    // approximate muzzle position projected into the world camera
    return out;
  }

  update(dt, s) {
    // s: { speed, onGround, crouch, mouseDX, mouseDY, drawFrac, reloadFrac, visible, time }
    this.root.visible = s.visible && !!this.gun;
    if (!this.gun) return;
    const g = this.gun;
    // recoil spring
    this.kickZ += this.kickV * dt; this.kickV -= this.kickZ * 260 * dt; this.kickV *= Math.exp(-dt * 22);
    this.kickR *= Math.exp(-dt * 12);
    // bob
    const moving = s.onGround ? Math.min(1, s.speed / 5.5) : 0;
    this.bobAmp += (moving - this.bobAmp) * Math.min(1, dt * 8);
    this.bobPhase += dt * (4 + s.speed * 1.3);
    const bx = Math.sin(this.bobPhase) * 0.012 * this.bobAmp, by = -Math.abs(Math.cos(this.bobPhase)) * 0.011 * this.bobAmp;
    // sway
    this.swayX += (-s.mouseDX * 0.00018 - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (s.mouseDY * 0.00018 - this.swayY) * Math.min(1, dt * 10);
    this.swayX = THREE.MathUtils.clamp(this.swayX, -0.03, 0.03); this.swayY = THREE.MathUtils.clamp(this.swayY, -0.03, 0.03);
    this.landT = Math.max(0, this.landT - dt * 3);
    const idle = Math.sin(s.time * 1.6) * 0.002;
    let px = bx + this.swayX, py = by + this.swayY + idle - this.landT * 0.03 - (s.crouch ? 0.01 : 0), pz = this.kickZ * 0.05;
    let rx = this.kickR + this.swayY * 2, ry = this.swayX * 2, rz = bx * 1.5;
    // draw
    const df = s.drawFrac;
    if (df < 1) { const k = (1 - df) ** 2; py -= 0.22 * k; rx -= 0.9 * k; }
    // reload
    const mag = g.userData.mag;
    if (s.reloadFrac > 0 && s.reloadFrac < 1) {
      const f = s.reloadFrac, k = Math.sin(Math.min(1, f * 1.1) * Math.PI);
      if (this.type === 'shotgun') { rz += 0.25 * k; py -= 0.03 * k; rx += 0.1 * Math.sin(f * Math.PI * 6) * k; }
      else { rz += 0.55 * k; rx += 0.18 * k; py -= 0.05 * k; px -= 0.02 * k; }
      if (mag && this.type !== 'shotgun') {
        const out = f > 0.2 && f < 0.7 ? Math.min(1, (f - 0.2) * 6) * (f < 0.55 ? 1 : 1 - (f - 0.55) / 0.15) : 0;
        mag.position.copy(g.userData.magHome).add(new THREE.Vector3(0, -0.22 * out, 0.03 * out));
        mag.visible = !(f > 0.35 && f < 0.5);
      }
    } else if (mag) { mag.position.copy(g.userData.magHome); mag.visible = true; }
    // knife swing
    if (this.meleeT > 0) {
      this.meleeT -= dt; const f = 1 - this.meleeT / 0.35, k = Math.sin(f * Math.PI);
      ry += 0.9 * k; rx -= 0.4 * k; px -= 0.08 * k; pz -= 0.08 * k;
    }
    if (this.throwT > 0) {
      this.throwT -= dt; const f = 1 - this.throwT / 0.45;
      const k = f < 0.4 ? f / 0.4 : 1 - (f - 0.4) / 0.6;
      py += 0.08 * k; rx -= 1.1 * (f < 0.4 ? k : -k * 0.5); pz += 0.05 * k;
    }
    g.position.set(px, py, pz);
    g.rotation.set(rx, ry, rz);
    // muzzle flash
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) this.flash.visible = false;
      this.flash.getWorldPosition(this.flashLight.position);
      this.flashLight.intensity = this.flashT > 0 ? 3 : 0;
    } else this.flashLight.intensity = 0;
  }
}
