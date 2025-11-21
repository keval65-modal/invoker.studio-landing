import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

// ========== CONFIGURATION ==========
const DEV_DEBUG_VISUALS = true;
const ENABLE_SEASON_PLACEHOLDERS = false;
const ENABLE_BLOOM = true;


const ENABLE_AURORA_BANDS = false;
const GLOBE_RADIUS = 10; // doubled for larger world
const TORUS_MAJOR_RADIUS = GLOBE_RADIUS + 0.3;
const TORUS_MINOR_RADIUS = 0.08;
const CHARACTER_SIZE = 0.3;
const CHARACTER_RING_CLEARANCE = 0.15;
const HOTSPOT_COUNT = 4;
const SEASONS = ['summer', 'rain', 'autumn', 'winter'];
const FORCE_LOW_QUALITY = true;
const IS_LOW_POWER_DEVICE = (() => {
    if (typeof navigator !== 'undefined') {
        if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) return true;
        if (navigator.deviceMemory && navigator.deviceMemory <= 4) return true;
        if (/mobi|android|iphone|ipad/i.test(navigator.userAgent)) return true;
    }
    if (typeof window !== 'undefined') {
        return window.innerWidth < 1024;
    }
    return false;
})();
const DEVICE_PIXEL_RATIO_LIMIT = IS_LOW_POWER_DEVICE ? 0.75 : 0.95;
const HIGH_DEVICE_PIXEL_RATIO = 1.2;
const PARTICLE_COUNT_SCALE = IS_LOW_POWER_DEVICE ? 0.4 : 0.8;
const DECOR_COUNT_SCALE = IS_LOW_POWER_DEVICE ? 0.4 : 0.75;
const FOREST_DENSITY_SCALE = IS_LOW_POWER_DEVICE ? 0.35 : 0.55;
const PARTICLE_UPDATE_INTERVAL = IS_LOW_POWER_DEVICE ? 3 : 2;
const CRYSTAL_DRIFT_COUNT = IS_LOW_POWER_DEVICE ? 3 : 6;
const MAGIC_CLUSTER_COUNT = IS_LOW_POWER_DEVICE ? 4 : 8;
const SEASON_ANGLES = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]; // 0°, 90°, 180°, 270°
const ALLOW_SEASON_FX = !IS_LOW_POWER_DEVICE;

// Character movement controls
const CHARACTER_BASE_ROTATION_SPEED = 0.8; // radians per second
const CHARACTER_ROTATION_ACCEL = 5; // smoothing factor
const SCROLL_ROTATION_IMPULSE = 0.4;
const SCROLL_ROTATION_STEP = 0.05; // legacy for impulse magnitude scaling
const TOUCH_SCROLL_STEP = 12; // px delta per impulse on touch devices
const TOUCH_DRAG_SENS = 1.1;

// ========== SCENE SETUP ==========
const canvas = document.getElementById('c');
canvas.style.backgroundColor = '#05000c';

const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');
const loadingProgress = document.getElementById('loading-progress');
const loadingPreviewCanvas = null;
let loadingPreview = null;
const canvasFreezeCover = (() => {
    const el = document.createElement('canvas');
    el.id = 'canvas-freeze-cover';
    el.style.position = 'fixed';
    el.style.inset = '0';
    el.style.zIndex = '100';
    el.style.pointerEvents = 'none';
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.25s ease';
    document.body.appendChild(el);
    return el;
})();
const loadingBarFill = document.getElementById('loading-bar-fill');
const lorePanel = document.getElementById('lore-panel');
const lorePanelTitle = document.getElementById('lore-panel-title');
const lorePanelBody = document.getElementById('lore-panel-body');
const lorePanelClose = document.getElementById('lore-panel-close');
const hotspotButtons = Array.from(document.querySelectorAll('.hotspot-btn'));
if (loadingOverlay) {
    document.body.classList.add('is-loading');
}
if (loadingText) {
    loadingText.textContent = 'Preparing...';
}

function updateLoadingVisual(percent) {
    if (loadingProgress) {
        loadingProgress.textContent = `Loading ${percent}%`;
    }
    if (loadingBarFill) {
        loadingBarFill.style.width = `${percent}%`;
    }
}

const loadingManager = new THREE.LoadingManager();
let overlayDismissed = false;
function dismissLoadingOverlay(message) {
    if (overlayDismissed) return;
    overlayDismissed = true;
    if (message && loadingProgress) {
        loadingProgress.textContent = message;
    }
    document.body.classList.remove('is-loading');
    stopLoadingPreview();
    if (loadingOverlay) {
        loadingOverlay.classList.add('is-hidden');
        setTimeout(() => {
            if (loadingOverlay.parentElement) {
                loadingOverlay.remove();
            }
        }, 650);
    }
}

loadingManager.onStart = () => {
    updateLoadingVisual(0);
};

loadingManager.onProgress = (_url, itemsLoaded, itemsTotal) => {
    if (!itemsTotal) return;
    const percent = Math.round((itemsLoaded / itemsTotal) * 100);
    updateLoadingVisual(percent);
};

function compileView() {
    if (renderer.compileAsync) {
        return renderer.compileAsync(scene, camera);
    }
    renderer.compile(scene, camera);
    return Promise.resolve();
}

loadingManager.onLoad = () => {
    dismissLoadingOverlay('Loading complete');
};

loadingManager.onError = (url) => {
    if (loadingProgress) {
        const label = url ? url.split('/').pop() : 'asset';
        loadingProgress.textContent = `Retrying ${label}...`;
    }
};

const scene = new THREE.Scene();
// Skybox will be set after loading
scene.background = new THREE.Color(0x0a0a1a); // Temporary background until skybox loads

