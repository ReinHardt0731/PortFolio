import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

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

const landingGearCanvas = document.querySelector("#landing-gear-canvas");
const landingGearLoading = document.querySelector("#landing-gear-loading");
const landingGearLoadingText = document.querySelector("#landing-gear-loading-text");
const landingGearProgress = document.querySelector("#landing-gear-progress");
const landingGearError = document.querySelector("#landing-gear-error");
const landingGearReset = document.querySelector("#landing-gear-reset");
const landingGearDivider = document.querySelector("#landing-gear-divider");
let landingGearRenderer;
let landingGearScene;
let landingGearCamera;
let landingGearControls;
let landingGearResizeObserver;
let landingGearSavedCamera;
let landingGearSavedTarget;
let landingGearSplit = 0.5;
const landingGearMaterialStates = [];

const ANGLE_DEG = 60;
const DEFAULT_VIEW_ZOOM = 1.4;
const GANNET_COMPARISON_ZOOM = DEFAULT_VIEW_ZOOM * 2;
const COMPARISON_MARGIN = 0.06;
const COMPARISON_GAP = 0.12;
const comparisonCanvas = document.querySelector("#comparison-canvas");
const comparisonViewer = document.querySelector("#comparison-viewer");
const comparisonShell = document.querySelector(".comparison-shell");
const comparisonStatus = document.querySelector("#comparison-status");
const comparisonLoading = document.querySelector("#comparison-loading");
const comparisonLoadingText = document.querySelector("#comparison-loading-text");
const comparisonCadProgress = document.querySelector("#comparison-cad-progress");
const comparisonSimulationProgress = document.querySelector("#comparison-simulation-progress");
const comparisonError = document.querySelector("#comparison-error");
const comparisonPlay = document.querySelector("#comparison-play");
const comparisonHome = document.querySelector("#comparison-home");
const dividerElements = [document.querySelector("#divider-one"), document.querySelector("#divider-two")];

let dividerPositions = [1 / 3, 2 / 3];
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

function renderLandingGear() {
  if (landingGearRenderer && landingGearScene && landingGearCamera) {
    const size = landingGearRenderer.getSize(new THREE.Vector2());
    const width = size.x;
    const height = size.y;
    const split = Math.round(width * landingGearSplit);
    landingGearRenderer.setScissorTest(true);
    landingGearRenderer.setScissor(0, 0, split, height);
    landingGearRenderer.render(landingGearScene, landingGearCamera);
    landingGearMaterialStates.forEach((state) => { state.wire.visible = true; });
    landingGearRenderer.setScissor(split, 0, width - split, height);
    landingGearRenderer.render(landingGearScene, landingGearCamera);
    landingGearMaterialStates.forEach((state) => { state.wire.visible = false; });
    landingGearRenderer.setScissorTest(false);
  }
}

function setLandingGearSplit(value) {
  landingGearSplit = THREE.MathUtils.clamp(value, 0.2, 0.8);
  landingGearDivider.style.left = `${landingGearSplit * 100}%`;
  landingGearDivider.setAttribute("aria-valuenow", String(Math.round(landingGearSplit * 100)));
  renderLandingGear();
}

function resizeLandingGear() {
  const frame = landingGearCanvas.parentElement;
  const rect = frame.getBoundingClientRect();
  if (!rect.width || !rect.height || !landingGearRenderer) return;
  landingGearRenderer.setSize(rect.width, rect.height, false);
  landingGearCamera.aspect = rect.width / rect.height;
  landingGearCamera.updateProjectionMatrix();
  renderLandingGear();
}

