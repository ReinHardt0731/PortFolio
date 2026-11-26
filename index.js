import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

function collapseProjectDetails() {
  document.querySelectorAll("details.project-details, details.project-details-aircraft").forEach((details) => {
    details.removeAttribute("open");
    const panel = details.querySelector(":scope > .project-details-panel");
    if (panel) panel.inert = true;
  });
}

collapseProjectDetails();
window.addEventListener("pageshow", collapseProjectDetails);
document.querySelectorAll("details.project-details, details.project-details-aircraft").forEach((details) => {
  details.addEventListener("toggle", () => {
    const panel = details.querySelector(":scope > .project-details-panel");
    if (panel) panel.inert = !details.open;
  });
});

const isMobileViewport = window.matchMedia("(max-width: 680px)").matches;
const renderPixelRatio = Math.min(window.devicePixelRatio || 1, isMobileViewport ? 1 : 1.25);

function createGLTFLoader() {
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
}

function loadingPercent(status) {
  const match = String(status).match(/(\d{1,3})%/);
  return match ? Number(match[1]) : null;
}

function updateLoadingProgress(progressElement, status) {
  if (!progressElement) return;
  const percent = loadingPercent(status);
  progressElement.classList.toggle("is-indeterminate", percent === null);
  if (percent === null) {
    progressElement.removeAttribute("aria-valuenow");
    progressElement.setAttribute("aria-valuetext", "Loading");
    progressElement.style.removeProperty("--progress");
    return;
  }
  const safePercent = THREE.MathUtils.clamp(percent, 0, 100);
  progressElement.setAttribute("aria-valuenow", String(safePercent));
  progressElement.removeAttribute("aria-valuetext");
  progressElement.style.setProperty("--progress", `${safePercent}%`);
}

const ANGLE_DEG = 60;
const DEFAULT_VIEW_ZOOM = 1.4;
const GANNET_COMPARISON_ZOOM = DEFAULT_VIEW_ZOOM * 2;
const COMPARISON_MARGIN = 0.06;
const comparisonCanvas = document.querySelector("#comparison-canvas");
const comparisonViewer = document.querySelector("#comparison-viewer");
const comparisonShell = document.querySelector(".comparison-shell");
const comparisonStatus = document.querySelector("#comparison-status");
const comparisonLoading = document.querySelector("#comparison-loading");
const comparisonLoadingText = document.querySelector("#comparison-loading-text");
const comparisonMeshProgress = document.querySelector("#comparison-mesh-progress");
const comparisonSimulationProgress = document.querySelector("#comparison-simulation-progress");
const comparisonError = document.querySelector("#comparison-error");
const comparisonPlay = document.querySelector("#comparison-play");
const comparisonHome = document.querySelector("#comparison-home");
const dividerElements = [document.querySelector("#divider-mesh-simulation")];

let dividerPositions = [0.5];
let renderer;
let controls;
let camera;
let comparisonState;
let baseModel;
let simulationModel;
let baseMixer;
let simulationMixer;
let baseAction;
let simulationAction;
let animationPlaying = false;
let frameRequest;
let savedCamera;
let savedTarget;
let resizeObserver;
let intersectionObserver;
let comparisonVisibilityObserver;
let comparisonNearViewport = false;
let comparisonControlSettleUntil = 0;
let lastComparisonFrame = 0;
let comparisonFrameInProgress = false;
let renderTargets = [];
let comparisonStarted = false;
let comparisonReady = false;
const baseMaterialStates = [];
const clock = new THREE.Clock();
const drawingBufferSize = new THREE.Vector2();
const backgroundColor = new THREE.Color(0x17263b);

function setComparisonStatus(message) {
  comparisonStatus.textContent = message.toUpperCase();
}

function setComparisonError(error, message) {
  console.error("Mesh and simulation comparison unavailable:", error);
  comparisonLoading.hidden = true;
  comparisonError.hidden = false;
  comparisonError.textContent = error?.message ? `${message} (${error.message})` : message;
  comparisonPlay.disabled = true;
  setComparisonStatus("MODEL PREVIEW UNAVAILABLE");
}

function getDividerLimits() {
  const rect = comparisonViewer.getBoundingClientRect();
  const halfTravel = rect.width > 0 ? (rect.height / rect.width) * 0.5 / Math.tan(THREE.MathUtils.degToRad(ANGLE_DEG)) : 0;
  return {
    min: Math.min(0.42, halfTravel + COMPARISON_MARGIN),
    max: Math.max(0.58, 1 - halfTravel - COMPARISON_MARGIN),
  };
}

function syncDividerUI() {
  const limits = getDividerLimits();
  dividerPositions[0] = THREE.MathUtils.clamp(dividerPositions[0], limits.min, limits.max);
  const element = dividerElements[0];
  element.style.left = `${dividerPositions[0] * 100}%`;
  element.setAttribute("aria-valuemin", String(Math.round(limits.min * 100)));
  element.setAttribute("aria-valuemax", String(Math.round(limits.max * 100)));
  element.setAttribute("aria-valuenow", String(Math.round(dividerPositions[0] * 100)));
}

function moveDivider(nextPosition) {
  const limits = getDividerLimits();
  dividerPositions[0] = THREE.MathUtils.clamp(nextPosition, limits.min, limits.max);
  syncDividerUI();
  scheduleComparisonFrame();
}

