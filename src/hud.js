// DOM HUD: vitals, ammo, money, timer, radar, kill feed, buy menu and scoreboard.
import { WEAPONS, BUY_MENU, EQUIPMENT } from './weapons.js';
import { HALF, WORLD } from './map.js';

const $ = id => document.getElementById(id);

export class HUD {
  constructor(game) {
    this.game = game;
    this.el = {};
    for (const id of ['hud', 'radar', 'scoreCT', 'scoreT', 'aliveCT', 'aliveT', 'roundtimer', 'crosshair', 'hitmarker', 'dmgdir', 'killfeed', 'center-msg', 'sub-msg', 'hint', 'progress', 'progress-label', 'progress-fill', 'hpVal', 'armorVal', 'helmetIcon', 'bombIcon', 'kitIcon', 'moneyVal', 'moneyDelta', 'ammo', 'ammoClip', 'ammoRes', 'weaponName', 'weaponbar', 'spectate', 'scope', 'flashbang', 'damageflash', 'buymenu', 'buyCats', 'buyItems', 'buyMoney', 'buyTimer', 'scoreboard', 'sbCT', 'sbT', 'sbScoreCT', 'sbScoreT', 'sbRound', 'buyhint'])
      this.el[id] = $(id);
    this.radarCtx = this.el.radar.getContext('2d');
    this.buyCat = -1;
    this.msgT = 0; this.hitT = 0; this.wbarT = 0;
    this._last = {};
    this.el.buyCats.addEventListener('click', e => { const d = e.target.closest('[data-i]'); if (d) this.openCat(+d.dataset.i); });
    this.el.buyItems.addEventListener('click', e => { const d = e.target.closest('[data-item]'); if (d) this.game.buy(this.game.player, d.dataset.item, true); this.renderBuy(); });
  }

  show(v) { this.el.hud.classList.toggle('hidden', !v); }

  set(id, v) { if (this._last[id] !== v) { this._last[id] = v; this.el[id].textContent = v; } }

  message(text, cls = '', sub = '', dur = 3.5) {
    const m = this.el['center-msg'], s = this.el['sub-msg'];
    m.textContent = text; m.className = 'show ' + cls;
    s.textContent = sub; s.className = sub ? 'show' : '';
    this.msgT = dur;
  }

  hint(text) { this.set('hint', text || ''); }

  hitmarker(head) {
    const h = this.el.hitmarker;
    h.className = 'show' + (head ? ' head' : '');
    this.hitT = 0.12;
  }

  damageFrom(angle) {
    const a = document.createElement('div');
    a.className = 'arc';
    a.style.transform = `rotate(${angle}rad)`;
    this.el.dmgdir.appendChild(a);
    setTimeout(() => a.remove(), 1100);
    this.el.damageflash.style.transition = 'none';
    this.el.damageflash.style.opacity = '0.9';
    requestAnimationFrame(() => { this.el.damageflash.style.transition = 'opacity .6s'; this.el.damageflash.style.opacity = '0'; });
  }

  kill(killer, victim, weapon, hs, involvesPlayer) {
    const d = document.createElement('div');
    d.className = 'kf' + (involvesPlayer ? ' me' : '');
    const k = killer ? `<span class="${killer.team.toLowerCase()}">${killer.name}</span>` : '';
    d.innerHTML = `${k}<span class="w">${weapon}</span>${hs ? '<span class="hs">◉ HS</span>' : ''}<span class="${victim.team.toLowerCase()}">${victim.name}</span>`;
    this.el.killfeed.appendChild(d);
    while (this.el.killfeed.children.length > 5) this.el.killfeed.firstChild.remove();
    setTimeout(() => d.remove(), 6500);
  }

  moneyDelta(v) {
    const e = this.el.moneyDelta;
    e.textContent = (v > 0 ? '+$' : '-$') + Math.abs(v);
    e.className = v > 0 ? 'pos' : 'neg';
    void e.offsetWidth;
    e.className += ' show';
  }

  weaponBar() { this.wbarT = 1.5; }

  progress(label, frac) {
    const p = this.el.progress;
    if (frac == null) { p.classList.remove('show'); return; }
    p.classList.add('show');
    this.set('progress-label', label);
    this.el['progress-fill'].style.width = (frac * 100).toFixed(1) + '%';
  }

