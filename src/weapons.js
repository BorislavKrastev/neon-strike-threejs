// Weapon definitions (1.6-era balance, metres/seconds) and procedural gun models.
import * as THREE from 'three';

const U = 0.0254; // GoldSrc unit -> metres
const deg = THREE.MathUtils.degToRad;

// spread values are radians; recoil in radians per shot
export const WEAPONS = {
  knife: { id: 'knife', name: 'Knife', slot: 3, type: 'melee', damage: 34, damageBack: 65, rate: 0.45, range: 1.9, speed: 250 * U, price: 0, killReward: 1500 },
  glock: { id: 'glock', name: 'Glock-18', slot: 2, type: 'pistol', team: 'T', price: 400, damage: 25, pen: 0.47, rangeMod: 0.75, rate: 0.15, auto: false, mag: 20, reserve: 120, reload: 2.2,
    speed: 250 * U, spread: 0.009, spreadMove: 0.03, spreadAir: 0.12, spreadShot: 0.006, kick: deg(1.6), kickInc: deg(0.1), kickMax: deg(3), side: deg(0.4), killReward: 300, sound: 'pistol', tracer: 0 },
  usp: { id: 'usp', name: 'USP .45', slot: 2, type: 'pistol', team: 'CT', price: 500, damage: 34, pen: 0.5, rangeMod: 0.79, rate: 0.15, auto: false, mag: 12, reserve: 100, reload: 2.7,
    speed: 250 * U, spread: 0.008, spreadMove: 0.03, spreadAir: 0.12, spreadShot: 0.007, kick: deg(1.9), kickInc: deg(0.1), kickMax: deg(3.5), side: deg(0.4), killReward: 300, sound: 'usp', tracer: 0 },
  deagle: { id: 'deagle', name: 'Desert Eagle', slot: 2, type: 'pistol', price: 650, damage: 54, pen: 0.75, rangeMod: 0.81, rate: 0.24, auto: false, mag: 7, reserve: 35, reload: 2.2,
    speed: 250 * U, spread: 0.01, spreadMove: 0.05, spreadAir: 0.2, spreadShot: 0.02, kick: deg(4.5), kickInc: deg(0.3), kickMax: deg(7), side: deg(0.8), killReward: 300, sound: 'deagle', tracer: 0 },
  mp5: { id: 'mp5', name: 'MP5 Navy', slot: 1, type: 'smg', price: 1500, damage: 26, pen: 0.5, rangeMod: 0.84, rate: 0.075, auto: true, mag: 30, reserve: 120, reload: 2.6,
    speed: 250 * U, spread: 0.012, spreadMove: 0.02, spreadAir: 0.1, spreadShot: 0.0025, kick: deg(0.55), kickInc: deg(0.12), kickMax: deg(3.5), side: deg(0.35), killReward: 600, sound: 'smg', tracer: 0.25 },
  m3: { id: 'm3', name: 'M3 Super 90', slot: 1, type: 'shotgun', price: 1700, damage: 20, pellets: 9, pen: 0.5, rangeMod: 0.7, rate: 0.88, auto: false, mag: 8, reserve: 32, reload: 0.45, shellReload: true,
    speed: 220 * U, spread: 0.07, spreadMove: 0.02, spreadAir: 0.08, spreadShot: 0, kick: deg(5), kickInc: 0, kickMax: deg(6), side: deg(0.8), killReward: 900, sound: 'shotgun', tracer: 0.6 },
  ak47: { id: 'ak47', name: 'AK-47', slot: 1, type: 'rifle', team: 'T', price: 2500, damage: 36, pen: 0.775, rangeMod: 0.98, rate: 0.1, auto: true, mag: 30, reserve: 90, reload: 2.45,
    speed: 221 * U, spread: 0.0045, spreadMove: 0.07, spreadAir: 0.2, spreadShot: 0.0035, kick: deg(0.95), kickInc: deg(0.19), kickMax: deg(5.8), side: deg(0.55), sideAfter: 5, killReward: 300, sound: 'ak', tracer: 0.3 },
  m4a1: { id: 'm4a1', name: 'M4A1', slot: 1, type: 'rifle', team: 'CT', price: 3100, damage: 33, pen: 0.7, rangeMod: 0.97, rate: 0.09, auto: true, mag: 30, reserve: 90, reload: 3.05,
    speed: 230 * U, spread: 0.0035, spreadMove: 0.06, spreadAir: 0.18, spreadShot: 0.0028, kick: deg(0.75), kickInc: deg(0.15), kickMax: deg(4.6), side: deg(0.42), sideAfter: 6, killReward: 300, sound: 'm4', tracer: 0.3 },
  awp: { id: 'awp', name: 'AWP', slot: 1, type: 'sniper', price: 4750, damage: 115, pen: 0.97, rangeMod: 0.99, rate: 1.45, auto: false, mag: 10, reserve: 30, reload: 2.9, scope: [40, 12],
    speed: 210 * U, scopedSpeed: 150 * U, spread: 0.11, spreadScoped: 0.0012, spreadMove: 0.12, spreadAir: 0.3, spreadShot: 0, kick: deg(2.4), kickInc: 0, kickMax: deg(3), side: deg(0.3), killReward: 100, sound: 'awp', tracer: 1 },
  he: { id: 'he', name: 'HE Grenade', slot: 4, type: 'grenade', price: 300, max: 1, speed: 250 * U, rate: 1 },
  flash: { id: 'flash', name: 'Flashbang', slot: 4, type: 'grenade', price: 200, max: 2, speed: 250 * U, rate: 1 },
  smoke: { id: 'smoke', name: 'Smoke Grenade', slot: 4, type: 'grenade', price: 300, max: 1, speed: 250 * U, rate: 1 },
  c4: { id: 'c4', name: 'C4 Explosive', slot: 5, type: 'c4', speed: 250 * U, rate: 1 },
};

