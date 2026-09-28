// Bot AI: perception (FOV, line of sight, smoke, flashes, hearing), objectives
// (bomb plant/defuse, site holds, rotations), path following and combat with human-like aim.
import * as THREE from 'three';

export const DIFFICULTY = [
  { name: 'Easy', react: [0.55, 0.95], turn: 4.5, aimErr: 0.11, errDecay: 1.3, head: 0.12, comp: 0.3, strafe: 0, fov: 1.15, spray: 0.4 },
  { name: 'Normal', react: [0.32, 0.55], turn: 7, aimErr: 0.07, errDecay: 2.2, head: 0.28, comp: 0.55, strafe: 0.5, fov: 1.3, spray: 0.6 },
  { name: 'Hard', react: [0.2, 0.34], turn: 10, aimErr: 0.045, errDecay: 3.2, head: 0.45, comp: 0.75, strafe: 0.8, fov: 1.4, spray: 0.8 },
  { name: 'Expert', react: [0.12, 0.22], turn: 15, aimErr: 0.028, errDecay: 4.5, head: 0.62, comp: 0.9, strafe: 1, fov: 1.5, spray: 1 },
];

const TAU = Math.PI * 2;
export const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
export const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const _v = new THREE.Vector3(), _e = new THREE.Vector3();

export class BotBrain {
  constructor(game, c, diff) {
    this.game = game; this.c = c; this.D = DIFFICULTY[diff];
    this.reset();
  }

  reset() {
    this.path = null; this.pathIdx = 0; this.goal = null; this.goalReached = false;
    this.target = null; this.visible = false; this.reactAt = 0; this.lastSeen = -99;
    this.errYaw = 0; this.errPitch = 0; this.aimHead = false;
    this.lastKnown = null; this.lastKnownT = -99;
    this.thinkT = Math.random() * 0.1; this.repathT = 0;
    this.strafeDir = 1; this.strafeT = 0; this.stuckT = 0; this.stuckRef = null; this.stuckCheck = 0;
    this.burst = 0; this.burstPause = 0;
    this.lookYaw = null; this.lookT = 0; this.waypoints = []; this.task = 'idle';
    this.startDelay = 0; this.holdSpot = null; this.holdLook = null;
    this.crouchT = 0;
    this.nadePlan = null; this.avert = null;
  }

  // ---------------- planning ----------------
  roundStart(plan) {
    this.reset();
    const g = this.game, c = this.c, map = g.map;
    this.startDelay = rnd(0.2, 1.4);
    if (c.team === 'T') {
      const site = map.sites[plan.site];
      const route = plan.routeFor(c);
      this.waypoints = route.map(p => ({ x: p.x + rnd(-1, 1), z: p.z + rnd(-1, 1) }));
      this.site = site;
      this.task = 'push';
      this.finalSpot = c.inv.bomb ? pick(site.plantSpots) : pick(site.holdT);
    } else {
      const role = plan.roleFor(c);
      this.site = role === 'mid' ? null : map.sites[role];
      if (role === 'mid') {
        this.holdSpot = pick(map.holdMidCT); this.holdLook = yawTo(0, 1);
        this.waypoints = [];
      } else {
        this.holdSpot = pick(this.site.holdCT);
        const ent = pick(this.site.entrances);
        this.holdLook = yawTo(ent.x - this.holdSpot.x, ent.z - this.holdSpot.z);
        this.waypoints = [...map.routes.CT[role]];
      }
      this.task = 'hold';
      this.finalSpot = this.holdSpot;
    }
    this.goal = this.waypoints.length ? this.waypoints.shift() : this.finalSpot;
  }

  onBombPlanted(bombPos) {
    const c = this.c;
    if (c.team === 'CT') { this.task = 'retake'; this.setGoal(bombPos.x + rnd(-0.5, 0.5), bombPos.z + rnd(-0.5, 0.5)); this.waypoints = []; }
    else if (!this.goalReached || this.task === 'push') {
      this.task = 'guard';
      const site = this.game.bomb.site;
      const spot = pick(site.holdT);
      this.waypoints = []; this.setGoal(spot.x, spot.z);
      const ent = pick(site.entrances); this.holdLook = yawTo(ent.x - spot.x, ent.z - spot.z);
    }
  }

