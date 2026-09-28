// Entry point: loading, menu wiring and the render loop.
import { Engine } from './engine.js';
import { Game } from './game.js';
import { GameAudio } from './audio.js';

const $ = id => document.getElementById(id);
const SETTINGS_KEY = 'strikeforce16.settings';

function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { return {}; }
}
function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* storage unavailable */ }
}

const settings = Object.assign({ team: 'CT', difficulty: '1', size: '5', rounds: '8', quality: 'high', sens: '1' }, loadSettings());
const fields = { team: 'optTeam', difficulty: 'optDiff', size: 'optSize', rounds: 'optRounds', quality: 'optQuality', sens: 'optSens' };
for (const k in fields) $(fields[k]).value = settings[k];
$('sensLabel').textContent = Number(settings.sens).toFixed(2);

for (const k in fields) {
  $(fields[k]).addEventListener('input', e => {
    settings[k] = e.target.value;
    saveSettings(settings);
    if (k === 'sens') $('sensLabel').textContent = Number(settings.sens).toFixed(2);
    if (k === 'quality') { $('loadingText').textContent = 'Прилагане на графичните настройки…'; $('loading').classList.remove('done'); setTimeout(() => location.reload(), 50); }
  });
}

const audio = new GameAudio();
let engine, game;

async function boot() {
  const setStatus = t => { $('loadingText').textContent = t; };
  setStatus('Инициализация на WebGL…');
  await new Promise(r => setTimeout(r, 30));
  try {
    engine = new Engine($('game'), settings.quality);
  } catch (e) {
    setStatus('WebGL не е наличен в този браузър.');
    throw e;
  }
  setStatus('Генериране на текстури и карта…');
  await new Promise(r => setTimeout(r, 30));
  game = new Game(engine, audio);
  game.build(settings.quality);
  game.onQuit = showMenu;
  window.__game = game;
  // warm up shaders
  engine.camera.position.set(0, 40, 90); engine.camera.lookAt(0, 0, 0);
  engine.renderer.compile(engine.scene, engine.camera);
  $('loading').classList.add('done');
  $('playBtn').disabled = false;
  $('playBtn').textContent = 'ИГРАЙ';
  requestAnimationFrame(loop);
}

let last = performance.now(), menuT = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (game.phase === 'menu' || !game.combatants) {
    // slow cinematic orbit behind the menu
    menuT += dt * 0.05;
    engine.camera.position.set(Math.sin(menuT) * 70, 34 + Math.sin(menuT * 2) * 6, Math.cos(menuT) * 70);
    engine.camera.lookAt(0, 2, 0);
    game.effects.update(dt, engine.camera);
    game.physics.updateProps(dt);
  } else {
    game.update(dt);
  }
  engine.render(now / 1000);
}

function startGame() {
  audio.init();
  $('menu').classList.add('hidden');
  $('pause').classList.add('hidden');
  game.startMatch({
    team: settings.team,
    difficulty: Number(settings.difficulty),
    size: Number(settings.size),
    rounds: Number(settings.rounds),
    sens: Number(settings.sens),
  });
  game.paused = false;
  game.controls.lock();
}

function showMenu() {
  document.exitPointerLock?.();
  game.phase = 'menu';
  game.paused = true;
  game.controls.enabled = false;
  game.hud.show(false);
  game.hud.closeBuy();
  if (game.combatants) for (const c of game.combatants) if (c.model) engine.scene.remove(c.model.root);
  game.combatants = null;
  game.vm.setWeapon(null, 'CT');
  engine.camera.fov = 74; engine.camera.updateProjectionMatrix();
  $('pause').classList.add('hidden');
  $('menu').classList.remove('hidden');
  $('playBtn').textContent = 'ИГРАЙ';
}

$('playBtn').addEventListener('click', startGame);
$('pause').addEventListener('click', e => {
  if (e.target.id === 'quitBtn') return;
  audio.init();
  game.controls.lock();
});
$('quitBtn').addEventListener('click', e => { e.stopPropagation(); showMenu(); });

boot().catch(e => { console.error(e); $('loadingText').textContent = 'Грешка при зареждане: ' + e.message; });