export const BUY_MENU = [
  { name: 'Pistols', items: ['glock', 'usp', 'deagle'] },
  { name: 'Shotguns', items: ['m3'] },
  { name: 'SMGs', items: ['mp5'] },
  { name: 'Rifles', items: ['ak47', 'm4a1', 'awp'] },
  { name: 'Equipment', items: ['vest', 'vesthelm', 'he', 'flash', 'smoke', 'defuser'] },
  { name: 'Ammo', items: ['ammo1', 'ammo2'] },
];
export const EQUIPMENT = {
  vest: { name: 'Kevlar Vest', price: 650 },
  vesthelm: { name: 'Kevlar + Helmet', price: 1000 },
  defuser: { name: 'Defuse Kit', price: 200, team: 'CT' },
  ammo1: { name: 'Primary ammo', price: 60 },
  ammo2: { name: 'Secondary ammo', price: 50 },
};

// ----------------------------------------------------------------------------------
// Procedural models. Barrel points along -Z, grip roughly at the origin.
function box(w, h, d, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  return m;
}
function cyl(r1, r2, len, mat, x = 0, y = 0, z = 0, seg = 14) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, seg), mat);
  m.rotation.x = Math.PI / 2; m.position.set(x, y, z);
  return m;
}

export function buildWeaponModel(id, M) {
  const g = new THREE.Group();
  const add = (...ms) => ms.forEach(m => g.add(m));
  let muzzle = new THREE.Vector3(0, 0, -0.5), mag = null, eject = new THREE.Vector3(0.03, 0.04, -0.05);
  switch (id) {
    case 'ak47': {
      add(box(0.052, 0.075, 0.3, M.gunMetal, 0, 0.0, -0.02),
        box(0.046, 0.022, 0.27, M.gunMetal, 0, 0.045, -0.02),
        cyl(0.011, 0.011, 0.42, M.gunMetal, 0, 0.012, -0.38),
        cyl(0.012, 0.012, 0.24, M.gunMetal, 0, 0.042, -0.29),
        box(0.058, 0.05, 0.19, M.gunWood, 0, 0.004, -0.27),
        box(0.05, 0.03, 0.14, M.gunWood, 0, 0.045, -0.29),
        box(0.012, 0.045, 0.012, M.gunMetal, 0, 0.045, -0.56),
        cyl(0.016, 0.016, 0.05, M.gunMetal, 0, 0.012, -0.6),
        box(0.034, 0.1, 0.048, M.gunWood, 0, -0.075, 0.08, -0.35),
        box(0.042, 0.08, 0.28, M.gunWood, 0, -0.03, 0.26, 0.12),
        box(0.012, 0.02, 0.05, M.gunMetal, 0, 0.055, 0.1));
      mag = new THREE.Group();
      for (let k = 0; k < 3; k++) mag.add(box(0.03, 0.07, 0.065, M.gunMetal, 0, -0.035 - k * 0.058, -0.01 - k * 0.022, -0.3 - k * 0.18));
      mag.position.set(0, -0.04, -0.07);
      add(mag);
      muzzle.set(0, 0.012, -0.63); eject.set(0.03, 0.04, -0.04);
      break;
    }
    case 'm4a1': {
      add(box(0.05, 0.085, 0.28, M.gunMetal, 0, 0, -0.02),
        box(0.028, 0.03, 0.22, M.gunMetal, 0, 0.056, -0.04),
        box(0.012, 0.05, 0.02, M.gunMetal, 0, 0.078, 0.06),
        cyl(0.028, 0.028, 0.2, M.polymer, 0, 0.012, -0.26),
        cyl(0.01, 0.01, 0.12, M.gunMetal, 0, 0.012, -0.41),
        cyl(0.02, 0.02, 0.19, M.gunMetal, 0, 0.012, -0.55),
        box(0.012, 0.055, 0.012, M.gunMetal, 0, 0.05, -0.36),
        box(0.034, 0.095, 0.045, M.polymer, 0, -0.075, 0.07, -0.35),
        box(0.04, 0.07, 0.2, M.polymer, 0, -0.01, 0.26),
        cyl(0.014, 0.014, 0.18, M.gunMetal, 0, 0.02, 0.18),
        box(0.042, 0.1, 0.03, M.polymer, 0, -0.03, 0.36));
      mag = box(0.028, 0.14, 0.06, M.gunMetal, 0, -0.1, -0.07, 0.12);
      add(mag);
      muzzle.set(0, 0.012, -0.65);
      break;
    }
    case 'awp': {
      add(box(0.055, 0.08, 0.36, M.awpGreen, 0, 0, -0.02),
        cyl(0.013, 0.015, 0.6, M.gunMetal, 0, 0.018, -0.5),
        cyl(0.018, 0.018, 0.07, M.gunMetal, 0, 0.018, -0.82),
        box(0.06, 0.07, 0.32, M.awpGreen, 0, -0.01, -0.3),
        box(0.05, 0.13, 0.08, M.awpGreen, 0, -0.06, 0.12),
        box(0.05, 0.09, 0.34, M.awpGreen, 0, -0.02, 0.35),
        box(0.052, 0.14, 0.04, M.awpGreen, 0, -0.04, 0.5),
        cyl(0.026, 0.026, 0.3, M.gunMetal, 0, 0.085, -0.04),
        cyl(0.032, 0.026, 0.06, M.gunMetal, 0, 0.085, -0.2),
        cyl(0.03, 0.026, 0.05, M.gunMetal, 0, 0.085, 0.12),
        box(0.02, 0.03, 0.03, M.gunMetal, 0, 0.05, -0.04),
        cyl(0.008, 0.008, 0.07, M.gunSteel, 0.045, 0.02, 0.06));
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.029, 20), M.lens); lens.position.set(0, 0.085, -0.231); lens.rotation.y = Math.PI; add(lens);
      mag = box(0.04, 0.07, 0.08, M.gunMetal, 0, -0.07, -0.08); add(mag);
      muzzle.set(0, 0.018, -0.87);
      break;
    }
    case 'mp5': {
      add(cyl(0.028, 0.028, 0.3, M.gunMetal, 0, 0.01, -0.06),
        box(0.045, 0.05, 0.14, M.polymer, 0, -0.005, -0.25),
        cyl(0.01, 0.01, 0.1, M.gunMetal, 0, 0.01, -0.36),
        box(0.012, 0.04, 0.02, M.gunMetal, 0, 0.05, -0.2),
        box(0.034, 0.09, 0.045, M.polymer, 0, -0.07, 0.08, -0.3),
        cyl(0.008, 0.008, 0.25, M.gunMetal, 0.018, 0.0, 0.22),
        cyl(0.008, 0.008, 0.25, M.gunMetal, -0.018, 0.0, 0.22),
        box(0.05, 0.07, 0.02, M.gunMetal, 0, -0.02, 0.34));
      mag = new THREE.Group();
      for (let k = 0; k < 3; k++) mag.add(box(0.025, 0.05, 0.035, M.gunMetal, 0, -0.025 - k * 0.045, -0.005 - k * 0.012, -0.15 - k * 0.12));
      mag.position.set(0, -0.02, -0.12); add(mag);
      muzzle.set(0, 0.01, -0.42);
      break;
    }
    case 'm3': {
      add(box(0.05, 0.07, 0.24, M.gunMetal, 0, 0, 0),
        cyl(0.014, 0.014, 0.5, M.gunMetal, 0, 0.02, -0.37),
        cyl(0.016, 0.016, 0.42, M.gunMetal, 0, -0.012, -0.33),
        cyl(0.026, 0.026, 0.16, M.polymer, 0, -0.012, -0.28),
        box(0.034, 0.1, 0.045, M.polymer, 0, -0.075, 0.1, -0.35),
        box(0.042, 0.08, 0.3, M.polymer, 0, -0.03, 0.28, 0.1));
      mag = g.children[3];
      muzzle.set(0, 0.02, -0.63);
      break;
    }
    case 'deagle': {
      add(box(0.034, 0.045, 0.23, M.gunSteel, 0, 0.03, -0.07),
        box(0.03, 0.028, 0.18, M.gunSteel, 0, 0.0, -0.05),
        box(0.032, 0.11, 0.05, M.polymer, 0, -0.055, 0.02, -0.25),
        box(0.008, 0.012, 0.01, M.gunMetal, 0, 0.058, -0.17),
        box(0.02, 0.03, 0.03, M.gunSteel, 0, -0.02, -0.04));
      mag = box(0.024, 0.06, 0.035, M.gunMetal, 0, -0.1, 0.035, -0.25); add(mag);
      muzzle.set(0, 0.03, -0.19);
      break;
    }
    case 'glock':
    case 'usp': {
      const slide = id === 'usp' ? M.gunMetal : M.polymer;
      add(box(0.03, 0.036, 0.19, slide, 0, 0.028, -0.06),
        box(0.028, 0.024, 0.15, M.polymer, 0, 0.0, -0.05),
        box(0.028, 0.1, 0.045, M.polymer, 0, -0.05, 0.02, -0.25),
        box(0.018, 0.022, 0.028, M.polymer, 0, -0.02, -0.035));
      if (id === 'usp') add(cyl(0.015, 0.015, 0.14, M.gunMetal, 0, 0.022, -0.22));
      mag = box(0.022, 0.05, 0.032, M.gunMetal, 0, -0.1, 0.035, -0.25); add(mag);
      muzzle.set(0, 0.025, id === 'usp' ? -0.3 : -0.16);
      break;
    }
    case 'knife': {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.035, 0.2), M.gunSteel);
      const pos = blade.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) if (pos.getZ(i) < 0 && pos.getY(i) < 0) pos.setY(i, pos.getY(i) + 0.03);
      blade.geometry.computeVertexNormals();
      blade.position.set(0, 0.012, -0.12);
      add(blade, box(0.02, 0.03, 0.11, M.polymer, 0, 0, 0.04), box(0.03, 0.05, 0.012, M.gunMetal, 0, 0.005, -0.02));
      muzzle.set(0, 0, -0.2);
      break;
    }
    case 'he': case 'flash': case 'smoke': {
      const body = id === 'he'
        ? new THREE.Mesh(new THREE.SphereGeometry(0.036, 14, 10), new THREE.MeshStandardMaterial({ color: 0x3d4a2a, roughness: 0.6 }))
        : new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.1, 14), new THREE.MeshStandardMaterial({ color: id === 'flash' ? 0x9aa0a4 : 0x5a6a5a, roughness: 0.5, metalness: 0.4 }));
      add(body, box(0.012, 0.05, 0.02, M.gunSteel, 0.02, 0.05, 0, 0, 0, 0.3), cyl(0.012, 0.012, 0.02, M.gunSteel, 0, 0.05, 0));
      g.children[2].rotation.x = 0;
      muzzle.set(0, 0, 0);
      break;
    }
    case 'c4': {
      add(box(0.2, 0.06, 0.13, M.c4, 0, 0, 0), box(0.07, 0.012, 0.06, M.polymer, -0.04, 0.036, 0), box(0.04, 0.01, 0.025, M.lens, 0.05, 0.035, -0.03));
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), M.c4Led); led.position.set(0.07, 0.036, 0.04); add(led);
      for (let k = 0; k < 3; k++) add(cyl(0.006, 0.006, 0.13, new THREE.MeshStandardMaterial({ color: [0xaa2222, 0x2244aa, 0xcccc22][k], roughness: 0.5 }), -0.05 + k * 0.012, 0.034, 0));
      muzzle.set(0, 0, 0);
      g.userData.led = led;
      break;
    }
  }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
  g.userData.muzzle = muzzle;
  g.userData.mag = mag;
  g.userData.magHome = mag ? mag.position.clone() : null;
  g.userData.eject = eject;
  return g;
}