const aspect = window.innerWidth / window.innerHeight;
// PerspectiveCamera for third-person view
const camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 100);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, DEVICE_PIXEL_RATIO_LIMIT));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor('#05000c', 1);
let animationPaused = false;
function freezeRenderer() {
    if (animationPaused) return;
    animationPaused = true;
    loreInteractivityEnabled = false;
    renderer.autoClear = true;
    renderer.render(scene, camera);
    const ctx = canvasFreezeCover.getContext('2d');
    canvasFreezeCover.width = canvas.width;
    canvasFreezeCover.height = canvas.height;
    ctx.drawImage(canvas, 0, 0);
    canvas.style.opacity = '0';
    canvasFreezeCover.style.opacity = '1';
}
function resumeRenderer() {
    if (!animationPaused) return;
    animationPaused = false;
    loreInteractivityEnabled = true;
    canvas.style.opacity = '1';
    canvasFreezeCover.style.opacity = '0';
    canvasFreezeCover.width = 0;
    canvasFreezeCover.height = 0;
}
if (typeof window !== 'undefined') {
    window.renderer = renderer;
}
const CARTOON_LEVELS = 9.0;
const CARTOON_BLEND = 0.45;
const CartoonShader = {
    uniforms: {
        tDiffuse: { value: null },
        levels: { value: CARTOON_LEVELS },
        blend: { value: CARTOON_BLEND }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        varying vec2 vUv;
        uniform sampler2D tDiffuse;
        uniform float levels;
        uniform float blend;
        void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            vec3 quantized = floor(color.rgb * levels) / levels;
            color.rgb = mix(color.rgb, quantized, clamp(blend, 0.0, 1.0));
            gl_FragColor = color;
        }
    `
};

const cartoonComposer = new EffectComposer(renderer);
const baseRenderPass = new RenderPass(scene, camera);
const cartoonPass = new ShaderPass(CartoonShader);
cartoonPass.uniforms.levels.value = CARTOON_LEVELS;
cartoonPass.uniforms.blend.value = CARTOON_BLEND;
cartoonComposer.addPass(baseRenderPass);
cartoonComposer.addPass(cartoonPass);
cartoonComposer.setSize(window.innerWidth, window.innerHeight);
let adaptiveQuality = 'low';
let fpsAverage = 60;
let adaptiveTimer = 0;
let lastFrameStamp = performance.now();
function applyQualitySettings(mode) {
    adaptiveQuality = mode;
    adaptiveTimer = 0;
    const ratio = mode === 'high'
        ? Math.min(window.devicePixelRatio || 1, HIGH_DEVICE_PIXEL_RATIO)
        : DEVICE_PIXEL_RATIO_LIMIT;
    renderer.setPixelRatio(ratio);
    renderer.shadowMap.enabled = mode !== 'low';
    cartoonPass.enabled = (mode === 'low');
}
applyQualitySettings('low');
const fpsOverlay = document.getElementById('fps-overlay') || (() => {
    const el = document.createElement('div');
    el.id = 'fps-overlay';
    el.style.position = 'fixed';
    el.style.top = '20px';
    el.style.right = '20px';
    el.style.padding = '6px 10px';
    el.style.fontSize = '12px';
    el.style.fontFamily = 'monospace';
    el.style.color = '#fff';
    el.style.background = 'rgba(5,0,12,0.55)';
    el.style.border = '1px solid rgba(255,255,255,0.2)';
    el.style.borderRadius = '8px';
    el.style.zIndex = '999';
    el.style.pointerEvents = 'none';
    el.textContent = 'FPS --';
    document.body.appendChild(el);
    return el;
})();

// ========== THIRD-PERSON CAMERA (OVER-SHOULDER FOLLOW) ==========
const CAMERA_VERTICAL_OFFSET = 5.2;   // Slightly higher for full-shot framing
const CAMERA_LOOK_AT_OFFSET = 1.0;    // Height offset for look target
const CAMERA_TRAIL_DISTANCE = 8.2 * 1.15;    // Distance behind character along path tangent (pulled back ~15%)
const CAMERA_OUTWARD_OFFSET = 2.4;    // Push camera away from ring for depth
const CAMERA_POSITION_SMOOTH = 0.08;
const CAMERA_LOOK_SMOOTH = 0.12;
const PIXEL_PARTICLE_MIN_Y = -2.5;
const PIXEL_PARTICLE_MAX_Y = 5.2;
let cameraFollowDirection = 1;
// Create SphereGeometry: radius 5, 64 width segments, 64 height segments
const globeGeometry = new THREE.SphereGeometry(GLOBE_RADIUS, 64, 64);

// Load textures using THREE.TextureLoader
const textureLoader = new THREE.TextureLoader(loadingManager);

// Load diffuse map (terrainTexture.jpg)
const globeTexture = textureLoader.load(
    '/assets/terrainTexture.jpg',
    (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
        console.log('Globe diffuse texture loaded');
    },
    undefined,
    (error) => {
        console.warn('Failed to load globe diffuse texture:', error);
    }
);

// Load normal map (terrain_normal_map.png)
const globeNormalMap = textureLoader.load(
    '/assets/terrain_normal_map.png',
    (texture) => {
        texture.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
        console.log('Globe normal map loaded');
    },
    undefined,
    (error) => {
        console.warn('Failed to load globe normal map:', error);
    }
);

// Configure texture properties
if (globeTexture) {
    globeTexture.colorSpace = THREE.SRGBColorSpace;
    globeTexture.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
}

// Apply MeshStandardMaterial with color texture and normal map
const globeMaterial = new THREE.MeshStandardMaterial({
    map: globeTexture,
    normalMap: globeNormalMap,
    metalness: 0.1,
    roughness: 0.8
});

// Create mesh and position at origin (0, 0, 0)
const globe = new THREE.Mesh(globeGeometry, globeMaterial);
globe.position.set(0, 0, 0); // Explicitly set to origin
// Enable shadows on globe
globe.castShadow = true;
globe.receiveShadow = true;

// Add to scene
scene.add(globe);

// Globe rotation animation (disabled for stable view)
let globeRotationSpeed = 0; // radians per second

// ========== WALKWAY (TORUS AROUND EQUATOR) ==========
// Create a thin torus around the equator of the globe
const WALKWAY_RADIUS = GLOBE_RADIUS + 5.5; // pushed further for more breathing room
const RING_INNER_RADIUS = WALKWAY_RADIUS - 1.6;
const RING_OUTER_RADIUS = WALKWAY_RADIUS + 1.8;
const WALKWAY_WIDTH = 1.6;
const INNER_RING_WIDTH = 1.0;
const EFFECT_INNER_RADIUS = RING_INNER_RADIUS - 1.5;
const EFFECT_INNER_WIDTH = 1.4;
const EFFECT_OUTER_RADIUS = RING_OUTER_RADIUS + 1.6;
const BUILDING_SURFACE_PADDING = 0.02;
const STAR_BUILDING_SCALE_MULTIPLIER = 2.25;
const STAR_PLACEMENT_SURFACES = [];

const getPlacementSurface = () => STAR_PLACEMENT_SURFACES[0];
let currentDayNightFactor = 0.5;

function createRingMesh(innerRadius, width, color, emissiveColor, emissiveIntensity, height) {
    const geometry = new THREE.RingGeometry(innerRadius - width / 2, innerRadius + width / 2, 96);
    const material = new THREE.MeshStandardMaterial({
        color,
        metalness: 0.35,
        roughness: 0.35,
        transparent: true,
        opacity: 0.85,
        emissive: new THREE.Color(emissiveColor),
        emissiveIntensity,
        side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.y = height;
    mesh.receiveShadow = true;
    return mesh;
}

const innerRing = createRingMesh(RING_INNER_RADIUS, INNER_RING_WIDTH, 0x00ffe5, 0x00c6b0, 0.45, 0.3);          // teal
const walkwayRing = createRingMesh(WALKWAY_RADIUS, WALKWAY_WIDTH, 0xff45ff, 0xb40fb4, 0.5, 0.4);   // magenta
const outerRing = createRingMesh(RING_OUTER_RADIUS, 1.2, 0x77a7ff, 0x4263ff, 0.35, 0.5);          // blue

scene.add(innerRing);
scene.add(walkwayRing);
scene.add(outerRing);

STAR_PLACEMENT_SURFACES.push({
    id: 'inner',
    inner: GLOBE_RADIUS - 0.02,
    outer: EFFECT_INNER_RADIUS - 0.08,
    color: 0xff8cf5,
    mesh: null,
    height: innerRing.position.y
});

function addRingOutline(baseRadius, width, y, color) {
    const geometry = new THREE.RingGeometry(
        baseRadius - width / 2 - 0.05,
        baseRadius + width / 2 + 0.05,
        96
    );
    const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        depthWrite: false
    });
    const outline = new THREE.Mesh(geometry, material);
    outline.rotation.x = Math.PI / 2;
    outline.position.y = y + 0.02;
    scene.add(outline);
}

if (!DEV_DEBUG_VISUALS) {
    addRingOutline(RING_INNER_RADIUS, 1.0, innerRing.position.y, 0x61efff);
    addRingOutline(WALKWAY_RADIUS, WALKWAY_WIDTH, walkwayRing.position.y, 0xff7bff);
    addRingOutline(RING_OUTER_RADIUS, 1.2, outerRing.position.y, 0xbdd4ff);
}

const effectInnerRing = createRingMesh(EFFECT_INNER_RADIUS, 1.4, 0x4dff76, 0x2ab84f, 0.3, 0.2);    // green
const effectOuterRing = createRingMesh(EFFECT_OUTER_RADIUS, 1.8, 0xffed6f, 0xffc834, 0.3, 0.55);  // golden
scene.add(effectInnerRing);
scene.add(effectOuterRing);
if (!DEV_DEBUG_VISUALS) {
    addRingOutline(EFFECT_INNER_RADIUS, 1.4, effectInnerRing.position.y, 0x27f4ff);
    addRingOutline(EFFECT_OUTER_RADIUS, 1.8, effectOuterRing.position.y, 0xffd1ff);
}

function addRingParticles(baseRadius, height, color, count, verticalRange) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const speeds = [];
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = baseRadius + (Math.random() - 0.5) * 0.5;
        positions[i * 3] = Math.cos(angle) * radius;
        positions[i * 3 + 1] = height + (Math.random() - 0.5) * verticalRange;
        positions[i * 3 + 2] = Math.sin(angle) * radius;
        speeds.push(0.5 + Math.random() * 0.5);
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
        color,
        size: 0.12,
        transparent: true,
        opacity: 0.8,
        depthWrite: false
    });
    const points = new THREE.Points(geometry, material);
    points.userData = { speeds, baseRadius, height, verticalRange };
    scene.add(points);
    return points;
}

const innerEffectParticles = addRingParticles(
    EFFECT_INNER_RADIUS,
    effectInnerRing.position.y,
    0x41ffff,
    Math.max(70, Math.round(140 * PARTICLE_COUNT_SCALE)),
    0.55
);
const outerEffectParticles = addRingParticles(
    EFFECT_OUTER_RADIUS,
    effectOuterRing.position.y,
    0xffa8ff,
    Math.max(80, Math.round(160 * PARTICLE_COUNT_SCALE)),
    0.75
);

let globalAtmosphereParticles = null;
let globalPixelParticles = null;
let equatorialPixelRing = null;
const floatingElements = [];
const floatingCrystalRocks = [];
const floatingMagicClusters = [];
const weatherSystems = [];
const auroraBands = [];
let auroraRing = null;
const ambientAIs = [];
const worldProps = [];
const starfallSystems = [];
const quadrantDividerLines = [];
const forestInstances = [];
const decorationInstances = [];
const dancingJellyTrees = [];
const loreMarkers = [];
const loreMarkerMeshes = [];
const pointer = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
let hoveredLoreMarker = null;
let activeLoreMarker = null;
let loreInteractivityEnabled = true;

const FLOATING_ASSET_MAX_ANGLE = Math.PI * 0.75;
const FAR_VISIBILITY_DISTANCE = WALKWAY_RADIUS + 18;
const EXTENDED_VISIBILITY_DISTANCE = WALKWAY_RADIUS + 24;
const PROP_MIN_VISIBILITY_DISTANCE = WALKWAY_RADIUS + 1;
const MAX_PROP_VISIBILITY_DISTANCE = EXTENDED_VISIBILITY_DISTANCE + 6;
const LORE_MARKER_DEFS = [
    { id: 'about', title: 'About Us', glow: '#6bb9ff', icon: 'info' },
    { id: 'projects', title: 'Clients & Case Studies', glow: '#7de28f', icon: 'folder' },
    { id: 'contact', title: 'Contact Us', glow: '#ffa45a', icon: 'mail' },
    { id: 'tos', title: 'Terms of Service', glow: '#c997ff', icon: 'scroll' }
];
const LORE_ICON_MAP = {
    info: 'ℹ',
    folder: '🗂',
    mail: '✉',
    scroll: '⚖'
};
const LORE_MARKER_CONTENT = {
    about: {
        title: 'About Us',
        body: 'Discover the studio\'s origin story, the explorers who built this orbital atelier, and the values powering every magical artifact we design.'
    },
    projects: {
        title: 'Clients & Case Studies',
        body: 'Dive into living archives of collaborations—from interstellar trade routes to immersive brand realms—showing process notes, prototypes, and outcomes.'
    },
    contact: {
        title: 'Contact Us',
        body: 'Ping our relay beacons for partnerships, support, or guided tours. Direct links route to voice crystals, holo-mail, and concierge schedulers.'
    },
    tos: {
        title: 'Terms of Service',
        body: 'Review the accords that keep this world stable: usage rights, safety protocols, and the mutual promises between Invoker Studio and every visitor.'
    }
};

const gltfLoader = new GLTFLoader(loadingManager);
const gltfCache = new Map();
const treeAssetCache = new Map();
const forestGlowUniforms = { time: { value: 0 } };
const auroraUniforms = { time: { value: 0 } };
initSolariaLoadingPreview();

function ensureMaterialTextures(material) {
    if (!material) return;
    const materials = Array.isArray(material) ? material : [material];
    materials.forEach((mat) => {
        ['map', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap'].forEach((key) => {
            if (mat[key] && mat[key].isTexture) {
                mat[key].colorSpace = THREE.SRGBColorSpace;
                mat[key].needsUpdate = true;
            }
        });
    });
}

function loadGLTFClone(path, onReady, onError) {
    if (gltfCache.has(path)) {
        const cached = gltfCache.get(path);
        const clone = cloneSkeleton(cached.scene);
        clone.animations = cached.animations;
        onReady(clone);
        return;
    }
    gltfLoader.load(
        path,
        (gltf) => {
            gltf.scene.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    ensureMaterialTextures(child.material);
                }
            });
            const cacheEntry = {
                scene: gltf.scene,
                animations: (gltf.animations || []).map((clip) => clip)
            };
            gltfCache.set(path, cacheEntry);
            const clone = cloneSkeleton(gltf.scene);
            clone.animations = cacheEntry.animations;
            onReady(clone);
        },
        undefined,
        (err) => {
            console.warn(`Failed to load ${path}`, err);
            if (onError) onError(err);
        }
    );
}


function createInstancedForest(treePath, count, radius, height, tiltAngle = 0.12, tiltDirection = 1, scaleMultiplier = 1) {
    const buildInstances = (asset) => {
        if (!asset) return;
        const geometry = asset.geometry.clone();
        const glowPhaseArray = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            glowPhaseArray[i] = Math.random() * Math.PI * 2;
        }
        geometry.setAttribute('glowPhase', new THREE.InstancedBufferAttribute(glowPhaseArray, 1));

        const instanced = new THREE.InstancedMesh(geometry, asset.material, count);
        instanced.castShadow = false;
        instanced.receiveShadow = false;

        const dummy = new THREE.Object3D();
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const radialOffset = Math.random() * 0.35; // push outward only so trees stay on 5th ring
            const upwardOffset = THREE.MathUtils.randFloatSpread(0.05);
            const scale = THREE.MathUtils.lerp(0.65, 1.6, Math.random()) * scaleMultiplier;
            const placeRadius = radius + radialOffset;

            dummy.position.set(
                Math.cos(angle) * placeRadius,
                height + upwardOffset,
                Math.sin(angle) * placeRadius
            );
            dummy.rotation.set(
                tiltAngle * tiltDirection + THREE.MathUtils.randFloatSpread(0.03),
                angle + Math.PI / 2 + THREE.MathUtils.randFloatSpread(Math.PI * 0.4),
                THREE.MathUtils.randFloatSpread(0.08)
            );
            dummy.scale.setScalar(scale);
            dummy.updateMatrix();
            instanced.setMatrixAt(i, dummy.matrix);
        }

        instanced.instanceMatrix.needsUpdate = true;
        scene.add(instanced);
        forestInstances.push(instanced);
    };

    if (treeAssetCache.has(treePath)) {
        buildInstances(treeAssetCache.get(treePath));
        return;
    }

    gltfLoader.load(
        treePath,
        (gltf) => {
            let sourceMesh = null;
            gltf.scene.traverse((child) => {
                if (child.isMesh && !sourceMesh) {
                    sourceMesh = child;
                }
            });
            if (!sourceMesh) {
                console.warn(`No mesh geometry found in ${treePath}`);
                buildInstances(null);
                return;
            }
            sourceMesh.castShadow = false;
            sourceMesh.receiveShadow = false;

            const geometry = sourceMesh.geometry.clone();
            geometry.rotateX(-Math.PI / 2);
            geometry.computeVertexNormals();

            const sharedMaterial = sourceMesh.material && sourceMesh.material.isMaterial
                ? sourceMesh.material.clone()
                : new THREE.MeshStandardMaterial({
                    color: 0xffffff,
                    roughness: 0.85,
                    metalness: 0.05,
                    flatShading: true
                });
            sharedMaterial.castShadow = false;
            sharedMaterial.transparent = sourceMesh.material?.transparent ?? sharedMaterial.transparent;
            sharedMaterial.vertexColors = sourceMesh.material?.vertexColors ?? true;
            sharedMaterial.emissive = sharedMaterial.color.clone().lerp(new THREE.Color(0xffffff), 0.1);
            sharedMaterial.emissiveIntensity = 0.18;
            sharedMaterial.toneMapped = true;
            sharedMaterial.onBeforeCompile = (shader) => {
                shader.uniforms.forestTime = forestGlowUniforms.time;
                shader.vertexShader = shader.vertexShader
                    .replace('#include <common>', '#include <common>\nattribute float glowPhase;\nvarying float vGlowPhase;')
                    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlowPhase = glowPhase;');
                shader.fragmentShader = shader.fragmentShader
                    .replace('#include <common>', '#include <common>\nvarying float vGlowPhase;\nuniform float forestTime;')
                    .replace(
                        '#include <emissivemap_fragment>',
                        '#include <emissivemap_fragment>\nfloat flicker = 0.35 + 0.25 * sin(forestTime * 1.5 + vGlowPhase);\ntotalEmissiveRadiance *= flicker;'
                    );
            };
            sharedMaterial.needsUpdate = true;

            const asset = { geometry, material: sharedMaterial };
            treeAssetCache.set(treePath, asset);
            buildInstances(asset);
        },
        undefined,
        (err) => {
            console.warn(`Failed to load ${treePath}`, err);
        }
    );
}

function createDancingJellyTrees(count = Math.max(2, Math.round(5 * DECOR_COUNT_SCALE))) {
    for (let i = 0; i < count; i++) {
        gltfLoader.load(
            '/assets/dancing_jelly_tree.glb',
            (gltf) => {
                const model = gltf.scene;
                model.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                    }
                });
                const radius = THREE.MathUtils.lerp(EFFECT_OUTER_RADIUS + 2.5, EFFECT_OUTER_RADIUS + 6, Math.random());
                const baseAngle = Math.random() * Math.PI * 2;
                const baseHeight = effectOuterRing.position.y + 1.2 + Math.random() * 2.5;
                const angularSpeed = THREE.MathUtils.lerp(0.015, 0.05, Math.random());
                const bobAmount = THREE.MathUtils.lerp(0.2, 0.5, Math.random());
                const bobSpeed = THREE.MathUtils.lerp(0.4, 0.9, Math.random());
                model.scale.setScalar(0.001);
                model.position.set(
                    Math.cos(baseAngle) * radius,
                    baseHeight,
                    Math.sin(baseAngle) * radius
                );
                scene.add(model);

                let mixer = null;
                if (gltf.animations && gltf.animations.length > 0) {
                    mixer = new THREE.AnimationMixer(model);
                    gltf.animations.forEach((clip) => {
                        mixer.clipAction(clip).setLoop(THREE.LoopRepeat, Infinity).play();
                    });
                }

                dancingJellyTrees.push({
                    mesh: model,
                    radius,
                    baseAngle,
                    angularSpeed,
                    baseHeight,
                    bobAmount,
                    bobSpeed,
                    offset: Math.random() * Math.PI * 2,
                    mixer
                });
            },
            undefined,
            (err) => console.warn('Failed to load dancing_jelly_tree.glb', err)
        );
    }
}

function createGlobalPixelParticles() {
    const count = Math.max(60, Math.round(220 * PARTICLE_COUNT_SCALE));
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const basePositions = new Float32Array(count * 3);
    const amplitudes = new Float32Array(count);
    const speeds = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        const radius = WALKWAY_RADIUS + 5 + Math.random() * 6;
        const angle = Math.random() * Math.PI * 2;
        const y = THREE.MathUtils.lerp(PIXEL_PARTICLE_MIN_Y, PIXEL_PARTICLE_MAX_Y, Math.random());
        const idx = i * 3;
        positions[idx] = Math.cos(angle) * radius;
        positions[idx + 1] = y;
        positions[idx + 2] = Math.sin(angle) * radius;
        basePositions[idx] = positions[idx];
        basePositions[idx + 1] = y;
        basePositions[idx + 2] = positions[idx + 2];
        amplitudes[i] = 0.25 + Math.random() * 0.4;
        speeds[i] = 0.4 + Math.random() * 0.8;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
        color: 0xfff4d6,
        size: 0.05,
        transparent: true,
        opacity: 0.7,
        depthWrite: false
    });
    globalPixelParticles = new THREE.Points(geometry, material);
    globalPixelParticles.userData = { basePositions, amplitudes, speeds };
    scene.add(globalPixelParticles);
}
function createEquatorialPixelRing() {
    const count = Math.max(80, Math.round(260 * PARTICLE_COUNT_SCALE));
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const baseAngles = new Float32Array(count);
    const radialOffsets = new Float32Array(count);
    const heights = new Float32Array(count);
    const speeds = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = WALKWAY_RADIUS + THREE.MathUtils.randFloatSpread(1.5);
        const height = THREE.MathUtils.randFloatSpread(0.6);
        const idx = i * 3;
        positions[idx] = Math.cos(angle) * radius;
        positions[idx + 1] = height;
        positions[idx + 2] = Math.sin(angle) * radius;
        baseAngles[i] = angle;
        radialOffsets[i] = radius;
        heights[i] = height;
        speeds[i] = 0.5 + Math.random() * 1.2;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
        color: 0xfff8e7,
        size: 0.08,
        transparent: true,
        opacity: 0.85,
        depthWrite: false
    });
    equatorialPixelRing = new THREE.Points(geometry, material);
    equatorialPixelRing.userData = { baseAngles, radialOffsets, heights, speeds };
    scene.add(equatorialPixelRing);
}
function createGlobalAtmosphereParticles() {
    const count = Math.max(80, Math.round(180 * PARTICLE_COUNT_SCALE));
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const speeds = [];
    for (let i = 0; i < count; i++) {
        const radius = WALKWAY_RADIUS + 4 + Math.random() * 10;
        const angle = Math.random() * Math.PI * 2;
        positions[i * 3] = Math.cos(angle) * radius;
        positions[i * 3 + 1] = -2 + Math.random() * 10;
        positions[i * 3 + 2] = Math.sin(angle) * radius;
        speeds.push(0.05 + Math.random() * 0.1);
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
        color: 0xbfe6ff,
        size: 0.08,
        transparent: true,
        opacity: 0.4,
        depthWrite: false
    });
    globalAtmosphereParticles = new THREE.Points(geometry, material);
    globalAtmosphereParticles.userData = { speeds };
    scene.add(globalAtmosphereParticles);
}

function createFloatingElements() {
    const elementGeometry = new THREE.IcosahedronGeometry(0.4, 0);
    const elementMaterial = new THREE.MeshStandardMaterial({
        color: 0xfff2a1,
        emissive: 0xffd97d,
        emissiveIntensity: 0.4,
        transparent: true,
        opacity: 0.8
    });
    const floatingCount = Math.max(2, Math.round(6 * DECOR_COUNT_SCALE));
    for (let i = 0; i < floatingCount; i++) {
        const mesh = new THREE.Mesh(elementGeometry, elementMaterial.clone());
        mesh.material.emissiveIntensity = 0.3 + Math.random() * 0.2;
        mesh.position.set(0, 0, 0);
        mesh.userData = {
            radius: WALKWAY_RADIUS + 5 + Math.random() * 4,
            height: 2 + Math.random() * 3,
            speed: 0.1 + Math.random() * 0.1,
            offset: Math.random() * Math.PI * 2
        };
        scene.add(mesh);
        floatingElements.push(mesh);
    }
}

function createAuroraBands() {
    const baseRadius = EFFECT_OUTER_RADIUS + 8;
    const vertexShader = `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `;
    const auroraFragmentShader = `
        uniform vec3 colorA;
        uniform vec3 colorB;
        uniform vec3 colorC;
        uniform float time;
        varying vec2 vUv;
        void main() {
            float wave = sin((vUv.x * 6.0) + time * 0.4) * 0.2 + sin((vUv.x * 14.0) - time * 0.7) * 0.08;
            float gradient = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
            float alpha = clamp((gradient + wave) * 0.85, 0.0, 1.0);
            vec3 blend1 = mix(colorA, colorB, clamp(vUv.y + wave * 0.3, 0.0, 1.0));
            vec3 blend2 = mix(colorB, colorC, clamp(vUv.y + wave * 0.2, 0.0, 1.0));
            vec3 color = mix(blend1, blend2, 0.5 + 0.5 * sin(time * 0.2));
            gl_FragColor = vec4(color, alpha);
        }
    `;
    const geometry = new THREE.CylinderGeometry(
        baseRadius + 0.5,
        baseRadius - 0.5,
        6.5,
        84,
        1,
        true
    );
    const uniforms = {
        colorA: { value: new THREE.Color(0x7efbff) },
        colorB: { value: new THREE.Color(0xb58cff) },
        colorC: { value: new THREE.Color(0x8cffcf) },
        time: auroraUniforms.time
    };
    const material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader,
        fragmentShader: auroraFragmentShader,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
    });
    auroraRing = new THREE.Mesh(geometry, material);
    auroraRing.position.y = 4.6;
    auroraRing.renderOrder = 2;
    scene.add(auroraRing);
    auroraBands.push({
        mesh: auroraRing,
        baseHeight: auroraRing.position.y,
        wobble: 0.35,
        speed: 0.12,
        offset: 0,
        centerAngle: 0
    });
}
function scaleSceneToSize(scene, desiredSize) {
    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDimension = Math.max(size.x, size.y, size.z, 0.0001);
    const scale = desiredSize / maxDimension;
    scene.scale.setScalar(scale);
}

function stopLoadingPreview() {
    if (!loadingPreview) return;
    loadingPreview.running = false;
    if (loadingPreview.cleanup) {
        loadingPreview.cleanup();
    }
    if (loadingPreview.renderer) {
        loadingPreview.renderer.dispose();
    }
    loadingPreview = null;
}

function initSolariaLoadingPreview() {
    if (!loadingPreviewCanvas) return;
    const previewRenderer = new THREE.WebGLRenderer({
        canvas: loadingPreviewCanvas,
        antialias: true,
        alpha: true
    });
    previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
    previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    previewRenderer.setClearColor(0x000000, 0);

    const previewScene = new THREE.Scene();
    const previewCamera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
    previewCamera.position.set(0, 0.4, 3.6);
    const ambient = new THREE.AmbientLight(0x8fb7ff, 0.8);
    const dir = new THREE.DirectionalLight(0xffffff, 1.15);
    dir.position.set(2, 3, 2);
    previewScene.add(ambient, dir);

    const state = {
        renderer: previewRenderer,
        scene: previewScene,
        camera: previewCamera,
        mixer: null,
        clock: new THREE.Clock(),
        running: true,
        cleanup: null,
        model: null
    };

    const handleResize = () => {
        const rect = loadingPreviewCanvas.getBoundingClientRect();
        const width = Math.max(rect.width || loadingPreviewCanvas.clientWidth || 320, 200);
        const height = Math.max(rect.height || loadingPreviewCanvas.clientHeight || 320, 200);
        previewRenderer.setSize(width, height, false);
        previewCamera.aspect = width / height;
        previewCamera.updateProjectionMatrix();
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    state.cleanup = () => window.removeEventListener('resize', handleResize);

    loadGLTFClone('/assets/solaria_core.glb', (model) => {
        scaleSceneToSize(model, 1.8);
        model.position.set(0, 0, 0);
        previewScene.add(model);
        state.model = model;
        if (model.animations && model.animations.length) {
            state.mixer = new THREE.AnimationMixer(model);
            model.animations.forEach((clip) => {
                state.mixer.clipAction(clip).setLoop(THREE.LoopRepeat, Infinity).play();
            });
        }
    }, (err) => console.warn('Failed to load solaria_core.glb for preview', err));

    const animatePreview = () => {
        if (!state.running) return;
        requestAnimationFrame(animatePreview);
        const delta = state.clock.getDelta();
        if (state.mixer) state.mixer.update(delta);
        if (state.model) {
            state.model.rotation.y += delta * 0.15;
        }
        previewRenderer.render(previewScene, previewCamera);
    };
    animatePreview();
    loadingPreview = state;
}

function spawnFloatingArtifacts({
    path,
    count,
    desiredSize,
    radiusMin,
    radiusMax,
    heightMin,
    heightMax,
    bobMin,
    bobMax,
    angularSpeedMin,
    angularSpeedMax,
    bobSpeedMin,
    bobSpeedMax,
    spinSpeedMin,
    spinSpeedMax,
    collection
}) {
    for (let i = 0; i < count; i++) {
        loadGLTFClone(path, (model) => {
            scaleSceneToSize(model, desiredSize);
            model.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = false;
                    child.receiveShadow = false;
                }
            });
            const radius = THREE.MathUtils.lerp(radiusMin, radiusMax, Math.random());
            const angle = Math.random() * Math.PI * 2;
            const baseHeight = THREE.MathUtils.lerp(heightMin, heightMax, Math.random());
            const bobAmount = THREE.MathUtils.lerp(bobMin, bobMax, Math.random());
            const bobSpeed = THREE.MathUtils.lerp(bobSpeedMin, bobSpeedMax, Math.random());
            const angularSpeed = THREE.MathUtils.lerp(angularSpeedMin, angularSpeedMax, Math.random());
            const spinSpeed = THREE.MathUtils.lerp(spinSpeedMin, spinSpeedMax, Math.random());
            const offset = Math.random() * Math.PI * 2;
            model.position.set(
                Math.cos(angle) * radius,
                baseHeight,
                Math.sin(angle) * radius
            );
            model.rotation.y = angle;
            scene.add(model);
            collection.push({
                mesh: model,
                radius,
                baseHeight,
                bobAmount,
                bobSpeed,
                angularSpeed,
                spinSpeed,
                offset
            });
        }, (err) => console.warn(`Failed to load floating artifact ${path}`, err));
    }
}

function placeCrystalDrifts() {
    const bufferDistance = EFFECT_OUTER_RADIUS + 2.5;
    spawnFloatingArtifacts({
        path: '/assets/crystal_stone_rock.glb',
        count: CRYSTAL_DRIFT_COUNT,
        desiredSize: 1.4,
        radiusMin: bufferDistance,
        radiusMax: EFFECT_OUTER_RADIUS + 6.5,
        heightMin: 1.6,
        heightMax: 4.2,
        bobMin: 0.25,
        bobMax: 0.6,
        angularSpeedMin: 0.05,
        angularSpeedMax: 0.18,
        bobSpeedMin: 0.4,
        bobSpeedMax: 0.8,
        spinSpeedMin: 0.1,
        spinSpeedMax: 0.35,
        collection: floatingCrystalRocks
    });
}

function placeMagicCrystalClusters() {
    const bufferDistance = EFFECT_OUTER_RADIUS + 3.5;
    spawnFloatingArtifacts({
        path: '/assets/magic_crystals.glb',
        count: MAGIC_CLUSTER_COUNT,
        desiredSize: 1.0,
        radiusMin: bufferDistance,
        radiusMax: EFFECT_OUTER_RADIUS + 7.2,
        heightMin: 2.2,
        heightMax: 5.5,
        bobMin: 0.35,
        bobMax: 0.8,
        angularSpeedMin: 0.08,
        angularSpeedMax: 0.22,
        bobSpeedMin: 0.6,
        bobSpeedMax: 1.1,
        spinSpeedMin: 0.2,
        spinSpeedMax: 0.5,
        collection: floatingMagicClusters
    });
}

function placeForestShrine() {
    const angle = Math.PI / 4; // north-east
    const distance = EFFECT_OUTER_RADIUS + 2.2; // render outside all five rings
    const baseHeight = effectOuterRing.position.y + 0.35;
    const hoverSpeed = 0.55;
    const hoverAmplitude = 0.25;
    loadGLTFClone('/assets/the_forest_shrine.glb', (model) => {
        model.position.set(
            Math.cos(angle) * distance,
            baseHeight,
            Math.sin(angle) * distance
        );
        model.scale.setScalar(0.0075);
        model.lookAt(0, 0.5, 0);
        scene.add(model);
        worldProps.push({
            object: model,
            angle,
            baseHeight,
            hoverSpeed,
            hoverAmplitude,
            phase: Math.random() * Math.PI * 2
        });
    });
}

function placeMagicGate() {
    const angle = -Math.PI / 2; // align with initial camera view (front)
    const distance = EFFECT_OUTER_RADIUS + 2.8;
    const baseHeight = effectOuterRing.position.y + 0.32;
    const hoverSpeed = 0.5;
    const hoverAmplitude = 0.22;
    loadGLTFClone('/assets/magic_gate.glb', (model) => {
        model.position.set(
            Math.cos(angle) * distance,
            baseHeight,
            Math.sin(angle) * distance
        );
        model.scale.setScalar(0.00375);
        model.lookAt(0, 0.5, 0);
        scene.add(model);
        worldProps.push({
            object: model,
            angle,
            baseHeight,
            hoverSpeed,
            hoverAmplitude,
            phase: Math.random() * Math.PI * 2
        });
    });
}

function placeVoyager() {
    const angle = Math.PI * 0.6;
    const distance = EFFECT_OUTER_RADIUS + 3.3;
    const baseHeight = effectOuterRing.position.y + 0.45;
    const hoverSpeed = 0.38;
    const hoverAmplitude = 0.2;
    loadGLTFClone('/assets/the_voyager.glb', (model) => {
        model.position.set(
            Math.cos(angle) * distance,
            baseHeight,
            Math.sin(angle) * distance
        );
        model.scale.setScalar(0.004);
        model.lookAt(0, 0.5, 0);
        scene.add(model);
        worldProps.push({
            object: model,
            angle,
            baseHeight,
            hoverSpeed,
            hoverAmplitude,
            phase: Math.random() * Math.PI * 2
        });
    });
}

function placeSolariaCore() {
    const angle = -Math.PI * 0.2;
    const distance = EFFECT_OUTER_RADIUS + 4.6;
    const baseHeight = effectOuterRing.position.y + 0.75;
    const hoverSpeed = 0.65;
    const hoverAmplitude = 0.4;
    loadGLTFClone('/assets/solaria_core.glb', (model) => {
        scaleSceneToSize(model, 1.9);
        model.position.set(
            Math.cos(angle) * distance,
            baseHeight,
            Math.sin(angle) * distance
        );
        model.lookAt(0, baseHeight, 0);
        scene.add(model);
        const entry = {
            object: model,
            angle,
            baseHeight,
            hoverSpeed,
            hoverAmplitude,
            phase: Math.random() * Math.PI * 2,
            mixer: null
        };
        if (model.animations && model.animations.length) {
            entry.mixer = new THREE.AnimationMixer(model);
            model.animations.forEach((clip) => {
                entry.mixer.clipAction(clip).setLoop(THREE.LoopRepeat, Infinity).play();
            });
        }
        worldProps.push(entry);
    }, (err) => console.warn('Failed to place solaria_core.glb', err));
}

if (!IS_LOW_POWER_DEVICE) {
    createGlobalAtmosphereParticles();
    createFloatingElements();
    if (ENABLE_AURORA_BANDS) {
        createAuroraBands();
    }
}
createGlobalPixelParticles();
createEquatorialPixelRing();
placeForestShrine();
placeMagicGate();
placeVoyager();
placeSolariaCore();
if (!IS_LOW_POWER_DEVICE) {
    placeCrystalDrifts();
    placeMagicCrystalClusters();
}
const FOREST_RING_SETUPS = {
    inner: {
        radius: EFFECT_INNER_RADIUS + 0.45,
        height: effectInnerRing.position.y + 0.06,
        tiltDirection: -1
    },
    outer: {
        radius: EFFECT_OUTER_RADIUS - 0.5,
        height: effectOuterRing.position.y + 0.08,
        tiltDirection: 1
    }
};
const scaleForestCount = (value) => Math.max(12, Math.round(value * FOREST_DENSITY_SCALE));
const FOREST_TREE_DEFS = [
    { path: '/assets/Tree_Green.glb', innerCount: scaleForestCount(32), outerCount: scaleForestCount(38) },
    { path: '/assets/Tree_Orange.glb', innerCount: scaleForestCount(30), outerCount: scaleForestCount(36) },
    { path: '/assets/Tree_Purple.glb', innerCount: scaleForestCount(28), outerCount: scaleForestCount(34) },
    { path: '/assets/Tree_Yellow.glb', innerCount: scaleForestCount(30), outerCount: scaleForestCount(32) }
];
FOREST_TREE_DEFS.forEach((tree) => {
    if (tree.outerCount) {
        const cfg = FOREST_RING_SETUPS.outer;
        createInstancedForest(
            tree.path,
            tree.outerCount,
            cfg.radius,
            cfg.height,
            0.1,
            cfg.tiltDirection,
            0.45
        );
    }
});
createLoreMarkers();
wireLoreUI();

function createAmbientAI() {
    const aiGeometry = new THREE.CapsuleGeometry(0.15, 0.4, 4, 8);
    const aiCount = Math.max(3, Math.round(6 * DECOR_COUNT_SCALE));
    for (let i = 0; i < aiCount; i++) {
        const material = new THREE.MeshStandardMaterial({
            color: 0x9be7ff,
            emissive: 0x6fd2ff,
            emissiveIntensity: 0.5,
            transparent: true,
            opacity: 0.8
        });
        const mesh = new THREE.Mesh(aiGeometry, material);
        mesh.userData = {
            radius: WALKWAY_RADIUS + 5 + Math.random() * 6,
            height: 1 + Math.random() * 2,
            speed: 0.08 + Math.random() * 0.08,
            verticalSwing: 0.4 + Math.random() * 0.3,
            offset: Math.random() * Math.PI * 2
        };
        scene.add(mesh);
        ambientAIs.push(mesh);
    }
}

// ========== LORE MARKERS & UI ==========
let loreMarkerPinned = false;

function createIconTexture(symbol, glowColor) {
    const size = 256;
    const canvasIcon = document.createElement('canvas');
    canvasIcon.width = canvasIcon.height = size;
    const ctx = canvasIcon.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, size, size);
    ctx.font = 'bold 150px "Segoe UI Symbol", "Arial Unicode MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 28;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(symbol, size / 2, size / 2 + 12);
    const texture = new THREE.CanvasTexture(canvasIcon);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
}

function highlightHotspotButton(targetId) {
    hotspotButtons.forEach((btn) => {
        if (!targetId) {
            btn.classList.remove('is-highlighted');
            return;
        }
        if (btn.dataset.hotspot === targetId) {
            btn.classList.add('is-highlighted');
        } else {
            btn.classList.remove('is-highlighted');
        }
    });
}

function showLorePanelContent(markerId) {
    if (!lorePanel || !lorePanelTitle || !lorePanelBody) return;
    const content = LORE_MARKER_CONTENT[markerId];
    if (!content) return;
    lorePanelTitle.textContent = content.title;
    lorePanelBody.textContent = content.body;
    lorePanel.classList.add('is-visible');
}

function hideLorePanelContent() {
    if (!lorePanel || !lorePanelTitle || !lorePanelBody) return;
    lorePanel.classList.remove('is-visible');
    lorePanelTitle.textContent = 'Lore';
    lorePanelBody.textContent = 'Select a marker to learn more.';
}

function activateLoreMarker(marker, pinSelection = false) {
    if (!marker) return;
    if (pinSelection) {
        loreMarkerPinned = true;
    } else if (loreMarkerPinned) {
        return;
    }
    activeLoreMarker = marker;
    hoveredLoreMarker = marker;
    showLorePanelContent(marker.id);
    highlightHotspotButton(marker.id);
}

function clearActiveLoreMarker() {
    activeLoreMarker = null;
    hoveredLoreMarker = null;
    loreMarkerPinned = false;
    hideLorePanelContent();
    highlightHotspotButton(null);
}

function getMarkerFromObject(object) {
    let current = object;
    while (current) {
        if (current.userData && current.userData.loreMarkerId) {
            const id = current.userData.loreMarkerId;
            return loreMarkers.find(marker => marker.id === id) || null;
        }
        current = current.parent;
    }
    return null;
}

function updatePointerFromEvent(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function pickLoreMarker() {
    if (loreMarkerMeshes.length === 0) return null;
    raycaster.setFromCamera(pointer, camera);
    const intersects = raycaster.intersectObjects(loreMarkerMeshes, true);
    if (intersects.length === 0) return null;
    return getMarkerFromObject(intersects[0].object);
}

let lorePointerDirty = false;
let lastPointerEvent = null;

function handleLorePointerMove(event) {
    lastPointerEvent = event;
    lorePointerDirty = true;
}

function processLorePointerMove() {
    if (!loreInteractivityEnabled) return;
    if (!lorePointerDirty || !lastPointerEvent) return;
    lorePointerDirty = false;
    updatePointerFromEvent(lastPointerEvent);
    const marker = pickLoreMarker();
    hoveredLoreMarker = marker;
    if (!loreMarkerPinned) {
        if (marker) {
            activateLoreMarker(marker, false);
        } else {
            clearActiveLoreMarker();
        }
    }
}

function handleLorePointerClick(event) {
    updatePointerFromEvent(event);
    const marker = pickLoreMarker();
    if (marker) {
        activateLoreMarker(marker, true);
    } else if (loreMarkerPinned) {
        clearActiveLoreMarker();
    }
}

function createLoreMarkers() {
    const baseHeight = walkwayRing.position.y + 0.85;
    const radius = WALKWAY_RADIUS + 0.2;
    LORE_MARKER_DEFS.forEach((def, index) => {
        const angle = index * ((Math.PI * 2) / LORE_MARKER_DEFS.length);
        const group = new THREE.Group();
        group.userData.loreMarkerId = def.id;
        const coreGeometry = new THREE.OctahedronGeometry(0.24, 0);
        const coreMaterial = new THREE.MeshStandardMaterial({
            color: new THREE.Color(def.glow).offsetHSL(-0.05, 0.2, -0.05),
            emissive: def.glow,
            emissiveIntensity: 0.45,
            metalness: 0.3,
            roughness: 0.35
        });
        const core = new THREE.Mesh(coreGeometry, coreMaterial);
        core.castShadow = true;
        group.add(core);

        const halo = new THREE.Mesh(
            new THREE.TorusGeometry(0.38, 0.035, 16, 48),
            new THREE.MeshBasicMaterial({
                color: def.glow,
                transparent: true,
                opacity: 0.45,
                depthWrite: false
            })
        );
        halo.rotation.x = Math.PI / 2;
        group.add(halo);

        const iconSymbol = LORE_ICON_MAP[def.icon] || '✦';
        const spriteMaterial = new THREE.SpriteMaterial({
            map: createIconTexture(iconSymbol, def.glow),
            transparent: true,
            depthWrite: false
        });
        const icon = new THREE.Sprite(spriteMaterial);
        icon.scale.set(0.65, 0.65, 0.65);
        icon.position.set(0, 0.55, 0);
        group.add(icon);

        const light = new THREE.PointLight(def.glow, 0.7, 6);
        group.add(light);

        const posX = Math.cos(angle) * radius;
        const posZ = Math.sin(angle) * radius;
        group.position.set(posX, baseHeight, posZ);
        group.lookAt(0, baseHeight, 0);

        scene.add(group);
        const markerData = {
            id: def.id,
            group,
            core,
            halo,
            icon,
            angle,
            baseHeight,
            bobAmplitude: 0.15,
            bobSpeed: 0.8 + index * 0.1,
            scaleState: 1
        };
        loreMarkers.push(markerData);
        loreMarkerMeshes.push(core, icon);
    });
}

function wireLoreUI() {
    if (renderer && renderer.domElement) {
        renderer.domElement.addEventListener('pointermove', handleLorePointerMove);
        renderer.domElement.addEventListener('click', handleLorePointerClick);
    }
    hotspotButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            const marker = loreMarkers.find(entry => entry.id === btn.dataset.hotspot);
            if (marker) {
                activateLoreMarker(marker, true);
            }
        });
    });
    if (lorePanelClose) {
        lorePanelClose.addEventListener('click', () => {
            clearActiveLoreMarker();
        });
    }
    window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            clearActiveLoreMarker();
        }
    });
}

function createHemisphereMaskTexture() {
    const size = 512;
    const canvasMask = document.createElement('canvas');
    canvasMask.width = canvasMask.height = size;
    const ctx = canvasMask.getContext('2d');

    const radial = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    radial.addColorStop(0, 'rgba(20, 0, 30, 0.85)');
    radial.addColorStop(0.4, 'rgba(20, 0, 30, 0.6)');
    radial.addColorStop(0.75, 'rgba(20, 0, 30, 0.25)');
    radial.addColorStop(1, 'rgba(20, 0, 30, 0)');
    ctx.fillStyle = radial;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.fill();

    const tex = new THREE.CanvasTexture(canvasMask);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
}

const hemisphereMaskTexture = createHemisphereMaskTexture();
const hemisphereMaskGeometry = new THREE.CircleGeometry(WALKWAY_RADIUS + WALKWAY_WIDTH * 2.5, 256);
const hemisphereMaskMaterial = new THREE.MeshBasicMaterial({
    map: hemisphereMaskTexture,
    transparent: true,
    opacity: 0.95,
    side: THREE.DoubleSide,
    depthWrite: false
});
const hemisphereMask = new THREE.Mesh(hemisphereMaskGeometry, hemisphereMaskMaterial);
hemisphereMask.rotation.x = Math.PI / 2;
hemisphereMask.position.y = 0.2;
scene.add(hemisphereMask);

// ========== CHARACTER (PLACEHOLDER) ==========
const characterGeometry = new THREE.BoxGeometry(CHARACTER_SIZE, CHARACTER_SIZE * 1.5, CHARACTER_SIZE);
const characterMaterial = new THREE.MeshStandardMaterial({
    color: 0x8b5cf6,
    polygonOffset: true,
    polygonOffsetFactor: -0.5,
    polygonOffsetUnits: -1
});
const character = new THREE.Mesh(characterGeometry, characterMaterial);

// Character state
let characterAngle = 0;
const CHARACTER_HEIGHT = CHARACTER_SIZE * 0.75; // Half the character height
let keyMovementDirection = 0; // -1 clockwise, +1 counter-clockwise
let scrollImpulse = 0;
let pendingScrollDelta = 0;
let lastWheelEventTime = 0;
const SCROLL_IMPULSE_DECAY = 0.92;
const MAX_SCROLL_IMPULSE = 1.2;
let lastTouchY = null;
let lastTouchX = null;
const activeMovementKeys = new Set();
let currentAngularSpeed = 0;
let isMovementActive = false;
let idleTimer = 0;
let gestureFreezeSnapshot = null;
let isGestureFrozen = false;
const MOVEMENT_IDLE_THRESHOLD = 0.04;
const MOVEMENT_IDLE_TIMEOUT = 0.35; // seconds
function updateKeyMovementDirection() {
    if (activeMovementKeys.has('ArrowRight')) {
        keyMovementDirection = -1; // clockwise
    } else if (activeMovementKeys.has('ArrowLeft')) {
        keyMovementDirection = 1; // counter-clockwise
    } else {
        keyMovementDirection = 0;
    }
}

window.addEventListener('keydown', (event) => {
    if (event.code === 'ArrowRight' || event.code === 'ArrowLeft') {
        activeMovementKeys.add(event.code);
        updateKeyMovementDirection();
    }
});

window.addEventListener('keyup', (event) => {
    if (activeMovementKeys.has(event.code)) {
        activeMovementKeys.delete(event.code);
        updateKeyMovementDirection();
    }
});

function queueScrollImpulse(delta) {
    pendingScrollDelta = THREE.MathUtils.clamp(pendingScrollDelta + delta, -MAX_SCROLL_IMPULSE, MAX_SCROLL_IMPULSE);
}

renderer.domElement.addEventListener('wheel', (event) => {
    event.preventDefault();
    lastWheelEventTime = performance.now();
    const delta = event.deltaY > 0 ? -SCROLL_ROTATION_IMPULSE : event.deltaY < 0 ? SCROLL_ROTATION_IMPULSE : 0;
    if (delta !== 0) {
        queueScrollImpulse(delta);
    }
}, { passive: false });

renderer.domElement.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1) return;
    lastTouchY = event.touches[0].clientY;
    lastTouchX = event.touches[0].clientX;
    freezeRenderer();
}, { passive: true });

renderer.domElement.addEventListener('touchmove', (event) => {
    if (event.touches.length !== 1 || lastTouchY === null || lastTouchX === null) return;
    event.preventDefault();
    const currentY = event.touches[0].clientY;
    const currentX = event.touches[0].clientX;
    const deltaY = currentY - lastTouchY;
    const deltaX = currentX - lastTouchX;
    if (Math.abs(deltaY) >= TOUCH_SCROLL_STEP) {
        const steps = Math.floor(Math.abs(deltaY) / TOUCH_SCROLL_STEP);
        const direction = deltaY < 0 ? 1 : -1; // swipe up => forward
        if (steps > 0) {
            queueScrollImpulse(direction * SCROLL_ROTATION_IMPULSE * steps);
        }
        lastTouchY = currentY;
    }
    if (Math.abs(deltaX) >= TOUCH_SCROLL_STEP) {
        const horizontalRatio = THREE.MathUtils.clamp(deltaX / (window.innerWidth * 0.25), -1, 1);
        queueScrollImpulse(-horizontalRatio * TOUCH_DRAG_SENS);
        lastTouchX = currentX;
    }
}, { passive: false });

const resetTouchScroll = () => {
    lastTouchY = null;
    lastTouchX = null;
    resumeRenderer();
};

renderer.domElement.addEventListener('touchend', resetTouchScroll);
renderer.domElement.addEventListener('touchcancel', resetTouchScroll);

// Function to get position on sphere surface at equator
function getPositionOnEquator(angle, radius) {
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = 0; // Equator is at y = 0
    return new THREE.Vector3(x, y, z);
}

// Function to get surface normal at a point on the sphere
function getSurfaceNormal(position) {
    return position.clone().normalize();
}

// Initialize character position
const initialPos = getPositionOnEquator(characterAngle, WALKWAY_RADIUS);
character.position.copy(initialPos);
character.position.y = CHARACTER_HEIGHT + CHARACTER_RING_CLEARANCE; // Position character above ring surface
scene.add(character);

// Initialize camera position for trailing third-person view
const initialForward = new THREE.Vector3(-Math.sin(characterAngle), 0, Math.cos(characterAngle))
    .multiplyScalar(cameraFollowDirection)
    .normalize();
const initialRadial = character.position.clone().normalize();
const initialCamPos = character.position.clone()
    .sub(initialForward.clone().multiplyScalar(CAMERA_TRAIL_DISTANCE))
    .add(initialRadial.multiplyScalar(CAMERA_OUTWARD_OFFSET))
    .add(new THREE.Vector3(0, CAMERA_VERTICAL_OFFSET, 0));
camera.position.copy(initialCamPos);

camera.up.set(0, 1, 0);
const initialLookTarget = character.position.clone().add(new THREE.Vector3(0, CAMERA_LOOK_AT_OFFSET, 0));
camera.lookAt(initialLookTarget);
const cameraLookTarget = initialLookTarget.clone();
const cameraForwardVec = new THREE.Vector3();
const cameraRadialVec = new THREE.Vector3();
const cameraTempVec = new THREE.Vector3();
const cameraDesiredPos = new THREE.Vector3();

// Character animation - moves along equator path
function updateCharacter(dt) {
    scrollImpulse = THREE.MathUtils.damp(scrollImpulse, pendingScrollDelta, 8, dt);
    pendingScrollDelta *= SCROLL_IMPULSE_DECAY;
    if (Math.abs(pendingScrollDelta) < 0.01) pendingScrollDelta = 0;
    const desiredSpeed = keyMovementDirection * CHARACTER_BASE_ROTATION_SPEED + scrollImpulse;
    const maxSpeed = 0.65;
    const targetAngularSpeed = THREE.MathUtils.clamp(desiredSpeed, -maxSpeed, maxSpeed);
    const blend = Math.min(1, CHARACTER_ROTATION_ACCEL * dt);
    currentAngularSpeed += (targetAngularSpeed - currentAngularSpeed) * blend;
    characterAngle += currentAngularSpeed * dt;
    const wasActive = isMovementActive;
    isMovementActive = Math.abs(currentAngularSpeed) > MOVEMENT_IDLE_THRESHOLD;
    if (isMovementActive) {
        idleTimer = 0;
    } else if (wasActive) {
        idleTimer += dt;
        if (idleTimer > MOVEMENT_IDLE_TIMEOUT) {
            isMovementActive = false;
        }
    }
    const directionThreshold = 0.08;
    if (currentAngularSpeed > directionThreshold) {
        cameraFollowDirection = 1;
    } else if (currentAngularSpeed < -directionThreshold) {
        cameraFollowDirection = -1;
    }

    // Get position on equator
    const position = getPositionOnEquator(characterAngle, WALKWAY_RADIUS);
    const normalizedAngle = ((characterAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

    // Set character position (slightly above walkway)
    character.position.set(
        position.x,
        CHARACTER_HEIGHT + CHARACTER_RING_CLEARANCE,
        position.z
    );

    // Calculate forward direction (tangent to the circle)
    const forward = new THREE.Vector3(-Math.sin(characterAngle), 0, Math.cos(characterAngle));

    // Get surface normal (points outward from sphere center)
    const normal = getSurfaceNormal(position);

    // Create a rotation matrix that:
    // 1. Aligns character forward along the path tangent
    // 2. Keeps character upright relative to surface normal
    const up = new THREE.Vector3(0, 1, 0); // World up
    const right = new THREE.Vector3().crossVectors(forward, normal).normalize();
    const correctedUp = new THREE.Vector3().crossVectors(right, forward).normalize();

    // Create look-at matrix
    const lookAtMatrix = new THREE.Matrix4();
    lookAtMatrix.lookAt(
        character.position,
        character.position.clone().add(forward),
        correctedUp
    );

    // Extract rotation from matrix
    const rotation = new THREE.Euler().setFromRotationMatrix(lookAtMatrix);
    character.rotation.copy(rotation);
}

// ========== THIRD-PERSON CAMERA UPDATE (NO FLIPPING) ==========
function updateCamera(dt) {
    cameraForwardVec.set(-Math.sin(characterAngle), 0, Math.cos(characterAngle))
        .multiplyScalar(cameraFollowDirection)
        .normalize();

    cameraRadialVec.copy(character.position).normalize();

    cameraDesiredPos.copy(character.position)
        .sub(cameraForwardVec.multiplyScalar(CAMERA_TRAIL_DISTANCE));

    cameraTempVec.copy(cameraRadialVec).multiplyScalar(CAMERA_OUTWARD_OFFSET);
    cameraDesiredPos.add(cameraTempVec);
    cameraDesiredPos.y += CAMERA_VERTICAL_OFFSET;

    cameraTempVec.copy(cameraDesiredPos).sub(camera.position).multiplyScalar(CAMERA_POSITION_SMOOTH);
    camera.position.add(cameraTempVec);

    const lookTarget = cameraTempVec.set(0, CAMERA_LOOK_AT_OFFSET, 0).add(character.position);
    cameraLookTarget.add(lookTarget.sub(cameraLookTarget).multiplyScalar(CAMERA_LOOK_SMOOTH));
    camera.up.set(0, 1, 0);
    camera.lookAt(cameraLookTarget);
}

// ========== ZONE-SPECIFIC LIGHTING ==========
const zoneLights = {
    summer: {
        ambient: new THREE.AmbientLight(0xffffff, 1.0),
        directional: new THREE.DirectionalLight(0xffd700, 0.8)
    },
    rain: {
        ambient: new THREE.AmbientLight(0x4a4a5a, 0.5),
        directional: new THREE.DirectionalLight(0x6a6a7a, 0.3)
    },
    autumn: {
        ambient: new THREE.AmbientLight(0xffaa66, 0.7),
        directional: new THREE.DirectionalLight(0xff8c42, 0.6)
    },
    winter: {
        ambient: new THREE.AmbientLight(0xaaccff, 0.6),
        directional: new THREE.DirectionalLight(0xffffff, 0.5)
    }
};

// Position directional lights
Object.keys(zoneLights).forEach((season, index) => {
    const angle = SEASON_ANGLES[index];
    const light = zoneLights[season].directional;
    light.position.set(
        Math.cos(angle) * 10,
        5,
        Math.sin(angle) * 10
    );
    light.castShadow = true;
    scene.add(light);
    scene.add(zoneLights[season].ambient);
});

const seasonalFogColors = {
    summer: new THREE.Color('#5c2c8e'),
    rain: new THREE.Color('#3a1f4f'),
    autumn: new THREE.Color('#7a356a'),
    winter: new THREE.Color('#4f3a9e')
};

const SEASON_TRANSITION_DURATION = 2.2;
let currentSeason = 0;
let targetSeason = 0;
const seasonWeights = [1, 0, 0, 0];
const seasonWeightTargets = [1, 0, 0, 0];
const seasonLabelElement = document.getElementById('season');

function storeBaseLightIntensity(light) {
    if (!light.userData) {
        light.userData = {};
    }
    if (light.userData.baseIntensity === undefined) {
        light.userData.baseIntensity = light.intensity;
    }
}

function applyLightWeight(lights, weight) {
    const ambient = lights.ambient;
    const directional = lights.directional;
    storeBaseLightIntensity(ambient);
    storeBaseLightIntensity(directional);
    const visible = weight > 0.02;
    ambient.visible = visible;
    directional.visible = visible;
    ambient.intensity = ambient.userData.baseIntensity * weight;
    directional.intensity = directional.userData.baseIntensity * weight;
}

function initializeSeasonEnvironment(initialSeason = 0) {
    currentSeason = initialSeason;
    targetSeason = initialSeason;
    seasonWeights.fill(0);
    seasonWeightTargets.fill(0);
    seasonWeights[initialSeason] = 1;
    seasonWeightTargets[initialSeason] = 1;
    const color = seasonalFogColors[SEASONS[initialSeason]] || globalFogColor;
    if (!scene.fog) {
        scene.fog = new THREE.FogExp2(color.clone(), 0.02);
    }
    scene.fog.color.copy(color);
    Object.keys(zoneLights).forEach((seasonKey, index) => {
        const lights = zoneLights[seasonKey];
        applyLightWeight(lights, index === initialSeason ? 1 : 0);
    });
    Object.keys(seasonGroups).forEach((key, index) => {
        const group = seasonGroups[key];
        group.userData.fade = index === initialSeason ? 1 : 0;
        group.visible = index === initialSeason;
    });
    if (seasonLabelElement) {
        const label = SEASONS[initialSeason];
        seasonLabelElement.textContent = label.charAt(0).toUpperCase() + label.slice(1);
    }
}

function requestSeasonChange(nextSeason) {
    if (nextSeason === targetSeason && seasonWeightTargets[nextSeason] === 1) return;
    targetSeason = nextSeason;
    seasonWeightTargets.fill(0);
    seasonWeightTargets[nextSeason] = 1;
}

function blendSeasonFogColors() {
    if (!scene.fog) return;
    const blended = new THREE.Color(0, 0, 0);
    seasonWeights.forEach((weight, index) => {
        if (weight <= 0) return;
        const color = seasonalFogColors[SEASONS[index]] || globalFogColor;
        blended.r += color.r * weight;
        blended.g += color.g * weight;
        blended.b += color.b * weight;
    });
    scene.fog.color.copy(blended);
}

function updateSeasonLightsFromWeights() {
    Object.keys(zoneLights).forEach((seasonKey, index) => {
        applyLightWeight(zoneLights[seasonKey], seasonWeights[index]);
    });
}

function prepareFadeNodes(group) {
    if (group.userData.fadeNodesPrepared) return;
    const nodes = [];
    group.traverse((child) => {
        if (child.material) {
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach((mat) => {
                if (!mat.userData) mat.userData = {};
                if (mat.userData.baseOpacity === undefined) {
                    mat.userData.baseOpacity = mat.opacity !== undefined ? mat.opacity : 1;
                }
                mat.transparent = true;
                mat.depthWrite = false;
            });
        }
        if (child.intensity !== undefined) {
            if (!child.userData) child.userData = {};
            if (child.userData.baseIntensity === undefined) {
                child.userData.baseIntensity = child.intensity;
            }
        }
        nodes.push(child);
    });
    group.userData.fadeNodes = nodes;
    group.userData.fadeNodesPrepared = true;
}

function applyGroupFade(group, targetWeight) {
    const currentFade = group.userData.fade ?? 0;
    const nextFade = THREE.MathUtils.lerp(currentFade, targetWeight, 0.15);
    group.userData.fade = nextFade;
    prepareFadeNodes(group);
    const visible = nextFade > 0.01;
    group.visible = visible;
    const nodes = group.userData.fadeNodes || [];
    nodes.forEach((node) => {
        if (node.material) {
            const materials = Array.isArray(node.material) ? node.material : [node.material];
            materials.forEach((mat) => {
                const base = mat.userData?.baseOpacity ?? 1;
                mat.opacity = base * nextFade;
            });
        }
        if (node.intensity !== undefined) {
            const base = node.userData?.baseIntensity ?? node.intensity;
            node.intensity = base * nextFade;
        }
    });
}

function fadeSeasonGroupsFromWeights() {
    Object.keys(seasonGroups).forEach((key, index) => {
        applyGroupFade(seasonGroups[key], seasonWeights[index]);
    });
}

function updateSeasonSystems(dt) {
    const step = dt / SEASON_TRANSITION_DURATION;
    for (let i = 0; i < seasonWeights.length; i++) {
        const target = seasonWeightTargets[i];
        const current = seasonWeights[i];
        if (Math.abs(target - current) < 1e-4) {
            seasonWeights[i] = target;
            continue;
        }
        const delta = Math.sign(target - current) * Math.min(Math.abs(target - current), step);
        seasonWeights[i] = THREE.MathUtils.clamp(current + delta, 0, 1);
    }
    blendSeasonFogColors();
    updateSeasonLightsFromWeights();
    fadeSeasonGroupsFromWeights();
    if (seasonWeights[targetSeason] > 0.98 && currentSeason !== targetSeason) {
        currentSeason = targetSeason;
        if (seasonLabelElement) {
            const label = SEASONS[currentSeason];
            seasonLabelElement.textContent = label.charAt(0).toUpperCase() + label.slice(1);
        }
    }
}

// ========== SEASONAL EFFECTS ==========
const seasonGroups = {
    summer: new THREE.Group(),
    rain: new THREE.Group(),
    autumn: new THREE.Group(),
    winter: new THREE.Group()
};

// Add season groups to scene
Object.values(seasonGroups).forEach(group => scene.add(group));
initializeSeasonEnvironment(0);

const QUADRANT_DEFS = [
    { id: 'modern', label: 'Modern Nexus', seasonIndex: 0, color: 0x7dd5ff },
    { id: 'ancient', label: 'Ancient Ruins', seasonIndex: 1, color: 0xe0c18f },
    { id: 'neon', label: 'Neon Bazaar', seasonIndex: 2, color: 0xf56bff },
    { id: 'dystopian', label: 'Dystopian Frontier', seasonIndex: 3, color: 0x9ea8ff }
];
const QUADRANT_ANCHOR_COUNT = 6;
const GOTHIC_BUILDINGS = [
    { path: '/assets/Gothic/Goth_1.glb', label: 'Goth 1', normAngle: 0.08, scaleMul: 0.6, radiusMul: 0.08 },
    { path: '/assets/Gothic/Goth_2.glb', label: 'Goth 2', normAngle: 0.16, scaleMul: 0.58, radiusMul: 0.1 },
    { path: '/assets/Gothic/Goth_3.glb', label: 'Goth 3', normAngle: 0.24, scaleMul: 0.62, radiusMul: 0.12 },
    { path: '/assets/Gothic/Goth_4.glb', label: 'Goth 4', normAngle: 0.34, scaleMul: 0.55, radiusMul: 0.14 },
    { path: '/assets/Gothic/Goth_5.glb', label: 'Goth 5', normAngle: 0.44, scaleMul: 0.6, radiusMul: 0.16 },
    { path: '/assets/Gothic/Goth_6.glb', label: 'Goth 6', normAngle: 0.54, scaleMul: 0.58, radiusMul: 0.18 },
    { path: '/assets/Gothic/Goth_7.glb', label: 'Goth 7', normAngle: 0.64, scaleMul: 0.6, radiusMul: 0.2 },
    { path: '/assets/Gothic/Goth_8.glb', label: 'Goth 8', normAngle: 0.76, scaleMul: 0.62, radiusMul: 0.22 },
    { path: '/assets/Gothic/Goth_9.glb', label: 'Goth 9', normAngle: 0.88, scaleMul: 0.6, radiusMul: 0.24 }
];

const REAL_STAR_WARS_BUILDINGS = [
    { path: '/assets/Starwars/Star_1.glb', label: 'Star 1', normAngle: 0.08, scaleMul: 0.6, radiusMul: 0.08 },
    { path: '/assets/Starwars/Star_2.glb', label: 'Star 2', normAngle: 0.16, scaleMul: 0.6, radiusMul: 0.12 },
    { path: '/assets/Starwars/Star_3.glb', label: 'Star 3', normAngle: 0.24, scaleMul: 0.6, radiusMul: 0.16 },
    { path: '/assets/Starwars/Star_4.glb', label: 'Star 4', normAngle: 0.32, scaleMul: 0.6, radiusMul: 0.2 },
    { path: '/assets/Starwars/Star_5.glb', label: 'Star 5', normAngle: 0.40, scaleMul: 0.6, radiusMul: 0.24 },
    { path: '/assets/Starwars/Star_6.glb', label: 'Star 6', normAngle: 0.48, scaleMul: 0.6, radiusMul: 0.28 },
    { path: '/assets/Starwars/Star_7.glb', label: 'Star 7', normAngle: 0.56, scaleMul: 0.6, radiusMul: 0.32 },
    { path: '/assets/Starwars/Star_8.glb', label: 'Star 8', normAngle: 0.64, scaleMul: 0.6, radiusMul: 0.36 },
    { path: '/assets/Starwars/Star_9.glb', label: 'Star 9', normAngle: 0.72, scaleMul: 0.6, radiusMul: 0.4 },
    { path: '/assets/Starwars/Star_10.glb', label: 'Star 10', normAngle: 0.80, scaleMul: 0.6, radiusMul: 0.44 },
    { path: '/assets/Starwars/Star_11.glb', label: 'Star 11', normAngle: 0.88, scaleMul: 0.6, radiusMul: 0.48 },
    { path: '/assets/Starwars/Star_12.glb', label: 'Star 12', normAngle: 0.96, scaleMul: 0.6, radiusMul: 0.52 }
];

const NIGHT_CITY_BUILDINGS = [
    { path: '/assets/NightCIty/Night_1.glb', label: 'Night 1', normAngle: 0.10, scaleMul: 0.6, radiusMul: 0.1 },
    { path: '/assets/NightCIty/Night_2.glb', label: 'Night 2', normAngle: 0.22, scaleMul: 0.6, radiusMul: 0.15 },
    { path: '/assets/NightCIty/Night_3.glb', label: 'Night 3', normAngle: 0.34, scaleMul: 0.6, radiusMul: 0.2 },
    { path: '/assets/NightCIty/Night_4.glb', label: 'Night 4', normAngle: 0.46, scaleMul: 0.6, radiusMul: 0.25 },
    { path: '/assets/NightCIty/Night_5.glb', label: 'Night 5', normAngle: 0.58, scaleMul: 0.6, radiusMul: 0.3 },
    { path: '/assets/NightCIty/Night_6.glb', label: 'Night 6', normAngle: 0.70, scaleMul: 0.6, radiusMul: 0.35 },
    { path: '/assets/NightCIty/Night_7.glb', label: 'Night 7', normAngle: 0.82, scaleMul: 0.6, radiusMul: 0.4 },
    { path: '/assets/NightCIty/Night_8.glb', label: 'Night 8', normAngle: 0.90, scaleMul: 0.6, radiusMul: 0.45 },
    { path: '/assets/NightCIty/Night_9.glb', label: 'Night 9', normAngle: 0.98, scaleMul: 0.6, radiusMul: 0.5 }
];
const quadrantGroups = {};
initializeQuadrantZones();

function initializeQuadrantZones() {
    const firstRingInnerRadius = WALKWAY_RADIUS - WALKWAY_WIDTH * 0.5;
    QUADRANT_DEFS.forEach((def, index) => {
        const startAngle = SEASON_ANGLES[index];
        const endAngle = startAngle + Math.PI / 2;
        const group = new THREE.Group();
        group.name = `${def.label} Zone`;
        group.userData = {
            id: def.id,
            label: def.label,
            seasonIndex: def.seasonIndex,
            startAngle,
            endAngle,
            radiusInner: GLOBE_RADIUS + 0.2,
            radiusOuter: firstRingInnerRadius
        };
        group.userData.anchors = createQuadrantAnchors(group.userData);
        quadrantGroups[def.id] = group;
        scene.add(group);
        const helper = createQuadrantDebugArc(group.userData, def.color);
        group.add(helper);
    });
    if (typeof window !== 'undefined') {
        window.quadrantGroups = quadrantGroups;
    }
    populateGothicQuadrant();
    populateRealStarWarsQuadrant();
    populateNightCityQuadrant();
    initializeStarPlacementSurfaces();
    createQuadrantDivisionLines();
}

function createPlacementSurfaceMesh(surface) {
    const geometry = new THREE.RingGeometry(surface.inner, surface.outer, 128, 1);
    const material = new THREE.MeshBasicMaterial({
        color: surface.color,
        transparent: true,
        opacity: DEV_DEBUG_VISUALS ? 0.25 : 0.06,
        side: THREE.DoubleSide,
        wireframe: DEV_DEBUG_VISUALS,
        depthWrite: false
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.y = innerRing.position.y + 0.015;
    mesh.visible = DEV_DEBUG_VISUALS;
    scene.add(mesh);
    surface.mesh = mesh;
}

function initializeStarPlacementSurfaces() {
    STAR_PLACEMENT_SURFACES.forEach((surface) => {
        createPlacementSurfaceMesh(surface);
    });
}

function createQuadrantAnchors(config) {
    const anchors = [];
    const elevation = innerRing.position.y + 0.05;
    for (let i = 0; i < QUADRANT_ANCHOR_COUNT; i++) {
        const t = QUADRANT_ANCHOR_COUNT === 1 ? 0.5 : i / (QUADRANT_ANCHOR_COUNT - 1);
        const angle = THREE.MathUtils.lerp(config.startAngle, config.endAngle, t);
        const innerRadius = config.radiusInner;
        const outerRadius = config.radiusOuter;
        const innerPosition = new THREE.Vector3(
            Math.cos(angle) * innerRadius,
            elevation,
            Math.sin(angle) * innerRadius
        );
        const outerPosition = new THREE.Vector3(
            Math.cos(angle) * outerRadius,
            elevation,
            Math.sin(angle) * outerRadius
        );
        anchors.push({
            angle,
            innerRadius,
            outerRadius,
            innerPosition,
            outerPosition,
            normal: new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle))
        });
    }
    return anchors;
}

function createQuadrantDebugArc(config, color) {
    const portions = 32;
    const geometry = new THREE.RingGeometry(
        config.radiusInner,
        config.radiusOuter,
        portions,
        1,
        config.startAngle,
        Math.PI / 2
    );
    const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.08,
        side: THREE.DoubleSide,
        depthWrite: false
    });
    const arc = new THREE.Mesh(geometry, material);
    arc.rotation.x = Math.PI / 2;
    arc.position.y = innerRing.position.y + 0.02;
    return arc;
}

function createQuadrantDividerLine(angle, color) {
    const startRadius = GLOBE_RADIUS - 0.2;
    const endRadius = WALKWAY_RADIUS + WALKWAY_WIDTH * 2.5;
    const baseY = innerRing.position.y + 0.05;
    const start = new THREE.Vector3(
        Math.cos(angle) * startRadius,
        baseY,
        Math.sin(angle) * startRadius
    );
    const end = new THREE.Vector3(
        Math.cos(angle) * endRadius,
        baseY,
        Math.sin(angle) * endRadius
    );
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    const material = new THREE.LineDashedMaterial({
        color,
        linewidth: 1,
        dashSize: 0.6,
        gapSize: 0.4,
        transparent: true,
        opacity: 0.9,
        depthWrite: false
    });
    const line = new THREE.Line(geometry, material);
    line.computeLineDistances();
    line.renderOrder = 10;
    scene.add(line);
    quadrantDividerLines.push(line);
}

function createQuadrantDivisionLines() {
    const dividerColors = [0xff9f4a, 0x4ac3ff, 0xcd7dff, 0xff5a94];
    SEASON_ANGLES.forEach((angle, index) => {
        createQuadrantDividerLine(angle, dividerColors[index % dividerColors.length]);
    });
}

function clearQuadrantContent(group, tag) {
    if (!group) return;
    group.children
        .filter((child) => child.userData && child.userData.tag === tag)
        .forEach((child) => {
            group.remove(child);
            if (child.geometry) child.geometry.dispose?.();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach((mat) => mat.dispose?.());
                } else {
                    child.material.dispose?.();
                }
            }
            if (tag === 'starfall') {
                const idx = starfallSystems.indexOf(child);
                if (idx !== -1) {
                    starfallSystems.splice(idx, 1);
                }
            }
        });
    if (tag === 'starBuildings' && group.userData[tag]) {
        group.userData[tag].forEach((entry) => {
            const idx = worldProps.indexOf(entry);
            if (idx !== -1) {
                worldProps.splice(idx, 1);
            }
        });
    }
    group.userData[tag] = [];
}

function populateGothicQuadrant() {
    const quadrant = quadrantGroups.modern;
    if (!quadrant) return;
    clearQuadrantContent(quadrant, 'starBuildings');
    clearQuadrantContent(quadrant, 'starfall');
    const config = quadrant.userData;
    const range = config.endAngle - config.startAngle;
    const padding = range * 0.05;
    const usableRange = Math.max(range - padding * 2, 0.001);
    const segmentCount = GOTHIC_BUILDINGS.length;
    const baseHeight = innerRing.position.y + 0.02;
    const placementEntries = [];

    GOTHIC_BUILDINGS.forEach((entry, index) => {
        const path = typeof entry === 'string' ? entry : entry.path;
        const entryOffset = typeof entry === 'object' && typeof entry.offset === 'number'
            ? entry.offset
            : 0;
        const normalized = typeof entry === 'object' && typeof entry.normAngle === 'number'
            ? THREE.MathUtils.clamp(entry.normAngle, 0, 1)
            : (index + 0.5) / Math.max(segmentCount, 1);
        const baseAngle = config.startAngle + padding + usableRange * normalized;
        const angle = baseAngle + entryOffset;
        const surface = getPlacementSurface(entry);
        const ringInnerLimit = surface.inner + BUILDING_SURFACE_PADDING;
        const ringOuterLimit = surface.outer - BUILDING_SURFACE_PADDING;
        const availableWidth = Math.max(ringOuterLimit - ringInnerLimit, BUILDING_SURFACE_PADDING * 2);
        loadGLTFClone(path, (model) => {
            try {
                // Create a container to center the model geometry
                const container = new THREE.Group();
                container.userData.tag = 'starBuildings';

                // Calculate center offset
                const initialBox = new THREE.Box3().setFromObject(model);
                const center = new THREE.Vector3();
                initialBox.getCenter(center);

                // Center the model within the container (align bottom to 0)
                model.position.set(-center.x, -initialBox.min.y, -center.z);
                container.add(model);

                container.traverse((child) => {
                    if (child.isMesh) {
                        ensureMaterialTextures(child.material);
                        // Emissive glow removed per user request
                    }
                });

                const rawSize = new THREE.Vector3();
                const rawBox = new THREE.Box3().setFromObject(container);
                rawBox.getSize(rawSize);
                const span = Math.max(rawSize.x, rawSize.z, 0.001);
                const entryScaleMul = typeof entry === 'object' && entry.scaleMul ? entry.scaleMul : 1;
                const desiredScale = Math.min(availableWidth / span, 6) * STAR_BUILDING_SCALE_MULTIPLIER * entryScaleMul;
                let scaleFactor = desiredScale;
                container.scale.multiplyScalar(scaleFactor);

                const fittedBox = new THREE.Box3();
                const fittedSize = new THREE.Vector3();
                let lift = baseHeight;
                let width = span * scaleFactor;
                let attempt = 0;
                while (attempt < 20) {
                    fittedBox.setFromObject(container);
                    fittedBox.getSize(fittedSize);
                    width = Math.max(fittedSize.x, fittedSize.z);
                    lift = baseHeight - fittedBox.min.y;
                    if (width <= availableWidth) {
                        break;
                    }
                    const shrinkRatio = Math.max(availableWidth / width, 0.8);
                    scaleFactor *= shrinkRatio;
                    container.scale.setScalar(scaleFactor);
                    attempt++;
                }
                if (width > availableWidth) {
                    const finalRatio = availableWidth / Math.max(width, 0.0001);
                    scaleFactor *= finalRatio;
                    container.scale.setScalar(scaleFactor);
                    fittedBox.setFromObject(container);
                    fittedBox.getSize(fittedSize);
                    width = Math.max(fittedSize.x, fittedSize.z);
                    lift = baseHeight - fittedBox.min.y;
                }
                const entryRadiusMul = typeof entry === 'object' && entry.radiusMul ? entry.radiusMul : 0.4;
                const usableSpan = Math.max(ringOuterLimit - ringInnerLimit - width, BUILDING_SURFACE_PADDING);
                const radiusBlend = THREE.MathUtils.clamp(entryRadiusMul, 0, 1);
                const preferredRadius = ringInnerLimit + width * 0.5 + usableSpan * radiusBlend;
                const radius = THREE.MathUtils.clamp(
                    preferredRadius,
                    ringInnerLimit + width * 0.5,
                    ringOuterLimit - width * 0.5
                );
                container.position.set(
                    Math.cos(angle) * radius,
                    lift,
                    Math.sin(angle) * radius
                );
                const rotationOffset = typeof entry === 'object' && entry.rotationOffset ? entry.rotationOffset : 0;
                container.rotation.y = angle + Math.PI / 2 + rotationOffset;
                container.lookAt(0, lift, 0);
                quadrant.add(container);

                const propEntry = {
                    object: container,
                    angle,
                    baseHeight: lift,
                    hoverSpeed: 0.2 + Math.random() * 0.25,
                    hoverAmplitude: 0.12 + Math.random() * 0.08,
                    phase: Math.random() * Math.PI * 2,
                    mixer: null
                };
                worldProps.push(propEntry);
                placementEntries.push(propEntry);
            } catch (e) {
                console.error('Error placing building:', e);
            }
        }, (err) => console.warn(`Failed to load ${path}`, err));
    });
    quadrant.userData.starBuildings = placementEntries;
    createStarfallParticles(quadrant, config);
    createGothicParticlesForQuadrant(quadrant, config);
    createGothicWeather(quadrant, config);
}

function populateRealStarWarsQuadrant() {
    const quadrant = quadrantGroups.dystopian;
    if (!quadrant) return;
    clearQuadrantContent(quadrant, 'starBuildings');
    const config = quadrant.userData;
    const range = config.endAngle - config.startAngle;
    const padding = range * 0.05;
    const usableRange = Math.max(range - padding * 2, 0.001);
    const segmentCount = REAL_STAR_WARS_BUILDINGS.length;
    const baseHeight = innerRing.position.y + 0.02;
    const placementEntries = [];

    REAL_STAR_WARS_BUILDINGS.forEach((entry, index) => {
        const path = typeof entry === 'string' ? entry : entry.path;
        const entryOffset = typeof entry === 'object' && typeof entry.offset === 'number'
            ? entry.offset
            : 0;
        const normalized = typeof entry === 'object' && typeof entry.normAngle === 'number'
            ? THREE.MathUtils.clamp(entry.normAngle, 0, 1)
            : (index + 0.5) / Math.max(segmentCount, 1);
        const baseAngle = config.startAngle + padding + usableRange * normalized;
        const angle = baseAngle + entryOffset;
        const surface = getPlacementSurface(entry);
        const ringInnerLimit = surface.inner + BUILDING_SURFACE_PADDING;
        const ringOuterLimit = surface.outer - BUILDING_SURFACE_PADDING;
        const availableWidth = Math.max(ringOuterLimit - ringInnerLimit, BUILDING_SURFACE_PADDING * 2);
        loadGLTFClone(path, (model) => {
            try {
                // Create a container to center the model geometry
                const container = new THREE.Group();
                container.userData.tag = 'starBuildings';

                // Calculate center offset
                const initialBox = new THREE.Box3().setFromObject(model);
                const center = new THREE.Vector3();
                initialBox.getCenter(center);

                // Center the model within the container (align bottom to 0)
                model.position.set(-center.x, -initialBox.min.y, -center.z);
                container.add(model);

                container.traverse((child) => {
                    if (child.isMesh) {
                        ensureMaterialTextures(child.material);
                        // Emissive glow removed per user request
                    }
                });

                const rawSize = new THREE.Vector3();
                const rawBox = new THREE.Box3().setFromObject(container);
                rawBox.getSize(rawSize);
                const span = Math.max(rawSize.x, rawSize.z, 0.001);
                const entryScaleMul = typeof entry === 'object' && entry.scaleMul ? entry.scaleMul : 1;
                const desiredScale = Math.min(availableWidth / span, 6) * STAR_BUILDING_SCALE_MULTIPLIER * entryScaleMul;
                let scaleFactor = desiredScale;
                container.scale.multiplyScalar(scaleFactor);

                const fittedBox = new THREE.Box3();
                const fittedSize = new THREE.Vector3();
                let lift = baseHeight;
                let width = span * scaleFactor;
                let attempt = 0;
                while (attempt < 20) {
                    fittedBox.setFromObject(container);
                    fittedBox.getSize(fittedSize);
                    width = Math.max(fittedSize.x, fittedSize.z);
                    lift = baseHeight - fittedBox.min.y;
                    if (width <= availableWidth) {
                        break;
                    }
                    const shrinkRatio = Math.max(availableWidth / width, 0.8);
                    scaleFactor *= shrinkRatio;
                    container.scale.setScalar(scaleFactor);
                    attempt++;
                }
                if (width > availableWidth) {
                    const finalRatio = availableWidth / Math.max(width, 0.0001);
                    scaleFactor *= finalRatio;
                    container.scale.setScalar(scaleFactor);
                    fittedBox.setFromObject(container);
                    fittedBox.getSize(fittedSize);
                    width = Math.max(fittedSize.x, fittedSize.z);
                    lift = baseHeight - fittedBox.min.y;
                }
                const entryRadiusMul = typeof entry === 'object' && entry.radiusMul ? entry.radiusMul : 0.4;
                const usableSpan = Math.max(ringOuterLimit - ringInnerLimit - width, BUILDING_SURFACE_PADDING);
                const radiusBlend = THREE.MathUtils.clamp(entryRadiusMul, 0, 1);
                const preferredRadius = ringInnerLimit + width * 0.5 + usableSpan * radiusBlend;
                const radius = THREE.MathUtils.clamp(
                    preferredRadius,
                    ringInnerLimit + width * 0.5,
                    ringOuterLimit - width * 0.5
                );
                container.position.set(
                    Math.cos(angle) * radius,
                    lift,
                    Math.sin(angle) * radius
                );
                const rotationOffset = typeof entry === 'object' && entry.rotationOffset ? entry.rotationOffset : 0;
                container.rotation.y = angle + Math.PI / 2 + rotationOffset;
                container.lookAt(0, lift, 0);
                quadrant.add(container);

                const propEntry = {
                    object: container,
                    angle,
                    baseHeight: lift,
                    hoverSpeed: 0.2 + Math.random() * 0.25,
                    hoverAmplitude: 0.12 + Math.random() * 0.08,
                    phase: Math.random() * Math.PI * 2,
                    mixer: null
                };
                worldProps.push(propEntry);
                placementEntries.push(propEntry);
            } catch (e) {
                console.error('Error placing building:', e);
            }
        }, (err) => console.warn(`Failed to load ${path}`, err));
    });
    quadrant.userData.starBuildings = placementEntries;
    createStarParticlesForQuadrant(quadrant, config);
    createCosmicDustWeather(quadrant, config);
}

function populateNightCityQuadrant() {
    const quadrant = quadrantGroups.neon;
    if (!quadrant) return;
    clearQuadrantContent(quadrant, 'starBuildings');
    const config = quadrant.userData;
    const range = config.endAngle - config.startAngle;
    const padding = range * 0.05;
    const usableRange = Math.max(range - padding * 2, 0.001);
    const segmentCount = NIGHT_CITY_BUILDINGS.length;
    const baseHeight = innerRing.position.y + 0.02;
    const placementEntries = [];

    NIGHT_CITY_BUILDINGS.forEach((entry, index) => {
        const path = typeof entry === 'string' ? entry : entry.path;
        const entryOffset = typeof entry === 'object' && typeof entry.offset === 'number'
            ? entry.offset
            : 0;
        const normalized = typeof entry === 'object' && typeof entry.normAngle === 'number'
            ? THREE.MathUtils.clamp(entry.normAngle, 0, 1)
            : (index + 0.5) / Math.max(segmentCount, 1);
        const baseAngle = config.startAngle + padding + usableRange * normalized;
        const angle = baseAngle + entryOffset;
        const surface = getPlacementSurface(entry);
        const ringInnerLimit = surface.inner + BUILDING_SURFACE_PADDING;
        const ringOuterLimit = surface.outer - BUILDING_SURFACE_PADDING;
        const availableWidth = Math.max(ringOuterLimit - ringInnerLimit, BUILDING_SURFACE_PADDING * 2);
        loadGLTFClone(path, (model) => {
            try {
                // Create a container to center the model geometry
                const container = new THREE.Group();
                container.userData.tag = 'starBuildings';

                // Calculate center offset
                const initialBox = new THREE.Box3().setFromObject(model);
                const center = new THREE.Vector3();
                initialBox.getCenter(center);

                // Center the model within the container (align bottom to 0)
                model.position.set(-center.x, -initialBox.min.y, -center.z);
                container.add(model);

                container.traverse((child) => {
                    if (child.isMesh) {
                        ensureMaterialTextures(child.material);
                    }
                });

                const rawSize = new THREE.Vector3();
                const rawBox = new THREE.Box3().setFromObject(container);
                rawBox.getSize(rawSize);
                const span = Math.max(rawSize.x, rawSize.z, 0.001);
                const entryScaleMul = typeof entry === 'object' && entry.scaleMul ? entry.scaleMul : 1;
                const desiredScale = Math.min(availableWidth / span, 6) * STAR_BUILDING_SCALE_MULTIPLIER * entryScaleMul;
                let scaleFactor = desiredScale;
                container.scale.multiplyScalar(scaleFactor);

                const fittedBox = new THREE.Box3();
                const fittedSize = new THREE.Vector3();
                let lift = baseHeight;
                let width = span * scaleFactor;
                let attempt = 0;
                while (attempt < 20) {
                    fittedBox.setFromObject(container);
                    fittedBox.getSize(fittedSize);
                    width = Math.max(fittedSize.x, fittedSize.z);
                    lift = baseHeight - fittedBox.min.y;
                    if (width <= availableWidth) {
                        break;
                    }
                    const shrinkRatio = Math.max(availableWidth / width, 0.8);
                    scaleFactor *= shrinkRatio;
                    container.scale.setScalar(scaleFactor);
                    attempt++;
                }
                if (width > availableWidth) {
                    const finalRatio = availableWidth / Math.max(width, 0.0001);
                    scaleFactor *= finalRatio;
                    container.scale.setScalar(scaleFactor);
                    fittedBox.setFromObject(container);
                    fittedBox.getSize(fittedSize);
                    width = Math.max(fittedSize.x, fittedSize.z);
                    lift = baseHeight - fittedBox.min.y;
                }
                const entryRadiusMul = typeof entry === 'object' && entry.radiusMul ? entry.radiusMul : 0.4;
                const usableSpan = Math.max(ringOuterLimit - ringInnerLimit - width, BUILDING_SURFACE_PADDING);
                const radiusBlend = THREE.MathUtils.clamp(entryRadiusMul, 0, 1);
                const preferredRadius = ringInnerLimit + width * 0.5 + usableSpan * radiusBlend;
                const radius = THREE.MathUtils.clamp(
                    preferredRadius,
                    ringInnerLimit + width * 0.5,
                    ringOuterLimit - width * 0.5
                );
                container.position.set(
                    Math.cos(angle) * radius,
                    lift,
                    Math.sin(angle) * radius
                );
                const rotationOffset = typeof entry === 'object' && entry.rotationOffset ? entry.rotationOffset : 0;
                container.rotation.y = angle + Math.PI / 2 + rotationOffset;
                container.lookAt(0, lift, 0);
                quadrant.add(container);

                const propEntry = {
                    object: container,
                    angle,
                    baseHeight: lift,
                    hoverSpeed: 0.2 + Math.random() * 0.25,
                    hoverAmplitude: 0.12 + Math.random() * 0.08,
                    phase: Math.random() * Math.PI * 2,
                    mixer: null
                };
                worldProps.push(propEntry);
                placementEntries.push(propEntry);
            } catch (e) {
                console.error('Error placing building:', e);
            }
        }, (err) => console.warn(`Failed to load ${path}`, err));
    });
    quadrant.userData.starBuildings = placementEntries;
    createPixelParticlesForQuadrant(quadrant, config);
    createNeonRainWeather(quadrant, config);
}

function createStarParticlesForQuadrant(quadrant, config) {
    const count = 300;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const baseHeight = -3;
    const upperHeight = 8;
    const minRadius = GLOBE_RADIUS;
    const maxRadius = 28;

    for (let i = 0; i < count; i++) {
        const angle = THREE.MathUtils.lerp(config.startAngle, config.endAngle, Math.random());
        const radius = THREE.MathUtils.lerp(minRadius, maxRadius, Math.random());
        const height = THREE.MathUtils.lerp(baseHeight, upperHeight, Math.random());

        positions[i * 3] = Math.cos(angle) * radius;
        positions[i * 3 + 1] = height;
        positions[i * 3 + 2] = Math.sin(angle) * radius;
        sizes[i] = 0.08 + Math.random() * 0.12;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.PointsMaterial({
        color: 0xffeb3b,
        size: 0.15,
        transparent: true,
        opacity: 0.8,
        sizeAttenuation: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        map: createStarTexture()
    });

    const particles = new THREE.Points(geometry, material);
    particles.userData.tag = 'quadrantParticles';
    particles.userData.speeds = new Array(count).fill(0).map(() => 0.3 + Math.random() * 0.4);
    particles.userData.phases = new Array(count).fill(0).map(() => Math.random() * Math.PI * 2);
    quadrant.add(particles);

    return particles;
}

function createPixelParticlesForQuadrant(quadrant, config) {
    const count = 400;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const baseHeight = -3;
    const upperHeight = 8;
    const minRadius = GLOBE_RADIUS;
    const maxRadius = 28;

    const neonColors = [
        new THREE.Color(0x00ffff), // Cyan
        new THREE.Color(0xff00ff), // Magenta
        new THREE.Color(0xffff00), // Yellow
        new THREE.Color(0x00ff00)  // Green
    ];

    for (let i = 0; i < count; i++) {
        const angle = THREE.MathUtils.lerp(config.startAngle, config.endAngle, Math.random());
        const radius = THREE.MathUtils.lerp(minRadius, maxRadius, Math.random());
        const height = THREE.MathUtils.lerp(baseHeight, upperHeight, Math.random());

        positions[i * 3] = Math.cos(angle) * radius;
        positions[i * 3 + 1] = height;
        positions[i * 3 + 2] = Math.sin(angle) * radius;

        const color = neonColors[Math.floor(Math.random() * neonColors.length)];
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
        size: 0.08,
        transparent: true,
        opacity: 0.9,
        vertexColors: true,
        sizeAttenuation: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    const particles = new THREE.Points(geometry, material);
    particles.userData.tag = 'quadrantParticles';
    particles.userData.speeds = new Array(count).fill(0).map(() => 0.5 + Math.random() * 0.5);
    particles.userData.directions = new Array(count).fill(0).map(() => Math.random() > 0.5 ? 1 : -1);
    quadrant.add(particles);

    return particles;
}

function createGothicParticlesForQuadrant(quadrant, config) {
    const count = 250;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const baseHeight = -3;
    const upperHeight = 8;
    const minRadius = GLOBE_RADIUS;
    const maxRadius = 28;

    for (let i = 0; i < count; i++) {
        const angle = THREE.MathUtils.lerp(config.startAngle, config.endAngle, Math.random());
        const radius = THREE.MathUtils.lerp(minRadius, maxRadius, Math.random());
        const height = THREE.MathUtils.lerp(baseHeight, upperHeight, Math.random());

        positions[i * 3] = Math.cos(angle) * radius;
        positions[i * 3 + 1] = height;
        positions[i * 3 + 2] = Math.sin(angle) * radius;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
        color: 0x00ff88,
        size: 0.12,
        transparent: true,
        opacity: 0.6,
        sizeAttenuation: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    const particles = new THREE.Points(geometry, material);
    particles.userData.tag = 'quadrantParticles';
    particles.userData.speeds = new Array(count).fill(0).map(() => 0.2 + Math.random() * 0.3);
    particles.userData.swirls = new Array(count).fill(0).map(() => Math.random() * Math.PI * 2);
    quadrant.add(particles);

    return particles;
}

function createStarTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.2, 'rgba(255, 255, 200, 0.8)');
    gradient.addColorStop(0.4, 'rgba(255, 255, 150, 0.4)');
    gradient.addColorStop(1, 'rgba(255, 255, 100, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 32, 32);

    const texture = new THREE.CanvasTexture(canvas);
    return texture;
}

function createGothicWeather(quadrant, config) {
    const count = 180;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count);
    const baseHeight = -2;
    const upperHeight = 7;
    const minRadius = GLOBE_RADIUS;
    const maxRadius = 28;

    for (let i = 0; i < count; i++) {
        const angle = THREE.MathUtils.lerp(config.startAngle, config.endAngle, Math.random());
        const radius = THREE.MathUtils.lerp(minRadius, maxRadius, Math.random());
        const height = THREE.MathUtils.lerp(baseHeight, upperHeight, Math.random());

        positions[i * 3] = Math.cos(angle) * radius;
        positions[i * 3 + 1] = height;
        positions[i * 3 + 2] = Math.sin(angle) * radius;
        velocities[i] = 0.3 + Math.random() * 0.4;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
        color: 0x00ff88,
        size: 0.25,
        transparent: true,
        opacity: 0.4,
        sizeAttenuation: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    const particles = new THREE.Points(geometry, material);
    particles.userData.tag = 'quadrantWeather';
    particles.userData.weatherType = 'gothic';
    particles.userData.velocities = velocities;
    quadrant.add(particles);

    return particles;
}

function createNeonRainWeather(quadrant, config) {
    const count = 250;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const baseHeight = -2;
    const upperHeight = 9;
    const minRadius = GLOBE_RADIUS;
    const maxRadius = 28;

    const purpleShades = [
        new THREE.Color(0xaa00ff),
        new THREE.Color(0xff00ff),
        new THREE.Color(0xdd00ff),
        new THREE.Color(0x8800ff)
    ];

    for (let i = 0; i < count; i++) {
        const angle = THREE.MathUtils.lerp(config.startAngle, config.endAngle, Math.random());
        const radius = THREE.MathUtils.lerp(minRadius, maxRadius, Math.random());
        const height = THREE.MathUtils.lerp(baseHeight, upperHeight, Math.random());

        positions[i * 3] = Math.cos(angle) * radius;
        positions[i * 3 + 1] = height;
        positions[i * 3 + 2] = Math.sin(angle) * radius;
        velocities[i] = 1.5 + Math.random() * 1.5;

        const color = purpleShades[Math.floor(Math.random() * purpleShades.length)];
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
        size: 0.15,
        transparent: true,
        opacity: 0.7,
        vertexColors: true,
        sizeAttenuation: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    const particles = new THREE.Points(geometry, material);
    particles.userData.tag = 'quadrantWeather';
    particles.userData.weatherType = 'neonRain';
    particles.userData.velocities = velocities;
    quadrant.add(particles);

    return particles;
}

function createCosmicDustWeather(quadrant, config) {
    const count = 200;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count);
    const sizes = new Float32Array(count);
    const baseHeight = -2;
    const upperHeight = 8;
    const minRadius = GLOBE_RADIUS;
    const maxRadius = 28;

    for (let i = 0; i < count; i++) {
        const angle = THREE.MathUtils.lerp(config.startAngle, config.endAngle, Math.random());
        const radius = THREE.MathUtils.lerp(minRadius, maxRadius, Math.random());
        const height = THREE.MathUtils.lerp(baseHeight, upperHeight, Math.random());

        positions[i * 3] = Math.cos(angle) * radius;
        positions[i * 3 + 1] = height;
        positions[i * 3 + 2] = Math.sin(angle) * radius;
        velocities[i] = 0.2 + Math.random() * 0.3;
        sizes[i] = 0.1 + Math.random() * 0.15;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.PointsMaterial({
        color: 0x888888,
        size: 0.12,
        transparent: true,
        opacity: 0.5,
        sizeAttenuation: true,
        depthWrite: false,
        blending: THREE.NormalBlending
    });

    const particles = new THREE.Points(geometry, material);
    particles.userData.tag = 'quadrantWeather';
    particles.userData.weatherType = 'cosmicDust';
    particles.userData.velocities = velocities;
    quadrant.add(particles);

    return particles;
}

function createStarfallParticles(quadrant, config) {
    const count = 320;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count);
    const angles = new Float32Array(count);
    const baseHeight = innerRing.position.y + 0.4;
    const upperHeight = innerRing.position.y + 6.5;
    const minRadius = STAR_PLACEMENT_SURFACES[0].inner;
    const maxRadius = STAR_PLACEMENT_SURFACES[STAR_PLACEMENT_SURFACES.length - 1].outer;

    for (let i = 0; i < count; i++) {
        const angle = THREE.MathUtils.lerp(config.startAngle, config.endAngle, Math.random());
        const radius = THREE.MathUtils.lerp(minRadius, maxRadius, Math.random());
        const height = baseHeight + Math.random() * (upperHeight - baseHeight);
        const idx = i * 3;
        positions[idx] = Math.cos(angle) * radius;
        positions[idx + 1] = height;
        positions[idx + 2] = Math.sin(angle) * radius;
        velocities[i] = 0.4 + Math.random() * 0.9;
        angles[i] = angle;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
        color: 0xe8f6ff,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        size: 0.05,
        sizeAttenuation: true
    });
    const points = new THREE.Points(geometry, material);
    points.userData = {
        tag: 'starfall',
        velocities,
        angles,
        lowerBound: innerRing.position.y + 0.15,
        upperBound: upperHeight,
        minRadius,
        maxRadius,
        startAngle: config.startAngle,
        endAngle: config.endAngle
    };
    quadrant.add(points);
    starfallSystems.push(points);
}

function updateStarfallSystems(dt) {
    if (starfallSystems.length === 0) return;
    starfallSystems.forEach((system) => {
        const positions = system.geometry.attributes.position.array;
        const velocities = system.userData.velocities;
        const angles = system.userData.angles;
        const lowerBound = system.userData.lowerBound;
        const upperBound = system.userData.upperBound;
        const minRadius = system.userData.minRadius;
        const maxRadius = system.userData.maxRadius;
        const startAngle = system.userData.startAngle;
        const endAngle = system.userData.endAngle;
        for (let i = 0; i < velocities.length; i++) {
            const idx = i * 3;
            positions[idx + 1] -= velocities[i] * dt;
            if (positions[idx + 1] < lowerBound) {
                positions[idx + 1] = upperBound;
                angles[i] = THREE.MathUtils.lerp(startAngle, endAngle, Math.random());
                const offsetRadius = THREE.MathUtils.lerp(minRadius, maxRadius, Math.random());
                positions[idx] = Math.cos(angles[i]) * offsetRadius;
                positions[idx + 2] = Math.sin(angles[i]) * offsetRadius;
            }
        }
        system.geometry.attributes.position.needsUpdate = true;
    });
}

// ========== DYNAMIC LIGHTING ==========
// Ambient light for soft base illumination
const ambientLight = new THREE.AmbientLight(0x404040);
scene.add(ambientLight);

// Directional light for main illumination with shadows
const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
directionalLight.position.set(10, 20, 10);
directionalLight.castShadow = true;
// Configure shadow properties for better quality
directionalLight.shadow.mapSize.width = IS_LOW_POWER_DEVICE ? 1024 : 2048;
directionalLight.shadow.mapSize.height = IS_LOW_POWER_DEVICE ? 1024 : 2048;
directionalLight.shadow.camera.near = 0.5;
directionalLight.shadow.camera.far = 50;
directionalLight.shadow.camera.left = -20;
directionalLight.shadow.camera.right = 20;
directionalLight.shadow.camera.top = 20;
directionalLight.shadow.camera.bottom = -20;
directionalLight.shadow.bias = IS_LOW_POWER_DEVICE ? -0.0004 : -0.0001;
scene.add(directionalLight);

// Optional magical overhead point light
const pointLight = new THREE.PointLight(0x9c7eff, IS_LOW_POWER_DEVICE ? 0.4 : 0.8);
pointLight.position.set(0, 10, 0);
scene.add(pointLight);

// ========== ZONE-SPECIFIC LIGHTING ==========
// Zone-specific lighting is handled in zoneLights above
// Keep a base ambient light for general visibility (now using the dynamic ambient light above)

// ========== SUMMER SECTION ==========
function createSummerSection() {
    if (!ENABLE_SEASON_PLACEHOLDERS) {
        const group = seasonGroups.summer;
        group.clear();
        group.userData = {};
        return;
    }
    const group = seasonGroups.summer;

    // Grass patches
    for (let i = 0; i < 30; i++) {
        const angle = SEASON_ANGLES[0] + (Math.random() - 0.5) * 0.5;
        const radius = GLOBE_RADIUS + 0.1;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;

        const grassGeometry = new THREE.ConeGeometry(0.1, 0.3, 6);
        const grassMaterial = new THREE.MeshStandardMaterial({ color: 0x4a8a2e });
        const grass = new THREE.Mesh(grassGeometry, grassMaterial);
        grass.position.set(x, 0.1, z);
        grass.rotation.y = Math.random() * Math.PI * 2;
        group.add(grass);
    }

    // Fireflies (particles)
    const fireflyGeometry = new THREE.BufferGeometry();
    const fireflyCount = Math.max(20, Math.round(50 * PARTICLE_COUNT_SCALE));
    const fireflyPositions = new Float32Array(fireflyCount * 3);
    const fireflyVelocities = [];

    for (let i = 0; i < fireflyCount; i++) {
        const angle = SEASON_ANGLES[0] + (Math.random() - 0.5) * 0.5;
        const radius = GLOBE_RADIUS + 0.5 + Math.random() * 2;
        fireflyPositions[i * 3] = Math.cos(angle) * radius;
        fireflyPositions[i * 3 + 1] = Math.random() * 3;
        fireflyPositions[i * 3 + 2] = Math.sin(angle) * radius;
        fireflyVelocities.push({
            phase: Math.random() * Math.PI * 2,
            speed: 0.5 + Math.random() * 0.5
        });
    }

    fireflyGeometry.setAttribute('position', new THREE.BufferAttribute(fireflyPositions, 3));
    const fireflyMaterial = new THREE.PointsMaterial({
        color: 0xffaa00,
        size: 0.1,
        transparent: true,
        opacity: 0.8
    });
    const fireflies = new THREE.Points(fireflyGeometry, fireflyMaterial);
    group.add(fireflies);
    group.userData.fireflies = { points: fireflies, velocities: fireflyVelocities };
}

// ========== RAIN SECTION ==========
function createRainSection() {
    if (!ENABLE_SEASON_PLACEHOLDERS) {
        const group = seasonGroups.rain;
        group.clear();
        group.userData = {};
        return;
    }
    const group = seasonGroups.rain;

    // Dark clouds
    for (let i = 0; i < 8; i++) {
        const cloudGeometry = new THREE.SphereGeometry(0.8 + Math.random() * 0.4, 16, 16);
        const cloudMaterial = new THREE.MeshStandardMaterial({
            color: 0x3a3a4a,
            transparent: true,
            opacity: 0.7
        });
        const cloud = new THREE.Mesh(cloudGeometry, cloudMaterial);
        const angle = SEASON_ANGLES[1] + (Math.random() - 0.5) * 0.5;
        const radius = GLOBE_RADIUS + 2 + Math.random() * 1;
        cloud.position.set(
            Math.cos(angle) * radius,
            3 + Math.random() * 2,
            Math.sin(angle) * radius
        );
        group.add(cloud);
    }

    // Rain particles
    const rainGeometry = new THREE.BufferGeometry();
    const rainCount = Math.max(120, Math.round(500 * PARTICLE_COUNT_SCALE));
    const rainPositions = new Float32Array(rainCount * 3);
    const rainVelocities = [];

    for (let i = 0; i < rainCount; i++) {
        const angle = SEASON_ANGLES[1] + (Math.random() - 0.5) * 0.5;
        const radius = GLOBE_RADIUS + 0.5 + Math.random() * 3;
        rainPositions[i * 3] = Math.cos(angle) * radius;
        rainPositions[i * 3 + 1] = 5 + Math.random() * 5;
        rainPositions[i * 3 + 2] = Math.sin(angle) * radius;
        rainVelocities.push(5 + Math.random() * 5);
    }

    rainGeometry.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
    const rainMaterial = new THREE.LineBasicMaterial({
        color: 0x4a8aff,
        transparent: true,
        opacity: 0.6
    });
    const rain = new THREE.LineSegments(rainGeometry, rainMaterial);
    group.add(rain);
    group.userData.rain = { geometry: rainGeometry, velocities: rainVelocities };

    // Lightning flash
    const lightning = new THREE.DirectionalLight(0xffffff, 0);
    lightning.position.set(0, 10, 0);
    group.add(lightning);
    group.userData.lightning = lightning;
}

// ========== AUTUMN SECTION ==========
function createAutumnSection() {
    if (!ENABLE_SEASON_PLACEHOLDERS) {
        const group = seasonGroups.autumn;
        group.clear();
        group.userData = {};
        return;
    }
    const group = seasonGroups.autumn;

    // Orange/brown trees
    for (let i = 0; i < 20; i++) {
        const angle = SEASON_ANGLES[2] + (Math.random() - 0.5) * 0.5;
        const radius = GLOBE_RADIUS + 0.1;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;

        // Trunk
        const trunkGeometry = new THREE.CylinderGeometry(0.1, 0.12, 1, 8);
        const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x5a3a2a });
        const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
        trunk.position.set(x, 0.5, z);
        group.add(trunk);

        // Foliage (orange/brown)
        const foliageGeometry = new THREE.ConeGeometry(0.6, 1.2, 8);
        const foliageMaterial = new THREE.MeshStandardMaterial({ color: 0xff6b35 });
        const foliage = new THREE.Mesh(foliageGeometry, foliageMaterial);
        foliage.position.set(x, 1.3, z);
        group.add(foliage);
    }

    // Fallen leaves on ground
    for (let i = 0; i < 100; i++) {
        const angle = SEASON_ANGLES[2] + (Math.random() - 0.5) * 0.5;
        const radius = GLOBE_RADIUS + 0.05 + Math.random() * 0.3;
        const leafGeometry = new THREE.PlaneGeometry(0.15, 0.15);
        const leafMaterial = new THREE.MeshStandardMaterial({
            color: new THREE.Color().setHSL(0.08 + Math.random() * 0.1, 0.8, 0.5),
            side: THREE.DoubleSide
        });
        const leaf = new THREE.Mesh(leafGeometry, leafMaterial);
        leaf.position.set(
            Math.cos(angle) * radius,
            0.05,
            Math.sin(angle) * radius
        );
        leaf.rotation.x = -Math.PI / 2;
        leaf.rotation.z = Math.random() * Math.PI * 2;
        group.add(leaf);
    }

    // Falling leaves (particles)
    const leafGeometry = new THREE.BufferGeometry();
    const leafCount = Math.max(80, Math.round(200 * PARTICLE_COUNT_SCALE));
    const leafPositions = new Float32Array(leafCount * 3);
    const leafVelocities = [];

    for (let i = 0; i < leafCount; i++) {
        const angle = SEASON_ANGLES[2] + (Math.random() - 0.5) * 0.5;
        const radius = GLOBE_RADIUS + 0.5 + Math.random() * 2;
        leafPositions[i * 3] = Math.cos(angle) * radius;
        leafPositions[i * 3 + 1] = Math.random() * 5;
        leafPositions[i * 3 + 2] = Math.sin(angle) * radius;
        leafVelocities.push({
            fallSpeed: 0.5 + Math.random() * 1,
            drift: (Math.random() - 0.5) * 0.1,
            phase: Math.random() * Math.PI * 2
        });
    }

    leafGeometry.setAttribute('position', new THREE.BufferAttribute(leafPositions, 3));
    const leafMaterial = new THREE.PointsMaterial({
        color: 0xff6b35,
        size: 0.2,
        transparent: true,
        opacity: 0.7
    });
    const leaves = new THREE.Points(leafGeometry, leafMaterial);
    group.add(leaves);
    group.userData.leaves = { points: leaves, velocities: leafVelocities };
}

// ========== WINTER SECTION ==========
function createWinterSection() {
    if (!ENABLE_SEASON_PLACEHOLDERS) {
        const group = seasonGroups.winter;
        group.clear();
        group.userData = {};
        return;
    }
    const group = seasonGroups.winter;

    // Snow-covered surfaces (white material on globe section)
    // This is handled by fog and particle overlay

    // Pine trees with snow
    for (let i = 0; i < 15; i++) {
        const angle = SEASON_ANGLES[3] + (Math.random() - 0.5) * 0.5;
        const radius = GLOBE_RADIUS + 0.1;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;

        // Trunk
        const trunkGeometry = new THREE.CylinderGeometry(0.12, 0.14, 1.5, 8);
        const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x4a3a2a });
        const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
        trunk.position.set(x, 0.75, z);
        group.add(trunk);

        // Snow-covered branches (layered cones)
        for (let j = 0; j < 3; j++) {
            const branchGeometry = new THREE.ConeGeometry(0.5 - j * 0.15, 0.8, 8);
            const branchMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
            const branch = new THREE.Mesh(branchGeometry, branchMaterial);
            branch.position.set(x, 1.2 + j * 0.6, z);
            group.add(branch);
        }
    }

    // Snow particles (2000+)
    const snowGeometry = new THREE.BufferGeometry();
    const snowCount = Math.max(300, Math.round(2000 * PARTICLE_COUNT_SCALE));
    const snowPositions = new Float32Array(snowCount * 3);
    const snowVelocities = [];

    for (let i = 0; i < snowCount; i++) {
        const angle = SEASON_ANGLES[3] + (Math.random() - 0.5) * 0.5;
        const radius = GLOBE_RADIUS + 0.5 + Math.random() * 4;
        snowPositions[i * 3] = Math.cos(angle) * radius;
        snowPositions[i * 3 + 1] = Math.random() * 8;
        snowPositions[i * 3 + 2] = Math.sin(angle) * radius;
        snowVelocities.push({
            fallSpeed: 0.3 + Math.random() * 0.5,
            drift: (Math.random() - 0.5) * 0.2,
            phase: Math.random() * Math.PI * 2
        });
    }

    snowGeometry.setAttribute('position', new THREE.BufferAttribute(snowPositions, 3));
    const snowMaterial = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.15,
        transparent: true,
        opacity: 0.9
    });
    const snow = new THREE.Points(snowGeometry, snowMaterial);
    group.add(snow);
    group.userData.snow = { points: snow, velocities: snowVelocities };
}

// Initialize all seasons
createSummerSection();
createRainSection();
createAutumnSection();
createWinterSection();

// ========== 360° PANORAMIC SKYBOX ==========
const panoramaTexture = textureLoader.load(
    '/assets/magical_realm_panorama.png',
    (texture) => {
        // Configure panorama texture
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.mapping = THREE.EquirectangularReflectionMapping;

        // Set as scene background for visual sky
        scene.background = texture;

        // Generate environment map for proper lighting and reflections
        // For now, use texture directly as environment (works well for most cases)
        // PMREMGenerator would provide better quality but requires additional setup
        scene.environment = texture;

        console.log('360° Panoramic skybox loaded successfully');
    },
    undefined,
    (error) => {
        console.warn('Failed to load panoramic skybox:', error);
        // Keep fallback background
        scene.background = new THREE.Color(0x0a0a1a);
    }
);

// ========== PARALLAX BACKGROUND ==========
const parallaxGeometry = new THREE.SphereGeometry(50, 32, 32);
// Create a simple nebula-like texture programmatically
const canvas2d = document.createElement('canvas');
canvas2d.width = 512;
canvas2d.height = 512;
const ctx = canvas2d.getContext('2d');
const gradient = ctx.createRadialGradient(256, 256, 0, 256, 256, 256);
gradient.addColorStop(0, 'rgba(100, 50, 200, 0.8)');
gradient.addColorStop(0.5, 'rgba(50, 100, 200, 0.4)');
gradient.addColorStop(1, 'rgba(20, 20, 50, 0.1)');
ctx.fillStyle = gradient;
ctx.fillRect(0, 0, 512, 512);

const parallaxTexture = new THREE.CanvasTexture(canvas2d);
parallaxTexture.colorSpace = THREE.SRGBColorSpace;
const parallaxMaterial = new THREE.MeshBasicMaterial({
    map: parallaxTexture,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0.8,
    depthWrite: false
});
const parallaxSphere = new THREE.Mesh(parallaxGeometry, parallaxMaterial);
scene.add(parallaxSphere);

// Skybox animation helpers
let skyboxTime = 0;
function updateSkyboxTexture(dt, dayFactor = 0.5) {
    skyboxTime += dt * 0.02;
    const ctx = canvas2d.getContext('2d');
    const hueShift = dayFactor * 60;
    const hue = ((skyboxTime * 120) + hueShift) % 360;

    const grad = ctx.createLinearGradient(0, 0, 0, canvas2d.height);
    grad.addColorStop(0, `hsl(${(hue + 30) % 360}, 60%, 30%)`);
    grad.addColorStop(0.5, `hsl(${(hue + 80) % 360}, 55%, 22%)`);
    grad.addColorStop(1, `hsl(${(hue + 140) % 360}, 50%, 15%)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas2d.width, canvas2d.height);

    // moving clouds
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    const cloudCount = 15;
    for (let i = 0; i < cloudCount; i++) {
        const x = ((i * 73.13) + skyboxTime * 200) % canvas2d.width;
        const y = ((i * 53.87) + skyboxTime * 120) % canvas2d.height;
        const w = 80 + (i % 4) * 30;
        const h = 20 + (i % 3) * 15;
        ctx.beginPath();
        ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
    parallaxTexture.needsUpdate = true;
}
updateSkyboxTexture(0, currentDayNightFactor);

