// A player or bot in the match: GoldSrc-style movement, inventory, weapon handling and recoil.
import * as THREE from 'three';
import { WEAPONS } from './weapons.js';
import { GRAVITY } from './physics.js';

const U = 0.0254;
export const STAND_H = 1.83, CROUCH_H = 1.2, EYE_STAND = 1.64, EYE_CROUCH = 1.02;
const ACCEL = 5.5, AIRACCEL = 12, FRICTION = 4, STOPSPEED = 100 * U;
const JUMP_V = Math.sqrt(2 * GRAVITY * 45 * U);
const AIR_WISH_CAP = 30 * U;

const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3();

export class Combatant {
  constructor(game, { name, team, isBot, id }) {
    this.game = game; this.name = name; this.team = team; this.isBot = isBot; this.id = id;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.body = { pos: this.pos, vel: this.vel, hx: 0.4, hz: 0.4, h: STAND_H, onGround: false, bounce: 0, step: true, box: null, solidProps: true, pushes: true };
    this.yaw = 0; this.pitch = 0; this.punchP = 0; this.punchY = 0; this.sideDir = 1;
    this.hp = 100; this.armor = 0; this.helmet = false; this.defuser = false; this.money = 800; this.alive = false;
    this.kills = 0; this.deaths = 0; this.hs = 0; this.mvp = 0;
    this.inv = { primary: null, secondary: null, nades: { he: 0, flash: 0, smoke: 0 }, bomb: false };
    this.slot = 3; this.lastSlot = 3; this.nadeSel = 'he';
    this.nextFire = 0; this.reloadEnd = 0; this.drawEnd = 0; this.shotsFired = 0; this.lastShot = -10;
    this.triggerDown = false; this.triggerWas = false; this.useHeld = false;
    this.crouched = false; this.wantCrouch = false; this.eyeH = EYE_STAND;
    this.wish = new THREE.Vector3(); this.walking = false; this.jumpBuffer = 0;
    this.scope = 0; this.rescopeAt = 0; this.flashT = 0; this.flashMax = 0;
    this.model = null; this.action = null; this.stepAcc = 0; this.lastHurt = -10;
    this.lastAttacker = null;
    this.moneyEarnedRound = 0;
  }

  // ---------------- inventory ----------------
  get wid() {
    switch (this.slot) {
      case 1: return this.inv.primary ? this.inv.primary.id : 'knife';
      case 2: return this.inv.secondary ? this.inv.secondary.id : 'knife';
      case 4: return this.nadeSel;
      case 5: return 'c4';
      default: return 'knife';
    }
  }
  get def() { return WEAPONS[this.wid]; }
  get wstate() { return this.slot === 1 ? this.inv.primary : this.slot === 2 ? this.inv.secondary : null; }

  hasSlot(s) {
    if (s === 1) return !!this.inv.primary;
    if (s === 2) return !!this.inv.secondary;
    if (s === 3) return true;
    if (s === 4) return this.inv.nades.he + this.inv.nades.flash + this.inv.nades.smoke > 0;
    if (s === 5) return this.inv.bomb;
    return false;
  }
  bestSlot() { return this.inv.primary ? 1 : this.inv.secondary ? 2 : 3; }

  switchTo(s, time = this.game.time) {
    if (!this.hasSlot(s)) return false;
    if (s === 4 && this.slot === 4) {
      const order = ['he', 'flash', 'smoke'];
      let i = order.indexOf(this.nadeSel);
      for (let k = 1; k <= 3; k++) { const n = order[(i + k) % 3]; if (this.inv.nades[n] > 0) { this.nadeSel = n; break; } }
    } else if (s === 4) {
      if (this.inv.nades[this.nadeSel] <= 0) this.nadeSel = ['he', 'flash', 'smoke'].find(n => this.inv.nades[n] > 0);
    } else if (s === this.slot) return false;
    if (s !== this.slot) this.lastSlot = this.slot;
    this.slot = s;
    const d = this.def;
    this.drawEnd = time + (d.type === 'rifle' || d.type === 'sniper' ? 0.75 : d.type === 'melee' ? 0.4 : 0.55);
    this.reloadEnd = 0; this.scope = 0; this.shotsFired = 0; this.action = null;
    if (this.onSwitch) this.onSwitch();
    return true;
  }