  onBombDropped(pos) {
    if (this.c.team !== 'T') return;
    this.task = 'getbomb'; this.waypoints = []; this.setGoal(pos.x, pos.z);
  }

  setGoal(x, z) { this.goal = { x, z }; this.path = null; this.goalReached = false; }

  hear(pos, kind) {
    if (this.visible) return;
    this.lastKnown = pos.clone ? pos.clone() : new THREE.Vector3(pos.x, pos.y, pos.z);
    this.lastKnownT = this.game.time;
    if (kind === 'shot' || kind === 'hurt') this.lookT = 0;
  }

  // ---------------- perception ----------------
  perceive(time) {
    const g = this.game, c = this.c;
    if (c.flashT > 0.6) { this.visible = false; return; }
    const eye = c.eye(_e);
    let best = null, bestScore = 1e9;
    for (const e of g.combatants) {
      if (!e.alive || e.team === c.team) continue;
      const dx = e.pos.x - c.pos.x, dz = e.pos.z - c.pos.z, dist = Math.hypot(dx, dz);
      if (dist > 130) continue;
      const a = Math.abs(angDiff(yawTo(dx, dz), c.yaw));
      const inFov = a < this.D.fov || dist < 3 || (this.target === e && time - this.lastSeen < 1.5) || (c.lastAttacker === e && time - c.lastHurt < 1.5);
      if (!inFov) continue;
      if (!g.canSee(eye, e)) continue;
      const score = dist * (1 + a);
      if (score < bestScore) { bestScore = score; best = e; }
    }
    if (best) {
      const dist = best.pos.distanceTo(c.pos);
      if (best !== this.target || time - this.lastSeen > 1.2) {
        const r = rnd(this.D.react[0], this.D.react[1]) * (1 + Math.min(0.6, dist / 80)) * (c.flashT > 0 ? 2 : 1);
        this.reactAt = time + r;
        const e = this.D.aimErr * (0.6 + Math.random() * 0.8);
        const ang = Math.random() * TAU;
        this.errYaw = Math.cos(ang) * e * 1.4; this.errPitch = Math.sin(ang) * e * 0.8;
        this.aimHead = Math.random() < this.D.head;
        this.burst = 0; this.burstPause = 0;
      }
      this.target = best; this.visible = true; this.lastSeen = time;
      this.lastKnown = best.pos.clone(); this.lastKnownT = time;
      g.spot(best, c);
    } else {
      this.visible = false;
      if (this.target && (!this.target.alive || time - this.lastSeen > 3)) this.target = null;
    }
  }

  // ---------------- main update ----------------
  update(dt, time) {
    const c = this.c, g = this.game;
    c.triggerDown = false; c.useHeld = false; c.walking = false;
    if (!c.alive) return;
    this.thinkT -= dt;
    if (this.thinkT <= 0) { this.thinkT = 0.09 + Math.random() * 0.06; this.perceive(time); }
    if (g.frozen) { c.wish.set(0, 0, 0); this.turnTo(this.holdLook ?? c.yaw, 0, dt, 0.3); return; }
    if (this.target && !this.target.alive) { this.target = null; this.visible = false; }

    // grenade throw in progress
    if (this.nadePlan) {
      if (this.visible || !c.inv.nades[this.nadePlan.type] || time > this.nadePlan.until) { this.nadePlan = null; }
      else { this.throwStep(dt, time); return; }
    }

    // weapon housekeeping
    const w = c.wstate;
    if (c.slot === 3 || c.slot === 5 || c.slot === 4) { if (!c.action) c.switchTo(c.bestSlot(), time); }
    else if (w && w.clip === 0 && w.reserve === 0) { if (c.slot === 1 && c.inv.secondary) c.switchTo(2, time); }
    if (w && !this.visible && w.clip < c.def.mag * 0.4 && w.reserve > 0 && !c.reloadEnd) c.reload(time);

    if (this.avert && time < this.avert.until && !this.visible) {
      c.wish.set(0, 0, 0);
      this.turnTo(this.avert.yaw, 0, dt, 1.2);
    } else if (this.visible && this.target) this.combat(dt, time);
    else this.navigate(dt, time);

    // flashed: stumble and spray at last known position
    if (c.flashT > 0.6) {
      c.wish.set(Math.sin(time * 3 + c.id), 0, Math.cos(time * 2.3 + c.id));
      if (this.lastKnown && time - this.lastKnownT < 2 && Math.random() < 0.3) c.triggerDown = true;
    }
  }

