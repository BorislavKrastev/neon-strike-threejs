// Renderer, lighting, sky, post-processing and shared materials.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import * as TX from './textures.js';
import { awningTexture, palmLeafTexture } from './map.js';

export const QUALITY = {
  low: { pixelRatio: 0.75, shadow: 1024, texture: 256, bloom: false, ao: false, msaa: 0, shadowType: THREE.PCFShadowMap },
  medium: { pixelRatio: 1, shadow: 2048, texture: 512, bloom: true, ao: false, msaa: 2, shadowType: THREE.PCFSoftShadowMap },
  high: { pixelRatio: 1.25, shadow: 4096, texture: 512, bloom: true, ao: false, msaa: 4, shadowType: THREE.PCFSoftShadowMap },
  ultra: { pixelRatio: 1.5, shadow: 4096, texture: 1024, bloom: true, ao: true, msaa: 4, shadowType: THREE.PCFSoftShadowMap },
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, time: { value: 0 }, vignette: { value: 0.32 }, grain: { value: 0.035 },
    flash: { value: 0 }, hurt: { value: 0 }, saturation: { value: 1.05 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time, vignette, grain, flash, hurt, saturation;
    varying vec2 vUv;
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + time*7.0) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      vec2 d = uv - 0.5;
      float ca = 0.0012 + hurt * 0.004;
      vec3 c;
      c.r = texture2D(tDiffuse, uv + d * ca).r;
      c.g = texture2D(tDiffuse, uv).g;
      c.b = texture2D(tDiffuse, uv - d * ca).b;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, saturation - hurt * 0.6);
      // warm film grade: lift shadows slightly toward teal, highlights toward amber
      c = c * vec3(1.02, 1.0, 0.97) + vec3(-0.004, 0.002, 0.008) * (1.0 - l);
      float v = smoothstep(0.85, 0.2, length(d) * (1.0 + vignette));
      c *= mix(1.0, v, 0.85);
      c += (rnd(uv) - 0.5) * grain;
      c = mix(c, vec3(1.0), flash);
      c = mix(c, c * vec3(1.25, 0.55, 0.5), hurt * 0.35);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export class Engine {
  constructor(container, qualityName) {
    this.qualityName = qualityName;
    const q = this.q = QUALITY[qualityName];
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    r.setSize(window.innerWidth, window.innerHeight);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.95;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = q.shadowType;
    container.appendChild(r.domElement);
    TX.setAnisotropy(Math.min(8, r.capabilities.getMaxAnisotropy()));

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xd9c4a0, 70, 900);
    this.camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 1200);
    this.scene.add(this.camera);

    // viewmodel layer (rendered on top after clearing depth)
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.01, 10);
    this.vmScene.add(this.vmCamera);

    this._sky();
    this._lights();
    this._post();
    window.addEventListener('resize', () => this.resize());
  }

  _sky() {
    const sky = new Sky();
    sky.scale.setScalar(4000);
    const u = sky.material.uniforms;
    u.turbidity.value = 7;
    u.rayleigh.value = 1.3;
    u.mieCoefficient.value = 0.006;
    u.mieDirectionalG.value = 0.86;
    const elevation = 38, azimuth = 215;
    const phi = THREE.MathUtils.degToRad(90 - elevation), theta = THREE.MathUtils.degToRad(azimuth);
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(this.sunDir);
    this.scene.add(sky);
    this.sky = sky;

    // environment map from the sky for PBR reflections
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const sky2 = new Sky(); sky2.scale.setScalar(4000);
    for (const k in u) if (sky2.material.uniforms[k]) sky2.material.uniforms[k].value = u[k].value;
    envScene.add(sky2);
    // warm ground bounce in the env map
    const groundBounce = new THREE.Mesh(new THREE.SphereGeometry(1000, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x8a7050, side: THREE.BackSide }));
    envScene.add(groundBounce);
    this.envMap = pmrem.fromScene(envScene, 0.02).texture;
    this.scene.environment = this.envMap;
    this.vmScene.environment = this.envMap;
    pmrem.dispose();
  }

  _lights() {
    const sun = this.sun = new THREE.DirectionalLight(0xffeccc, 4.2);
    sun.position.copy(this.sunDir).multiplyScalar(160);
    sun.castShadow = true;
    const s = sun.shadow;
    s.mapSize.set(this.q.shadow, this.q.shadow);
    s.camera.left = -82; s.camera.right = 82; s.camera.top = 82; s.camera.bottom = -82;
    s.camera.near = 10; s.camera.far = 400;
    s.bias = -0.0004; s.normalBias = 0.035;
    s.radius = 2.5;
    this.scene.add(sun, sun.target);
    const hemi = new THREE.HemisphereLight(0xa8c4f0, 0x8a6a45, 0.45);
    this.scene.add(hemi);

    // viewmodel lighting matches the world
    const vsun = new THREE.DirectionalLight(0xfff1d8, 2.4);
    vsun.position.set(0.6, 1, 0.4);
    this.vmScene.add(vsun);
    this.vmScene.add(new THREE.HemisphereLight(0xbcd4ff, 0x9c7a50, 1.1));
    this.vmSun = vsun;
  }

  _post() {
    const q = this.q, r = this.renderer;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: q.msaa });
    const comp = this.composer = new EffectComposer(r, rt);
    comp.setPixelRatio(r.getPixelRatio());
    comp.setSize(window.innerWidth, window.innerHeight);
    const main = new RenderPass(this.scene, this.camera);
    comp.addPass(main);
    if (q.ao) {
      const gtao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.6, thickness: 1.2, scale: 1.1, samples: 12 });
      gtao.blendIntensity = 0.85;
      // keep sprites, particles and decals out of the AO G-buffer
      gtao.overrideVisibility = function () {
        const cache = this._visibilityCache;
        this.scene.traverse(o => {
          cache.set(o, o.visible);
          if (o.isPoints || o.isLine || o.isSprite || (o.material && o.material.transparent)) o.visible = false;
        });
      };
      comp.addPass(gtao);
      this.gtao = gtao;
    }
    const vm = new RenderPass(this.vmScene, this.vmCamera);
    vm.clear = false; vm.clearDepth = true;
    comp.addPass(vm);
    if (q.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.22, 0.5, 0.92);
      comp.addPass(this.bloom);
    }
    comp.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    comp.addPass(this.grade);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h; this.vmCamera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  render(time) {
    this.grade.uniforms.time.value = time % 100;
    this.composer.render();
  }

  // --------- materials ---------
  makeMaterials() {
    const S = this.q.texture;
    const std = (tex, extra = {}) => new THREE.MeshStandardMaterial({ ...tex, envMapIntensity: 0.32, ...extra });
    const sandstone = TX.sandstoneTexture(S, 3);
    const sandstone2 = TX.sandstoneTexture(S, 17, [0.74, 0.6, 0.44]);
    const plaster = TX.plasterTexture(S, 7, [0.82, 0.74, 0.6]);
    const sand = TX.sandTexture(S);
    const tile = TX.tileTexture(S, 31);
    const concrete = TX.concreteTexture(Math.min(S, 512), 41);
    const crate = TX.crateTexture(Math.min(S, 512), 21);
    const fabric = TX.fabricTexture(256, 61);
    const metals = {
      blue: TX.metalTexture(256, 51, [0.16, 0.26, 0.42]),
      olive: TX.metalTexture(256, 52, [0.3, 0.33, 0.2]),
      red: TX.metalTexture(256, 53, [0.55, 0.1, 0.06]),
      dark: TX.metalTexture(256, 54, [0.12, 0.12, 0.12]),
    };
    const nrm = new THREE.Vector2(1, 1);
    const m = {
      sandstone: std(sandstone, { vertexColors: true, normalScale: nrm }),
      plaster: std(plaster, { vertexColors: true }),
      trim: std(sandstone2, { vertexColors: true, color: 0xcdbb9c }),
      trimSolid: std(sandstone2, { color: 0xcdbb9c }),
      plasterSolid: std(plaster, {}),
      dome: std(tile, { color: 0x7fa6b0, roughness: 0.6, metalness: 0.1 }),
      ground: std(sand, { vertexColors: true, envMapIntensity: 0.35 }),
      tile: std(tile, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
      concrete: std(concrete, { vertexColors: true }),
      crate: std(crate, { vertexColors: true }),
      door: std(crate, { vertexColors: true, color: 0x9a7a60 }),
      darkWood: std(crate, { vertexColors: true, color: 0x8a6444 }),
      metalDark: new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5, metalness: 0.8 }),
      palmTrunk: new THREE.MeshStandardMaterial({ color: 0x6d5438, roughness: 0.95, normalMap: sandstone.normalMap }),
      palmLeaf: new THREE.MeshStandardMaterial({ map: palmLeafTexture(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8 }),
      awning: new THREE.MeshStandardMaterial({ map: awningTexture(), side: THREE.DoubleSide, roughness: 0.95 }),
      barrel: {},
      fabric,
      gunMetal: new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.42, metalness: 0.7, envMapIntensity: 0.35, normalMap: metals.dark.normalMap }),
      gunSteel: new THREE.MeshStandardMaterial({ color: 0x75777b, roughness: 0.32, metalness: 0.9, envMapIntensity: 0.45 }),
      polymer: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.65, metalness: 0.05, envMapIntensity: 0.4, normalMap: fabric.normalMap, normalScale: new THREE.Vector2(0.3, 0.3) }),
      gunWood: new THREE.MeshStandardMaterial({ map: crate.map, color: 0xb0703a, roughness: 0.55, metalness: 0.0 }),
      awpGreen: new THREE.MeshStandardMaterial({ color: 0x3b4a34, roughness: 0.6, metalness: 0.1, envMapIntensity: 0.4, normalMap: fabric.normalMap, normalScale: new THREE.Vector2(0.2, 0.2) }),
      lens: new THREE.MeshStandardMaterial({ color: 0x0a1a30, roughness: 0.05, metalness: 1, emissive: 0x102040, emissiveIntensity: 0.4 }),
      brass: new THREE.MeshStandardMaterial({ color: 0xc8a040, roughness: 0.3, metalness: 1 }),
      glove: new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.75, normalMap: fabric.normalMap }),
      skin: new THREE.MeshStandardMaterial({ color: 0xc08a68, roughness: 0.7 }),
      c4: new THREE.MeshStandardMaterial({ color: 0x8a7a5a, roughness: 0.8 }),
      c4Led: new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff2010, emissiveIntensity: 0 }),
    };
    for (const k of ['blue', 'olive', 'red']) m.barrel[k] = new THREE.MeshStandardMaterial({ ...metals[k], metalness: 0.45, envMapIntensity: 0.6 });
    // team clothing
    const cloth = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.92, map: fabric.map, normalMap: fabric.normalMap, normalScale: new THREE.Vector2(0.6, 0.6) });
    m.team = {
      T: { shirt: cloth(0x7b6446), pants: cloth(0x5a4b36), vest: cloth(0x3b3a2c), head: cloth(0x1a1a1a), accent: cloth(0x8c3a28), sleeve: cloth(0x6e5a40) },
      CT: { shirt: cloth(0x3a4656), pants: cloth(0x2e3642), vest: cloth(0x1f252d), head: new THREE.MeshStandardMaterial({ color: 0x2b323b, roughness: 0.45, metalness: 0.3 }), accent: cloth(0x3c5a7a), sleeve: cloth(0x2e3a48) },
    };
    this.mats = m;
    return m;
  }
}
