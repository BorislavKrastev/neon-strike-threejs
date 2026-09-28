// Match orchestration: rounds, economy, bomb, combat resolution, grenades, drops, camera.
import * as THREE from 'three';
import { PhysicsWorld, raySphere, rayAABB, segmentHitsSphere, GRAVITY } from './physics.js';
import { buildMap, P } from './map.js';
import { Effects } from './effects.js';
import { HUD } from './hud.js';
import { ViewModel } from './viewmodel.js';
import { Combatant } from './combatant.js';
import { SoldierModel } from './character.js';
import { BotBrain, angDiff, yawTo } from './bot.js';
import { PlayerControls } from './controls.js';
import { WEAPONS, EQUIPMENT, buildWeaponModel } from './weapons.js';

const FREEZE = 5, ROUND = 115, POST = 5.5, BUYTIME = 20, BOMB_TIMER = 40, MAXMONEY = 16000;
const BOT_NAMES = ['Viper', 'Ghost', 'Hawk', 'Nomad', 'Blaze', 'Rook', 'Wolf', 'Cobra', 'Raven', 'Titan', 'Jackal', 'Falcon', 'Mamba', 'Specter', 'Bishop', 'Sarge', 'Havoc', 'Onyx'];
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

export class Game {
  constructor(engine, audio) {
    this.engine = engine; this.audio = audio;
    this.scene = engine.scene;
    this.time = 0;
    this.phase = 'menu'; this.phaseT = 0;
    this.paused = true;
  }

  // ---------------- setup ----------------
  build(quality) {
    const mats = this.mats = this.engine.makeMaterials();
    this.physics = new PhysicsWorld();
    this.effects = new Effects(this.engine, this.physics);
    this.map = buildMap(this.scene, this.physics, mats, quality, this.effects);
    this.nav = this.map.nav;
    for (const p of this.map.props) {
      p.home = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
      p.onBounce = (prop, v) => { if (v > 3) this.audio.play(prop.kind === 'barrel' ? 'land' : 'knifehit', prop.pos, Math.min(1, v / 8), 0.7); };
    }
    this.effects.onShellBounce = pos => this.audio.play('shell', pos, 0.35, 1, { range: 6 });
    this.hud = new HUD(this);
    this.vm = new ViewModel(this.engine, mats, this.effects.flareTex);
    this.controls = new PlayerControls(this, this.engine.renderer.domElement);
    this.audio.occlusion = pos => {
      const e = this.viewEye();
      const dx = pos.x - e.x, dy = pos.y + 0.8 - e.y, dz = pos.z - e.z, d = Math.hypot(dx, dy, dz);
      return !!this.physics.raycast(e.x, e.y, e.z, dx / d, dy / d, dz / d, d - 0.5, false);
    };
    // bomb mesh
    this.bombMesh = buildWeaponModel('c4', mats);
    this.bombMesh.scale.setScalar(1.3);
    this.bombMesh.visible = false;
    this.scene.add(this.bombMesh);
    this.bombLight = new THREE.PointLight(0xff2010, 0, 3, 2);
    this.scene.add(this.bombLight);
    this.grenades = []; this.smokes = []; this.drops = [];
  }

  startMatch(opts) {
    // clean previous match
    if (this.combatants) for (const c of this.combatants) if (c.model) this.scene.remove(c.model.root);
    for (const d of this.drops || []) this.scene.remove(d.mesh);
    for (const g of this.grenades || []) this.scene.remove(g.mesh);
    this.drops = []; this.grenades = []; this.smokes = [];
    this.opts = opts;
    this.winRounds = opts.rounds;
    this.difficulty = opts.difficulty;
    const team = opts.team === 'auto' ? (Math.random() < 0.5 ? 'CT' : 'T') : opts.team;
    this.combatants = [];
    this.brains = new Map();
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    let id = 0;
    const player = this.player = new Combatant(this, { name: 'Player', team, isBot: false, id: id++ });
    player.hideModel = true;
    this.combatants.push(player);
    for (const t of ['CT', 'T']) {
      const n = opts.size - (t === team ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const c = new Combatant(this, { name: names.pop(), team: t, isBot: true, id: id++ });
        this.combatants.push(c);
        this.brains.set(c, new BotBrain(this, c, opts.difficulty));
      }
    }
    for (const c of this.combatants) {
      c.model = new SoldierModel(c.team, this.mats);
      this.scene.add(c.model.root);
      c.onJump = () => { if (c === player) this.audio.play('step1', null, 0.35); };
      c.onSwitch = () => { if (c === player) this.audio.play('pickup', null, 0.25, 1.4); };
    }
    this.score = { CT: 0, T: 0 };
    this.lossStreak = { CT: 0, T: 0 };
    this.round = 0;
    this.player.lastBuys = [];
    this.controls.sens = opts.sens;
    this.controls.enabled = true;
    this.hud.show(true);
    this.startRound();
  }

  // ---------------- rounds ----------------
  startRound() {
    this.round++;
    this.phase = 'freeze'; this.phaseT = FREEZE;
    this.roundStartTime = this.time;
    this.liveStart = this.time + FREEZE;
    this.effects.clearRound();
    for (const d of this.drops) this.scene.remove(d.mesh);
    for (const g of this.grenades) this.scene.remove(g.mesh);
    this.drops = []; this.grenades = []; this.smokes = [];
    this.roundKills = new Map();
    // props back home
    for (const p of this.map.props) {
      p.pos.x = p.home.x; p.pos.y = p.home.y; p.pos.z = p.home.z; p.vel.x = p.vel.y = p.vel.z = 0;
      p.dead = false; p.hp = 45; p.mesh.visible = true; p.yaw = Math.random() * 6.28; p.sleep = 0;
      this.physics._syncProp(p); this.physics._syncMesh(p, 0);
    }
    // spawns
    for (const team of ['CT', 'T']) {
      const pts = [...this.map.spawns[team]].sort(() => Math.random() - 0.5);
      const members = this.combatants.filter(c => c.team === team);
      members.forEach((c, i) => {
        const s = pts[i % pts.length];
        if (!c.alive) { c.inv.primary = null; c.inv.nades = { he: 0, flash: 0, smoke: 0 }; c.armor = 0; c.helmet = false; c.defuser = false; if (c.inv.secondary && this.round > 1) c.inv.secondary = null; }
        c.inv.bomb = false;
        c.spawn(s.x, s.z, team === 'T' ? 0 : Math.PI);
      });
    }
    // bomb
    const ts = this.combatants.filter(c => c.team === 'T');
    const carrier = ts[Math.floor(Math.random() * ts.length)];
    carrier.inv.bomb = true;
    this.bomb = { carrier, dropped: false, planted: false, defused: false, exploded: false, pos: new THREE.Vector3(), site: null, plantTime: 0, beepT: 0, defuser: null };
    this.bombMesh.visible = false; this.bombLight.intensity = 0;
    // bot plan
    const siteName = Math.random() < 0.5 ? 'A' : 'B';
    const routes = this.map.routes.T[siteName];
    const ctRoles = { 3: ['A', 'B', 'mid'], 4: ['A', 'A', 'B', 'mid'], 5: ['A', 'A', 'B', 'B', 'mid'] }[this.opts.size];
    let ri = 0;
    const plan = {
      site: siteName,
      routeFor: () => (Math.random() < 0.65 ? routes[0] : routes[1]),
      roleFor: () => ctRoles[ri++ % ctRoles.length],
    };
    this.plan = plan;
    for (const [c, brain] of this.brains) { this.botBuy(c); brain.roundStart(plan); }
    this.hud.closeBuy();
    this.hud.message(`Рунд ${this.round}`, '', this.player.team === 'T' ? 'Постави бомбата на A или B' : 'Защити бомбсайтовете', 3);
    this.audio.play('squelch', null, 0.4);
    if (this.player.team === 'T' && this.player.inv.bomb) this.hud.message(`Рунд ${this.round}`, 't', 'Ти носиш бомбата (C4) — слот 5', 3.5);
  }