  giveWeapon(id, clip, reserve) {
    const d = WEAPONS[id];
    const w = { id, clip: clip ?? d.mag, reserve: reserve ?? d.reserve };
    if (d.slot === 1) this.inv.primary = w; else if (d.slot === 2) this.inv.secondary = w;
    return w;
  }

  resetForMatch() {
    this.inv = { primary: null, secondary: null, nades: { he: 0, flash: 0, smoke: 0 }, bomb: false };
    this.armor = 0; this.helmet = false; this.defuser = false; this.money = 800;
    this.kills = 0; this.deaths = 0; this.hs = 0; this.mvp = 0;
  }

  spawn(x, z, yaw) {
    this.pos.set(x, 0.02, z); this.vel.set(0, 0, 0);
    this.yaw = yaw; this.pitch = 0; this.punchP = this.punchY = 0;
    this.hp = 100; this.alive = true; this.crouched = false; this.wantCrouch = false;
    this.body.h = STAND_H; this.eyeH = EYE_STAND; this.body.onGround = true;
    this.flashT = 0; this.action = null; this.scope = 0; this.reloadEnd = 0;
    if (!this.inv.secondary) this.giveWeapon(this.team === 'T' ? 'glock' : 'usp');
    else this.inv.secondary.reserve = Math.max(this.inv.secondary.reserve, WEAPONS[this.inv.secondary.id].reserve);
    if (this.inv.primary) this.inv.primary.reserve = Math.max(this.inv.primary.reserve, WEAPONS[this.inv.primary.id].reserve);
    this.slot = 0; this.switchTo(this.bestSlot(), 0);
    this.lastSlot = this.slot === 1 ? 2 : 3;
    this.drawEnd = 0; this.lastAttacker = null; this.moneyEarnedRound = 0;
    if (this.model) { this.model.reset(); this.model.root.visible = !this.hideModel; }
  }

