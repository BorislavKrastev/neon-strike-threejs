// Keyboard / mouse input for the local player (pointer lock).
import { angDiff } from './bot.js';

export class PlayerControls {
  constructor(game, dom) {
    this.game = game; this.dom = dom;
    this.keys = new Set();
    this.mdx = 0; this.mdy = 0; this.lastDX = 0; this.lastDY = 0;
    this.sens = 1;
    this.locked = false;
    this.enabled = false;
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
      this.game.onPointerLock(this.locked);
    });
    document.addEventListener('mousemove', e => {
      if (!this.locked) return;
      this.mdx += e.movementX || 0; this.mdy += e.movementY || 0;
    });
    document.addEventListener('mousedown', e => {
      if (!this.enabled) return;
      if (!this.locked) { if (!this.game.hud.buyOpen()) this.lock(); return; }
      const p = this.game.player;
      if (e.button === 0) { p.triggerDown = true; if (!p.alive) this.game.cycleSpectate(1); }
      if (e.button === 2) this.secondary();
    });
    document.addEventListener('mouseup', e => { if (e.button === 0) this.game.player.triggerDown = false; });
    document.addEventListener('contextmenu', e => { if (this.enabled) e.preventDefault(); });
    document.addEventListener('wheel', e => {
      if (!this.enabled || !this.locked) return;
      this.cycleWeapon(e.deltaY > 0 ? 1 : -1);
    }, { passive: true });
    window.addEventListener('keydown', e => this.keyDown(e));
    window.addEventListener('keyup', e => this.keyUp(e));
    window.addEventListener('blur', () => { this.keys.clear(); if (this.game.player) this.game.player.triggerDown = false; });
  }

  lock() {
    try {
      const r = this.dom.requestPointerLock({ unadjustedMovement: true });
      if (r && r.catch) r.catch(() => this.dom.requestPointerLock());
    } catch (e) { this.dom.requestPointerLock(); }
  }

  secondary() {
    const p = this.game.player, d = p.def;
    if (!p.alive) return;
    if (d.scope) {
      if (p.reloadEnd || this.game.time < p.drawEnd) return;
      p.scope = (p.scope + 1) % (d.scope.length + 1);
      p.rescopeAt = 0;
      this.game.audio.play('empty', null, 0.25, 1.8);
    } else if (d.type === 'melee') {
      if (this.game.time >= p.nextFire) { p.nextFire = this.game.time + 1.0; this.game.knifeAttack(p, true); }
    }
  }

  cycleWeapon(dir) {
    const p = this.game.player; if (!p.alive) return;
    const order = [1, 2, 3, 4, 5].filter(s => p.hasSlot(s));
    let i = order.indexOf(p.slot);
    i = (i + dir + order.length) % order.length;
    if (p.switchTo(order[i])) this.game.hud.weaponBar();
  }

  keyDown(e) {
    if (!this.enabled) return;
    const g = this.game, p = g.player, hud = g.hud;
    if (e.code === 'Tab') { e.preventDefault(); hud.showScores(true); return; }
    if (['F3', 'F4'].includes(e.code)) { e.preventDefault(); if (e.code === 'F3') g.autoBuy(p); else g.rebuy(p); hud.renderBuy(); return; }
    if (e.repeat) return;
    if (hud.buyOpen()) {
      const m = e.code.match(/^(Digit|Numpad)(\d)$/);
      if (m) { hud.buyKey(+m[2]); return; }
      if (e.code === 'KeyB' || e.code === 'Escape') { hud.closeBuy(); if (!this.locked) this.lock(); return; }
    }
    this.keys.add(e.code);
    switch (e.code) {
      case 'Space': p.jumpBuffer = 0.12; e.preventDefault(); break;
      case 'KeyR': p.reload(g.time); break;
      case 'KeyB': if (hud.openBuy()) { document.exitPointerLock?.(); } break;
      case 'KeyQ': if (p.switchTo(p.lastSlot)) hud.weaponBar(); break;
      case 'KeyG': g.dropWeapon(p); break;
      case 'KeyE': p.useHeld = true; g.tryUse(p); break;
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': case 'Digit5':
        if (p.switchTo(+e.code.slice(5))) hud.weaponBar(); break;
      case 'KeyF': g.inspect(); break;
    }
  }

  keyUp(e) {
    this.keys.delete(e.code);
    const g = this.game;
    if (!g.player) return;
    if (e.code === 'Tab') g.hud.showScores(false);
    if (e.code === 'KeyE') g.player.useHeld = false;
  }

  update(dt) {
    const g = this.game, p = g.player, k = this.keys;
    this.lastDX = this.mdx; this.lastDY = this.mdy;
    if (!p) return;
    // mouse look
    const fovScale = p.scope ? (p.def.scope[p.scope - 1] / 74) : 1;
    const s = 0.0022 * this.sens * fovScale;
    if (p.alive) {
      p.yaw -= this.mdx * s;
      p.pitch -= this.mdy * s;
      p.pitch = Math.max(-1.55, Math.min(1.55, p.pitch));
    }
    this.mdx = 0; this.mdy = 0;
    // movement intent
    let f = 0, r = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) f += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) r += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) r -= 1;
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    p.wish.set(-sy * f + cy * r, 0, -cy * f - sy * r);
    p.wantCrouch = k.has('ControlLeft') || k.has('ControlRight') || k.has('KeyC');
    p.walking = k.has('ShiftLeft') || k.has('ShiftRight');
    if (p.def.type === 'c4' && p.triggerDown) { p.useHeld = true; }
    else if (!k.has('KeyE')) p.useHeld = false;
  }
}

export { angDiff };