  endRound(winner, reason) {
    if (this.phase !== 'live' && this.phase !== 'freeze') return;
    this.phase = 'post'; this.phaseT = POST;
    this.score[winner]++;
    const loser = winner === 'CT' ? 'T' : 'CT';
    const winBonus = reason === 'bomb' || reason === 'defuse' ? 3500 : 3250;
    const lossBonus = Math.min(3400, 1400 + this.lossStreak[loser] * 500);
    this.lossStreak[winner] = 0; this.lossStreak[loser]++;
    for (const c of this.combatants) {
      if (c.team === winner) this.addMoney(c, winBonus);
      else this.addMoney(c, lossBonus + (c.team === 'T' && this.bomb.planted ? 800 : 0));
    }
    // MVP
    let mvp = null, best = 0;
    for (const [c, k] of this.roundKills) if (c.team === winner && k > best) { best = k; mvp = c; }
    if (reason === 'bomb' && this.bomb.planter) mvp = this.bomb.planter;
    if (reason === 'defuse' && this.bomb.defuser) mvp = this.bomb.defuser;
    if (mvp) mvp.mvp++;
    const text = winner === 'CT' ? 'Counter-Terrorists Win!' : 'Terrorists Win!';
    const sub = { elim: 'Всички противници са елиминирани', bomb: 'Целта е унищожена', defuse: 'Бомбата е обезвредена', time: 'Целта е спасена' }[reason] + (mvp ? ` · MVP: ${mvp.name}` : '');
    this.hud.message(text, winner.toLowerCase(), sub, POST);
    this.audio.say(winner === 'CT' ? 'Counter-Terrorists win' : 'Terrorists win');
    if (this.score[winner] >= this.winRounds) this.matchWinner = winner;
  }

  checkRoundEnd() {
    if (this.phase !== 'live') return;
    const ct = this.aliveCount('CT'), t = this.aliveCount('T');
    if (ct === 0) return this.endRound('T', 'elim');
    if (t === 0 && !this.bomb.planted) return this.endRound('CT', 'elim');
  }

  aliveCount(team) { let n = 0; for (const c of this.combatants) if (c.alive && c.team === team) n++; return n; }
  roundTimeLeft() { return this.phase === 'live' ? Math.max(0, ROUND - (this.time - this.liveStart)) : ROUND; }
  buyTimeLeft() { return BUYTIME - (this.time - this.roundStartTime); }
  get frozen() { return this.phase === 'freeze'; }
  randomEnemy(c) { const es = this.combatants.filter(e => e.alive && e.team !== c.team); return es[Math.floor(Math.random() * es.length)]; }
  bombTargetSite() { return this.map.sites[this.plan.site]; }

  inSite(pos) {
    for (const k in this.map.sites) {
      const s = this.map.sites[k];
      if (pos.x > s.minX && pos.x < s.maxX && pos.z > s.minZ && pos.z < s.maxZ) return s;
    }
    return null;
  }

  // ---------------- economy ----------------
  addMoney(c, v) {
    const before = c.money;
    c.money = Math.max(0, Math.min(MAXMONEY, c.money + v));
    if (c === this.player && c.money !== before) this.hud.moneyDelta(c.money - before);
  }

  inBuyZone(c) {
    const pts = this.map.spawns[c.team];
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length, cz = pts.reduce((a, p) => a + p.z, 0) / pts.length;
    return Math.hypot(c.pos.x - cx, c.pos.z - cz) < 22;
  }
  canBuy(c) { return c.alive && (this.phase === 'freeze' || this.phase === 'live') && this.buyTimeLeft() > 0 && this.inBuyZone(c); }

  canPurchase(c, key) {
    const w = WEAPONS[key], e = EQUIPMENT[key];
    const price = this.priceOf(c, key);
    if (price > c.money) return false;
    if (w) {
      if (w.team && w.team !== c.team) return false;
      if (w.type === 'grenade') return c.inv.nades[key] < w.max;
      const cur = w.slot === 1 ? c.inv.primary : c.inv.secondary;
      return !(cur && cur.id === key);
    }
    if (!e) return false;
    if (e.team && e.team !== c.team) return false;
    if (key === 'vest') return c.armor < 100;
    if (key === 'vesthelm') return c.armor < 100 || !c.helmet;
    if (key === 'defuser') return !c.defuser;
    if (key === 'ammo1') return !!c.inv.primary && c.inv.primary.reserve < WEAPONS[c.inv.primary.id].reserve;
    if (key === 'ammo2') return !!c.inv.secondary && c.inv.secondary.reserve < WEAPONS[c.inv.secondary.id].reserve;
    return true;
  }
  priceOf(c, key) {
    if (key === 'vesthelm' && c.armor >= 100 && !c.helmet) return 350;
    return (WEAPONS[key] || EQUIPMENT[key]).price;
  }

  buy(c, key, isPlayer) {
    if (!this.canBuy(c) || !this.canPurchase(c, key)) { if (isPlayer) this.audio.play('empty', null, 0.4); return false; }
    const price = this.priceOf(c, key);
    const w = WEAPONS[key];
    if (w) {
      if (w.type === 'grenade') c.inv.nades[key]++;
      else {
        const cur = w.slot === 1 ? c.inv.primary : c.inv.secondary;
        if (cur) this.spawnDrop(cur, c.pos, c.yaw);
        c.giveWeapon(key);
        c.slot = 0; c.switchTo(w.slot);
      }
    } else if (key === 'vest') c.armor = 100;
    else if (key === 'vesthelm') { c.armor = 100; c.helmet = true; }
    else if (key === 'defuser') c.defuser = true;
    else if (key === 'ammo1') c.inv.primary.reserve = WEAPONS[c.inv.primary.id].reserve;
    else if (key === 'ammo2') c.inv.secondary.reserve = WEAPONS[c.inv.secondary.id].reserve;
    this.addMoney(c, -price);
    if (isPlayer) { this.audio.play('buy', null, 0.5); c.lastBuys = c.lastBuys || []; if (!c.lastBuys.includes(key)) c.lastBuys.push(key); }
    return true;
  }

