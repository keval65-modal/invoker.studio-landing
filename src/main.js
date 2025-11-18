import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

// ========== CONFIGURATION ==========
const DEV_DEBUG_VISUALS = false;
const ENABLE_SEASON_PLACEHOLDERS = false;
const ENABLE_BLOOM = false;
const GLOBE_RADIUS = 10; // doubled for larger world
const TORUS_MAJOR_RADIUS = GLOBE_RADIUS + 0.3;
const TORUS_MINOR_RADIUS = 0.08;
const CHARACTER_SIZE = 0.3;
const CHARACTER_RING_CLEARANCE = 0.15;
const HOTSPOT_COUNT = 4;
const SEASONS = ['summer', 'rain', 'autumn', 'winter'];
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
const PARTICLE_COUNT_SCALE = IS_LOW_POWER_DEVICE ? 0.4 : 0.8;
const DECOR_COUNT_SCALE = IS_LOW_POWER_DEVICE ? 0.4 : 0.75;
const FOREST_DENSITY_SCALE = IS_LOW_POWER_DEVICE ? 0.35 : 0.55;
const PARTICLE_UPDATE_INTERVAL = IS_LOW_POWER_DEVICE ? 3 : 2;
const CRYSTAL_DRIFT_COUNT = IS_LOW_POWER_DEVICE ? 3 : 6;
const MAGIC_CLUSTER_COUNT = IS_LOW_POWER_DEVICE ? 4 : 8;
const SEASON_ANGLES = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]; // 0°, 90°, 180°, 270°

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
const lorePanel = document.getElementById('lore-panel');
const lorePanelTitle = document.getElementById('lore-panel-title');
const lorePanelBody = document.getElementById('lore-panel-body');
const lorePanelClose = document.getElementById('lore-panel-close');
const hotspotButtons = Array.from(document.querySelectorAll('.hotspot-btn'));
if (loadingOverlay) {
    document.body.classList.add('is-loading');
}
const LOADING_MESSAGES = [
    'Brewing the magic...',
    'Forging aurora circuits...',
    'Polishing portal lenses...',
    'Tuning orbital relays...'
];
let loadingMessageIndex = 0;
let loadingMessageInterval = null;

function startLoadingMessages() {
    if (!loadingText) return;
    loadingText.textContent = LOADING_MESSAGES[0];
    loadingMessageInterval = window.setInterval(() => {
        loadingMessageIndex = (loadingMessageIndex + 1) % LOADING_MESSAGES.length;
        loadingText.textContent = LOADING_MESSAGES[loadingMessageIndex];
    }, 2600);
}

function stopLoadingMessages() {
    if (loadingMessageInterval) {
        clearInterval(loadingMessageInterval);
        loadingMessageInterval = null;
    }
}

if (loadingText) {
    startLoadingMessages();
}

const loadingManager = new THREE.LoadingManager();
let overlayDismissed = false;
function dismissLoadingOverlay(message) {
    if (overlayDismissed) return;
    overlayDismissed = true;
    stopLoadingMessages();
    if (message && loadingProgress) {
        loadingProgress.textContent = message;
    }
    document.body.classList.remove('is-loading');
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
    if (loadingProgress) {
        loadingProgress.textContent = 'Loading 0%';
    }
};

loadingManager.onProgress = (_url, itemsLoaded, itemsTotal) => {
    if (!loadingProgress || !itemsTotal) return;
    const percent = Math.round((itemsLoaded / itemsTotal) * 100);
    loadingProgress.textContent = `Loading ${percent}%`;
};

function compileView() {
    if (renderer.compileAsync) {
        return renderer.compileAsync(scene, camera);
    }
    renderer.compile(scene, camera);
    return Promise.resolve();
}

async function finalizeLoading() {
    const originalPosition = camera.position.clone();
    const originalQuaternion = camera.quaternion.clone();
    const originalUp = camera.up.clone();

    const angles = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2];
    const previewDistance = WALKWAY_RADIUS + 14;
    for (const angle of angles) {
        camera.position.set(
            Math.cos(angle) * previewDistance,
            7,
            Math.sin(angle) * previewDistance
        );
        camera.lookAt(0, 0, 0);
        await compileView();
    }

    camera.position.copy(originalPosition);
    camera.quaternion.copy(originalQuaternion);
    camera.up.copy(originalUp);
    return compileView();
}