// ========== GLOBAL FOG & LIGHTING ==========
const globalFogColor = new THREE.Color('#4a1b6d');
scene.fog = new THREE.FogExp2(globalFogColor, 0.02);

const dayNightLight = new THREE.DirectionalLight(0xa080ff, 0.8);
dayNightLight.position.set(20, 30, 10);
dayNightLight.castShadow = true;
dayNightLight.shadow.mapSize.set(2048, 2048);
dayNightLight.shadow.radius = 6;
scene.add(dayNightLight);

const dayNightAmbient = new THREE.HemisphereLight(0x7f5aff, 0x12021b, 0.4);
scene.add(dayNightAmbient);

renderer.setClearColor('#05000c', 1);
let bloomComposer = null;
let bloomPass = null;
if (ENABLE_BLOOM) {
    renderer.setClearColor('#05000c', 1);
    bloomComposer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    bloomPass.threshold = 0.85;
    bloomPass.strength = 0.5;
    bloomPass.radius = 0.4;
    bloomComposer.renderToScreen = true;
    bloomComposer.addPass(renderPass);
    bloomComposer.addPass(bloomPass);
}

function updateGlobalFog(dt) {
    const cameraHeightFactor = THREE.MathUtils.clamp((camera.position.y + 10) / 80, 0, 1);
    const distanceFactor = THREE.MathUtils.clamp(camera.position.length() / 60, 0, 1);
    const density = 0.012 + 0.025 * (cameraHeightFactor * 0.6 + distanceFactor * 0.4);
    scene.fog.density = density;
}

