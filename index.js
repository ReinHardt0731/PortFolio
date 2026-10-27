import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const landingGearCanvas = document.querySelector("#landing-gear-canvas");
const landingGearLoading = document.querySelector("#landing-gear-loading");
const landingGearError = document.querySelector("#landing-gear-error");
const landingGearReset = document.querySelector("#landing-gear-reset");
let landingGearRenderer;
let landingGearScene;
let landingGearCamera;
let landingGearControls;
let landingGearResizeObserver;
let landingGearSavedCamera;
let landingGearSavedTarget;

const ANGLE_DEG = 60;
const DEFAULT_VIEW_ZOOM = 1.4;
const COMPARISON_MARGIN = 0.06;
const COMPARISON_GAP = 0.12;
const comparisonCanvas = document.querySelector("#comparison-canvas");
const comparisonViewer = document.querySelector("#comparison-viewer");
const comparisonShell = document.querySelector(".comparison-shell");
const comparisonStatus = document.querySelector("#comparison-status");
const comparisonLoading = document.querySelector("#comparison-loading");
const comparisonLoadingText = document.querySelector("#comparison-loading-text");
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
let animationTime = 0;
let frameRequest;
let savedCamera;
let savedTarget;
let resizeObserver;
let intersectionObserver;
let renderTargets = [];
let comparisonStarted = false;
let comparisonReady = false;
const baseMaterialStates = [];
const clock = new THREE.Clock();
const drawingBufferSize = new THREE.Vector2();
const backgroundColor = new THREE.Color(0x17263b);

function renderLandingGear() {
  if (landingGearRenderer && landingGearScene && landingGearCamera) {
    landingGearRenderer.render(landingGearScene, landingGearCamera);
  }
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
      antialias: true,
      powerPreference: "high-performance",
    });
    landingGearRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
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
    landingGearReset.addEventListener("click", () => {
      if (!landingGearSavedCamera || !landingGearSavedTarget) return;
      landingGearCamera.position.copy(landingGearSavedCamera);
      landingGearControls.target.copy(landingGearSavedTarget);
      landingGearControls.update();
    });

    landingGearResizeObserver = new ResizeObserver(resizeLandingGear);
    landingGearResizeObserver.observe(landingGearCanvas.parentElement);
    resizeLandingGear();

    const gltf = await new GLTFLoader().loadAsync("./assets/Landing_Gear.glb", (event) => {
      if (event.lengthComputable && event.total > 0) {
        landingGearLoading.textContent = `Loading landing gear model… ${Math.round((event.loaded / event.total) * 100)}%`;
      }
    });
    const modelRoot = new THREE.Group();
    modelRoot.add(gltf.scene);
    modelRoot.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(modelRoot);
    const center = bounds.getCenter(new THREE.Vector3());
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    modelRoot.position.sub(center);
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
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.4));
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

function loadGltf(loader, url, label) {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, (event) => {
      if (event.lengthComputable && event.total > 0) {
        const percent = Math.round((event.loaded / event.total) * 100);
        comparisonLoadingText.textContent = `Loading ${label} model… ${percent}%`;
      } else {
        comparisonLoadingText.textContent = `Loading ${label} model…`;
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
  const distance = (radius / Math.sin(THREE.MathUtils.degToRad(cameraTarget.fov * 0.5))) * 1.08 / DEFAULT_VIEW_ZOOM;
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

function startRenderLoop(state) {
  const frame = () => {
    frameRequest = requestAnimationFrame(frame);
    const delta = Math.min(clock.getDelta(), 0.05);
    controls.update();
    if (animationPlaying) {
      animationTime += delta;
      baseMixer?.setTime(animationTime);
      simulationMixer?.setTime(animationTime);
    }
    renderComparison(state);
  };
  frameRequest = requestAnimationFrame(frame);
}

async function startComparison() {
  if (comparisonStarted) return;
  comparisonStarted = true;
  try {
    comparisonState = createComparisonRenderer();
    const loader = new GLTFLoader();
    setComparisonStatus("LOADING MODELS");
    comparisonLoading.hidden = false;
    comparisonError.hidden = true;
    comparisonLoadingText.textContent = "Loading matched CAD and simulation models…";

    const [baseGltf, simulationGltf] = await Promise.all([
      loadGltf(loader, "./assets/gannet.glb", "CAD"),
      loadGltf(loader, "./assets/gannet_simulation.glb", "simulation"),
    ]);
    baseModel = baseGltf.scene;
    simulationModel = simulationGltf.scene;
    comparisonState.scene.add(baseModel, simulationModel);
    fitSharedCamera(baseModel, simulationModel, camera);
    createMaterialVariants(baseModel);
    configureSynchronizedAnimation(baseGltf, simulationGltf);
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
  animationPlaying = !animationPlaying;
  baseAction.paused = !animationPlaying;
  simulationAction.paused = !animationPlaying;
  comparisonPlay.textContent = animationPlaying ? "Ⅱ" : "▶";
  comparisonPlay.setAttribute("aria-label", animationPlaying ? "Pause synchronized propeller animation" : "Play synchronized propeller animation");
  comparisonPlay.title = animationPlaying ? "Pause animation" : "Play animation";
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
} else {
  startComparison();
}

comparisonPlay.addEventListener("click", toggleComparisonAnimation);
comparisonHome.addEventListener("click", resetComparisonCamera);
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