loadingManager.onLoad = () => {
    finalizeLoading()
        .catch((err) => console.warn('Renderer compile failed', err))
        .finally(() => dismissLoadingOverlay('Loading complete'));
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
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor('#05000c', 1);
if (typeof window !== 'undefined') {
    window.renderer = renderer;
}
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
const CAMERA_TRAIL_DISTANCE = 8.2;    // Distance behind character along path tangent
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
const EFFECT_INNER_RADIUS = RING_INNER_RADIUS - 1.5;
const EFFECT_OUTER_RADIUS = RING_OUTER_RADIUS + 1.6;
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

const innerRing = createRingMesh(RING_INNER_RADIUS, 1.0, 0x00ffe5, 0x00c6b0, 0.45, 0.3);          // teal
const walkwayRing = createRingMesh(WALKWAY_RADIUS, WALKWAY_WIDTH, 0xff45ff, 0xb40fb4, 0.5, 0.4);   // magenta
const outerRing = createRingMesh(RING_OUTER_RADIUS, 1.2, 0x77a7ff, 0x4263ff, 0.35, 0.5);          // blue

scene.add(innerRing);
scene.add(walkwayRing);
scene.add(outerRing);

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
const floatingElements = [];
const floatingCrystalRocks = [];
const floatingMagicClusters = [];
const auroraBands = [];
let auroraRing = null;
const ambientAIs = [];
const worldProps = [];
const forestInstances = [];
const decorationInstances = [];
const dancingJellyTrees = [];
const loreMarkers = [];
const loreMarkerMeshes = [];
const pointer = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
let hoveredLoreMarker = null;
let activeLoreMarker = null;

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
        const clone = cloneSkeleton(gltfCache.get(path));
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
            gltfCache.set(path, gltf.scene);
            const clone = cloneSkeleton(gltf.scene);
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

createGlobalAtmosphereParticles();
createGlobalPixelParticles();
placeForestShrine();
placeMagicGate();
placeVoyager();
createAuroraBands();
placeCrystalDrifts();
placeMagicCrystalClusters();
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
const MOVEMENT_IDLE_THRESHOLD = 0.04;
const MOVEMENT_IDLE_TIMEOUT = 0.35; // seconds
let adaptiveQuality = 'low';
let fpsAverage = 60;
let adaptiveTimer = 0;
let lastFrameStamp = performance.now();

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
    
    // Initially hide all lights except summer
    if (index !== 0) {
        light.visible = false;
        zoneLights[season].ambient.visible = false;
    }
});

const seasonalFogColors = {
    summer: new THREE.Color('#5c2c8e'),
    rain: new THREE.Color('#3a1f4f'),
    autumn: new THREE.Color('#7a356a'),
    winter: new THREE.Color('#4f3a9e')
};

function setSeasonFog(seasonIndex) {
    const season = SEASONS[seasonIndex];
    Object.keys(zoneLights).forEach((s, i) => {
        const isActive = (i === seasonIndex);
        zoneLights[s].ambient.visible = isActive;
        zoneLights[s].directional.visible = isActive;
    });
    const color = seasonalFogColors[season] || globalFogColor;
    if (!scene.fog) {
        scene.fog = new THREE.FogExp2(color.clone(), 0.02);
    }
    scene.fog.color.copy(color);
}

setSeasonFog(0);

// ========== SEASONAL EFFECTS ==========
let currentSeason = 0;
const seasonGroups = {
    summer: new THREE.Group(),
    rain: new THREE.Group(),
    autumn: new THREE.Group(),
    winter: new THREE.Group()
};