function installDividerControls() {
  comparisonViewer.style.setProperty("--divider-rotation", `${ANGLE_DEG - 90}deg`);
  dividerElements.forEach((element) => {
    let activePointer = null;
    const updateFromPointer = (event) => {
      const rect = comparisonViewer.getBoundingClientRect();
      if (rect.width > 0) moveDivider((event.clientX - rect.left) / rect.width);
    };

    element.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      activePointer = event.pointerId;
      element.classList.add("is-dragging");
      element.setPointerCapture(event.pointerId);
      updateFromPointer(event);
    });
    element.addEventListener("pointermove", (event) => {
      if (event.pointerId === activePointer) updateFromPointer(event);
    });
    const finishDrag = (event) => {
      if (event.pointerId !== activePointer) return;
      activePointer = null;
      element.classList.remove("is-dragging");
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    };
    element.addEventListener("pointerup", finishDrag);
    element.addEventListener("pointercancel", finishDrag);
    element.addEventListener("lostpointercapture", () => {
      activePointer = null;
      element.classList.remove("is-dragging");
    });
    element.addEventListener("keydown", (event) => {
      const limits = getDividerLimits();
      const step = event.shiftKey ? 0.05 : 0.015;
      if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
        event.preventDefault();
        moveDivider(dividerPositions[0] - step);
      } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
        event.preventDefault();
        moveDivider(dividerPositions[0] + step);
      } else if (event.key === "Home") {
        event.preventDefault();
        moveDivider(limits.min);
      } else if (event.key === "End") {
        event.preventDefault();
        moveDivider(limits.max);
      }
    });
  });
  syncDividerUI();
}
function createComparisonRenderer() {
  renderer = new THREE.WebGLRenderer({
    canvas: comparisonCanvas,
    alpha: false,
    antialias: !isMobileViewport,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(renderPixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.setClearColor(backgroundColor, 1);

  const scene = new THREE.Scene();
  scene.background = backgroundColor;
  camera = new THREE.PerspectiveCamera(34, 1, 0.1, 5000);
  scene.add(new THREE.HemisphereLight(0xe2eeff, 0x29354a, 2.1));
  const keyLight = new THREE.DirectionalLight(0xfff2d7, 3.2);
  keyLight.position.set(4, 7, 5);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0x85baff, 2.2);
  rimLight.position.set(-5, 2, -4);
  scene.add(rimLight);
  const fillLight = new THREE.PointLight(0xd3ef66, 0.7, 24);
  fillLight.position.set(0, -2, 3);
  scene.add(fillLight);

  controls = new OrbitControls(camera, comparisonCanvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.autoRotate = false;
  controls.autoRotateSpeed = 0.55;
  controls.minPolarAngle = 0.18;
  controls.maxPolarAngle = Math.PI * 0.83;
  controls.addEventListener("change", () => {
    comparisonControlSettleUntil = performance.now() + 220;
    if (!comparisonFrameInProgress && !animationPlaying && comparisonReady) {
      renderComparison(comparisonState);
    }
    scheduleComparisonFrame();
  });

  const targetOptions = {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    depthBuffer: true,
    stencilBuffer: false,
  };
  renderTargets = [0, 1].map(() => {
    const target = new THREE.WebGLRenderTarget(1, 1, targetOptions);
    target.texture.colorSpace = THREE.LinearSRGBColorSpace;
    target.texture.generateMipmaps = false;
    return target;
  });

  const compositeMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uMesh: { value: renderTargets[0].texture },
      uSimulation: { value: renderTargets[1].texture },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uDivider: { value: dividerPositions[0] },
      uAngle: { value: THREE.MathUtils.degToRad(ANGLE_DEG) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D uMesh;
      uniform sampler2D uSimulation;
      uniform vec2 uResolution;
      uniform float uDivider;
      uniform float uAngle;
      varying vec2 vUv;
      void main() {
        float shift = (0.5 - vUv.y) * (uResolution.y / uResolution.x) / tan(uAngle);
        float split = uDivider + shift;
        float edge = 1.0 / uResolution.x;
        float toSimulation = smoothstep(split - edge, split + edge, vUv.x);
        vec4 color = mix(texture2D(uMesh, vUv), texture2D(uSimulation, vUv), toSimulation);
        gl_FragColor = color;
        #include <colorspace_fragment>
      }
    `,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const compositeScene = new THREE.Scene();
  compositeScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), compositeMaterial));
  const compositeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  compositeCamera.position.z = 1;

  const resize = () => {
    const rect = comparisonViewer.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
    renderer.getDrawingBufferSize(drawingBufferSize);
    renderTargets.forEach((target) => target.setSize(drawingBufferSize.x, drawingBufferSize.y));
    compositeMaterial.uniforms.uResolution.value.copy(drawingBufferSize);
    syncDividerUI();
    scheduleComparisonFrame();
  };
  resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(comparisonViewer);
  resize();

  return { scene, compositeScene, compositeCamera, compositeMaterial, resize };
}

function createMaterialVariants(model) {
  baseMaterialStates.length = 0;
  const flatColor = new THREE.Color(0xb8c5d3);
  model.traverse((object) => {
    if (!object.isMesh) return;
    const original = object.material;
    const originals = Array.isArray(original) ? original : [original];
    const flat = originals.map((material) => {
      const variant = material.clone();
      if ("flatShading" in variant) variant.flatShading = true;
      variant.needsUpdate = true;
      return variant;
    });
    const wire = originals.map(() => new THREE.MeshBasicMaterial({
      color: 0xd3ef66,
      wireframe: true,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      toneMapped: true,
    }));
    flat.forEach((material) => {
      if ("color" in material) material.color.lerp(flatColor, 0.14);
    });
    baseMaterialStates.push({ object, original, flat: Array.isArray(original) ? flat : flat[0], wire: Array.isArray(original) ? wire : wire[0], variants: [...flat, ...wire] });
  });
}

function setBaseMaterialMode(mode) {
  baseMaterialStates.forEach((state) => {
    state.object.material = state[mode];
  });
}

function restoreBaseMaterials() {
  baseMaterialStates.forEach((state) => {
    state.object.material = state.original;
  });
}

function loadGltf(loader, url, label, onProgress) {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, (event) => {
      if (event.lengthComputable && event.total > 0) {
        const percent = Math.round((event.loaded / event.total) * 100);
        onProgress(label, `${percent}%`);
      } else {
        onProgress(label, "loading");
      }
    }, reject);
  });
}

function fitSharedCamera(baseScene, simulationScene, cameraTarget) {
  const bounds = new THREE.Box3().setFromObject(baseScene);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  baseScene.position.sub(center);
  simulationScene.position.sub(center);

  const radius = Math.max(size.length() * 0.5, 0.5);
  const viewDirection = new THREE.Vector3(-2.8, 1.2, 2.6).normalize();
  const distance = (radius / Math.sin(THREE.MathUtils.degToRad(cameraTarget.fov * 0.5))) * 1.08 / GANNET_COMPARISON_ZOOM;
  cameraTarget.position.copy(viewDirection.multiplyScalar(distance));
  cameraTarget.near = Math.max(radius / 100, 0.01);
  cameraTarget.far = radius * 30;
  cameraTarget.updateProjectionMatrix();
  controls.target.set(0, 0, 0);
  controls.minDistance = radius * 1.05;
  controls.maxDistance = radius * 6;
  controls.update();
  savedCamera = cameraTarget.position.clone();
  savedTarget = controls.target.clone();
}

function renderComparison(state) {
  if (!comparisonReady) return;
  state.compositeMaterial.uniforms.uDivider.value = dividerPositions[0];
  state.compositeMaterial.uniforms.uAngle.value = THREE.MathUtils.degToRad(ANGLE_DEG);

  baseModel.visible = true;
  simulationModel.visible = false;
  setBaseMaterialMode("flat");
  renderer.setRenderTarget(renderTargets[0]);
  renderer.clear(true, true, true);
  renderer.render(state.scene, camera);
  setBaseMaterialMode("wire");
  renderer.autoClear = false;
  renderer.render(state.scene, camera);
  renderer.autoClear = true;
  restoreBaseMaterials();

  baseModel.visible = false;
  simulationModel.visible = true;
  renderer.setRenderTarget(renderTargets[1]);
  renderer.clear(true, true, true);
  renderer.render(state.scene, camera);

  baseModel.visible = true;
  simulationModel.visible = false;
  renderer.setRenderTarget(null);
  renderer.render(state.compositeScene, state.compositeCamera);
}

function configureSynchronizedAnimation(baseGltf, simulationGltf) {
  if (!baseGltf.animations.length || !simulationGltf.animations.length) return;
  baseMixer = new THREE.AnimationMixer(baseModel);
  simulationMixer = new THREE.AnimationMixer(simulationModel);
  baseAction = baseMixer.clipAction(baseGltf.animations[0]);
  simulationAction = simulationMixer.clipAction(simulationGltf.animations[0]);
  [baseAction, simulationAction].forEach((action) => {
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.play();
    action.paused = true;
  });
  comparisonPlay.disabled = false;
}

function scheduleComparisonFrame() {
  if (frameRequest || !comparisonReady || !comparisonNearViewport || document.hidden) return;
  frameRequest = requestAnimationFrame(renderComparisonFrame);
}

function renderComparisonFrame(timestamp) {
  frameRequest = 0;
  if (!comparisonReady || !comparisonNearViewport || document.hidden) return;

  if (animationPlaying && isMobileViewport && timestamp - lastComparisonFrame < 1000 / 30) {
    scheduleComparisonFrame();
    return;
  }

  const delta = Math.min(clock.getDelta(), 0.05);
  comparisonFrameInProgress = true;
  controls.update();
  comparisonFrameInProgress = false;
  if (animationPlaying) {
    baseMixer?.update(delta);
    simulationMixer?.update(delta);
  }
  renderComparison(comparisonState);
  lastComparisonFrame = timestamp;

  if (animationPlaying || performance.now() < comparisonControlSettleUntil) scheduleComparisonFrame();
}

function startRenderLoop() {
  scheduleComparisonFrame();
}

async function startComparison() {
  if (comparisonStarted) return;
  comparisonStarted = true;
  try {
    comparisonState = createComparisonRenderer();
    const loader = createGLTFLoader();
    setComparisonStatus("LOADING MODELS");
    comparisonLoading.hidden = false;
    comparisonError.hidden = true;
    const modelProgress = { mesh: "queued", simulation: "queued" };
    const updateModelProgress = (label, status) => {
      modelProgress[label] = status;
      comparisonLoadingText.textContent = `MESH ${modelProgress.mesh}  /  SIMULATION ${modelProgress.simulation}`;
      updateLoadingProgress(label === "mesh" ? comparisonMeshProgress : comparisonSimulationProgress, status);
    };
    updateModelProgress("mesh", "queued");
    updateModelProgress("simulation", "queued");

    const [baseGltf, simulationGltf] = await Promise.all([
      loadGltf(loader, "./assets/gannet.glb", "mesh", updateModelProgress),
      loadGltf(loader, "./assets/gannet_simulation.glb", "simulation", updateModelProgress),
    ]);
    comparisonLoadingText.textContent = "Preparing the shared comparison…";
    baseModel = baseGltf.scene;
    simulationModel = simulationGltf.scene;
    comparisonState.scene.add(baseModel, simulationModel);
    fitSharedCamera(baseModel, simulationModel, camera);
    createMaterialVariants(baseModel);
    configureSynchronizedAnimation(baseGltf, simulationGltf);
    if (baseAction && simulationAction) setComparisonAnimationPlaying(true);
    comparisonReady = true;
    comparisonLoading.hidden = true;
    setComparisonStatus("BOTH VIEWS READY");
    startRenderLoop(comparisonState);
  } catch (error) {
    setComparisonError(error, "One or more model files could not be loaded. Check the GLB files and try again.");
  }
}

function toggleComparisonAnimation() {
  if (!baseAction || !simulationAction) return;
  setComparisonAnimationPlaying(!animationPlaying);
}

function setComparisonAnimationPlaying(playing) {
  if (!baseAction || !simulationAction) return;
  animationPlaying = playing;
  baseAction.paused = !animationPlaying;
  simulationAction.paused = !animationPlaying;
  comparisonControlSettleUntil = playing ? 0 : performance.now() + 220;
  comparisonPlay.textContent = animationPlaying ? "Ⅱ" : "▶";
  comparisonPlay.setAttribute("aria-label", animationPlaying ? "Pause synchronized propeller animation" : "Play synchronized propeller animation");
  comparisonPlay.title = animationPlaying ? "Pause animation" : "Play animation";
  if (!animationPlaying && comparisonReady) renderComparison(comparisonState);
  scheduleComparisonFrame();
}

function resetComparisonCamera() {
  if (!savedCamera || !savedTarget) return;
  camera.position.copy(savedCamera);
  controls.target.copy(savedTarget);
  controls.update();
}

function disposeComparison() {
  if (frameRequest) cancelAnimationFrame(frameRequest);
  if (intersectionObserver) intersectionObserver.disconnect();
  if (comparisonVisibilityObserver) comparisonVisibilityObserver.disconnect();
  if (resizeObserver) resizeObserver.disconnect();
  controls?.dispose();
  renderer?.dispose();
  renderTargets.forEach((target) => target.dispose());
}

installDividerControls();
if ("IntersectionObserver" in window) {
  intersectionObserver = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      intersectionObserver.disconnect();
      startComparison();
    }
  }, { rootMargin: "360px 0px" });
  intersectionObserver.observe(comparisonShell);
  comparisonVisibilityObserver = new IntersectionObserver((entries) => {
    comparisonNearViewport = Boolean(entries[0]?.isIntersecting);
    if (comparisonNearViewport) {
      scheduleComparisonFrame();
    } else if (frameRequest) {
      cancelAnimationFrame(frameRequest);
      frameRequest = 0;
      lastComparisonFrame = 0;
    }
  });
  comparisonVisibilityObserver.observe(comparisonShell);
} else {
  comparisonNearViewport = true;
  startComparison();
}

comparisonPlay.addEventListener("click", toggleComparisonAnimation);
comparisonHome.addEventListener("click", resetComparisonCamera);

const projectViewerStates = [];
const projectViewerObservers = [];
const projectLightColor = new THREE.Color(0x17263b);
let propellerSplit = 0.5;
let propellerStarted = false;
let uavStarted = false;
let aircraftStarted = false;
let aircraftNearViewport = false;
let aircraftAnimationPaused = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let aircraftMixer = null;
let aircraftAction = null;
let aircraftAnimationFrame = 0;
let aircraftPreviousFrame = 0;
let aircraftObserver = null;

function createProjectViewport(canvas, viewer, render, { transparent = false } = {}) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: transparent,
    antialias: !isMobileViewport,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(renderPixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.setClearColor(projectLightColor, transparent ? 0 : 1);

  const scene = new THREE.Scene();
  scene.background = transparent ? null : projectLightColor;
  scene.add(new THREE.HemisphereLight(0xe2eeff, 0x29354a, 2.0));
  const key = new THREE.DirectionalLight(0xfff2d7, 3.0);
  key.position.set(4, 7, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x85baff, 2.0);
  rim.position.set(-5, 2, -4);
  scene.add(rim);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 5000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.minPolarAngle = 0.15;
  controls.maxPolarAngle = Math.PI * 0.85;

  const state = { renderer, scene, camera, controls, viewer, ready: false, roots: [], savedCamera: null, savedTarget: null, resizeObserver: null, refit: null };
  controls.addEventListener("change", () => render(state));
  const resize = () => {
    const rect = viewer.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
    if (state.ready) {
      state.refit?.();
      render(state);
    }
  };
  state.resizeObserver = new ResizeObserver(resize);
  state.resizeObserver.observe(viewer);
  resize();
  projectViewerStates.push(state);
  return state;
}

function centerProjectModel(model) {
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  if (bounds.isEmpty()) throw new Error("The model has no visible geometry.");
  model.position.sub(bounds.getCenter(new THREE.Vector3()));
  model.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(model);
}

function fitProjectModels(state, models, zoom = 1, cameraDirection = new THREE.Vector3(-2.8, 1.25, 2.7), screenCenterX = 0.5) {
  let radius = 0;
  models.forEach((model) => {
    const bounds = centerProjectModel(model);
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    radius = Math.max(radius, sphere.radius);
  });
  radius = Math.max(radius, 0.1);
  const verticalHalfFov = THREE.MathUtils.degToRad(state.camera.fov * 0.5);
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * Math.max(state.camera.aspect, 0.1));
  const limitingHalfFov = Math.min(verticalHalfFov, horizontalHalfFov);
  const distance = (radius / Math.sin(limitingHalfFov)) * 1.18 / zoom;
  const direction = cameraDirection.clone().normalize();
  const forward = direction.clone().negate();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const screenShift = (0.5 - screenCenterX) * 2 * distance * Math.tan(horizontalHalfFov);
  state.camera.position.copy(direction.multiplyScalar(distance)).addScaledVector(right, screenShift);
  state.camera.near = Math.max(radius / 1000, 0.01);
  state.camera.far = radius * 30;
  state.camera.updateProjectionMatrix();
  state.controls.target.copy(right.multiplyScalar(screenShift));
  state.controls.minDistance = radius * 0.75;
  state.controls.maxDistance = radius * 8;
  state.savedCamera = state.camera.position.clone();
  state.savedTarget = state.controls.target.clone();
  state.controls.update();
}

function fitProjectModelToViewport(state, model, screenFraction = 0.58, screenCenterX = 0.5) {
  const bounds = centerProjectModel(model);
  const center = bounds.getCenter(new THREE.Vector3());
  const radius = Math.max(bounds.getBoundingSphere(new THREE.Sphere()).radius, 0.1);
  const direction = new THREE.Vector3(-2.8, 1.25, 2.7).normalize();
  const forward = direction.clone().negate();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  const verticalHalfFov = THREE.MathUtils.degToRad(state.camera.fov * 0.5);
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * Math.max(state.camera.aspect, 0.1));
  let distance = 0;

  for (let corner = 0; corner < 8; corner += 1) {
    const point = new THREE.Vector3(
      corner & 1 ? bounds.max.x : bounds.min.x,
      corner & 2 ? bounds.max.y : bounds.min.y,
      corner & 4 ? bounds.max.z : bounds.min.z,
    ).sub(center);
    const depthTowardCamera = point.dot(direction);
    const verticalDistance = depthTowardCamera + Math.abs(point.dot(up)) / (screenFraction * Math.tan(verticalHalfFov));
    const horizontalDistance = depthTowardCamera + Math.abs(point.dot(right)) / (screenFraction * Math.tan(horizontalHalfFov));
    distance = Math.max(distance, verticalDistance, horizontalDistance);
  }

  distance = Math.max(distance, radius * 0.5);
  const screenShift = (0.5 - screenCenterX) * 2 * distance * Math.tan(horizontalHalfFov);
  state.camera.position.copy(center).addScaledVector(direction, distance).addScaledVector(right, screenShift);
  state.camera.near = Math.max(radius / 1000, 0.01);
  state.camera.far = Math.max(radius * 30, distance + radius * 2);
  state.camera.updateProjectionMatrix();
  state.controls.target.copy(center).addScaledVector(right, screenShift);
  state.controls.minDistance = Math.min(radius * 0.75, distance * 0.8);
  state.controls.maxDistance = radius * 8;
  state.savedCamera = state.camera.position.clone();
  state.savedTarget = state.controls.target.clone();
  state.controls.update();
}

function loadProjectModel(loader, url, label, onProgress) {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(`${label} ${Math.round((event.loaded / event.total) * 100)}%`);
      } else {
        onProgress(`Loading ${label}`);
      }
    }, reject);
  });
}

function renderPropellerComparison(state) {
  if (!state?.ready) return;
  const size = state.renderer.getSize(new THREE.Vector2());
  const width = Math.max(1, Math.round(size.x));
  const height = Math.max(1, Math.round(size.y));
  const split = THREE.MathUtils.clamp(Math.round(width * propellerSplit), 1, width - 1);
  const [cv, tv] = state.roots;
  state.renderer.setScissorTest(true);
  cv.visible = true;
  tv.visible = false;
  state.renderer.setScissor(0, 0, split, height);
  state.renderer.clear(true, true, true);
  state.renderer.render(state.scene, state.camera);
  cv.visible = false;
  tv.visible = true;
  state.renderer.setScissor(split, 0, width - split, height);
  state.renderer.clear(true, true, true);
  state.renderer.render(state.scene, state.camera);
  state.renderer.setScissorTest(false);
  cv.visible = true;
}

function setPropellerSplit(value) {
  propellerSplit = THREE.MathUtils.clamp(value, 0.2, 0.8);
  const divider = document.querySelector("#propeller-divider");
  divider.style.left = `${propellerSplit * 100}%`;
  divider.setAttribute("aria-valuenow", String(Math.round(propellerSplit * 100)));
  renderPropellerComparison(projectViewerStates.find((state) => state.viewer.id === "propeller-viewer"));
}

function installPropellerDivider() {
  const divider = document.querySelector("#propeller-divider");
  let activePointer = null;
  const updateFromPointer = (event) => {
    const rect = divider.parentElement.getBoundingClientRect();
    if (rect.width > 0) setPropellerSplit((event.clientX - rect.left) / rect.width);
  };
  divider.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    activePointer = event.pointerId;
    divider.setPointerCapture(event.pointerId);
    updateFromPointer(event);
  });
  divider.addEventListener("pointermove", (event) => {
    if (event.pointerId === activePointer) updateFromPointer(event);
  });
  const finishDrag = (event) => {
    if (event.pointerId !== activePointer) return;
    activePointer = null;
    if (divider.hasPointerCapture(event.pointerId)) divider.releasePointerCapture(event.pointerId);
  };
  divider.addEventListener("pointerup", finishDrag);
  divider.addEventListener("pointercancel", finishDrag);
  divider.addEventListener("lostpointercapture", () => { activePointer = null; });
  divider.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 0.05 : 0.015;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      setPropellerSplit(propellerSplit - step);
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      setPropellerSplit(propellerSplit + step);
    } else if (event.key === "Home") {
      event.preventDefault();
      setPropellerSplit(0.2);
    } else if (event.key === "End") {
      event.preventDefault();
      setPropellerSplit(0.8);
    }
  });
  setPropellerSplit(propellerSplit);
  document.querySelector("#propeller-reset").addEventListener("click", () => resetProjectCamera("propeller-viewer"));
}

async function startPropellerViewer() {
  if (propellerStarted) return;
  propellerStarted = true;
  const viewer = document.querySelector("#propeller-viewer");
  const canvas = document.querySelector("#propeller-canvas");
  const loading = document.querySelector("#propeller-loading");
  const loadingText = document.querySelector("#propeller-loading-text");
  const progressBar = document.querySelector("#propeller-progress");
  const error = document.querySelector("#propeller-error");
  const divider = document.querySelector("#propeller-divider");
  const reset = document.querySelector("#propeller-reset");
  const modeToggle = document.querySelector("#propeller-mode-toggle");
  const video = document.querySelector("#propeller-video");
  const instructions = document.querySelector("#propeller-viewer-instructions");
  modeToggle.addEventListener("click", () => {
    const showVideo = !viewer.classList.contains("is-video-mode");
    modeToggle.textContent = showVideo ? "BACK TO 3D VIEW" : "WATCH VIDEO";
    modeToggle.setAttribute("aria-label", showVideo ? "Return to 3D propeller comparison" : "Watch toroidal propeller video");
    instructions.textContent = showVideo
      ? "VIDEO PLAYER · USE YOUTUBE CONTROLS"
      : "DRAG TO ORBIT · SCROLL TO ZOOM · DRAG DIVIDER TO COMPARE";
    viewer.classList.toggle("is-video-mode", showVideo);
    video.hidden = !showVideo;
    if (showVideo) video.src = video.dataset.src;
    else video.removeAttribute("src");
    if (!showVideo && state?.ready) renderPropellerComparison(state);
  });
  let state;
  try {
    state = createProjectViewport(canvas, viewer, renderPropellerComparison);
    installPropellerDivider();
    const progress = { CV: "queued", TV: "queued" };
    const updateProgress = (label) => {
      const key = label.startsWith("CV") ? "CV" : "TV";
      progress[key] = label;
      loadingText.textContent = `${progress.CV}  /  ${progress.TV}`;
      const cvPercent = loadingPercent(progress.CV) ?? 0;
      const tvPercent = loadingPercent(progress.TV) ?? 0;
      updateLoadingProgress(progressBar, `${Math.round((cvPercent + tvPercent) / 2)}%`);
    };
    loading.hidden = false;
    error.hidden = true;
    const loader = createGLTFLoader();
    const [cvGltf, tvGltf] = await Promise.all([
      loadProjectModel(loader, "./assets/other_projects/Propeller%20Study/CV.glb", "CV", updateProgress),
      loadProjectModel(loader, "./assets/other_projects/Propeller%20Study/TV.glb", "TV", updateProgress),
    ]);
    const cv = new THREE.Group();
    const tv = new THREE.Group();
    cv.add(cvGltf.scene);
    tv.add(tvGltf.scene);
    state.scene.add(cv, tv);
    state.roots = [cv, tv];
    fitProjectModels(state, state.roots, 2);
    state.ready = true;
    loading.hidden = true;
    divider.disabled = false;
    divider.hidden = false;
    reset.disabled = false;
    reset.hidden = false;
    renderPropellerComparison(state);
  } catch (loadError) {
    console.error("Propeller comparison unavailable:", loadError);
    loading.hidden = true;
    error.hidden = false;
    divider.disabled = true;
    reset.disabled = true;
    divider.hidden = true;
    reset.hidden = true;
  }
}

function renderSingleProjectModel(state) {
  if (state?.ready) state.renderer.render(state.scene, state.camera);
}

function updateAircraftPlayButton() {
  const button = document.querySelector("#aircraft-play");
  if (!button) return;
  button.textContent = aircraftAnimationPaused ? "PLAY ANIMATION  \u25B6" : "PAUSE ANIMATION  \u2016";
  button.setAttribute("aria-label", aircraftAnimationPaused ? "Play aircraft animation" : "Pause aircraft animation");
  button.title = aircraftAnimationPaused ? "Play animation" : "Pause animation";
}

function stopAircraftAnimationLoop() {
  if (aircraftAnimationFrame) cancelAnimationFrame(aircraftAnimationFrame);
  aircraftAnimationFrame = 0;
  aircraftPreviousFrame = 0;
}

function animateAircraft(timestamp) {
  aircraftAnimationFrame = 0;
  const state = projectViewerStates.find((entry) => entry.viewer.id === "aircraft-stage");
  if (!state?.ready || aircraftAnimationPaused || !aircraftNearViewport || document.hidden) return;
  if (aircraftPreviousFrame) aircraftMixer.update(Math.min((timestamp - aircraftPreviousFrame) / 1000, 0.05));
  aircraftPreviousFrame = timestamp;
  renderSingleProjectModel(state);
  aircraftAnimationFrame = requestAnimationFrame(animateAircraft);
}

function startAircraftAnimationLoop() {
  if (aircraftAnimationFrame || aircraftAnimationPaused || !aircraftNearViewport || document.hidden) return;
  aircraftPreviousFrame = 0;
  aircraftAnimationFrame = requestAnimationFrame(animateAircraft);
}

function setAircraftAnimationPaused(paused) {
  aircraftAnimationPaused = paused;
  if (aircraftAction) aircraftAction.paused = paused;
  updateAircraftPlayButton();
  if (paused) {
    stopAircraftAnimationLoop();
    renderSingleProjectModel(projectViewerStates.find((entry) => entry.viewer.id === "aircraft-stage"));
  } else {
    startAircraftAnimationLoop();
  }
}

async function startAircraftViewer() {
  if (aircraftStarted) return;
  aircraftStarted = true;
  const viewer = document.querySelector("#aircraft-stage");
  const canvas = document.querySelector("#aircraft-canvas");
  const loading = document.querySelector("#aircraft-loading");
  const loadingText = document.querySelector("#aircraft-loading-text");
  const progressBar = document.querySelector("#aircraft-progress");
  const error = document.querySelector("#aircraft-error");
  const play = document.querySelector("#aircraft-play");
  const reset = document.querySelector("#aircraft-reset");
  let state;
  try {
    state = createProjectViewport(canvas, viewer, renderSingleProjectModel, { transparent: true });
    loading.hidden = false;
    error.hidden = true;
    const gltf = await loadProjectModel(createGLTFLoader(), "./assets/other_projects/animated_aircraft.glb", "Aircraft", (status) => {
      loadingText.textContent = `${status}...`;
      updateLoadingProgress(progressBar, status);
    });
    const root = new THREE.Group();
    root.add(gltf.scene);
    state.scene.add(root);
    state.roots = [root];
    state.refit = () => fitProjectModels(state, state.roots, 3, new THREE.Vector3(-4.5, 1.4, 1.2), 0.38);
    state.refit();
    state.ready = true;
    loading.hidden = true;
    reset.disabled = false;
    aircraftMixer = new THREE.AnimationMixer(gltf.scene);
    if (gltf.animations.length) {
      aircraftAction = aircraftMixer.clipAction(gltf.animations[0]);
      aircraftAction.setLoop(THREE.LoopRepeat, Infinity);
      aircraftAction.play();
      aircraftAction.paused = aircraftAnimationPaused;
      play.disabled = false;
      play.hidden = false;
      updateAircraftPlayButton();
    } else {
      play.hidden = true;
    }
    renderSingleProjectModel(state);
    startAircraftAnimationLoop();
  } catch (loadError) {
    console.error("Animated aircraft preview unavailable:", loadError);
    loading.hidden = true;
    error.hidden = false;
    play.hidden = true;
  }
}

function observeAircraftViewer(element) {
  if (!("IntersectionObserver" in window)) {
    aircraftNearViewport = true;
    startAircraftViewer();
    return;
  }
  aircraftObserver = new IntersectionObserver((entries) => {
    const entry = entries[0];
    if (!entry) return;
    aircraftNearViewport = entry.isIntersecting;
    if (aircraftNearViewport) {
      startAircraftViewer();
      startAircraftAnimationLoop();
    } else {
      stopAircraftAnimationLoop();
    }
  }, { rootMargin: "360px 0px" });
  aircraftObserver.observe(element);
}

document.querySelector("#aircraft-play").addEventListener("click", () => setAircraftAnimationPaused(!aircraftAnimationPaused));
document.querySelector("#aircraft-reset").addEventListener("click", () => {
  const state = projectViewerStates.find((entry) => entry.viewer.id === "aircraft-stage");
  if (!state?.savedCamera || !state.savedTarget) return;
  state.camera.position.copy(state.savedCamera);
  state.controls.target.copy(state.savedTarget);
  state.controls.update();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopAircraftAnimationLoop();
    if (frameRequest) cancelAnimationFrame(frameRequest);
    frameRequest = 0;
    lastComparisonFrame = 0;
  } else {
    startAircraftAnimationLoop();
    scheduleComparisonFrame();
  }
});

async function startUavViewer() {
  if (uavStarted) return;
  uavStarted = true;
  const viewer = document.querySelector("#uav-viewer");
  const canvas = document.querySelector("#uav-canvas");
  const loading = document.querySelector("#uav-loading");
  const loadingText = document.querySelector("#uav-loading-text");
  const progressBar = document.querySelector("#uav-progress");
  const error = document.querySelector("#uav-error");
  const reset = document.querySelector("#uav-reset");
  let state;
  try {
    state = createProjectViewport(canvas, viewer, renderSingleProjectModel);
    loading.hidden = false;
    error.hidden = true;
    reset.disabled = true;
    const gltf = await loadProjectModel(createGLTFLoader(), "./assets/other_projects/UAV/Drone.glb", "UAV", (status) => {
      loadingText.textContent = `${status}...`;
      updateLoadingProgress(progressBar, status);
    });
    const root = new THREE.Group();
    root.add(gltf.scene);
    state.scene.add(root);
    state.roots = [root];
    fitProjectModelToViewport(state, root, 0.9);
    state.ready = true;
    loading.hidden = true;
    reset.disabled = false;
    reset.hidden = false;
    renderSingleProjectModel(state);
  } catch (loadError) {
    console.error("UAV model preview unavailable:", loadError);
    loading.hidden = true;
    error.hidden = false;
    reset.disabled = true;
    reset.hidden = true;
  }
  reset.addEventListener("click", () => resetProjectCamera("uav-viewer"));
}

function resetProjectCamera(viewerId) {
  const state = projectViewerStates.find((entry) => entry.viewer.id === viewerId);
  if (!state?.savedCamera || !state.savedTarget) return;
  state.camera.position.copy(state.savedCamera);
  state.controls.target.copy(state.savedTarget);
  state.controls.update();
}

function observeProjectViewer(element, start) {
  if (!("IntersectionObserver" in window)) {
    start();
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    observer.disconnect();
    start();
  }, { rootMargin: "260px 0px" });
  observer.observe(element);
  projectViewerObservers.push(observer);
}

function disposeProjectViewers() {
  projectViewerObservers.forEach((observer) => observer.disconnect());
  aircraftObserver?.disconnect();
  stopAircraftAnimationLoop();
  projectViewerStates.forEach((state) => {
    state.resizeObserver?.disconnect();
    state.controls.dispose();
    state.roots.forEach((root) => root.traverse((object) => {
      if (!object.isMesh) return;
      object.geometry?.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        if (!material) return;
        Object.values(material).forEach((value) => {
          if (value?.isTexture) value.dispose();
        });
        material.dispose();
      });
    }));
    state.renderer.dispose();
  });
}

function installFlightForgeSlideshow() {
  const image = document.querySelector("#flightforge-slide-image");
  const controls = document.querySelector("#flightforge-slideshow-controls");
  const previousButton = document.querySelector("#flightforge-slide-prev");
  const toggleButton = document.querySelector("#flightforge-slide-toggle");
  const nextButton = document.querySelector("#flightforge-slide-next");
  const slideCount = document.querySelector("#flightforge-slide-count");
  if (!image || !controls || !previousButton || !toggleButton || !nextButton || !slideCount) return;

  const slides = [
    { src: "./assets/other_projects/FlightForge/flightforge-slide-01.png", alt: "FlightForge Geometry Modeler showing a wireframe aircraft fuselage and wing." },
    { src: "./assets/other_projects/FlightForge/flightforge-slide-02.png", alt: "FlightForge analysis view showing an aircraft inside a computational domain." },
    { src: "./assets/other_projects/FlightForge/flightforge-slide-03.png", alt: "FlightForge convergence plots showing aerodynamic coefficients over iterations." },
    { src: "./assets/other_projects/FlightForge/flightforge-slide-04.png", alt: "FlightForge performance analysis with power and thrust required plotted against velocity." },
    { src: "./assets/other_projects/FlightForge/flightforge-slide-05.png", alt: "FlightForge Aerogenesis project board describing an aircraft design and combat simulation game, with software screenshots and aircraft imagery." },
    { src: "./assets/other_projects/FlightForge/aerogenesis.png", alt: "FlightForge Aerogenesis visual featuring aircraft flow studies, a green concept form, and an engineering rendering." },
  ];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let currentSlide = 0;
  let isPlaying = false;
  let userPaused = false;

  function updateToggleButton() {
    toggleButton.disabled = reducedMotion.matches;
    toggleButton.textContent = reducedMotion.matches ? "PAUSED" : isPlaying ? "PAUSE" : "PLAY";
    toggleButton.setAttribute("aria-label", reducedMotion.matches ? "Slideshow paused because reduced motion is enabled" : isPlaying ? "Pause slideshow" : "Play slideshow");
    toggleButton.title = toggleButton.getAttribute("aria-label");
  }

  function showSlide(index, restartCycle = false) {
    currentSlide = (index + slides.length) % slides.length;
    const slide = slides[currentSlide];
    image.src = slide.src;
    image.alt = slide.alt;
    slideCount.textContent = `${currentSlide + 1} / ${slides.length}`;

    if (!restartCycle || reducedMotion.matches) return;
    image.classList.remove("is-slideshow-animating", "is-slideshow-paused");
    if (isPlaying) {
      void image.offsetWidth;
      image.classList.add("is-slideshow-animating");
    }
  }

  function stopSlideshow() {
    isPlaying = false;
    if (reducedMotion.matches) image.classList.remove("is-slideshow-animating", "is-slideshow-paused");
    else if (image.classList.contains("is-slideshow-animating")) image.classList.add("is-slideshow-paused");
    updateToggleButton();
  }

  function startSlideshow() {
    if (isPlaying || reducedMotion.matches || document.hidden || userPaused) return;
    isPlaying = true;
    image.classList.add("is-slideshow-animating");
    image.classList.remove("is-slideshow-paused");
    updateToggleButton();
  }

  function preloadSlide(slide) {
    return new Promise((resolve, reject) => {
      const preload = new Image();
      preload.onload = () => resolve(slide);
      preload.onerror = () => reject(new Error(`Could not load ${slide.src}`));
      preload.src = slide.src;
    });
  }

  image.addEventListener("animationiteration", () => showSlide(currentSlide + 1));
  previousButton.addEventListener("click", () => showSlide(currentSlide - 1, true));
  nextButton.addEventListener("click", () => showSlide(currentSlide + 1, true));
  toggleButton.addEventListener("click", () => {
    if (isPlaying) {
      userPaused = true;
      stopSlideshow();
    } else {
      userPaused = false;
      startSlideshow();
    }
  });
  reducedMotion.addEventListener("change", () => {
    if (reducedMotion.matches) stopSlideshow();
    else startSlideshow();
    updateToggleButton();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopSlideshow();
    else startSlideshow();
  });
  window.addEventListener("pagehide", stopSlideshow, { once: true });

  Promise.all(slides.map(preloadSlide)).then(() => {
    showSlide(0);
    controls.hidden = false;
    startSlideshow();
    updateToggleButton();
  }).catch((error) => {
    console.warn("FlightForge slideshow images are not ready; showing the project poster instead.", error);
  });
}

installFlightForgeSlideshow();

observeProjectViewer(document.querySelector("#propeller-viewer"), startPropellerViewer);
observeProjectViewer(document.querySelector("#uav-viewer"), startUavViewer);
observeAircraftViewer(document.querySelector("#aircraft-stage"));
window.addEventListener("pagehide", disposeProjectViewers);

function installLeadershipGrowthNotes() {
  const timeline = document.querySelector(".profile-timeline");
  if (!timeline) return;

  const triggers = Array.from(timeline.querySelectorAll(".profile-timeline-trigger"));
  const syncTrigger = (trigger) => {
    const pointerHover = trigger.matches(":hover") && trigger.dataset.pointerType !== "touch";
    const open = trigger.dataset.pinned === "true" || pointerHover || trigger.matches(":focus-visible");
    trigger.closest(".profile-timeline-role")?.classList.toggle("is-open", open);
    trigger.setAttribute("aria-expanded", String(open));
  };

  triggers.forEach((trigger) => {
    trigger.addEventListener("pointerenter", (event) => {
      trigger.dataset.pointerType = event.pointerType;
      syncTrigger(trigger);
    });
    trigger.addEventListener("pointerleave", () => syncTrigger(trigger));
    trigger.addEventListener("focus", () => syncTrigger(trigger));
    trigger.addEventListener("blur", () => syncTrigger(trigger));
    trigger.addEventListener("click", () => {
      triggers.forEach((other) => {
        if (other !== trigger && other.dataset.pinned === "true") {
          other.dataset.pinned = "false";
          syncTrigger(other);
        }
      });
      trigger.dataset.pinned = trigger.dataset.pinned === "true" ? "false" : "true";
      syncTrigger(trigger);
    });
  });

  document.addEventListener("click", (event) => {
    if (timeline.contains(event.target)) return;
    triggers.forEach((trigger) => {
      if (trigger.dataset.pinned === "true") {
        trigger.dataset.pinned = "false";
        syncTrigger(trigger);
      }
    });
  });
}

installLeadershipGrowthNotes();
function installCoreSkillDeck() {
  const deck = document.querySelector(".profile-skill-deck");
  if (!deck) return;

  const panels = Array.from(deck.querySelectorAll(".profile-skill-panel"));
  let pinnedPanel = panels.find((panel) => panel.classList.contains("is-active")) || panels[0];
  let lastPointerPosition = null;
  let hoverTimer = 0;
  const activePanel = () => panels.find((panel) => panel.classList.contains("is-active"));
  const cancelHover = () => {
    window.clearTimeout(hoverTimer);
    hoverTimer = 0;
  };
  const activate = (panel) => {
    if (!panel || panel === activePanel()) return;
    panels.forEach((item) => {
      const active = item === panel;
      item.classList.toggle("is-active", active);
      item.querySelector(".profile-skill-trigger")?.setAttribute("aria-expanded", String(active));
    });
  };

  deck.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch") return;
    const moved = !lastPointerPosition || Math.hypot(event.clientX - lastPointerPosition.x, event.clientY - lastPointerPosition.y) >= 2;
    if (!moved) return;
    lastPointerPosition = { x: event.clientX, y: event.clientY };

    const panel = event.target.closest(".profile-skill-panel");
    if (!panel || !deck.contains(panel)) return;
    if (panel === activePanel()) {
      cancelHover();
      return;
    }

    cancelHover();
    const x = event.clientX;
    const y = event.clientY;
    hoverTimer = window.setTimeout(() => {
      const elementUnderPointer = document.elementFromPoint(x, y);
      const hoveredPanel = elementUnderPointer?.closest(".profile-skill-panel");
      if (hoveredPanel === panel && deck.contains(hoveredPanel)) activate(panel);
      hoverTimer = 0;
    }, 40);
  });

  deck.addEventListener("pointerleave", () => {
    cancelHover();
    lastPointerPosition = null;
    const focusedControl = deck.querySelector(".profile-skill-trigger:focus-visible, .profile-skill-tool:focus-visible");
    activate(focusedControl?.closest(".profile-skill-panel") || pinnedPanel);
  });
  deck.addEventListener("focusin", (event) => {
    cancelHover();
    const panel = event.target.closest(".profile-skill-panel");
    if (panel) activate(panel);
  });
  deck.addEventListener("focusout", (event) => {
    if (!deck.contains(event.relatedTarget)) activate(pinnedPanel);
  });
  deck.addEventListener("click", (event) => {
    const panel = event.target.closest(".profile-skill-panel");
    if (!panel) return;
    pinnedPanel = panel;
    activate(panel);
  });
}

installCoreSkillDeck();
function installParticleDriftBackground() {
  const section = document.querySelector(".python-projects-section");
  const canvas = section?.querySelector(".particle-drift-canvas");
  if (!section || !canvas) return;

  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const characters = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ@#$%&*()";
  const palette = ["#55b8dc", "#d3ef66"];
  let width = 1;
  let height = 1;
  let dpr = 1;
  let nodes = [];
  let beams = [];
  let frame = 0;
  let lastFrame = 0;
  let nearViewport = false;
  const mouse = { x: -1000, y: -1000, active: false };
  const randomCharacter = () => characters[Math.floor(Math.random() * characters.length)];

  const initializeParticles = () => {
    nodes = Array.from({ length: 90 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vy: Math.random() * 0.4 + 0.1,
      character: randomCharacter()
    }));
    beams = Array.from({ length: 25 }, (_, index) => ({
      x: Math.random() * width,
      y: Math.random() * height,
      length: Math.random() * 100 + 50,
      speed: Math.random() * 6 + 3,
      opacity: Math.random() * 0.38 + 0.22,
      color: palette[index % palette.length]
    }));
  };

  const resize = () => {
    const bounds = section.getBoundingClientRect();
    width = Math.max(bounds.width, 1);
    height = Math.max(bounds.height, 1);
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    initializeParticles();
  };

  const draw = (timestamp) => {
    if (reducedMotion.matches || document.hidden || !nearViewport) {
      frame = 0;
      return;
    }
    const step = lastFrame ? Math.min((timestamp - lastFrame) / 16.67, 2) : 1;
    lastFrame = timestamp;
    context.clearRect(0, 0, width, height);

    beams.forEach((beam) => {
      beam.y -= beam.speed * step;
      if (beam.y + beam.length < 0) {
        beam.y = height + 100;
        beam.x = Math.random() * width;
      }
      const gradient = context.createLinearGradient(beam.x, beam.y, beam.x, beam.y + beam.length);
      gradient.addColorStop(0, beam.color === palette[0]
        ? `rgba(85, 184, 220, ${beam.opacity})`
        : `rgba(211, 239, 102, ${beam.opacity * 0.72})`);
      gradient.addColorStop(1, "rgba(17, 26, 42, 0)");
      context.strokeStyle = gradient;
      context.lineWidth = 1.2;
      context.beginPath();
      context.moveTo(beam.x, beam.y);
      context.lineTo(beam.x, beam.y + beam.length);
      context.stroke();
    });

    context.lineWidth = 0.55;
    for (let i = 0; i < nodes.length; i++) {
      const first = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const second = nodes[j];
        const distance = Math.hypot(first.x - second.x, first.y - second.y);
        if (distance < 120) {
          context.strokeStyle = `rgba(157, 183, 204, ${0.17 * (1 - distance / 120)})`;
          context.beginPath();
          context.moveTo(first.x, first.y);
          context.lineTo(second.x, second.y);
          context.stroke();
        }
      }
    }

    context.font = "12px ui-monospace, SFMono-Regular, Consolas, monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    nodes.forEach((node) => {
      node.y += node.vy * step;
      if (node.y > height + 20) {
        node.y = -20;
        node.x = Math.random() * width;
      }
      const distance = mouse.active ? Math.hypot(mouse.x - node.x, mouse.y - node.y) : Infinity;
      if (distance < 180 || Math.random() > 0.98) node.character = randomCharacter();
      if (distance < 180) {
        context.strokeStyle = `rgba(85, 184, 220, ${0.48 * (1 - distance / 180)})`;
        context.beginPath();
        context.moveTo(node.x, node.y);
        context.lineTo(mouse.x, mouse.y);
        context.stroke();
      }
      context.fillStyle = distance < 180 ? "#55b8dc" : "rgba(174, 190, 208, 0.46)";
      context.fillText(node.character, node.x, node.y);
    });

    frame = window.requestAnimationFrame(draw);
  };

  const start = () => {
    if (frame || reducedMotion.matches || document.hidden || !nearViewport) return;
    lastFrame = 0;
    frame = window.requestAnimationFrame(draw);
  };
  const stop = () => {
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    lastFrame = 0;
    mouse.active = false;
  };

  section.addEventListener("pointermove", (event) => {
    const bounds = section.getBoundingClientRect();
    mouse.x = event.clientX - bounds.left;
    mouse.y = event.clientY - bounds.top;
    mouse.active = true;
  }, { passive: true });
  section.addEventListener("pointerleave", () => { mouse.active = false; });
  section.addEventListener("pointercancel", () => { mouse.active = false; });
  window.addEventListener("resize", resize, { passive: true });
  resize();

  if ("ResizeObserver" in window) {
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(section);
  }
  if ("IntersectionObserver" in window) {
    const intersectionObserver = new IntersectionObserver((entries) => {
      nearViewport = entries.some((entry) => entry.isIntersecting);
      if (nearViewport) start();
      else stop();
    }, { rootMargin: "160px 0px", threshold: 0 });
    intersectionObserver.observe(section);
  } else {
    nearViewport = true;
  }

  reducedMotion.addEventListener("change", () => {
    if (reducedMotion.matches) {
      stop();
      context.clearRect(0, 0, width, height);
    } else start();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else start();
  });
  window.addEventListener("pagehide", stop);
  window.addEventListener("pageshow", start);
  if (nearViewport) start();
}

installParticleDriftBackground();
function installFlowFieldBackground() {
  const section = document.querySelector(".waves-background-section");
  const canvas = section?.querySelector(".flow-field-canvas");
  if (!section || !canvas) return;

  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const palette = [
    { r: 85, g: 184, b: 220 },
    { r: 211, g: 239, b: 102 },
    { r: 113, g: 145, b: 181 }
  ];
  let width = 0;
  let height = 0;
  let dpr = 1;
  let particles = [];
  let frame = 0;
  let lastFrame = 0;
  let elapsed = 0;
  let nearViewport = false;
  const mouse = { x: -9999, y: -9999, active: false };

  function createNoise(seed) {
    const f2 = 0.5 * (Math.sqrt(3) - 1);
    const g2 = (3 - Math.sqrt(3)) / 6;
    const gradients = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
    const permutation = new Uint8Array(512);
    const values = new Uint8Array(256);
    let state = seed >>> 0;
    for (let i = 0; i < 256; i++) values[i] = i;
    for (let i = 255; i > 0; i--) {
      state = (state * 1664525 + 1013904223) >>> 0;
      const j = state % (i + 1);
      [values[i], values[j]] = [values[j], values[i]];
    }
    for (let i = 0; i < 512; i++) permutation[i] = values[i & 255];

    return (x, y) => {
      const skew = (x + y) * f2;
      const i = Math.floor(x + skew);
      const j = Math.floor(y + skew);
      const unskew = (i + j) * g2;
      const x0 = x - (i - unskew);
      const y0 = y - (j - unskew);
      const i1 = x0 > y0 ? 1 : 0;
      const j1 = x0 > y0 ? 0 : 1;
      const x1 = x0 - i1 + g2;
      const y1 = y0 - j1 + g2;
      const x2 = x0 - 1 + 2 * g2;
      const y2 = y0 - 1 + 2 * g2;
      const ii = i & 255;
      const jj = j & 255;
      const contribution = (px, py, gi) => {
        let attenuation = 0.5 - px * px - py * py;
        if (attenuation < 0) return 0;
        attenuation *= attenuation;
        const gradient = gradients[gi & 7];
        return attenuation * attenuation * (gradient[0] * px + gradient[1] * py);
      };
      const gi0 = permutation[ii + permutation[jj]];
      const gi1 = permutation[ii + i1 + permutation[jj + j1]];
      const gi2 = permutation[ii + 1 + permutation[jj + 1]];
      return 70 * (contribution(x0, y0, gi0) + contribution(x1, y1, gi1) + contribution(x2, y2, gi2));
    };
  }

  const noise = createNoise(42);
  const randomParticle = () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    speed: 0.4 + Math.random(),
    alpha: 0.15 + Math.random() * 0.45,
    size: 0.6 + Math.random() * 1.1
  });
  const resize = () => {
    const bounds = section.getBoundingClientRect();
    width = Math.max(1, bounds.width);
    height = Math.max(1, bounds.height);
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.min(1800, Math.max(450, Math.round(width * height / 450)));
    particles = Array.from({ length: count }, randomParticle);
  };

  const colorAt = (value) => {
    const position = ((value + 1) * 0.5) * (palette.length - 1);
    const index = Math.min(Math.floor(position), palette.length - 2);
    const blend = position - index;
    const a = palette[index];
    const b = palette[index + 1];
    return `rgba(${Math.round(a.r + (b.r - a.r) * blend)}, ${Math.round(a.g + (b.g - a.g) * blend)}, ${Math.round(a.b + (b.b - a.b) * blend)},`;
  };

  const draw = (timestamp) => {
    if (reducedMotion.matches || document.hidden || !nearViewport) {
      frame = 0;
      return;
    }
    const step = lastFrame ? Math.min((timestamp - lastFrame) / 16.67, 2) : 1;
    lastFrame = timestamp;
    elapsed += step;
    context.fillStyle = "rgba(17, 26, 42, 0.055)";
    context.fillRect(0, 0, width, height);
    const time = elapsed * 0.00042;
    const mouseRadius = 138;

    for (const particle of particles) {
      const nx = particle.x * 0.003;
      const ny = particle.y * 0.003;
      const angle = noise(nx + time, ny - time * 0.72) * Math.PI * 2;
      let vx = Math.cos(angle) * particle.speed * step;
      let vy = Math.sin(angle) * particle.speed * step;
      if (mouse.active) {
        const dx = particle.x - mouse.x;
        const dy = particle.y - mouse.y;
        const distance = Math.hypot(dx, dy);
        if (distance < mouseRadius && distance > 0) {
          const force = (1 - distance / mouseRadius) * 1.9 * step;
          vx += (dx / distance) * force;
          vy += (dy / distance) * force;
        }
      }
      const previousX = particle.x;
      const previousY = particle.y;
      particle.x += vx;
      particle.y += vy;
      const color = colorAt(noise(nx * 1.55 + 43, ny * 1.55 + 43));
      context.beginPath();
      context.moveTo(previousX, previousY);
      context.lineTo(particle.x, particle.y);
      context.strokeStyle = `${color} ${particle.alpha})`;
      context.lineWidth = particle.size;
      context.stroke();
      if (particle.x < -18 || particle.x > width + 18 || particle.y < -18 || particle.y > height + 18) {
        particle.x = Math.random() * width;
        particle.y = Math.random() * height;
      }
    }
    frame = window.requestAnimationFrame(draw);
  };

  const start = () => {
    if (frame || reducedMotion.matches || document.hidden || !nearViewport) return;
    lastFrame = 0;
    context.fillStyle = "#111a2a";
    context.fillRect(0, 0, width, height);
    frame = window.requestAnimationFrame(draw);
  };
  const stop = () => {
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    lastFrame = 0;
    mouse.active = false;
  };

  canvas.addEventListener("pointermove", (event) => {
    const bounds = canvas.getBoundingClientRect();
    mouse.x = event.clientX - bounds.left;
    mouse.y = event.clientY - bounds.top;
    mouse.active = true;
  }, { passive: true });
  canvas.addEventListener("pointerleave", () => { mouse.active = false; });
  window.addEventListener("resize", resize, { passive: true });
  resize();

  if ("ResizeObserver" in window) {
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(section);
  }
  if ("IntersectionObserver" in window) {
    const intersectionObserver = new IntersectionObserver((entries) => {
      nearViewport = entries.some((entry) => entry.isIntersecting);
      if (nearViewport) start();
      else stop();
    }, { rootMargin: "160px 0px", threshold: 0 });
    intersectionObserver.observe(section);
  } else {
    nearViewport = true;
  }

  reducedMotion.addEventListener("change", () => {
    if (reducedMotion.matches) { stop(); context.clearRect(0, 0, width, height); }
    else start();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else start();
  });
  window.addEventListener("pagehide", stop);
  window.addEventListener("pageshow", start);
  if (nearViewport) start();
}

installFlowFieldBackground();
function installCardRevealObserver() {
  const cards = document.querySelectorAll(".drawing-card, .project-story, .profile-detail-card");
  if (!cards.length || !("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      entry.target.classList.toggle("is-visible", entry.isIntersecting);
    });
  }, { threshold: 0.08 });

  cards.forEach((card) => {
    card.classList.add("scroll-reveal");
    const bounds = card.getBoundingClientRect();
    if (bounds.top < window.innerHeight && bounds.bottom > 0) card.classList.add("is-visible");
    observer.observe(card);
  });
  document.documentElement.classList.add("scroll-reveal-ready");
  window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
}

installCardRevealObserver();

let pdfjsPromise;
const pdfDocuments = new Map();
const pdfDialog = document.querySelector("#pdf-dialog");
const pdfCanvas = document.querySelector("#pdf-full-canvas");
const pdfContext = pdfCanvas.getContext("2d");
const pdfTitle = document.querySelector("#pdf-title");
const pdfPageStatus = document.querySelector("#pdf-page-status");
const pdfError = document.querySelector("#pdf-error");
const pdfPrevious = document.querySelector("#pdf-prev");
const pdfNext = document.querySelector("#pdf-next");
const pdfDownload = document.querySelector("#pdf-download");
let activePdf = null;
let activePage = 1;
let pdfRenderTask;

function getPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.mjs").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.worker.mjs";
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

async function getPdf(url) {
  if (!pdfDocuments.has(url)) {
    const task = getPdfJs().then((pdfjs) => pdfjs.getDocument({ url }).promise);
    pdfDocuments.set(url, task);
  }
  return pdfDocuments.get(url);
}

document.querySelectorAll(".drawing-card").forEach((card) => {
  const url = card.dataset.pdf;
  card.addEventListener("click", async () => {
    activePage = 1;
    pdfTitle.textContent = card.dataset.title;
    pdfDownload.href = url;
    pdfError.hidden = true;
    pdfCanvas.hidden = false;
    pdfDialog.showModal();
    try {
      activePdf = await getPdf(url);
      await renderActivePdfPage();
    } catch (error) {
      console.error(`Could not open PDF preview ${url}:`, error);
      pdfCanvas.hidden = true;
      pdfError.hidden = false;
      pdfPageStatus.textContent = "PREVIEW UNAVAILABLE";
      pdfPrevious.disabled = true;
      pdfNext.disabled = true;
    }
  });
});

async function renderActivePdfPage() {
  if (!activePdf) return;
  if (pdfRenderTask) {
    pdfRenderTask.cancel();
    pdfRenderTask = null;
  }
  const page = await activePdf.getPage(activePage);
  const base = page.getViewport({ scale: 1 });
  const availableWidth = Math.max(240, Math.min(pdfDialog.clientWidth - 54, 860));
  const availableHeight = Math.max(240, window.innerHeight - 185);
  const scale = Math.min(availableWidth / base.width, availableHeight / base.height, 1.8);
  const viewport = page.getViewport({ scale });
  const ratio = Math.min(window.devicePixelRatio || 1, 1.8);
  pdfCanvas.width = Math.round(viewport.width * ratio);
  pdfCanvas.height = Math.round(viewport.height * ratio);
  pdfCanvas.style.width = `${viewport.width}px`;
  pdfCanvas.style.height = `${viewport.height}px`;
  pdfRenderTask = page.render({
    canvasContext: pdfContext,
    viewport,
    transform: [ratio, 0, 0, ratio, 0, 0],
    background: "#ffffff",
  });
  await pdfRenderTask.promise;
  pdfRenderTask = null;
  pdfPageStatus.textContent = `PAGE ${activePage} / ${activePdf.numPages}`;
  pdfPrevious.disabled = activePage <= 1;
  pdfNext.disabled = activePage >= activePdf.numPages;
}

pdfPrevious.addEventListener("click", async () => {
  if (!activePdf || activePage <= 1) return;
  activePage -= 1;
  await renderActivePdfPage();
});
pdfNext.addEventListener("click", async () => {
  if (!activePdf || activePage >= activePdf.numPages) return;
  activePage += 1;
  await renderActivePdfPage();
});

document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => document.getElementById(button.dataset.closeDialog).close());
});
document.querySelectorAll("dialog").forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
});
pdfDialog.addEventListener("close", () => {
  activePdf = null;
  if (pdfRenderTask) {
    pdfRenderTask.cancel();
    pdfRenderTask = null;
  }
});

const fulcrumDialog = document.querySelector("#fulcrum-dialog");
const fulcrumFrame = fulcrumDialog.querySelector("iframe");
document.querySelector("#open-fulcrum").addEventListener("click", () => {
  if (!fulcrumFrame.src) fulcrumFrame.src = fulcrumFrame.dataset.src;
  fulcrumDialog.showModal();
});

window.addEventListener("pagehide", disposeComparison);