function updateDayNightLight(time) {
    const lightAngle = time * 0.05;
    dayNightLight.position.set(
        Math.cos(lightAngle) * 40,
        25 + Math.sin(lightAngle * 0.5) * 10,
        Math.sin(lightAngle) * 40
    );
    dayNightLight.lookAt(0, 0, 0);
    const t = (Math.sin(lightAngle * 0.5) + 1) / 2;
    currentDayNightFactor = t;
    const dayColor = new THREE.Color(0xa060ff);
    const nightColor = new THREE.Color(0x2b3dff);
    dayNightLight.color.lerpColors(dayColor, nightColor, t);
    dayNightLight.intensity = 0.5 + 0.3 * (1 - t);
    dayNightLight.shadow.radius = 4 + t * 6;
    dayNightAmbient.intensity = 0.3 + 0.2 * t;
}

// ========== NEON CRACKS EMISSIVE ==========
function createNeonCracksTexture() {
    const crackCanvas = document.createElement('canvas');
    crackCanvas.width = crackCanvas.height = 512;
    const ctx = crackCanvas.getContext('2d');
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, 512, 512);
    ctx.lineWidth = 2;
    for (let i = 0; i < 80; i++) {
        ctx.strokeStyle = `hsla(${280 + Math.random() * 20}, 100%, ${60 + Math.random() * 15}%, ${0.5 + Math.random() * 0.4})`;
        ctx.beginPath();
        ctx.moveTo(Math.random() * 512, Math.random() * 512);
        for (let j = 0; j < 4; j++) {
            ctx.lineTo(Math.random() * 512, Math.random() * 512);
        }
        ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(crackCanvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 1);
    return tex;
}