  botBuy(c) {
    const T = c.team === 'T', r = Math.random, b = k => this.buy(c, k, false);
    if (!c.inv.primary) {
      if (c.money >= 4750 + 1000 && r() < 0.2) b('awp');
      else if (c.money >= (T ? 2500 : 3100) + 650) b(T ? 'ak47' : 'm4a1');
      else if (c.money >= 2150 && this.round > 1 && r() < 0.55) b(r() < 0.6 ? 'mp5' : 'm3');
    }
    if (c.money >= 1000 && (c.armor < 100 || !c.helmet)) b('vesthelm');
    else if (c.money >= 650 && c.armor < 100) b('vest');
    if (!c.inv.primary && c.money >= 650 && r() < 0.35) b('deagle');
    if (!T && c.money >= 200 && r() < 0.55) b('defuser');
    if (c.money >= 300 && r() < 0.6) b('he');
    if (c.money >= 200 && r() < 0.5) b('flash');
    if (c.money >= 300 && r() < 0.3) b('smoke');
  }

  autoBuy(c) {
    const T = c.team === 'T';
    if (!c.inv.primary) this.buy(c, c.money >= (T ? 2500 : 3100) ? (T ? 'ak47' : 'm4a1') : 'mp5', true);
    this.buy(c, 'vesthelm', true) || this.buy(c, 'vest', true);
    if (!T) this.buy(c, 'defuser', true);
    this.buy(c, 'he', true); this.buy(c, 'flash', true);
  }
  rebuy(c) { for (const k of c.lastBuys || []) this.buy(c, k, true); }