async function startLandingGearViewer() {
  try {
    landingGearRenderer = new THREE.WebGLRenderer({
      canvas: landingGearCanvas,
      alpha: false,
      antialias: !isMobileViewport,
      powerPreference: "high-performance",
    });
    landingGearRenderer.setPixelRatio(renderPixelRatio);
    landingGearRenderer.outputColorSpace = THREE.SRGBColorSpace;
    landingGearRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    landingGearRenderer.toneMappingExposure = 1.1;
    landingGearRenderer.setClearColor(backgroundColor, 1);

    landingGearScene = new THREE.Scene();
    landingGearScene.background = backgroundColor;
    landingGearScene.add(new THREE.HemisphereLight(0xe2eeff, 0x29354a, 2.1));
    const key = new THREE.DirectionalLight(0xfff2d7, 3.2);
    key.position.set(4, 7, 5);
    landingGearScene.add(key);
    const rim = new THREE.DirectionalLight(0x85baff, 2.2);
    rim.position.set(-5, 2, -4);
    landingGearScene.add(rim);

    landingGearCamera = new THREE.PerspectiveCamera(35, 1, 0.01, 5000);
    landingGearControls = new OrbitControls(landingGearCamera, landingGearCanvas);
    landingGearControls.enableDamping = false;
    landingGearControls.enablePan = true;
    landingGearControls.screenSpacePanning = true;
    landingGearControls.addEventListener("change", renderLandingGear);
    let draggingDivider = false;
    const moveDivider = (event) => {
      const rect = landingGearCanvas.getBoundingClientRect();
      if (rect.width) setLandingGearSplit((event.clientX - rect.left) / rect.width);
    };
    landingGearDivider.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      draggingDivider = true;
      landingGearDivider.setPointerCapture(event.pointerId);
      moveDivider(event);
    });
    landingGearDivider.addEventListener("pointermove", (event) => {
      if (draggingDivider) moveDivider(event);
    });
    const finishDivider = () => { draggingDivider = false; };
    landingGearDivider.addEventListener("pointerup", finishDivider);
    landingGearDivider.addEventListener("pointercancel", finishDivider);
    landingGearDivider.addEventListener("keydown", (event) => {
      const step = event.shiftKey ? 0.05 : 0.015;
      if (event.key === "ArrowLeft" || event.key === "ArrowDown") { event.preventDefault(); setLandingGearSplit(landingGearSplit - step); }
      if (event.key === "ArrowRight" || event.key === "ArrowUp") { event.preventDefault(); setLandingGearSplit(landingGearSplit + step); }
      if (event.key === "Home") { event.preventDefault(); setLandingGearSplit(0.2); }
      if (event.key === "End") { event.preventDefault(); setLandingGearSplit(0.8); }
    });
    landingGearReset.addEventListener("click", () => {
      if (!landingGearSavedCamera || !landingGearSavedTarget) return;
      landingGearCamera.position.copy(landingGearSavedCamera);
      landingGearControls.target.copy(landingGearSavedTarget);
      landingGearControls.update();
    });

    landingGearResizeObserver = new ResizeObserver(resizeLandingGear);
    landingGearResizeObserver.observe(landingGearCanvas.parentElement);
    resizeLandingGear();

    const gltf = await createGLTFLoader().loadAsync("./assets/Landing_Gear.glb", (event) => {
      if (event.lengthComputable && event.total > 0) {
        const status = `Loading landing gear model… ${Math.round((event.loaded / event.total) * 100)}%`;
        landingGearLoadingText.textContent = status;
        updateLoadingProgress(landingGearProgress, status);
      }
    });
    const modelRoot = new THREE.Group();
    modelRoot.add(gltf.scene);
    modelRoot.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(modelRoot);
    const center = bounds.getCenter(new THREE.Vector3());
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    modelRoot.position.sub(center);
    const gearMeshes = [];
    modelRoot.traverse((object) => { if (object.isMesh) gearMeshes.push(object); });
    gearMeshes.forEach((object) => {
      const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
      const wireMaterials = sourceMaterials.map((material) => new THREE.MeshBasicMaterial({
        color: material?.metalness >= 0.25 ? 0x101318 : 0xd3ef66,
        wireframe: true,
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }));
      const wire = new THREE.Mesh(object.geometry, Array.isArray(object.material) ? wireMaterials : wireMaterials[0]);
      wire.visible = false;
      wire.renderOrder = object.renderOrder + 1;
      object.add(wire);
      landingGearMaterialStates.push({ wire });
    });
    landingGearScene.add(modelRoot);

    const radius = Math.max(sphere.radius, 0.1);
    const direction = new THREE.Vector3(3.2, 1.1, 0.8).normalize();
    const distance = (radius / Math.sin(THREE.MathUtils.degToRad(landingGearCamera.fov * 0.5))) * 1.08 / DEFAULT_VIEW_ZOOM;
    landingGearCamera.position.copy(direction.multiplyScalar(distance));
    landingGearCamera.near = Math.max(radius / 100, 0.01);
    landingGearCamera.far = radius * 30;
    landingGearCamera.updateProjectionMatrix();
    landingGearControls.target.set(0, 0, 0);
    landingGearControls.minDistance = radius * 0.8;
    landingGearControls.maxDistance = radius * 8;
    landingGearSavedCamera = landingGearCamera.position.clone();
    landingGearSavedTarget = landingGearControls.target.clone();
    landingGearControls.update();
    landingGearLoading.hidden = true;
    renderLandingGear();
  } catch (error) {
    console.error("Landing gear preview unavailable:", error);
    landingGearLoading.hidden = true;
    landingGearError.hidden = false;
    landingGearReset.disabled = true;
  }
}