  combat(dt, time) {
    const c = this.c, t = this.target, D = this.D;
    const eye = c.eye(_e);
    const aimY = this.aimHead ? t.pos.y + t.eyeH + 0.02 : t.pos.y + t.eyeH * 0.72;
    const dx = t.pos.x - eye.x, dz = t.pos.z - eye.z, dy = aimY - eye.y;
    const hd = Math.hypot(dx, dz), dist = Math.hypot(hd, dy);
    // lead slightly for moving targets at range
    const lead = Math.min(0.12, dist / 900);
    const ty = yawTo(dx + t.vel.x * lead, dz + t.vel.z * lead);
    const tp = Math.atan2(dy, hd);
    const k = Math.exp(-D.errDecay * dt);
    this.errYaw *= k; this.errPitch *= k;
    const desiredYaw = ty + this.errYaw;
    const desiredPitch = tp + this.errPitch - c.punchP * D.comp;
    this.turnTo(desiredYaw, desiredPitch, dt, 1);

    const d = c.def;
    // AWP scoping
    if (d.scope) { if (dist > 7 && !c.scope && time > c.nextFire - 0.1) c.scope = 1; }
    // knife / pistol fallback
    if (c.slot === 3 && c.bestSlot() !== 3) c.switchTo(c.bestSlot(), time);

    // shooting decision
    const errAng = Math.hypot(angDiff(c.yaw, ty), c.pitch + c.punchP - tp);
    const tol = Math.max(0.015, Math.atan2(this.aimHead ? 0.2 : 0.35, dist)) * (d.type === 'sniper' ? 0.6 : 1.4);
    if (time >= this.reactAt && errAng < tol + (dist < 8 ? 0.12 : 0)) {
      if (d.type === 'rifle' || d.type === 'smg') {
        const maxBurst = dist > 30 ? 3 : dist > 15 ? 6 : 30;
        if (this.burstPause > 0) this.burstPause -= dt;
        else {
          c.triggerDown = true;
          if (time - c.lastShot < 0.02) this.burst++;
          if (this.burst >= maxBurst * D.spray + 1) { this.burst = 0; this.burstPause = rnd(0.25, 0.5) * (dist > 30 ? 1.3 : 1); this.aimHead = Math.random() < D.head; }
        }
      } else if (d.type === 'sniper') {
        if (c.hspeed() < 1.2 && errAng < tol) c.triggerDown = true;
      } else {
        c.triggerDown = !c.triggerWas;
      }
    }
    if (d.type === 'melee') { c.triggerDown = dist < 2; }

    // movement: strafe / counter-strafe / crouch-spray
    const right = { x: Math.cos(c.yaw), z: -Math.sin(c.yaw) };
    this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafeDir = Math.random() < 0.5 ? -1 : 1; this.strafeT = rnd(0.25, 0.8); this.crouchT = Math.random() < D.spray * 0.35 && dist > 12 ? rnd(0.6, 1.4) : 0; }
    let mx = 0, mz = 0;
    if (Math.random() < D.strafe && !(d.type === 'sniper')) {
      const standStill = c.triggerDown && dist > 20 && D.strafe > 0.6;
      if (!standStill) { mx = right.x * this.strafeDir; mz = right.z * this.strafeDir; }
    }
    if (d.type === 'melee' || (dist > 45 && this.c.team === 'T' && !this.game.bomb.planted && Math.random() < 0.02)) { mx += dx / hd; mz += dz / hd; }
    if (dist < 2.5) { mx -= dx / hd * 0.5; mz -= dz / hd * 0.5; }
    c.wish.set(mx, 0, mz);
    if (this.crouchT > 0) { this.crouchT -= dt; c.wantCrouch = true; } else c.wantCrouch = false;
  }

  navigate(dt, time) {
    const c = this.c, g = this.game;
    c.wantCrouch = false;
    if (this.startDelay > 0) { this.startDelay -= dt; c.wish.set(0, 0, 0); return; }
    // objective handling at destination
    if (this.goalReached) {
      c.wish.set(0, 0, 0);
      if (this.task === 'push' && c.inv.bomb && g.inSite(c.pos)) {
        if (c.slot !== 5) c.switchTo(5, time);
        c.useHeld = true;
        if (!c.action) g.tryPlant(c);
        this.turnTo(c.yaw, -0.6, dt, 0.5);
        return;
      }
      if (this.task === 'retake' && g.bomb.planted && !g.bomb.defused) {
        const d = Math.hypot(g.bomb.pos.x - c.pos.x, g.bomb.pos.z - c.pos.z);
        if (d < 1.6) {
          c.useHeld = true; c.wantCrouch = true;
          if (!c.action) g.tryDefuse(c);
          return;
        }
        this.setGoal(g.bomb.pos.x, g.bomb.pos.z);
      }
      if (this.task === 'getbomb' && !g.bomb.carrier && g.bomb.dropped) this.setGoal(g.bomb.pos.x, g.bomb.pos.z);
      if (this.task === 'push' && !c.inv.bomb) { this.task = 'hold'; }
      // idle hold: look around, react to sounds
      this.lookT -= dt;
      if (this.lastKnown && time - this.lastKnownT < 6) {
        _v.subVectors(this.lastKnown, c.pos);
        this.turnTo(yawTo(_v.x, _v.z), 0, dt, 0.6);
        const kd = Math.hypot(_v.x, _v.z);
        if (time - this.lastKnownT < 2 && kd > 12 && kd < 35 && c.inv.nades.he && Math.random() < 0.01) this.planThrow('he', this.lastKnown.x, this.lastKnown.z, time);
        if (time - this.lastKnownT > 2.5 && this.task !== 'retake' && Math.random() < 0.004 && g.roundTimeLeft() > 20) {
          this.task = 'hunt'; this.setGoal(this.lastKnown.x, this.lastKnown.z);
        }
      } else {
        if (this.lookT <= 0) { this.lookT = rnd(1.5, 4); this.lookYaw = (this.holdLook ?? c.yaw) + rnd(-0.6, 0.6); }
        this.turnTo(this.lookYaw ?? c.yaw, 0, dt, 0.35);
      }
      // late round: Ts that haven't planted go for the site; CTs hunt when Ts are few
      if (c.team === 'T' && !g.bomb.planted && g.roundTimeLeft() < 35 && this.task !== 'push') {
        const spot = pick(g.bombTargetSite().plantSpots); this.task = 'push'; this.setGoal(spot.x, spot.z);
      }
      if (this.task === 'hunt' || (c.team === 'CT' && g.aliveCount('T') <= 1 && !g.bomb.planted && g.roundTimeLeft() < 60 && Math.random() < 0.003)) {
        const e = g.randomEnemy(c);
        if (e) { this.task = 'hunt'; this.setGoal(e.pos.x + rnd(-6, 6), e.pos.z + rnd(-6, 6)); }
      }
      return;
    }
    if (!this.goal) { this.goalReached = true; return; }
    // path
    this.repathT -= dt;
    if (!this.path || this.repathT <= 0) {
      this.path = g.nav.findPath(c.pos.x, c.pos.z, this.goal.x, this.goal.z);
      this.pathIdx = 0; this.repathT = 4 + Math.random() * 2;
      if (!this.path) { this.goalReached = true; return; }
    }
    let wp = this.path[this.pathIdx];
    let dx = wp.x - c.pos.x, dz = wp.z - c.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.9) {
      this.pathIdx++;
      if (this.pathIdx >= this.path.length) {
        if (this.waypoints.length) {
          this.goal = this.waypoints.shift(); this.path = null;
          // entering the site: soften it up with utility
          if (!this.waypoints.length && this.task === 'push' && this.site && Math.random() < 0.7) {
            const s = this.site.center, type = ['he', 'flash', 'smoke'].find(t => c.inv.nades[t] > 0);
            if (type) this.planThrow(type, s.x + rnd(-4, 4), s.z + rnd(-4, 4), time);
          }
        }
        else if (this.goal !== this.finalSpot && this.finalSpot && (this.task === 'push' || this.task === 'hold')) { this.goal = this.finalSpot; this.path = null; }
        else this.goalReached = true;
        c.wish.set(0, 0, 0);
        return;
      }
      wp = this.path[this.pathIdx]; dx = wp.x - c.pos.x; dz = wp.z - c.pos.z; d = Math.hypot(dx, dz);
    }
    c.wish.set(dx / d, 0, dz / d);
    // be quiet when close to objective as CT holding or T approaching
    c.walking = this.task === 'hold' && d < 6 && !this.path[this.pathIdx + 1];
    // look where we go, or towards recent threats
    let lookYaw = yawTo(dx, dz);
    if (this.lastKnown && time - this.lastKnownT < 3) { _v.subVectors(this.lastKnown, c.pos); lookYaw = yawTo(_v.x, _v.z); }
    this.turnTo(lookYaw, 0, dt, 0.5);
    // stuck handling
    this.stuckCheck -= dt;
    if (this.stuckCheck <= 0) {
      this.stuckCheck = 0.8;
      if (this.stuckRef && this.stuckRef.distanceTo(c.pos) < 0.4 && !g.frozen) {
        this.stuckT++;
        c.jumpBuffer = 0.15;
        c.wish.set(c.wish.x + rnd(-1, 1), 0, c.wish.z + rnd(-1, 1));
        if (this.stuckT > 2) { this.path = null; this.stuckT = 0; }
      } else this.stuckT = 0;
      this.stuckRef = (this.stuckRef || new THREE.Vector3()).copy(c.pos);
    }
  }

  planThrow(type, x, z, time) {
    if (this.nadePlan || !this.c.inv.nades[type]) return false;
    this.nadePlan = { type, x, z, until: time + 2.5 };
    return true;
  }

  throwStep(dt, time) {
    const c = this.c, p = this.nadePlan;
    c.wish.set(0, 0, 0);
    if (c.slot !== 4 || c.nadeSel !== p.type) { c.nadeSel = p.type; c.slot = 0; c.switchTo(4, time); return; }
    const dx = p.x - c.pos.x, dz = p.z - c.pos.z, d = Math.hypot(dx, dz);
    const yaw = yawTo(dx, dz), pitch = Math.min(0.75, 0.1 + d / 60);
    this.turnTo(yaw, pitch, dt, 1.3);
    if (Math.abs(angDiff(c.yaw, yaw)) < 0.06 && Math.abs(c.pitch - pitch) < 0.06 && time > c.drawEnd && time >= c.nextFire && !c.triggerWas) {
      c.triggerDown = true;
      if (p.type === 'flash') this.avert = { until: time + 1.9, yaw: yaw + Math.PI };
      this.nadePlan = null;
    }
  }

  turnTo(yaw, pitch, dt, speedMul) {
    const c = this.c;
    const max = this.D.turn * speedMul * dt;
    const dy = angDiff(yaw, c.yaw);
    c.yaw += Math.max(-max, Math.min(max, dy * Math.min(1, dt * 14)));
    const dp = pitch - c.pitch;
    c.pitch += Math.max(-max, Math.min(max, dp * Math.min(1, dt * 14)));
    c.pitch = Math.max(-1.4, Math.min(1.4, c.pitch));
  }
}