if (DEV_DEBUG_VISUALS) {
    const neonCracksTexture = createNeonCracksTexture();
    globeMaterial.emissive = new THREE.Color(0xaf6bff);
    globeMaterial.emissiveIntensity = 0.45;
    globeMaterial.emissiveMap = neonCracksTexture;
} else {
    globeMaterial.emissiveIntensity = 0.1;
    globeMaterial.emissive.set(0x000000);
    globeMaterial.emissiveMap = null;
}

// ========== PERFORMANCE / LOD ==========
function updatePerformanceControls() {
    if (!ENABLE_BLOOM) return;
    const distance = camera.position.length();
    const qualityFactor = THREE.MathUtils.clamp(1 - (distance - 30) / 40, 0.4, 1);
    bloomPass.strength = 0.5 + 0.6 * qualityFactor;
    bloomPass.radius = 0.6 + 0.4 * qualityFactor;
    dayNightLight.castShadow = qualityFactor > 0.5;
}

function angularDifference(a, b) {
    return Math.abs(THREE.MathUtils.euclideanModulo(a - b + Math.PI, Math.PI * 2) - Math.PI);
}

function updateAssetVisibility() {
    const focusAngle = THREE.MathUtils.euclideanModulo(characterAngle, Math.PI * 2);
    worldProps.forEach(({ object, angle }) => {
        const radialDistance = Math.hypot(object.position.x, object.position.z);
        object.visible =
            angularDifference(angle, focusAngle) <= Math.PI * 0.95 &&
            radialDistance <= MAX_PROP_VISIBILITY_DISTANCE;
    });

    floatingElements.forEach((mesh) => {
        const pos = mesh.position;
        const assetAngle = Math.atan2(pos.z, pos.x);
        const radialDistance = Math.hypot(pos.x, pos.z);
        const visible =
            angularDifference(assetAngle, focusAngle) <= FLOATING_ASSET_MAX_ANGLE &&
            radialDistance >= PROP_MIN_VISIBILITY_DISTANCE &&
            radialDistance <= FAR_VISIBILITY_DISTANCE;
        mesh.visible = visible;
    });

    ambientAIs.forEach((mesh) => {
        const pos = mesh.position;
        const assetAngle = Math.atan2(pos.z, pos.x);
        const radialDistance = Math.hypot(pos.x, pos.z);
        const visible =
            angularDifference(assetAngle, focusAngle) <= FLOATING_ASSET_MAX_ANGLE &&
            radialDistance >= PROP_MIN_VISIBILITY_DISTANCE &&
            radialDistance <= FAR_VISIBILITY_DISTANCE;
        mesh.visible = visible;
    });

    dancingJellyTrees.forEach((tree) => {
        const pos = tree.mesh.position;
        const assetAngle = Math.atan2(pos.z, pos.x);
        const radialDistance = Math.hypot(pos.x, pos.z);
        const visible =
            angularDifference(assetAngle, focusAngle) <= FLOATING_ASSET_MAX_ANGLE &&
            radialDistance >= PROP_MIN_VISIBILITY_DISTANCE &&
            radialDistance <= MAX_PROP_VISIBILITY_DISTANCE;
        tree.mesh.visible = visible;
    });

    if (globalAtmosphereParticles) {
        const cameraDistance = Math.hypot(camera.position.x, camera.position.z);
        globalAtmosphereParticles.visible = cameraDistance <= EXTENDED_VISIBILITY_DISTANCE + 8;
    }

    const evaluateVisibility = (mesh) => {
        const pos = mesh.position;
        const assetAngle = Math.atan2(pos.z, pos.x);
        const radialDistance = Math.hypot(pos.x, pos.z);
        return angularDifference(assetAngle, focusAngle) <= FLOATING_ASSET_MAX_ANGLE &&
            radialDistance >= PROP_MIN_VISIBILITY_DISTANCE &&
            radialDistance <= MAX_PROP_VISIBILITY_DISTANCE;
    };

    floatingCrystalRocks.forEach((artifact) => {
        artifact.mesh.visible = evaluateVisibility(artifact.mesh);
    });

    floatingMagicClusters.forEach((artifact) => {
        artifact.mesh.visible = evaluateVisibility(artifact.mesh);
    });

    if (ENABLE_AURORA_BANDS) {
        auroraBands.forEach((band) => {
            band.mesh.visible = angularDifference(band.centerAngle, focusAngle) <= FLOATING_ASSET_MAX_ANGLE;
        });
    }
}