function setComparisonStatus(message) {
  comparisonStatus.textContent = message.toUpperCase();
}

function setComparisonError(error, message) {
  console.error("Three-way comparison unavailable:", error);
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
  dividerPositions[0] = THREE.MathUtils.clamp(dividerPositions[0], limits.min, Math.min(limits.max, dividerPositions[1] - COMPARISON_GAP));
  dividerPositions[1] = THREE.MathUtils.clamp(dividerPositions[1], Math.max(limits.min, dividerPositions[0] + COMPARISON_GAP), limits.max);

  dividerElements.forEach((element, index) => {
    const value = dividerPositions[index];
    const min = index === 0 ? limits.min : Math.max(limits.min, dividerPositions[0] + COMPARISON_GAP);
    const max = index === 0 ? Math.min(limits.max, dividerPositions[1] - COMPARISON_GAP) : limits.max;
    element.style.left = `${value * 100}%`;
    element.setAttribute("aria-valuemin", String(Math.round(min * 100)));
    element.setAttribute("aria-valuemax", String(Math.round(max * 100)));
    element.setAttribute("aria-valuenow", String(Math.round(value * 100)));
  });
}

function moveDivider(index, nextPosition) {
  const limits = getDividerLimits();
  if (index === 0) {
    dividerPositions[0] = THREE.MathUtils.clamp(nextPosition, limits.min, dividerPositions[1] - COMPARISON_GAP);
  } else {
    dividerPositions[1] = THREE.MathUtils.clamp(nextPosition, dividerPositions[0] + COMPARISON_GAP, limits.max);
  }
  syncDividerUI();
  scheduleComparisonFrame();
}