  update(dt) {
    const g = this.game, p = g.player, view = g.viewTarget();
    this.msgT -= dt;
    if (this.msgT <= 0) { this.el['center-msg'].className = ''; this.el['sub-msg'].className = ''; }
    this.hitT -= dt; if (this.hitT <= 0) this.el.hitmarker.className = '';
    this.set('scoreCT', String(g.score.CT)); this.set('scoreT', String(g.score.T));
    this.set('aliveCT', g.aliveCount('CT') + ' alive'); this.set('aliveT', g.aliveCount('T') + ' alive');
    // timer
    const rt = this.el.roundtimer;
    if (g.bomb.planted && !g.bomb.defused && !g.bomb.exploded) { this.set('roundtimer', 'C4'); rt.classList.add('bomb'); }
    else {
      rt.classList.remove('bomb');
      const t = Math.max(0, Math.ceil(g.phase === 'freeze' ? g.phaseT : g.roundTimeLeft()));
      this.set('roundtimer', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
    }
    const c = view || p;
    const hp = Math.max(0, Math.ceil(c.hp));
    this.set('hpVal', String(hp));
    this.el.hpVal.parentElement.classList.toggle('low', hp <= 25 && c.alive);
    this.set('armorVal', String(Math.ceil(c.armor)));
    this.el.helmetIcon.classList.toggle('on', c.helmet && c.armor > 0);
    this.el.bombIcon.classList.toggle('on', c.inv.bomb);
    this.el.bombIcon.classList.toggle('blink', c.inv.bomb && g.inSite(c.pos));
    this.el.kitIcon.classList.toggle('on', c.defuser);
    this.set('moneyVal', String(p.money));
    const d = c.def, w = c.wstate;
    this.set('weaponName', d.name.toUpperCase());
    if (w) {
      this.set('ammoClip', String(w.clip)); this.set('ammoRes', String(w.reserve));
      this.el.ammo.classList.toggle('empty', w.clip === 0);
    } else if (d.type === 'grenade') { this.set('ammoClip', String(c.inv.nades[c.nadeSel])); this.set('ammoRes', '-'); this.el.ammo.classList.remove('empty'); }
    else { this.set('ammoClip', '-'); this.set('ammoRes', '-'); this.el.ammo.classList.remove('empty'); }
    // crosshair: dynamic gap from spread (1.6 style)
    const ch = this.el.crosshair;
    const scoped = p.alive && c === p && p.scope > 0;
    ch.style.display = (scoped || (d.type === 'sniper' && c === p)) ? 'none' : '';
    if (!scoped) {
      const spread = c.currentSpread();
      const gap = 3 + Math.min(40, spread * 900 + (c.alive ? c.hspeed() * 0.8 : 0));
      if (Math.abs((this._gap || 0) - gap) > 0.5) {
        this._gap = gap;
        const [l, r, u, dd] = ch.children;
        l.style.left = (-gap - 8) + 'px'; r.style.left = gap + 'px'; u.style.top = (-gap - 8) + 'px'; dd.style.top = gap + 'px';
      }
    }
    this.el.scope.classList.toggle('show', scoped);
    // flash overlay
    const fl = c.alive ? Math.min(1, c.flashT / 1.2) : 0;
    this.el.flashbang.style.opacity = fl.toFixed(3);
    // weapon bar
    this.wbarT -= dt;
    this.el.weaponbar.classList.toggle('show', this.wbarT > 0);
    if (this.wbarT > 0) {
      const rows = [];
      if (p.inv.primary) rows.push([1, WEAPONS[p.inv.primary.id].name]);
      if (p.inv.secondary) rows.push([2, WEAPONS[p.inv.secondary.id].name]);
      rows.push([3, 'Knife']);
      const n = p.inv.nades; const nadeStr = ['he', 'flash', 'smoke'].filter(k => n[k]).map(k => WEAPONS[k].name + (n[k] > 1 ? ' x' + n[k] : '')).join(', ');
      if (nadeStr) rows.push([4, nadeStr]);
      if (p.inv.bomb) rows.push([5, 'C4']);
      const html = rows.map(([s, n]) => `<div class="${p.slot === s ? 'cur' : ''}">${s} · ${n}</div>`).join('');
      if (this._wb !== html) { this._wb = html; this.el.weaponbar.innerHTML = html; }
    }
    // spectate
    this.set('spectate', !p.alive && view && view !== p ? `Наблюдаваш: ${view.name}  ·  клик за смяна` : (!p.alive ? 'Мъртъв си — изчакай следващия рунд' : ''));
    this.el.buyhint.classList.toggle('show', g.canBuy(p) && this.el.buymenu.classList.contains('hidden'));
    if (!this.el.buymenu.classList.contains('hidden')) {
      this.set('buyMoney', '$' + p.money);
      const bt = g.buyTimeLeft();
      this.set('buyTimer', bt > 0 ? Math.ceil(bt) + 's' : '');
      if (!g.canBuy(p)) this.closeBuy();
    }
    this.drawRadar(c);
    if (!this.el.scoreboard.classList.contains('hidden')) this.renderScoreboard();
  }

  drawRadar(c) {
    const g = this.game, ctx = this.radarCtx, S = 200, R = S / 2;
    const scale = 288 / WORLD; // radar image px per metre
    const zoom = 1.6;          // screen px per radar px
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath(); ctx.arc(R, R, R - 1, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = 'rgba(10,10,8,0.62)'; ctx.fillRect(0, 0, S, S);
    ctx.translate(R, R);
    ctx.rotate(c.yaw);
    ctx.scale(zoom, zoom);
    ctx.translate(-(c.pos.x + HALF) * scale, -(c.pos.z + HALF) * scale);
    ctx.drawImage(g.map.radar, 0, 0);
    const dot = (x, z, col, r = 3.2) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc((x + HALF) * scale, (z + HALF) * scale, r / zoom * 1.6, 0, Math.PI * 2); ctx.fill(); };
    for (const o of g.combatants) {
      if (!o.alive || o === c) continue;
      if (o.team === g.player.team) dot(o.pos.x, o.pos.z, o.team === 'CT' ? '#8fc3ff' : '#ff6a55');
      else if (g.time - (o.spottedAt || -9) < 1.2) dot(o.pos.x, o.pos.z, '#ff2a1a', 3.6);
    }
    const b = g.bomb;
    if (b.planted || (g.player.team === 'T' && (b.dropped || b.carrier))) {
      const bp = b.carrier ? b.carrier.pos : b.pos;
      ctx.fillStyle = b.planted && Math.floor(g.time * 4) % 2 ? '#ff3b24' : '#ffb52e';
      ctx.fillRect((bp.x + HALF) * scale - 2.2, (bp.z + HALF) * scale - 2.2, 4.4, 4.4);
    }
    ctx.restore();
    // self arrow
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(R, R - 7); ctx.lineTo(R - 5, R + 5); ctx.lineTo(R, R + 2); ctx.lineTo(R + 5, R + 5); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,181,46,.45)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(R, R, R - 1.5, 0, Math.PI * 2); ctx.stroke();
  }