function animateLoreMarkers(dt) {
    if (loreMarkers.length === 0) return;
    if (isMovementActive) return;
    loreMarkers.forEach((marker, index) => {
        const t = totalTime * marker.bobSpeed + index;
        marker.group.position.y = marker.baseHeight + Math.sin(t) * marker.bobAmplitude;
        marker.core.rotation.y += dt * 0.6;
        marker.halo.material.opacity = 0.35 + Math.sin(t * 1.5) * 0.2;
        marker.icon.material.opacity = 0.9 + Math.sin(t * 2.1) * 0.1;
        const targetScale = marker === activeLoreMarker
            ? 1.35
            : marker === hoveredLoreMarker
                ? 1.18
                : 1;
        marker.scaleState = THREE.MathUtils.lerp(marker.scaleState, targetScale, 0.15);
        marker.group.scale.setScalar(marker.scaleState);
    });
}

// ========== ANIMATION LOOP ==========
let totalTime = 0;
const clock = new THREE.Clock();
let sparseParticleFrame = 0;

function updateFloatingArtifactCollection(collection, dt) {
    collection.forEach((artifact) => {
        if (!artifact.mesh.visible) {
            return;
        }
        const angle = totalTime * artifact.angularSpeed + artifact.offset;
        artifact.mesh.position.set(
            Math.cos(angle) * artifact.radius,
            artifact.baseHeight + Math.sin(totalTime * artifact.bobSpeed + artifact.offset) * artifact.bobAmount,
            Math.sin(angle) * artifact.radius
        );
        artifact.mesh.rotation.y += artifact.spinSpeed * dt;
    });
}