function installDividerControls() {
  comparisonViewer.style.setProperty("--divider-rotation", `${ANGLE_DEG - 90}deg`);
  dividerElements.forEach((element, index) => {
    let activePointer = null;
    const updateFromPointer = (event) => {
      const rect = comparisonViewer.getBoundingClientRect();
      if (rect.width > 0) moveDivider(index, (event.clientX - rect.left) / rect.width);
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
      const min = index === 0 ? limits.min : dividerPositions[0] + COMPARISON_GAP;
      const max = index === 0 ? dividerPositions[1] - COMPARISON_GAP : limits.max;
      const step = event.shiftKey ? 0.05 : 0.015;
      if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
        event.preventDefault();
        moveDivider(index, dividerPositions[index] - step);
      } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
        event.preventDefault();
        moveDivider(index, dividerPositions[index] + step);
      } else if (event.key === "Home") {
        event.preventDefault();
        moveDivider(index, min);
      } else if (event.key === "End") {
        event.preventDefault();
        moveDivider(index, max);
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
  renderTargets = [0, 1, 2].map(() => {
    const target = new THREE.WebGLRenderTarget(1, 1, targetOptions);
    target.texture.colorSpace = THREE.LinearSRGBColorSpace;
    target.texture.generateMipmaps = false;
    return target;
  });

  const compositeMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uShaded: { value: renderTargets[0].texture },
      uMesh: { value: renderTargets[1].texture },
      uSimulation: { value: renderTargets[2].texture },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uDividerOne: { value: dividerPositions[0] },
      uDividerTwo: { value: dividerPositions[1] },
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
      uniform sampler2D uShaded;
      uniform sampler2D uMesh;
      uniform sampler2D uSimulation;
      uniform vec2 uResolution;
      uniform float uDividerOne;
      uniform float uDividerTwo;
      uniform float uAngle;
      varying vec2 vUv;
      void main() {
        float shift = (0.5 - vUv.y) * (uResolution.y / uResolution.x) / tan(uAngle);
        float splitOne = uDividerOne + shift;
        float splitTwo = uDividerTwo + shift;
        float edge = 1.0 / uResolution.x;
        float toMesh = smoothstep(splitOne - edge, splitOne + edge, vUv.x);
        float toSimulation = smoothstep(splitTwo - edge, splitTwo + edge, vUv.x);
        vec4 color = mix(texture2D(uShaded, vUv), texture2D(uMesh, vUv), toMesh);
        color = mix(color, texture2D(uSimulation, vUv), toSimulation);
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
  state.compositeMaterial.uniforms.uDividerOne.value = dividerPositions[0];
  state.compositeMaterial.uniforms.uDividerTwo.value = dividerPositions[1];
  state.compositeMaterial.uniforms.uAngle.value = THREE.MathUtils.degToRad(ANGLE_DEG);

  baseModel.visible = true;
  simulationModel.visible = false;
  restoreBaseMaterials();
  renderer.setRenderTarget(renderTargets[0]);
  renderer.clear(true, true, true);
  renderer.render(state.scene, camera);

  renderer.setRenderTarget(renderTargets[1]);
  renderer.clear(true, true, true);
  setBaseMaterialMode("flat");
  renderer.render(state.scene, camera);
  setBaseMaterialMode("wire");
  renderer.autoClear = false;
  renderer.render(state.scene, camera);
  renderer.autoClear = true;
  restoreBaseMaterials();

  baseModel.visible = false;
  simulationModel.visible = true;
  renderer.setRenderTarget(renderTargets[2]);
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
    const modelProgress = { CAD: "queued", simulation: "queued" };
    const updateModelProgress = (label, status) => {
      modelProgress[label] = status;
      comparisonLoadingText.textContent = `CAD ${modelProgress.CAD}  /  SIMULATION ${modelProgress.simulation}`;
      updateLoadingProgress(label === "CAD" ? comparisonCadProgress : comparisonSimulationProgress, status);
    };
    updateModelProgress("CAD", "queued");
    updateModelProgress("simulation", "queued");

    const [baseGltf, simulationGltf] = await Promise.all([
      loadGltf(loader, "./assets/gannet.glb", "CAD", updateModelProgress),
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
    setComparisonStatus("ALL THREE VIEWS READY");
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
  landingGearResizeObserver?.disconnect();
  landingGearControls?.dispose();
  landingGearRenderer?.dispose();
  controls?.dispose();
  renderer?.dispose();
  renderTargets.forEach((target) => target.dispose());
}

startLandingGearViewer();
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

  const state = { renderer, scene, camera, controls, viewer, ready: false, roots: [], savedCamera: null, savedTarget: null, resizeObserver: null };
  controls.addEventListener("change", () => render(state));
  const resize = () => {
    const rect = viewer.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
    if (state.ready) render(state);
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

function fitProjectModels(state, models, zoom = 1) {
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
  const direction = new THREE.Vector3(-2.8, 1.25, 2.7).normalize();
  state.camera.position.copy(direction.multiplyScalar(distance));
  state.camera.near = Math.max(radius / 1000, 0.01);
  state.camera.far = radius * 30;
  state.camera.updateProjectionMatrix();
  state.controls.target.set(0, 0, 0);
  state.controls.minDistance = radius * 0.75;
  state.controls.maxDistance = radius * 8;
  state.savedCamera = state.camera.position.clone();
  state.savedTarget = state.controls.target.clone();
  state.controls.update();
}

function fitProjectModelToViewport(state, model, screenFraction = 0.58) {
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
  state.camera.position.copy(center).addScaledVector(direction, distance);
  state.camera.near = Math.max(radius / 1000, 0.01);
  state.camera.far = Math.max(radius * 30, distance + radius * 2);
  state.camera.updateProjectionMatrix();
  state.controls.target.copy(center);
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
  button.textContent = aircraftAnimationPaused ? "PLAY ANIMATION  ▶" : "PAUSE ANIMATION  ‖";
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
    fitProjectModels(state, state.roots, 3);
    state.ready = true;
    loading.hidden = true;
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

observeProjectViewer(document.querySelector("#propeller-viewer"), startPropellerViewer);
observeProjectViewer(document.querySelector("#uav-viewer"), startUavViewer);
observeAircraftViewer(document.querySelector("#aircraft-stage"));
window.addEventListener("pagehide", disposeProjectViewers);

function installCardRevealObserver() {
  const cards = document.querySelectorAll(".drawing-card, .software-card, .project-story");
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