  // ---------------- buy menu ----------------
  openBuy() {
    if (!this.game.canBuy(this.game.player)) return false;
    this.el.buymenu.classList.remove('hidden');
    this.buyCat = -1;
    this.renderBuy();
    return true;
  }
  closeBuy() { this.el.buymenu.classList.add('hidden'); this.buyCat = -1; }
  buyOpen() { return !this.el.buymenu.classList.contains('hidden'); }
  openCat(i) { this.buyCat = i; this.renderBuy(); }

  itemInfo(key) {
    const w = WEAPONS[key], e = EQUIPMENT[key];
    return w ? { name: w.name, price: w.price, team: w.team, w } : { name: e.name, price: e.price, team: e.team };
  }

  renderBuy() {
    const p = this.game.player;
    this.el.buyCats.innerHTML = BUY_MENU.map((c, i) => `<div data-i="${i}" class="${i === this.buyCat ? 'sel' : ''}"><span><span class="key-n">${i + 1}</span>${c.name}</span><span>›</span></div>`).join('');
    if (this.buyCat < 0) { this.el.buyItems.innerHTML = '<span class="desc">Избери категория. Цените и наличността зависят от отбора ти.</span>'; return; }
    const cat = BUY_MENU[this.buyCat];
    this.el.buyItems.innerHTML = cat.items.map((key, i) => {
      const info = this.itemInfo(key);
      const ok = this.game.canPurchase(p, key);
      const st = info.w && info.w.damage ? `<span class="stat">${info.w.damage} dmg · ${info.w.mag}/${info.w.reserve}</span>` : '';
      return `<div data-item="${key}" class="${ok ? '' : 'na'}"><span><span class="key-n">${i + 1}</span>${info.name}${info.team ? ` <small>(${info.team})</small>` : ''}</span>${st}<span class="price">$${info.price}</span></div>`;
    }).join('');
  }

  buyKey(n) {
    if (n === 0) { if (this.buyCat >= 0) { this.buyCat = -1; this.renderBuy(); } else this.closeBuy(); return; }
    if (this.buyCat < 0) { if (n <= BUY_MENU.length) this.openCat(n - 1); return; }
    const key = BUY_MENU[this.buyCat].items[n - 1];
    if (key) { this.game.buy(this.game.player, key, true); this.renderBuy(); }
  }

  // ---------------- scoreboard ----------------
  showScores(v) { this.el.scoreboard.classList.toggle('hidden', !v); if (v) this.renderScoreboard(); }
  renderScoreboard() {
    const g = this.game;
    this.set('sbScoreCT', String(g.score.CT)); this.set('sbScoreT', String(g.score.T));
    this.set('sbRound', `Рунд ${g.round} · до ${g.winRounds} победи`);
    for (const team of ['CT', 'T']) {
      const list = g.combatants.filter(c => c.team === team).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
      const html = '<tr><th>Играч</th><th>Убийства</th><th>Смърти</th><th>HS</th><th>MVP</th><th>Пари</th></tr>' + list.map(c => {
        const showMoney = c.team === g.player.team;
        return `<tr class="${c.alive ? '' : 'dead'} ${c === g.player ? 'me' : ''}"><td>${c.name}${c.inv.bomb && g.player.team === 'T' ? ' 💣' : ''}${c.alive ? '' : ' ✝'}</td><td>${c.kills}</td><td>${c.deaths}</td><td>${c.hs}</td><td>${c.mvp ? '★' + c.mvp : ''}</td><td>${showMoney ? '$' + c.money : ''}</td></tr>`;
      }).join('');
      const el = team === 'CT' ? this.el.sbCT : this.el.sbT;
      if (el._html !== html) { el._html = html; el.innerHTML = html; }
    }
  }
}