// Add season groups to scene
Object.values(seasonGroups).forEach(group => scene.add(group));

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
    bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.8, 0.6, 0.1);
    bloomPass.threshold = 0.1;
    bloomPass.strength = 1.1;
    bloomPass.radius = 0.8;
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

    auroraBands.forEach((band) => {
        band.mesh.visible = angularDifference(band.centerAngle, focusAngle) <= FLOATING_ASSET_MAX_ANGLE;
    });
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
    if (isMovementActive) return;
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
    fpsOverlay.textContent = `${fpsAverage.toFixed(0)} fps`;
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
    const fireflies = seasonGroups.summer.userData.fireflies;
    if (!isMovementActive && fireflies) {
        const positions = fireflies.points.geometry.attributes.position.array;
        fireflies.velocities.forEach((vel, i) => {
            positions[i * 3 + 1] += Math.sin(totalTime * vel.speed + vel.phase) * 0.01;
            if (positions[i * 3 + 1] > 5) positions[i * 3 + 1] = 0;
        });
        fireflies.points.geometry.attributes.position.needsUpdate = true;
    }
    
    // Update rain (rain section)
    const rain = seasonGroups.rain.userData.rain;
    if (!isMovementActive && shouldUpdateSparseParticles && rain) {
        const positions = rain.geometry.attributes.position.array;
        rain.velocities.forEach((vel, i) => {
            positions[i * 3 + 1] -= vel * dt;
            if (positions[i * 3 + 1] < -2) {
                positions[i * 3 + 1] = 5 + Math.random() * 5;
            }
        });
        rain.geometry.attributes.position.needsUpdate = true;
    }
    
    // Lightning flashes
    const lightning = seasonGroups.rain.userData.lightning;
    if (lightning) {
        if (Math.random() < 0.01) {
            lightning.intensity = 2;
        } else {
            lightning.intensity = Math.max(0, lightning.intensity - dt * 5);
        }
    }
    
    // Update falling leaves (autumn)
    const leaves = seasonGroups.autumn.userData.leaves;
    if (!isMovementActive && shouldUpdateSparseParticles && leaves) {
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
    
    // Update snow (winter)
    const snow = seasonGroups.winter.userData.snow;
    if (!isMovementActive && shouldUpdateSparseParticles && snow) {
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
    
    // Parallax background rotation + animated skybox
    parallaxSphere.rotation.y += dt * 0.01;
    updateSkyboxTexture(dt);
    
    // Rotate panoramic skybox for subtle movement + recolor
    if (scene.background && scene.background.isTexture && scene.background.mapping === THREE.EquirectangularReflectionMapping) {
        scene.background.rotation += 0.001 * dt;
    }
    updateSkyboxTexture(dt, currentDayNightFactor);
    
    // Update effect ring particles
    if (!isMovementActive && shouldUpdateSparseParticles) {
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
    if (!isMovementActive && shouldUpdateSparseParticles) {
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
    if (!isMovementActive && shouldUpdateSparseParticles && globalAtmosphereParticles && globalAtmosphereParticles.visible) {
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
    
    if (!isMovementActive && shouldUpdateSparseParticles && globalPixelParticles) {
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
    
    // Floating sky elements
    if (!isMovementActive) {
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
    }

    auroraBands.forEach((band) => {
        band.mesh.position.y = band.baseHeight + Math.sin(totalTime * band.speed + band.offset) * band.wobble;
        band.mesh.rotation.y = totalTime * 0.01;
    });

    updateFloatingArtifactCollection(floatingCrystalRocks, dt);
    updateFloatingArtifactCollection(floatingMagicClusters, dt);

    worldProps.forEach((prop) => {
        if (IS_LOW_POWER_DEVICE && !prop.object.visible) {
            return;
        }
        const hoverOffset = Math.sin(totalTime * prop.hoverSpeed + prop.phase) * prop.hoverAmplitude;
        prop.object.position.y = prop.baseHeight + hoverOffset;
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
    
    if (newSeason !== currentSeason) {
        currentSeason = newSeason;
        setSeasonFog(currentSeason);
        document.getElementById('season').textContent = SEASONS[currentSeason].charAt(0).toUpperCase() + SEASONS[currentSeason].slice(1);
    }
    
    // Show/hide season groups based on visibility
    Object.keys(seasonGroups).forEach((key, i) => {
        seasonGroups[key].visible = (i === currentSeason);
    });
    
    updateGlobalFog(dt);
    updateDayNightLight(totalTime);
    updatePerformanceControls();
    updateInteractionSystems();
    if (ENABLE_BLOOM && bloomComposer) {
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