function animate() {
    requestAnimationFrame(animate);
    const currentStamp = performance.now();
    const dt = clock.getDelta();
    totalTime += dt;
    const instantaneousFPS = 1 / Math.max(dt, 0.0001);
    fpsAverage = THREE.MathUtils.lerp(fpsAverage, instantaneousFPS, 0.1);
    fpsOverlay.textContent = `${fpsAverage.toFixed(0)} fps • ${adaptiveQuality}`;
    adaptiveTimer += dt;
    if (!FORCE_LOW_QUALITY) {
        if (adaptiveQuality === 'low' && fpsAverage > 55 && adaptiveTimer > 4) {
            applyQualitySettings('high');
        } else if (adaptiveQuality === 'high' && fpsAverage < 42) {
            applyQualitySettings('low');
        }
    } else if (adaptiveQuality !== 'low') {
        applyQualitySettings('low');
    }
    sparseParticleFrame = (sparseParticleFrame + 1) % PARTICLE_UPDATE_INTERVAL;
    const shouldUpdateSparseParticles = sparseParticleFrame === 0;
    forestGlowUniforms.time.value = totalTime;
    auroraUniforms.time.value = totalTime;

    // Rotate globe continuously
    globe.rotation.y += globeRotationSpeed * dt;

    // Update character position
    updateCharacter(dt);

    // Update camera to follow character (3rd-person view)
    updateCamera(dt);

    // Update fireflies (summer)
    if (ALLOW_SEASON_FX) {
        const fireflies = seasonGroups.summer.userData.fireflies;
        if (fireflies) {
            const positions = fireflies.points.geometry.attributes.position.array;
            fireflies.velocities.forEach((vel, i) => {
                positions[i * 3 + 1] += Math.sin(totalTime * vel.speed + vel.phase) * 0.01;
                if (positions[i * 3 + 1] > 5) positions[i * 3 + 1] = 0;
            });
            fireflies.points.geometry.attributes.position.needsUpdate = true;
        }

        const rain = seasonGroups.rain.userData.rain;
        if (shouldUpdateSparseParticles && rain) {
            const positions = rain.geometry.attributes.position.array;
            rain.velocities.forEach((vel, i) => {
                positions[i * 3 + 1] -= vel * dt;
                if (positions[i * 3 + 1] < -2) {
                    positions[i * 3 + 1] = 5 + Math.random() * 5;
                }
            });
            rain.geometry.attributes.position.needsUpdate = true;
        }

        const lightning = seasonGroups.rain.userData.lightning;
        if (lightning) {
            if (Math.random() < 0.01) {
                lightning.intensity = 2;
            } else {
                lightning.intensity = Math.max(0, lightning.intensity - dt * 5);
            }
        }

        const leaves = seasonGroups.autumn.userData.leaves;
        if (shouldUpdateSparseParticles && leaves) {
            const positions = leaves.points.geometry.attributes.position.array;
            leaves.velocities.forEach((vel, i) => {
                positions[i * 3 + 1] -= vel.fallSpeed * dt;
                positions[i * 3] += Math.sin(totalTime + vel.phase) * vel.drift * dt;
                if (positions[i * 3 + 1] < -2) {
                    positions[i * 3 + 1] = 5 + Math.random() * 5;
                }
            });
            leaves.points.geometry.attributes.position.needsUpdate = true;
        }

        const snow = seasonGroups.winter.userData.snow;
        if (shouldUpdateSparseParticles && snow) {
            const positions = snow.points.geometry.attributes.position.array;
            snow.velocities.forEach((vel, i) => {
                positions[i * 3 + 1] -= vel.fallSpeed * dt;
                positions[i * 3] += Math.sin(totalTime + vel.phase) * vel.drift * dt;
                if (positions[i * 3 + 1] < -2) {
                    positions[i * 3 + 1] = 8 + Math.random() * 2;
                }
            });
            snow.points.geometry.attributes.position.needsUpdate = true;
        }
    }

    // Parallax background rotation + animated skybox
    parallaxSphere.rotation.y += dt * 0.01;
    updateSkyboxTexture(dt);

    // Rotate panoramic skybox for subtle movement + recolor
    if (scene.background && scene.background.isTexture && scene.background.mapping === THREE.EquirectangularReflectionMapping) {
        scene.background.rotation += 0.001 * dt;
    }
    updateSkyboxTexture(dt, currentDayNightFactor);

    // Update effect ring particles
    if (shouldUpdateSparseParticles) {
        [innerEffectParticles, outerEffectParticles].forEach((system) => {
            if (!system) return;
            const positions = system.geometry.attributes.position.array;
            const speeds = system.userData.speeds;
            for (let i = 0; i < speeds.length; i++) {
                const angle = totalTime * speeds[i] + i;
                positions[i * 3] = Math.cos(angle) * system.userData.baseRadius;
                positions[i * 3 + 2] = Math.sin(angle) * system.userData.baseRadius;
                positions[i * 3 + 1] = system.userData.height + Math.sin(angle) * system.userData.verticalRange * 0.5;
            }
            system.geometry.attributes.position.needsUpdate = true;
        });
    }

    // Update weather zone particles
    if (shouldUpdateSparseParticles) {
        weatherSystems.forEach((system) => {
            const positions = system.particles.geometry.attributes.position.array;
            const speeds = system.particles.userData.speeds;
            const baseRadius = system.particles.userData.baseRadius;
            for (let i = 0; i < speeds.length; i++) {
                const angle = totalTime * speeds[i] + i;
                positions[i * 3] = Math.cos(angle) * baseRadius;
                positions[i * 3 + 2] = Math.sin(angle) * baseRadius;
            }
            system.particles.geometry.attributes.position.needsUpdate = true;
        });
    }

    // Global atmosphere drifting
    if (shouldUpdateSparseParticles && globalAtmosphereParticles && globalAtmosphereParticles.visible) {
        const positions = globalAtmosphereParticles.geometry.attributes.position.array;
        const speeds = globalAtmosphereParticles.userData.speeds;
        for (let i = 0; i < speeds.length; i++) {
            const angle = totalTime * speeds[i] + i;
            const radius = WALKWAY_RADIUS + 4 + (i % 5) * 2;
            positions[i * 3] = Math.cos(angle) * radius;
            positions[i * 3 + 2] = Math.sin(angle) * radius;
            positions[i * 3 + 1] += Math.sin(angle * 0.2) * 0.01;
        }
        globalAtmosphereParticles.geometry.attributes.position.needsUpdate = true;
    }

    if (shouldUpdateSparseParticles) {
        if (globalPixelParticles) {
            const positions = globalPixelParticles.geometry.attributes.position.array;
            const basePositions = globalPixelParticles.userData.basePositions;
            const amplitudes = globalPixelParticles.userData.amplitudes;
            const speeds = globalPixelParticles.userData.speeds;
            for (let i = 0; i < speeds.length; i++) {
                const idx = i * 3;
                positions[idx + 1] = basePositions[idx + 1] + Math.sin(totalTime * speeds[i] + i) * amplitudes[i];
            }
            globalPixelParticles.geometry.attributes.position.needsUpdate = true;
        }
        if (equatorialPixelRing) {
            const positions = equatorialPixelRing.geometry.attributes.position.array;
            const baseAngles = equatorialPixelRing.userData.baseAngles;
            const radialOffsets = equatorialPixelRing.userData.radialOffsets;
            const heights = equatorialPixelRing.userData.heights;
            const speeds = equatorialPixelRing.userData.speeds;
            for (let i = 0; i < speeds.length; i++) {
                const idx = i * 3;
                const angle = baseAngles[i] + totalTime * speeds[i] * 0.08;
                const radialPulse = radialOffsets[i] + Math.sin(totalTime * speeds[i] + i) * 0.4;
                positions[idx] = Math.cos(angle) * radialPulse;
                positions[idx + 2] = Math.sin(angle) * radialPulse;
                positions[idx + 1] = heights[i] + Math.sin(totalTime * speeds[i] * 0.5 + i) * 0.25;
            }
            equatorialPixelRing.geometry.attributes.position.needsUpdate = true;
        }
    }

    // Update quadrant particles
    if (shouldUpdateSparseParticles) {
        Object.values(quadrantGroups).forEach((quadrant) => {
            quadrant.children.forEach((child) => {
                if (child.userData.tag === 'quadrantParticles') {
                    const positions = child.geometry.attributes.position.array;

                    // Star particles (Star Wars quadrant)
                    if (child.userData.speeds && child.userData.phases) {
                        for (let i = 0; i < child.userData.speeds.length; i++) {
                            const idx = i * 3;
                            const phase = child.userData.phases[i];
                            const speed = child.userData.speeds[i];
                            positions[idx + 1] += Math.sin(totalTime * speed + phase) * 0.015;
                        }
                    }

                    // Pixel particles (Night City quadrant)
                    if (child.userData.directions) {
                        for (let i = 0; i < child.userData.directions.length; i++) {
                            const idx = i * 3;
                            const direction = child.userData.directions[i];
                            const speed = child.userData.speeds[i];
                            positions[idx + 1] += direction * speed * dt * 0.3;

                            // Reset if out of bounds
                            if (positions[idx + 1] > 8.5) {
                                positions[idx + 1] = -3;
                            } else if (positions[idx + 1] < -3.5) {
                                positions[idx + 1] = 8;
                            }
                        }
                    }

                    // Gothic particles (Gothic quadrant)
                    if (child.userData.swirls) {
                        for (let i = 0; i < child.userData.swirls.length; i++) {
                            const idx = i * 3;
                            const swirl = child.userData.swirls[i];
                            const speed = child.userData.speeds[i];

                            // Swirling motion
                            const angle = totalTime * speed + swirl;
                            const radius = Math.sqrt(positions[idx] * positions[idx] + positions[idx + 2] * positions[idx + 2]);
                            positions[idx] = Math.cos(angle) * radius;
                            positions[idx + 2] = Math.sin(angle) * radius;
                            positions[idx + 1] += Math.sin(totalTime * speed * 2 + swirl) * 0.01;
                        }
                    }

                    child.geometry.attributes.position.needsUpdate = true;
                }
            });
        });
    }

    // Update quadrant weather systems
    if (shouldUpdateSparseParticles) {
        Object.values(quadrantGroups).forEach((quadrant) => {
            quadrant.children.forEach((child) => {
                if (child.userData.tag === 'quadrantWeather') {
                    const positions = child.geometry.attributes.position.array;
                    const velocities = child.userData.velocities;
                    const weatherType = child.userData.weatherType;

                    if (weatherType === 'gothic') {
                        // Gothic fog - slow downward drift with swirling
                        for (let i = 0; i < velocities.length; i++) {
                            const idx = i * 3;
                            positions[idx + 1] -= velocities[i] * dt * 0.2;

                            // Swirl effect
                            const angle = totalTime * 0.1 + i;
                            const radius = Math.sqrt(positions[idx] * positions[idx] + positions[idx + 2] * positions[idx + 2]);
                            positions[idx] = Math.cos(angle) * radius;
                            positions[idx + 2] = Math.sin(angle) * radius;

                            // Reset if too low
                            if (positions[idx + 1] < -3) {
                                positions[idx + 1] = 7;
                            }
                        }
                    } else if (weatherType === 'neonRain') {
                        // Neon rain - fast downward movement
                        for (let i = 0; i < velocities.length; i++) {
                            const idx = i * 3;
                            positions[idx + 1] -= velocities[i] * dt;

                            // Reset if too low
                            if (positions[idx + 1] < -3) {
                                positions[idx + 1] = 9;
                            }
                        }
                    } else if (weatherType === 'cosmicDust') {
                        // Cosmic dust - slow horizontal drift
                        for (let i = 0; i < velocities.length; i++) {
                            const idx = i * 3;
                            const angle = totalTime * velocities[i] * 0.05 + i;
                            const radius = Math.sqrt(positions[idx] * positions[idx] + positions[idx + 2] * positions[idx + 2]);
                            positions[idx] = Math.cos(angle) * radius;
                            positions[idx + 2] = Math.sin(angle) * radius;
                            positions[idx + 1] += Math.sin(totalTime * velocities[i] + i) * 0.008;
                        }
                    }

                    child.geometry.attributes.position.needsUpdate = true;
                }
            });
        });
    }
    updateStarfallSystems(dt);

    // Floating sky elements
    floatingElements.forEach((mesh) => {
        if (IS_LOW_POWER_DEVICE && !mesh.visible) {
            return;
        }
        const data = mesh.userData;
        const angle = totalTime * data.speed + data.offset;
        mesh.position.set(
            Math.cos(angle) * data.radius,
            data.height + Math.sin(angle * 0.5) * 0.5,
            Math.sin(angle) * data.radius
        );
        mesh.rotation.y += dt * 0.3;
        mesh.rotation.x += dt * 0.15;
    });

    ambientAIs.forEach((ai, idx) => {
        if (IS_LOW_POWER_DEVICE && !ai.visible) {
            return;
        }
        const data = ai.userData;
        const angle = totalTime * data.speed + data.offset;
        ai.position.set(
            Math.cos(angle) * data.radius,
            data.height + Math.sin(angle * 0.7) * data.verticalSwing,
            Math.sin(angle) * data.radius
        );
        ai.rotation.y = angle;
        const pulse = 0.3 + Math.sin(angle + idx) * 0.2;
        ai.material.emissiveIntensity = pulse;
    });

    dancingJellyTrees.forEach((tree) => {
        if (IS_LOW_POWER_DEVICE && !tree.mesh.visible) {
            if (tree.mixer) {
                tree.mixer.update(0);
            }
            return;
        }
        const angle = totalTime * tree.angularSpeed + tree.offset;
        tree.mesh.position.set(
            Math.cos(angle) * tree.radius,
            tree.baseHeight + Math.sin(totalTime * tree.bobSpeed + angle) * tree.bobAmount,
            Math.sin(angle) * tree.radius
        );
        tree.mesh.rotation.y += dt * 0.25;
        if (tree.mixer) {
            tree.mixer.update(dt);
        }
    });

    if (ENABLE_AURORA_BANDS) {
        auroraBands.forEach((band) => {
            band.mesh.position.y = band.baseHeight + Math.sin(totalTime * band.speed + band.offset) * band.wobble;
            band.mesh.rotation.y = totalTime * 0.01;
        });
    }

    updateFloatingArtifactCollection(floatingCrystalRocks, dt);
    updateFloatingArtifactCollection(floatingMagicClusters, dt);

    worldProps.forEach((prop) => {
        if (IS_LOW_POWER_DEVICE && !prop.object.visible) {
            if (prop.mixer) {
                prop.mixer.update(0);
            }
            return;
        }
        const hoverOffset = Math.sin(totalTime * prop.hoverSpeed + prop.phase) * prop.hoverAmplitude;
        prop.object.position.y = prop.baseHeight + hoverOffset;
        if (prop.mixer) {
            prop.mixer.update(dt);
        }
    });

    updateAssetVisibility();
    animateLoreMarkers(dt);

    // Update season based on character angle (which quadrant they're in)
    // Quadrants: 0°-90° (Summer), 90°-180° (Rain), 180°-270° (Autumn), 270°-360° (Winter)
    let newSeason = 0;
    const normalizedAngle = ((characterAngle % (Math.PI * 2)) + (Math.PI * 2)) % (Math.PI * 2);

    if (normalizedAngle >= 0 && normalizedAngle < Math.PI / 2) {
        newSeason = 0; // Summer (0°-90°)
    } else if (normalizedAngle >= Math.PI / 2 && normalizedAngle < Math.PI) {
        newSeason = 1; // Rain (90°-180°)
    } else if (normalizedAngle >= Math.PI && normalizedAngle < 3 * Math.PI / 2) {
        newSeason = 2; // Autumn (180°-270°)
    } else {
        newSeason = 3; // Winter (270°-360°)
    }

    if (newSeason !== targetSeason) {
        requestSeasonChange(newSeason);
    }

    updateSeasonSystems(dt);
    updateGlobalFog(dt);
    updateDayNightLight(totalTime);
    updatePerformanceControls();
    updateInteractionSystems();
    const useCartoonPost = cartoonPass.enabled;
    if (useCartoonPost) {
        cartoonComposer.render();
    } else if (ENABLE_BLOOM && bloomComposer) {
        renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
        renderer.autoClear = false;
        renderer.clear();
        bloomComposer.render();
    } else {
        renderer.autoClear = true;
        renderer.render(scene, camera);
    }
}

// Handle window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    cartoonComposer.setSize(window.innerWidth, window.innerHeight);
    if (ENABLE_BLOOM && bloomComposer) {
        bloomComposer.setSize(window.innerWidth, window.innerHeight);
    }
});

function updateInteractionSystems() {
    if (!isMovementActive) {
        processLorePointerMove();
    }
}

// Start animation
animate();
console.log('Globe World initialized');