  eye(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + this.eyeH, this.pos.z); }

  forward(out = new THREE.Vector3(), withPunch = true) {
    const p = this.pitch + (withPunch ? this.punchP : 0), y = this.yaw + (withPunch ? this.punchY : 0);
    return out.set(-Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));
  }

  hspeed() { return Math.hypot(this.vel.x, this.vel.z); }

  maxSpeed() {
    const d = this.def;
    let s = (this.scope && d.scopedSpeed) ? d.scopedSpeed : d.speed;
    if (this.walking) s *= 0.52;
    if (this.crouched) s *= 0.34;
    return s;
  }

  currentSpread() {
    const d = this.def;
    if (!d.spread) return 0;
    let s = d.spread;
    if (d.type === 'sniper' && this.scope) s = d.spreadScoped;
    const ratio = Math.min(1.2, this.hspeed() / d.speed);
    if (!this.body.onGround) s += d.spreadAir;
    else if (ratio > 0.34) s += d.spreadMove * (ratio - 0.2);
    else if (d.type === 'sniper' && !this.scope) s += 0;
    if (this.crouched && this.body.onGround) s *= 0.75;
    s += Math.min(this.shotsFired, 12) * (d.spreadShot || 0);
    return s;
  }

  // ---------------- movement ----------------
  _free(y, h) {
    const p = this.pos;
    return this.game.physics.overlaps(p.x - 0.4, y, p.z - 0.4, p.x + 0.4, y + h, p.z + 0.4, null, true, this._ov || (this._ov = [])).length === 0;
  }

  updateMovement(dt) {
    const b = this.body, v = this.vel;
    const diff = STAND_H - CROUCH_H;
    if (this.wantCrouch && !this.crouched) {
      this.crouched = true; b.h = CROUCH_H;
      if (!b.onGround) { this.pos.y += diff; this.eyeH -= diff; }
    } else if (!this.wantCrouch && this.crouched) {
      if (b.onGround) { if (this._free(this.pos.y, STAND_H)) { this.crouched = false; b.h = STAND_H; } }
      else if (this._free(this.pos.y - diff, STAND_H)) { this.crouched = false; b.h = STAND_H; this.pos.y -= diff; this.eyeH += diff; }
      else if (this._free(this.pos.y, STAND_H)) { this.crouched = false; b.h = STAND_H; }
    }
    const eyeT = this.crouched ? EYE_CROUCH : EYE_STAND;
    this.eyeH += (eyeT - this.eyeH) * Math.min(1, dt * 12);

    const frozen = this.game.frozen || this.action;
    let wx = frozen ? 0 : this.wish.x, wz = frozen ? 0 : this.wish.z;
    const wl = Math.hypot(wx, wz);
    if (wl > 1e-4) { wx /= wl; wz /= wl; }
    const wishSpeed = wl > 1e-4 ? this.maxSpeed() : 0;

    if (this.jumpBuffer > 0) this.jumpBuffer -= dt;
    if (b.onGround) {
      if (this.jumpBuffer > 0 && !frozen) {
        v.y = JUMP_V; b.onGround = false; this.jumpBuffer = 0;
        if (this.onJump) this.onJump();
      } else {
        const sp = Math.hypot(v.x, v.z);
        if (sp > 0) {
          const control = Math.max(sp, STOPSPEED);
          const ns = Math.max(0, sp - control * FRICTION * dt) / sp;
          v.x *= ns; v.z *= ns;
        }
        this._accel(wx, wz, wishSpeed, ACCEL, dt);
      }
    }
    if (!b.onGround) {
      // air strafing
      const ws = Math.min(wishSpeed, AIR_WISH_CAP);
      const cur = v.x * wx + v.z * wz;
      const add = ws - cur;
      if (add > 0 && wishSpeed > 0) {
        const as = Math.min(AIRACCEL * wishSpeed * dt, add);
        v.x += as * wx; v.z += as * wz;
      }
    }
    v.y -= GRAVITY * dt;
    const wasGround = b.onGround, vyBefore = v.y;
    this.game.physics.moveBody(b, dt);
    if (!wasGround && b.onGround) {
      if (vyBefore < -6) this.game.onLand(this, -vyBefore);
      if (vyBefore < -11.5) this.game.applyDamage(this, null, (-vyBefore - 11.5) * 9, 'fall', null, null);
    }
    if (this.pos.y < -5) { this.pos.y = 0.1; v.y = 0; }
    // footsteps (running only, walking is silent)
    const hs = Math.hypot(v.x, v.z);
    if (b.onGround && hs > 2.6 && !this.walking && !this.crouched) {
      this.stepAcc += hs * dt;
      if (this.stepAcc > 2.1) { this.stepAcc = 0; this.game.onFootstep(this); }
    }
  }

  _accel(wx, wz, wishSpeed, accel, dt) {
    const v = this.vel;
    const cur = v.x * wx + v.z * wz;
    const add = wishSpeed - cur;
    if (add <= 0) return;
    const as = Math.min(accel * dt * wishSpeed, add);
    v.x += as * wx; v.z += as * wz;
  }

  // ---------------- weapons ----------------
  reload(time) {
    const d = this.def, w = this.wstate;
    if (!w || this.reloadEnd || w.clip >= d.mag || w.reserve <= 0 || time < this.drawEnd) return false;
    this.reloadEnd = time + (d.shellReload ? d.reload + 0.25 : d.reload);
    this.scope = 0;
    this.game.onReload(this);
    return true;
  }

  updateWeapon(dt, time) {
    const d = this.def, w = this.wstate;
    if (this.reloadEnd && time >= this.reloadEnd) {
      if (w) {
        if (d.shellReload) {
          w.clip++; w.reserve--;
          this.game.onShellLoaded(this);
          if (w.clip < d.mag && w.reserve > 0) this.reloadEnd = time + d.reload; else this.reloadEnd = 0;
        } else {
          const need = d.mag - w.clip, take = Math.min(need, w.reserve);
          w.clip += take; w.reserve -= take; this.reloadEnd = 0;
        }
      } else this.reloadEnd = 0;
    }
    const rec = d.type === 'pistol' ? 9 : d.type === 'sniper' ? 5 : 6.5;
    const k = Math.exp(-dt * rec);
    this.punchP *= k; this.punchY *= k;
    if (time - this.lastShot > Math.max(0.25, (d.rate || 0.1) * 2.2)) this.shotsFired = Math.max(0, this.shotsFired - dt * 18);
    if (this.rescopeAt && time >= this.rescopeAt) { this.rescopeAt = 0; if (this.def.scope && !this.reloadEnd) this.scope = this.pendingScope || 1; }
    if (this.triggerDown) this.tryFire(time);
    this.triggerWas = this.triggerDown;
  }

  tryFire(time) {
    if (!this.alive || this.game.frozen || time < this.nextFire || time < this.drawEnd || this.action) return;
    const d = this.def;
    if (d.type === 'melee') { this.nextFire = time + d.rate; this.game.knifeAttack(this); return; }
    if (d.type === 'grenade') {
      if (this.triggerWas) return;
      this.nextFire = time + 1.0;
      this.game.throwGrenade(this, this.nadeSel);
      return;
    }
    if (d.type === 'c4') { this.game.tryPlant(this); return; }
    const w = this.wstate; if (!w) return;
    if (!d.auto && this.triggerWas) return;
    if (this.reloadEnd) { if (d.shellReload && w.clip > 0) this.reloadEnd = 0; else return; }
    if (w.clip <= 0) {
      if (!this.triggerWas) this.game.onEmpty(this);
      this.nextFire = time + 0.25;
      if (w.reserve > 0) this.reload(time);
      return;
    }
    w.clip--;
    this.nextFire = time + d.rate;
    this.lastShot = time;
    const spread = this.currentSpread();
    this.forward(_fwd);
    _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    _up.crossVectors(_right, _fwd).normalize();
    const pellets = d.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      const a = Math.random() * Math.PI * 2, r = spread * (pellets > 1 ? Math.sqrt(Math.random()) : Math.random());
      const dir = _fwd.clone().addScaledVector(_right, Math.cos(a) * r).addScaledVector(_up, Math.sin(a) * r).normalize();
      this.game.fireBullet(this, dir, d, i === 0);
    }
    // recoil
    const kick = Math.min(d.kickMax, d.kick + d.kickInc * this.shotsFired) * (this.crouched ? 0.8 : 1) * (this.body.onGround ? 1 : 1.6);
    this.punchP = Math.min(this.punchP + kick, THREE.MathUtils.degToRad(8.5));
    const sideAfter = d.sideAfter ?? 1;
    if (this.shotsFired > sideAfter) {
      if (Math.random() < 0.12) this.sideDir *= -1;
      this.punchY += d.side * this.sideDir * (0.6 + Math.random() * 0.6);
    } else this.punchY += (Math.random() - 0.5) * d.side * 0.6;
    this.punchY = THREE.MathUtils.clamp(this.punchY, -0.07, 0.07);
    this.shotsFired++;
    if (d.scope && this.scope) { this.pendingScope = this.scope; this.scope = 0; this.rescopeAt = time + d.rate * 0.9; }
    this.game.onShot(this, d);
    if (w.clip === 0 && w.reserve > 0 && this.isBot) this.reload(time + 0.2);
  }

  update(dt, time) {
    if (!this.alive) return;
    if (this.flashT > 0) this.flashT = Math.max(0, this.flashT - dt);
    this.updateMovement(dt);
    this.updateWeapon(dt, time);
  }

  syncModel(dt) {
    if (!this.model) return;
    this.model.update(dt, { pos: this.pos, yaw: this.yaw, pitch: this.pitch, speed: this.hspeed(), crouch: this.crouched, onGround: this.body.onGround });
    const id = this.alive ? this.wid : null;
    if (this.alive) this.model.setWeapon(id === 'c4' ? 'c4' : id);
  }
}