  // ---------------- perception ----------------
  canSee(eye, target) {
    const pts = [target.pos.y + target.eyeH, target.pos.y + target.eyeH * 0.65, target.pos.y + 0.4];
    for (const y of pts) {
      const dx = target.pos.x - eye.x, dy = y - eye.y, dz = target.pos.z - eye.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < 0.01) return true;
      const hit = this.physics.raycast(eye.x, eye.y, eye.z, dx / d, dy / d, dz / d, d, true);
      if (hit) continue;
      if (this.smokeBlocks(eye.x, eye.y, eye.z, target.pos.x, y, target.pos.z)) continue;
      return true;
    }
    return false;
  }

  smokeBlocks(ax, ay, az, bx, by, bz) {
    for (const s of this.smokes) {
      const age = this.time - s.start;
      if (age < 0.8 || s.end < this.time) continue;
      const r = Math.min(4.3, age * 2.4) * (this.time > s.end - 2 ? (s.end - this.time) / 2 : 1);
      if (segmentHitsSphere(ax, ay, az, bx, by, bz, s.x, s.y + 1.4, s.z, r)) return true;
    }
    return false;
  }

  spot(enemy, by) { if (by.team === this.player.team) enemy.spottedAt = this.time; }

  noise(pos, radius, source, kind) {
    for (const [c, brain] of this.brains) {
      if (!c.alive || c.team === source.team) continue;
      if (c.pos.distanceTo(pos) < radius) brain.hear(pos, kind);
    }
  }

  // ---------------- combat ----------------
  muzzlePos(c, out) {
    const f = c.forward(_c);
    const rx = Math.cos(c.yaw), rz = -Math.sin(c.yaw);
    c.eye(out);
    const side = c === this.player ? 0.1 : 0.15, fw = c === this.player ? 0.55 : 0.75, down = c === this.player ? 0.09 : 0.18;
    return out.set(out.x + rx * side + f.x * fw, out.y - down + f.y * fw, out.z + rz * side + f.z * fw);
  }

  hitScan(ox, oy, oz, dx, dy, dz, maxD, shooter) {
    let best = null;
    for (const c of this.combatants) {
      if (!c.alive || c === shooter || c.team === shooter.team) continue;
      if (raySphere(ox, oy, oz, dx, dy, dz, c.pos.x, c.pos.y + 1.0, c.pos.z, 1.3) < 0) continue;
      const e = c.eyeH, y0 = c.pos.y, x = c.pos.x, z = c.pos.z;
      const fx = -Math.sin(c.yaw) * 0.03, fz = -Math.cos(c.yaw) * 0.03;
      const parts = [
        ['head', raySphere(ox, oy, oz, dx, dy, dz, x + fx, y0 + e + 0.02, z + fz, 0.135)],
        ['chest', rayAABB(ox, oy, oz, dx, dy, dz, x - 0.25, y0 + e - 0.6, z - 0.2, x + 0.25, y0 + e - 0.1, z + 0.2)],
        ['stomach', rayAABB(ox, oy, oz, dx, dy, dz, x - 0.2, y0 + e - 0.84, z - 0.17, x + 0.2, y0 + e - 0.6, z + 0.17)],
        ['legs', rayAABB(ox, oy, oz, dx, dy, dz, x - 0.2, y0, z - 0.17, x + 0.2, y0 + e - 0.84, z + 0.17)],
      ];
      for (const [grp, t] of parts) {
        if (t >= 0 && t < maxD && (!best || t < best.t)) best = { c, t, grp };
      }
    }
    return best;
  }

  fireBullet(shooter, dir, def, first) {
    const o = shooter.eye(_a);
    let ox = o.x, oy = o.y, oz = o.z, power = 1, range = def.type === 'shotgun' ? 60 : 500, travelled = 0;
    let endX = ox + dir.x * range, endY = oy + dir.y * range, endZ = oz + dir.z * range;
    for (let pen = 0; pen < 3; pen++) {
      const hw = this.physics.raycast(ox, oy, oz, dir.x, dir.y, dir.z, range, true);
      const maxD = hw ? hw.dist : range;
      const hc = this.hitScan(ox, oy, oz, dir.x, dir.y, dir.z, maxD, shooter);
      if (hc) {
        const dist = travelled + hc.t;
        let dmg = def.damage * power * Math.pow(def.rangeMod || 1, dist / 12.7);
        endX = ox + dir.x * hc.t; endY = oy + dir.y * hc.t; endZ = oz + dir.z * hc.t;
        this.effects.blood(endX, endY, endZ, dir.x, dir.y, dir.z, hc.grp === 'head');
        this.applyDamage(hc.c, shooter, dmg, def.pellets ? (hc.grp === 'head' ? 'head' : 'chest') : hc.grp, def, dir);
        break;
      }
      if (!hw) break;
      endX = hw.x; endY = hw.y; endZ = hw.z;
      this.effects.impact(hw.box.surface, hw.x, hw.y, hw.z, hw.nx, hw.ny, hw.nz);
      if (first || def.pellets) this.audio.play('knifehit', { x: hw.x, y: hw.y, z: hw.z }, 0.12, 2.5, { range: 5 });
      const prop = hw.box.prop;
      if (prop) this.hitProp(prop, dir, def.damage * power, shooter);
      if (hw.box.penetrable && (def.pen || 0) >= 0.7 && power > 0.3) {
        const th = this.physics.exitDistance(hw.box, hw.x, hw.y, hw.z, dir.x, dir.y, dir.z);
        if (th < 1.3) {
          travelled += hw.dist + th;
          ox = hw.x + dir.x * (th + 0.02); oy = hw.y + dir.y * (th + 0.02); oz = hw.z + dir.z * (th + 0.02);
          range -= hw.dist + th; power *= 0.6;
          this.effects.impact(hw.box.surface, ox, oy, oz, dir.x, dir.y, dir.z);
          continue;
        }
      }
      break;
    }
    if (first) {
      // bullet whizz past the local player
      const p = this.player;
      if (shooter !== p && p.alive) {
        const e = p.eye(_b);
        const t = (e.x - o.x) * dir.x + (e.y - o.y) * dir.y + (e.z - o.z) * dir.z;
        const endT = Math.hypot(endX - o.x, endY - o.y, endZ - o.z);
        if (t > 2 && t < endT) {
          const px = o.x + dir.x * t - e.x, py = o.y + dir.y * t - e.y, pz = o.z + dir.z * t - e.z;
          if (px * px + py * py + pz * pz < 2.5) this.audio.play('whiz', { x: e.x + px, y: e.y + py, z: e.z + pz }, 0.6);
        }
      }
      if (Math.random() < (def.tracer ?? 0.2) || shooter.isBot && Math.random() < 0.25) {
        const m = this.muzzlePos(shooter, _b);
        this.effects.tracer(m.x, m.y, m.z, endX, endY, endZ);
      }
    }
  }

  hitProp(prop, dir, dmg, attacker) {
    const imp = Math.min(40, dmg * 0.35);
    this.physics.impulseProp(prop, dir.x * imp, Math.max(0, dir.y) * imp + imp * 0.15, dir.z * imp);
    if (prop.explosive && !prop.dead) {
      prop.hp -= dmg;
      if (prop.hp <= 0) this.explodeBarrel(prop, attacker);
    }
  }

  explodeBarrel(prop, attacker) {
    prop.dead = true; prop.mesh.visible = false;
    const x = prop.pos.x, y = prop.pos.y + 0.4, z = prop.pos.z;
    prop.pos.y = -50; this.physics._syncProp(prop);
    setTimeout(() => this.explosion(x, y, z, attacker, 110, 9, 'Barrel'), 60);
  }

  explosion(x, y, z, owner, maxDmg, radius, label) {
    this.effects.explosion(x, y, z);
    this.audio.play('explode', { x, y, z }, 1.2, 1, { range: 60, max: 400, reverb: 0.5 });
    const def = { name: label, id: 'he', killReward: 300 };
    for (const c of this.combatants) {
      if (!c.alive) continue;
      if (owner && c !== owner && c.team === owner.team && label === 'HE Grenade') continue;
      const cy = c.pos.y + c.eyeH * 0.6;
      const dx = c.pos.x - x, dy = cy - y, dz = c.pos.z - z, d = Math.hypot(dx, dy, dz);
      if (d > radius) continue;
      const hit = this.physics.raycast(x, y, z, dx / d, dy / d, dz / d, d, false);
      if (hit) continue;
      const dmg = maxDmg * (1 - d / radius);
      c.vel.x += dx / d * (1 - d / radius) * 6; c.vel.z += dz / d * (1 - d / radius) * 6; c.vel.y += (1 - d / radius) * 3;
      this.applyDamage(c, owner, dmg, 'blast', def, { x: dx / d, y: 0, z: dz / d });
    }
    for (const p of this.physics.props) {
      if (p.dead) continue;
      const dx = p.pos.x - x, dz = p.pos.z - z, dy = p.pos.y + p.hy - y, d = Math.hypot(dx, dy, dz);
      if (d > radius * 1.2) continue;
      const k = (1 - d / (radius * 1.2)) * 260;
      this.physics.impulseProp(p, dx / d * k, (dy / d + 0.8) * k, dz / d * k);
      if (p.explosive && d < radius * 0.7) { p.hp = 0; setTimeout(() => { if (!p.dead) this.explodeBarrel(p, owner); }, 150 + Math.random() * 200); }
    }
    const pd = Math.hypot(this.camera().position.x - x, this.camera().position.z - z);
    this.effects.shake = Math.max(this.effects.shake, Math.max(0, 1.2 - pd / 35));
  }

  applyDamage(victim, attacker, dmg, group, def, dir) {
    if (!victim.alive || this.phase === 'over') return;
    if (group === 'head') dmg *= 4; else if (group === 'stomach') dmg *= 1.25; else if (group === 'legs') dmg *= 0.75;
    const armored = victim.armor > 0 && group !== 'legs' && group !== 'fall' && (group !== 'head' || victim.helmet);
    if (armored) {
      const pen = group === 'blast' ? 0.5 : (def && def.pen) || 0.5;
      let newDmg = dmg * pen;
      let armorTaken = (dmg - newDmg) * 0.5;
      if (armorTaken > victim.armor) { armorTaken = victim.armor; newDmg = dmg - armorTaken * 2; }
      victim.armor = Math.max(0, victim.armor - armorTaken);
      dmg = newDmg;
    }
    dmg = Math.max(1, Math.round(dmg));
    victim.hp -= dmg;
    victim.lastHurt = this.time; victim.lastAttacker = attacker;
    if (dir && group !== 'fall') {
      if (victim.body.onGround && group !== 'blast') { victim.vel.x *= 0.45; victim.vel.z *= 0.45; }
      victim.punchP += Math.min(0.05, dmg * 0.0015);
    }
    const p = this.player;
    if (victim === p) {
      if (attacker && attacker !== p) this.hud.damageFrom(-angDiff(yawTo(attacker.pos.x - p.pos.x, attacker.pos.z - p.pos.z), p.yaw));
      this.audio.play('hit', null, 0.5, 0.8);
      this.effects.shake = Math.max(this.effects.shake, 0.25);
      this.hurtFlash = 1;
    }
    if (attacker === p && victim !== p) {
      this.hud.hitmarker(group === 'head');
      this.audio.play(group === 'head' ? 'hs' : 'hit', null, group === 'head' ? 0.45 : 0.3, group === 'head' ? 1 : 1.6);
    }
    const brain = this.brains.get(victim);
    if (brain && attacker && attacker !== victim) { brain.hear(attacker.pos, 'hurt'); brain.thinkT = 0; }
    if (victim.hp <= 0) this.kill(victim, attacker, def ? def.name : (group === 'fall' ? 'Fall' : 'World'), group === 'head', dir);
  }

  kill(victim, attacker, weaponName, hs, dir) {
    victim.alive = false; victim.hp = 0; victim.deaths++; victim.action = null; victim.scope = 0;
    victim.triggerDown = false;
    if (attacker && attacker !== victim && attacker.team !== victim.team) {
      attacker.kills++; if (hs) attacker.hs++;
      const def = WEAPONS[attacker.wid];
      this.addMoney(attacker, weaponName === 'Knife' ? 1500 : weaponName === 'HE Grenade' ? 300 : (def && def.killReward) || 300);
      this.roundKills.set(attacker, (this.roundKills.get(attacker) || 0) + 1);
    } else if (attacker === victim || !attacker) {
      victim.kills = Math.max(0, victim.kills - 1);
    }
    const involves = victim === this.player || attacker === this.player;
    this.hud.kill(attacker && attacker !== victim ? attacker : null, victim, weaponName, hs, involves);
    // drops
    const w = victim.inv.primary || victim.inv.secondary;
    if (w) { this.spawnDrop(w, victim.pos, victim.yaw + Math.PI); if (w === victim.inv.primary) victim.inv.primary = null; else victim.inv.secondary = null; }
    if (victim.inv.bomb) this.dropBomb(victim);
    victim.inv.nades = { he: 0, flash: 0, smoke: 0 };
    victim.armor = 0; victim.helmet = false; victim.defuser = false;
    if (victim.model) {
      victim.model.root.visible = true;
      victim.model.die(dir ? dir.x : 0, dir ? dir.z : 0, hs);
    }
    if (victim === this.player) {
      this.specTarget = attacker && attacker.alive && attacker !== victim ? attacker : null;
      this.specTime = this.time;
      this.hud.closeBuy();
    }
    this.audio.play('land', victim.pos, 0.8);
    this.checkRoundEnd();
  }

  knifeAttack(c, heavy = false) {
    const f = c.forward(_c), e = c.eye(_a);
    const range = heavy ? 1.5 : 1.9;
    if (c === this.player) { this.vm.melee(); }
    this.audio.play('knife', c === this.player ? null : c.pos, 0.6);
    const hc = this.hitScan(e.x, e.y, e.z, f.x, f.y, f.z, range, c);
    const hw = this.physics.raycast(e.x, e.y, e.z, f.x, f.y, f.z, range, true);
    if (hc && (!hw || hc.t < hw.dist)) {
      const victim = hc.c;
      const back = Math.abs(angDiff(victim.yaw, c.yaw)) < 1.0;
      const dmg = heavy ? (back ? 195 : 65) : (back ? 90 : 34);
      this.effects.blood(e.x + f.x * hc.t, e.y + f.y * hc.t, e.z + f.z * hc.t, f.x, f.y, f.z, true);
      this.audio.play('knifehit', victim.pos, 0.8);
      this.applyDamage(victim, c, dmg / (hc.grp === 'head' ? 4 : hc.grp === 'stomach' ? 1.25 : hc.grp === 'legs' ? 0.75 : 1), hc.grp, WEAPONS.knife, f);
    } else if (hw) {
      this.effects.impact(hw.box.surface, hw.x, hw.y, hw.z, hw.nx, hw.ny, hw.nz);
      this.audio.play('knifehit', hw, 0.5, 1.3);
    }
  }

  // ---------------- events from combatants ----------------
  onShot(c, d) {
    const own = c === this.player;
    this.audio.gun(d.sound, c.pos, own);
    const m = this.muzzlePos(c, _b);
    if (own) {
      this.vm.fire(d.type === 'sniper' || d.type === 'shotgun' ? 1.8 : d.type === 'pistol' ? 1.2 : 1);
      this.effects.light(m.x, m.y, m.z, 0xffa850, 4, 8, 0.05);
      const rx = Math.cos(c.yaw), rz = -Math.sin(c.yaw);
      if (d.type !== 'shotgun' || true) {
        const s = this.effects.shell(m.x - rx * 0.05, m.y + 0.02, m.z - rz * 0.05, rx * (1.5 + Math.random()) + c.vel.x, 1.8 + Math.random(), rz * (1.5 + Math.random()) + c.vel.z);
        if (d.type === 'shotgun') s.m.scale.set(1.8, 1.4, 1.4); else s.m.scale.set(1, 1, 1);
      }
    } else {
      this.effects.muzzle(m.x, m.y, m.z, d.type === 'sniper' || d.type === 'shotgun' ? 1.5 : 1);
    }
    this.noise(c.pos, 55, c, 'shot');
  }
  onReload(c) {
    if (c === this.player) {
      const d = c.def;
      if (d.shellReload) return;
      this.audio.play('clipout', null, 0.5);
      setTimeout(() => this.audio.play('clipin', null, 0.5), d.reload * 550);
      setTimeout(() => this.audio.play('bolt', null, 0.45), d.reload * 850);
    } else this.audio.play('clipout', c.pos, 0.4, 1, { range: 8 });
  }
  onShellLoaded(c) { this.audio.play('clipin', c === this.player ? null : c.pos, 0.35, 1.4, { range: 8 }); }
  onEmpty(c) { if (c === this.player) this.audio.play('empty', null, 0.5); }
  onFootstep(c) {
    const own = c === this.player;
    this.audio.play('step' + Math.floor(Math.random() * 4), own ? null : c.pos, own ? 0.22 : 0.55, 1, { range: 12, max: 45 });
    this.noise(c.pos, 22, c, 'step');
  }
  onLand(c, v) {
    this.audio.play('land', c === this.player ? null : c.pos, Math.min(0.7, v / 14), 1, { range: 12 });
    if (c === this.player) this.vm.land(v);
  }

  // ---------------- grenades ----------------
  throwGrenade(c, type) {
    if (c.inv.nades[type] <= 0) return;
    c.inv.nades[type]--;
    const f = c.forward(_c), e = c.eye(_a);
    const pos = new THREE.Vector3(e.x + f.x * 0.4, e.y + f.y * 0.4 - 0.05, e.z + f.z * 0.4);
    const speed = c.walking || c.crouched ? 11 : 16.5;
    const vel = new THREE.Vector3(f.x * speed + c.vel.x, f.y * speed + 2.2 + c.vel.y * 0.5, f.z * speed + c.vel.z);
    const mesh = buildWeaponModel(type, this.mats);
    mesh.scale.setScalar(1.3);
    this.scene.add(mesh);
    const body = { pos, vel, hx: 0.06, hz: 0.06, h: 0.1, bounce: 0.42, step: false, box: null, solidProps: true, pushes: false, onGround: false };
    this.grenades.push({ type, owner: c, body, mesh, t: 0, fuse: type === 'he' ? 1.6 : type === 'flash' ? 1.4 : 1.2, spin: 8 });
    if (c === this.player) this.vm.throwAnim();
    if (c === this.player || Math.random() < 0.4) {
      if (c.team === this.player.team || c.pos.distanceTo(this.player.pos) < 25) this.audio.say('Fire in the hole!');
    }
    setTimeout(() => { if (c.alive && c.slot === 4 && c.inv.nades[c.nadeSel] <= 0) { if (c.hasSlot(4)) { c.slot = 0; c.switchTo(4); } else c.switchTo(c.bestSlot()); } }, 450);
  }

  updateGrenades(dt) {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i], b = g.body;
      g.t += dt;
      b.vel.y -= GRAVITY * dt;
      const vy = b.vel.y, wasGround = b.onGround;
      this.physics.moveBody(b, dt);
      if ((b.hitWall || (b.onGround && !wasGround && vy < -2)) && Math.hypot(b.vel.x, b.vel.y, b.vel.z) > 1.5) this.audio.play('bounce', b.pos, 0.6, 1, { range: 10 });
      if (b.onGround) { const k = Math.exp(-dt * 3); b.vel.x *= k; b.vel.z *= k; g.spin *= k; }
      g.mesh.position.set(b.pos.x, b.pos.y + 0.05, b.pos.z);
      g.mesh.rotation.x += g.spin * dt; g.mesh.rotation.z += g.spin * 0.6 * dt;
      const still = Math.hypot(b.vel.x, b.vel.z) < 0.4 && b.onGround;
      if (g.t >= g.fuse && (g.type !== 'smoke' || still || g.t > 3.5)) {
        this.detonate(g);
        this.scene.remove(g.mesh);
        this.grenades.splice(i, 1);
      }
    }
  }

  detonate(g) {
    const { x, y, z } = g.body.pos;
    if (g.type === 'he') this.explosion(x, y + 0.2, z, g.owner, 98, 11, 'HE Grenade');
    else if (g.type === 'flash') {
      this.audio.play('flashpop', { x, y, z }, 1, 1, { range: 40 });
      this.effects.light(x, y + 0.5, z, 0xffffff, 80, 30, 0.25);
      for (const c of this.combatants) {
        if (!c.alive) continue;
        const e = c.eye(_a);
        const dx = x - e.x, dy = y + 0.2 - e.y, dz = z - e.z, d = Math.hypot(dx, dy, dz);
        if (d > 35) continue;
        if (this.physics.raycast(e.x, e.y, e.z, dx / d, dy / d, dz / d, d - 0.2, false)) continue;
        const f = c.forward(_b, false);
        const dot = (f.x * dx + f.y * dy + f.z * dz) / d;
        const face = dot > 0.5 ? 1 : dot > 0 ? 0.6 : dot > -0.4 ? 0.3 : 0.12;
        const amt = face * (1 - d / 35) * 5.2;
        c.flashT = Math.max(c.flashT, amt);
        const brain = this.brains.get(c); if (brain && amt > 0.6) brain.visible = false;
      }
    } else {
      this.smokes.push({ x, y, z, start: this.time, end: this.time + 18 });
      this.effects.smokeGrenade(x, y, z);
      this.audio.play('hiss', { x, y, z }, 0.8, 1, { range: 18 });
    }
  }

  // ---------------- drops / bomb ----------------
  spawnDrop(w, pos, yaw) {
    const mesh = buildWeaponModel(w.id, this.mats);
    this.scene.add(mesh);
    const d = { id: w.id, clip: w.clip, reserve: w.reserve, mesh, pos: new THREE.Vector3(pos.x, pos.y + 1.1, pos.z), vel: new THREE.Vector3(-Math.sin(yaw) * 3, 1.5, -Math.cos(yaw) * 3), t: 0, rest: false };
    d.body = { pos: d.pos, vel: d.vel, hx: 0.12, hz: 0.12, h: 0.06, bounce: 0.2, step: false, box: null, solidProps: true, pushes: false, onGround: false };
    this.drops.push(d);
    return d;
  }

  dropWeapon(c) {
    if (!c.alive) return;
    if (c.slot === 5 && c.inv.bomb) { this.dropBomb(c, true); c.switchTo(c.bestSlot()); return; }
    const w = c.wstate; if (!w) return;
    this.spawnDrop(w, c.pos, c.yaw).noPickup = c;
    if (c.slot === 1) c.inv.primary = null; else c.inv.secondary = null;
    c.slot = 0; c.switchTo(c.bestSlot());
    this.hud.weaponBar();
  }

  dropBomb(c, thrown = false) {
    c.inv.bomb = false;
    const b = this.bomb;
    b.carrier = null; b.dropped = true;
    const d = this.spawnDrop({ id: 'c4', clip: 0, reserve: 0 }, c.pos, c.yaw + (thrown ? 0 : Math.PI));
    d.isBomb = true; d.noPickup = thrown ? c : null; d.noPickupT = 1;
    b.dropEntity = d;
    b.pos.copy(d.pos);
    if (c.slot === 5) c.slot = c.bestSlot();
    for (const [bot, brain] of this.brains) if (bot.alive && bot.team === 'T') { brain.onBombDropped(c.pos); break; }
    if (this.player.team === 'T') this.hud.message('', '', 'Бомбата е изпусната!', 2);
  }

  updateDrops(dt) {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.t += dt;
      if (!d.rest) {
        d.vel.y -= GRAVITY * dt;
        this.physics.moveBody(d.body, dt);
        if (d.body.onGround) { d.vel.x *= Math.exp(-dt * 6); d.vel.z *= Math.exp(-dt * 6); if (Math.hypot(d.vel.x, d.vel.z) < 0.05) d.rest = true; }
        d.mesh.rotation.set(0, d.t * 3, d.body.onGround ? Math.PI / 2 : d.t * 5);
      }
      d.mesh.position.set(d.pos.x, d.pos.y + 0.05, d.pos.z);
      if (d.isBomb) this.bomb.pos.copy(d.pos);
      if (d.t < 0.6) continue;
      for (const c of this.combatants) {
        if (!c.alive || (d.noPickup === c && d.t < 2)) continue;
        if (Math.abs(c.pos.x - d.pos.x) > 0.9 || Math.abs(c.pos.z - d.pos.z) > 0.9 || Math.abs(c.pos.y - d.pos.y) > 1.2) continue;
        if (d.isBomb) {
          if (c.team !== 'T') continue;
          c.inv.bomb = true; this.bomb.carrier = c; this.bomb.dropped = false; this.bomb.dropEntity = null;
          if (c === this.player) { this.audio.play('pickup', null, 0.6); this.hud.message('', 't', 'Взе бомбата', 2); }
          const brain = this.brains.get(c); if (brain) { brain.task = 'push'; const s = this.bombTargetSite(); const spot = s.plantSpots[0]; brain.waypoints = []; brain.finalSpot = spot; brain.setGoal(spot.x, spot.z); }
        } else {
          const def = WEAPONS[d.id];
          const has = def.slot === 1 ? c.inv.primary : c.inv.secondary;
          if (has) continue;
          const w = c.giveWeapon(d.id, d.clip, d.reserve);
          if (c === this.player) { this.audio.play('pickup', null, 0.6); this.hud.weaponBar(); }
          if (c.isBot || c.slot === 3) { c.slot = 0; c.switchTo(def.slot); }
          void w;
        }
        this.scene.remove(d.mesh);
        this.drops.splice(i, 1);
        break;
      }
    }
  }

  tryUse(c) {
    if (!c.alive) return;
    if (c.inv.bomb && this.inSite(c.pos)) { if (c.slot !== 5) c.switchTo(5); this.tryPlant(c); return; }
    if (c.team === 'CT') this.tryDefuse(c);
  }

  tryPlant(c) {
    if (!c.inv.bomb || c.action || this.phase !== 'live') return;
    if (!this.inSite(c.pos)) { if (c === this.player) this.hud.hint('Трябва да си в бомбсайт A или B, за да поставиш бомбата'); return; }
    if (!c.body.onGround) return;
    c.action = { type: 'plant', t: 0, dur: 3.2, key: 0, x: c.pos.x, z: c.pos.z };
    c.vel.set(0, c.vel.y, 0);
    if (c === this.player) this.audio.play('key', null, 0.5);
  }

  tryDefuse(c) {
    const b = this.bomb;
    if (c.team !== 'CT' || !b.planted || b.defused || b.exploded || c.action) return;
    if (Math.hypot(c.pos.x - b.pos.x, c.pos.z - b.pos.z) > 1.8 || Math.abs(c.pos.y - b.pos.y) > 1.5) return;
    c.action = { type: 'defuse', t: 0, dur: c.defuser ? 5 : 10, x: c.pos.x, z: c.pos.z };
    b.defuser = c;
    this.audio.play('defuse', b.pos, 0.8);
    if (c !== this.player && this.player.team === 'CT') this.hud.message('', 'ct', `${c.name} обезврежда бомбата`, 2);
  }

  updateActions(dt) {
    for (const c of this.combatants) {
      const a = c.action;
      if (!a) continue;
      if (!c.alive || !c.useHeld || Math.hypot(c.pos.x - a.x, c.pos.z - a.z) > 0.3 || this.phase === 'post') { c.action = null; continue; }
      a.t += dt;
      if (a.type === 'plant') {
        if (a.t - a.key > 0.42) { a.key = a.t; this.audio.play('key', c === this.player ? null : c.pos, 0.4, 1 + Math.random() * 0.3, { range: 10 }); }
        if (a.t >= a.dur) { c.action = null; this.plantBomb(c); }
      } else if (a.type === 'defuse') {
        if (!this.bomb.planted || this.bomb.exploded) { c.action = null; continue; }
        if (a.t >= a.dur) { c.action = null; this.defuseBomb(c); }
      }
    }
    const p = this.player, a = p.action;
    if (a) this.hud.progress(a.type === 'plant' ? 'ПОСТАВЯНЕ НА C4' : (p.defuser ? 'ОБЕЗВРЕЖДАНЕ (КИТ)' : 'ОБЕЗВРЕЖДАНЕ'), a.t / a.dur);
    else this.hud.progress(null);
  }

  plantBomb(c) {
    const b = this.bomb;
    c.inv.bomb = false;
    b.carrier = null; b.planted = true; b.planter = c; b.plantTime = this.time; b.beepT = 0;
    b.site = this.inSite(c.pos) || this.bombTargetSite();
    b.pos.set(c.pos.x, c.pos.y + 0.03, c.pos.z);
    this.bombMesh.position.copy(b.pos);
    this.bombMesh.rotation.set(0, c.yaw, 0);
    this.bombMesh.visible = true;
    this.addMoney(c, 300);
    c.switchTo(c.bestSlot());
    this.audio.say('Bomb has been planted');
    this.hud.message('Бомбата е поставена!', 't', `Бомбсайт ${b.site.name}`, 3);
    for (const [bot, brain] of this.brains) if (bot.alive) brain.onBombPlanted(b.pos);
  }

  defuseBomb(c) {
    const b = this.bomb;
    b.defused = true; b.defuser = c;
    this.bombLight.intensity = 0;
    this.audio.say('Bomb has been defused');
    this.addMoney(c, 300);
    this.endRound('CT', 'defuse');
  }

  updateBomb(dt) {
    const b = this.bomb;
    if (b.carrier && b.carrier.alive) b.pos.copy(b.carrier.pos);
    if (!b.planted || b.defused || b.exploded) return;
    const left = BOMB_TIMER - (this.time - b.plantTime);
    const interval = Math.max(0.12, 0.2 + (left / BOMB_TIMER) * 1.2);
    b.beepT -= dt;
    const led = this.bombMesh.userData.led;
    if (b.beepT <= 0) {
      b.beepT = interval;
      this.audio.play('beep', b.pos, 0.7, 1, { range: 14, max: 120 });
      this.bombLight.position.set(b.pos.x, b.pos.y + 0.3, b.pos.z);
      this.bombLight.intensity = 2;
      led.material.emissiveIntensity = 6;
    } else if (b.beepT < interval - 0.08) { this.bombLight.intensity = 0; led.material.emissiveIntensity = 0.3; }
    if (left <= 0) {
      b.exploded = true;
      this.bombLight.intensity = 0; this.bombMesh.visible = false;
      const { x, y, z } = b.pos;
      for (let k = 0; k < 4; k++) setTimeout(() => this.effects.explosion(x + (Math.random() - 0.5) * 6, y + Math.random() * 2, z + (Math.random() - 0.5) * 6), k * 120);
      this.explosion(x, y + 0.5, z, b.planter, 500, 24, 'C4');
      this.effects.shake = 2;
      if (this.phase === 'live') this.endRound('T', 'bomb');
    }
  }

  // ---------------- player / camera ----------------
  viewTarget() {
    if (this.player.alive) return this.player;
    if (this.specTarget && this.specTarget.alive) return this.specTarget;
    const mates = this.combatants.filter(c => c.alive && c.team === this.player.team);
    this.specTarget = mates[0] || this.combatants.find(c => c.alive) || null;
    return this.specTarget;
  }

  cycleSpectate(dir) {
    const list = this.combatants.filter(c => c.alive && c.team === this.player.team);
    if (!list.length) return;
    const i = list.indexOf(this.specTarget);
    this.specTarget = list[(i + dir + list.length) % list.length];
  }

  camera() { return this.engine.camera; }
  viewEye() { return this.engine.camera.position; }

  updateCamera(dt) {
    const cam = this.engine.camera, p = this.player;
    const shake = this.effects.shake;
    const sx = (Math.random() - 0.5) * shake * 0.05, sy = (Math.random() - 0.5) * shake * 0.05;
    let targetFov = 74;
    if (p.alive) {
      p.eye(cam.position);
      cam.rotation.set(p.pitch + p.punchP * 0.55 + sy, p.yaw + p.punchY * 0.55 + sx, 0, 'YXZ');
      if (p.scope) targetFov = p.def.scope[p.scope - 1];
    } else {
      const t = this.viewTarget();
      if (t) {
        const e = t.eye(_a);
        const back = t.forward(_b, false);
        const dist = 3.2;
        const hit = this.physics.raycast(e.x, e.y + 0.3, e.z, -back.x, 0.15, -back.z, dist, false);
        const d = hit ? Math.max(0.3, hit.dist - 0.3) : dist;
        cam.position.set(e.x - back.x * d, e.y + 0.3 + 0.15 * d, e.z - back.z * d);
        cam.lookAt(e.x + back.x * 4, e.y + back.y * 4, e.z + back.z * 4);
      } else {
        cam.position.set(0, 60, 60); cam.lookAt(0, 0, 0);
      }
    }
    if (Math.abs(cam.fov - targetFov) > 0.01) { cam.fov = targetFov; cam.updateProjectionMatrix(); }
    const yawForAudio = p.alive ? p.yaw : Math.atan2(-(cam.getWorldDirection(_c).x), -_c.z);
    this.audio.setListener(cam.position.x, cam.position.y, cam.position.z, yawForAudio);
    // post fx
    this.hurtFlash = Math.max(0, (this.hurtFlash || 0) - dt * 2);
    const view = this.viewTarget() || p;
    const gu = this.engine.grade.uniforms;
    gu.hurt.value = view.alive ? Math.max(this.hurtFlash * 0.6, view.hp < 30 ? (30 - view.hp) / 60 : 0) : 0;
    gu.flash.value = 0;
  }

  updateViewModel(dt) {
    const p = this.player;
    const d = p.def;
    const drawDur = d.type === 'rifle' || d.type === 'sniper' ? 0.75 : d.type === 'melee' ? 0.4 : 0.55;
    let reloadFrac = 0;
    if (p.reloadEnd) {
      const dur = d.shellReload ? d.reload : d.reload;
      reloadFrac = 1 - (p.reloadEnd - this.time) / dur;
    }
    this.vm.setWeapon(p.alive ? p.wid : null, p.team);
    this.vm.update(dt, {
      time: this.time, speed: p.hspeed(), onGround: p.body.onGround, crouch: p.crouched,
      mouseDX: this.controls.lastDX, mouseDY: this.controls.lastDY,
      drawFrac: Math.min(1, 1 - (p.drawEnd - this.time) / drawDur),
      reloadFrac, visible: p.alive && !p.scope,
    });
  }

  separate() {
    const cs = this.combatants;
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i]; if (!a.alive) continue;
      for (let j = i + 1; j < cs.length; j++) {
        const b = cs[j]; if (!b.alive) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d2 = dx * dx + dz * dz;
        if (d2 > 0.64 || Math.abs(a.pos.y - b.pos.y) > 1.6) continue;
        const d = Math.sqrt(d2) || 0.01, push = (0.8 - d) * 0.5;
        const nx = dx / d, nz = dz / d;
        a.vel.x -= nx * push * 6; a.vel.z -= nz * push * 6;
        b.vel.x += nx * push * 6; b.vel.z += nz * push * 6;
      }
    }
  }

  inspect() { }

  onPointerLock(locked) {
    if (this.phase === 'menu' || this.phase === 'over') return;
    if (!locked && !this.hud.buyOpen()) this.setPaused(true);
    if (locked) this.setPaused(false);
  }

  setPaused(v) {
    this.paused = v;
    document.getElementById('pause').classList.toggle('hidden', !v || this.phase === 'menu');
  }

  // ---------------- main tick ----------------
  step(dt) {
    this.time += dt;
    for (const [c, brain] of this.brains) brain.update(dt, this.time);
    for (const c of this.combatants) c.update(dt, this.time);
    this.separate();
    this.physics.updateProps(dt);
    this.updateGrenades(dt);
    this.updateDrops(dt);
    this.updateActions(dt);
    this.updateBomb(dt);
    // phases
    this.phaseT -= dt;
    if (this.phase === 'freeze' && this.phaseT <= 0) {
      this.phase = 'live'; this.liveStart = this.time;
      this.audio.say(this.player.team === 'CT' ? "Let's move out" : 'Go go go');
    } else if (this.phase === 'live') {
      if (this.roundTimeLeft() <= 0 && !this.bomb.planted) this.endRound('CT', 'time');
    } else if (this.phase === 'post' && this.phaseT <= 0) {
      if (this.matchWinner) return this.matchOver();
      this.startRound();
    }
  }

  update(dt) {
    if (this.paused || !this.combatants) return;
    this.controls.update(dt);
    const p = this.player;
    // hints
    if (p.alive) {
      if (p.inv.bomb && this.inSite(p.pos) && this.phase === 'live' && !p.action) this.hud.hint('Задръж E (или огън с C4), за да поставиш бомбата');
      else if (p.team === 'CT' && this.bomb.planted && !this.bomb.defused && !p.action && p.pos.distanceTo(this.bomb.pos) < 2.2) this.hud.hint(`Задръж E, за да обезвредиш${p.defuser ? ' (5 сек с кит)' : ' (10 сек)'}`);
      else if (this.phase === 'freeze') this.hud.hint(`Време за купуване — натисни B`);
      else this.hud.hint('');
    } else this.hud.hint('');
    const steps = Math.ceil(dt / (1 / 90));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) this.step(h);
    for (const c of this.combatants) c.syncModel(dt);
    this.effects.update(dt, this.engine.camera);
    this.updateCamera(dt);
    this.updateViewModel(dt);
    this.hud.update(dt);
  }

  matchOver() {
    this.phase = 'over';
    this.controls.enabled = false;
    document.exitPointerLock?.();
    const el = document.getElementById('matchover');
    const won = this.matchWinner === this.player.team;
    const top = [...this.combatants].sort((a, b) => b.kills - a.kills)[0];
    el.innerHTML = `<h2 style="color:${this.matchWinner === 'CT' ? 'var(--ct)' : 'var(--t)'}">${this.matchWinner === 'CT' ? 'Counter-Terrorists' : 'Terrorists'} печелят мача</h2>
      <p>${won ? 'Победа!' : 'Загуба.'} Резултат ${this.score.CT} : ${this.score.T}</p>
      <p>Ти: ${this.player.kills} убийства / ${this.player.deaths} смърти / ${this.player.hs} HS · Най-добър: ${top.name} (${top.kills})</p>
      <button id="againBtn">Към менюто</button>`;
    el.classList.remove('hidden');
    document.getElementById('againBtn').onclick = () => { el.classList.add('hidden'); this.onQuit && this.onQuit(); };
  }
}
