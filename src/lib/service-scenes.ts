import * as THREE from "three";

type SceneKind =
  | "setup"
  | "printer"
  | "sync"
  | "rates"
  | "network"
  | "automation";

type PacketFlow = {
  update: (time: number, activity: number) => void;
};

type SceneController = {
  root: THREE.Group;
  update: (time: number, activity: number, reducedMotion: boolean) => void;
};

type SceneContext = {
  colors: typeof palette;
};

const palette = {
  federalBlue: 0x002868,
  postalNavy: 0x0a1628,
  envelopeTan: 0xc4a46c,
  cardboardBrown: 0x8b6f47,
  cautionYellow: 0xffb800,
  safetyOrange: 0xe8600a,
  paperWhite: 0xf5f3ed,
  pureWhite: 0xffffff,
  formGray: 0xd1cec6,
};

const sceneFactories: Record<
  SceneKind,
  (context: SceneContext) => SceneController
> = {
  setup: createSetupScene,
  printer: createPrinterScene,
  sync: createSyncScene,
  rates: createRatesScene,
  network: createNetworkScene,
  automation: createAutomationScene,
};

let serviceSceneDefined = false;

export function defineServiceSceneElement() {
  if (
    serviceSceneDefined ||
    typeof window === "undefined" ||
    customElements.get("service-scene")
  ) {
    serviceSceneDefined = true;
    return;
  }

  class ServiceSceneElement extends HTMLElement {
    private cleanup?: () => void;
    private hovered = false;

    connectedCallback() {
      if (this.cleanup) {
        return;
      }

      const sceneName = this.dataset.scene as SceneKind | undefined;
      const canvas = this.querySelector("canvas");

      if (!sceneName || !canvas || !(sceneName in sceneFactories)) {
        return;
      }

      this.cleanup = mountScene(this, canvas, sceneName);

      const activate = () => {
        this.hovered = true;
        this.dataset.active = "true";
      };

      const deactivate = () => {
        this.hovered = false;
        this.dataset.active = "false";
      };

      this.addEventListener("pointerenter", activate);
      this.addEventListener("pointerleave", deactivate);
      this.addEventListener("focusin", activate);
      this.addEventListener("focusout", deactivate);

      const release = this.cleanup;
      this.cleanup = () => {
        this.removeEventListener("pointerenter", activate);
        this.removeEventListener("pointerleave", deactivate);
        this.removeEventListener("focusin", activate);
        this.removeEventListener("focusout", deactivate);
        release();
      };
    }

    disconnectedCallback() {
      this.cleanup?.();
      this.cleanup = undefined;
    }
  }

  customElements.define("service-scene", ServiceSceneElement);
  serviceSceneDefined = true;
}

function mountScene(
  host: HTMLElement,
  canvas: HTMLCanvasElement,
  sceneName: SceneKind,
) {
  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  const coarsePointer = window.matchMedia("(pointer: coarse)");
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: !prefersReducedMotion.matches,
    powerPreference: "high-performance",
  });

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(palette.paperWhite, 9, 17);

  const camera = new THREE.PerspectiveCamera(32, 2, 0.1, 40);
  camera.position.set(0, 3.25, 10.8);
  camera.lookAt(0, 0.8, 0);

  const root = new THREE.Group();
  root.rotation.x = -0.14;
  root.position.y = -0.2;
  scene.add(root);

  addLights(scene);
  addStage(root);

  const controller = sceneFactories[sceneName]({ colors: palette });
  root.add(controller.root);

  let visible = true;
  let frameId = 0;
  let disposed = false;
  let reducedMotion = prefersReducedMotion.matches;
  let currentWidth = 0;
  let currentHeight = 0;

  const resize = () => {
    const bounds = host.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));

    if (width === currentWidth && height === currentHeight) {
      return;
    }

    currentWidth = width;
    currentHeight = height;

    const maxPixelRatio = coarsePointer.matches ? 1.1 : 1.5;
    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, maxPixelRatio),
    );
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  const renderFrame = (time: number) => {
    frameId = 0;

    if (disposed) {
      return;
    }

    if (!visible || document.hidden) {
      return;
    }

    const activity =
      host.matches(":hover") || host.dataset.active === "true" ? 1 : 0.45;
    controller.update(time * 0.001, activity, reducedMotion);
    renderer.render(scene, camera);

    if (!reducedMotion) {
      frameId = window.requestAnimationFrame(renderFrame);
    }
  };

  const ensureFrame = () => {
    resize();

    if (reducedMotion) {
      controller.update(0, 0.35, true);
      renderer.render(scene, camera);
      return;
    }

    if (!frameId && visible && !document.hidden) {
      frameId = window.requestAnimationFrame(renderFrame);
    }
  };

  const intersectionObserver = new IntersectionObserver(
    (entries) => {
      visible = entries[0]?.isIntersecting ?? true;
      ensureFrame();
    },
    { threshold: 0.2 },
  );

  intersectionObserver.observe(host);

  const resizeObserver = new ResizeObserver(() => {
    ensureFrame();
  });

  resizeObserver.observe(host);

  const handleVisibility = () => {
    ensureFrame();
  };

  const handleMotionChange = (event: MediaQueryListEvent) => {
    reducedMotion = event.matches;
    ensureFrame();
  };

  document.addEventListener("visibilitychange", handleVisibility);
  prefersReducedMotion.addEventListener("change", handleMotionChange);

  ensureFrame();

  return () => {
    disposed = true;

    if (frameId) {
      window.cancelAnimationFrame(frameId);
    }

    intersectionObserver.disconnect();
    resizeObserver.disconnect();
    document.removeEventListener("visibilitychange", handleVisibility);
    prefersReducedMotion.removeEventListener("change", handleMotionChange);

    root.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.geometry.dispose();

        if (Array.isArray(node.material)) {
          node.material.forEach((material) => material.dispose());
        } else {
          node.material.dispose();
        }
      }

      if (node instanceof THREE.Line || node instanceof THREE.LineSegments) {
        node.geometry.dispose();

        if (Array.isArray(node.material)) {
          node.material.forEach((material) => material.dispose());
        } else {
          node.material.dispose();
        }
      }
    });

    renderer.dispose();
  };
}

function addLights(scene: THREE.Scene) {
  const ambient = new THREE.AmbientLight(0xffffff, 1.9);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xffffff, 3.4);
  keyLight.position.set(4.8, 8.2, 6.2);
  scene.add(keyLight);

  const fillLight = new THREE.PointLight(palette.cautionYellow, 18, 18, 2);
  fillLight.position.set(-5, 4.5, 5.6);
  scene.add(fillLight);

  const rimLight = new THREE.PointLight(palette.federalBlue, 24, 26, 2);
  rimLight.position.set(5.5, 2.8, -4.5);
  scene.add(rimLight);
}

function addStage(parent: THREE.Group) {
  const floor = box(10.8, 0.34, 4.9, palette.postalNavy, {
    x: 0,
    y: -0.22,
    z: 0,
  });
  parent.add(floor);

  const deck = box(
    9.6,
    0.06,
    4.1,
    palette.paperWhite,
    { x: 0, y: 0, z: 0.12 },
    0.08,
    0.96,
  );
  parent.add(deck);

  const backPanel = box(
    10.1,
    2.8,
    0.22,
    palette.pureWhite,
    { x: 0, y: 1.2, z: -1.95 },
    0.04,
    0.92,
  );
  backPanel.material = new THREE.MeshStandardMaterial({
    color: palette.pureWhite,
    metalness: 0.04,
    roughness: 0.86,
    transparent: true,
    opacity: 0.5,
  });
  parent.add(backPanel);

  const frame = createRoundedFrame();
  frame.position.set(0, 1.12, -1.72);
  parent.add(frame);

  const rings = createBackdropRings();
  rings.position.set(3.15, 1.55, -1.6);
  parent.add(rings);

  for (let index = 0; index < 7; index += 1) {
    const stripe = box(
      0.1,
      0.02,
      4.1,
      palette.formGray,
      { x: -3.6 + index * 1.2, y: 0.05, z: 0.12 },
      0,
      1,
    );
    parent.add(stripe);
  }
}

function createRoundedFrame() {
  const points = [
    new THREE.Vector3(-4.6, -0.85, 0),
    new THREE.Vector3(4.6, -0.85, 0),
    new THREE.Vector3(4.6, 1.38, 0),
    new THREE.Vector3(-4.6, 1.38, 0),
    new THREE.Vector3(-4.6, -0.85, 0),
  ];

  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const line = new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({
      color: palette.envelopeTan,
      transparent: true,
      opacity: 0.28,
    }),
  );

  return line;
}

function createBackdropRings() {
  const group = new THREE.Group();

  for (let index = 0; index < 3; index += 1) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.72 + index * 0.22, 0.018, 12, 72),
      new THREE.MeshBasicMaterial({
        color: index === 1 ? palette.cautionYellow : palette.envelopeTan,
        transparent: true,
        opacity: index === 1 ? 0.24 : 0.14,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.rotation.y = 0.25;
    ring.position.z = index * 0.02;
    group.add(ring);
  }

  return group;
}

/* ── Blueprint palette (setup scene only) ─────────────────────────── */

const bp = {
  cyan: 0x38bdf8,
  deepNavy: 0x071a2e,
  midBlue: 0x0c2d48,
  bodyOpacity: 0.68,
  edgeOpacity: 0.78,
  gridMajor: 0.22,
  gridMinor: 0.08,
};

function blueprintBox(
  w: number,
  h: number,
  d: number,
  position: { x: number; y: number; z: number },
  edgeColor = bp.cyan,
  bodyColor = bp.midBlue,
  bodyOpacity = bp.bodyOpacity,
  edgeOpacity = bp.edgeOpacity,
) {
  const group = new THREE.Group();
  const geo = new THREE.BoxGeometry(w, h, d);

  const body = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      color: bodyColor,
      metalness: 0.05,
      roughness: 0.85,
      transparent: true,
      opacity: bodyOpacity,
    }),
  );
  group.add(body);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({
      color: edgeColor,
      transparent: true,
      opacity: edgeOpacity,
    }),
  );
  group.add(edges);

  group.position.set(position.x, position.y, position.z);
  (group as any).__bpEdges = edges;
  return group;
}

function blueprintCylinder(
  rTop: number,
  rBottom: number,
  h: number,
  position: { x: number; y: number; z: number },
  edgeColor = bp.cyan,
  bodyColor = bp.midBlue,
  bodyOpacity = bp.bodyOpacity,
  edgeOpacity = bp.edgeOpacity,
  segments = 24,
) {
  const group = new THREE.Group();
  const geo = new THREE.CylinderGeometry(rTop, rBottom, h, segments);

  const body = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      color: bodyColor,
      metalness: 0.05,
      roughness: 0.85,
      transparent: true,
      opacity: bodyOpacity,
    }),
  );
  group.add(body);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo, 15),
    new THREE.LineBasicMaterial({
      color: edgeColor,
      transparent: true,
      opacity: edgeOpacity,
    }),
  );
  group.add(edges);

  group.position.set(position.x, position.y, position.z);
  (group as any).__bpEdges = edges;
  return group;
}

function blueprintGridPlane(
  size: number,
  divisions: number,
  position: { x: number; y: number; z: number },
  rotation?: { x?: number; y?: number; z?: number },
) {
  const group = new THREE.Group();

  const majorGrid = new THREE.GridHelper(size, divisions, bp.cyan, bp.cyan);
  const minorGrid = new THREE.GridHelper(size, divisions * 4, bp.cyan, bp.cyan);

  (majorGrid.material as THREE.Material).transparent = true;
  (majorGrid.material as THREE.Material).opacity = bp.gridMajor;
  (minorGrid.material as THREE.Material).transparent = true;
  (minorGrid.material as THREE.Material).opacity = bp.gridMinor;

  group.add(majorGrid);
  group.add(minorGrid);
  group.position.set(position.x, position.y, position.z);

  if (rotation) {
    group.rotation.set(rotation.x ?? 0, rotation.y ?? 0, rotation.z ?? 0);
  }

  return group;
}

function collectBlueprintEdges(root: THREE.Group): THREE.LineSegments[] {
  const edges: THREE.LineSegments[] = [];
  root.traverse((node) => {
    if ((node as any).__bpEdges) {
      edges.push((node as any).__bpEdges as THREE.LineSegments);
    }
  });
  return edges;
}

/* ── Setup scene ──────────────────────────────────────────────────── */

function createSetupScene({ colors }: SceneContext): SceneController {
  const root = new THREE.Group();
  const pendulumLights: THREE.Group[] = [];
  const conveyorPackages: THREE.Group[] = [];
  const conveyorRollers: THREE.Group[] = [];
  const labelCards: THREE.Group[] = [];
  const panels: THREE.Group[] = [];

  /* ── Phase 1: Blueprint environment ───────────────────────────── */

  // Dark background plane
  const bgPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 8),
    new THREE.MeshBasicMaterial({
      color: bp.deepNavy,
      side: THREE.DoubleSide,
    }),
  );
  bgPlane.position.set(0, 1.5, -2.4);
  root.add(bgPlane);

  // Blueprint grid — floor
  const floorGrid = blueprintGridPlane(12, 12, { x: 0, y: 0.06, z: 0 });
  root.add(floorGrid);

  // Blueprint grid — back wall
  const wallGrid = blueprintGridPlane(
    8,
    10,
    { x: 0, y: 2.0, z: -1.85 },
    { x: Math.PI / 2, y: 0, z: 0 },
  );
  root.add(wallGrid);

  // Setup-specific cyan wash light
  const cyanWash = new THREE.PointLight(bp.cyan, 3, 14, 2);
  cyanWash.position.set(0, 4.5, 5);
  root.add(cyanWash);

  // Dim warm fill for package readability
  const warmFill = new THREE.PointLight(0xf0a830, 1.8, 10, 2);
  warmFill.position.set(-2, 3, 3);
  root.add(warmFill);

  /* ── Phase 2: Warehouse structure ─────────────────────────────── */

  // Ceiling
  const ceiling = blueprintBox(
    11,
    0.08,
    5,
    { x: 0, y: 3.3, z: 0 },
    bp.cyan,
    bp.deepNavy,
    0.3,
    0.45,
  );
  root.add(ceiling);

  // Rafters (3 horizontal beams)
  for (let i = 0; i < 3; i += 1) {
    const rafter = blueprintBox(
      10.5,
      0.14,
      0.22,
      { x: 0, y: 3.1, z: -1.4 + i * 1.4 },
      bp.cyan,
      bp.midBlue,
      0.5,
      0.65,
    );
    root.add(rafter);
  }

  // Cross beams between rafters
  for (let i = 0; i < 5; i += 1) {
    const cross = blueprintBox(
      0.1,
      0.08,
      2.8,
      { x: -4.2 + i * 2.1, y: 3.05, z: 0 },
      bp.cyan,
      bp.midBlue,
      0.35,
      0.45,
    );
    root.add(cross);
  }

  // Vertical support columns (4)
  const columnXPositions = [-4.2, -1.4, 1.4, 4.2];
  for (const cx of columnXPositions) {
    const col = blueprintBox(
      0.22,
      3.1,
      0.22,
      { x: cx, y: 1.55, z: -1.7 },
      bp.cyan,
      bp.midBlue,
      0.45,
      0.6,
    );
    root.add(col);
  }

  // Hanging pendant lights (4)
  const lightXPositions = [-3.2, -1.0, 1.2, 3.5];
  for (const lx of lightXPositions) {
    const pendant = new THREE.Group();

    // Rod
    const rod = blueprintCylinder(
      0.015,
      0.015,
      0.7,
      { x: 0, y: -0.35, z: 0 },
      bp.cyan,
      bp.midBlue,
      0.4,
      0.55,
      8,
    );
    pendant.add(rod);

    // Shade
    const shade = blueprintCylinder(
      0.06,
      0.22,
      0.18,
      { x: 0, y: -0.78, z: 0 },
      bp.cyan,
      bp.midBlue,
      0.55,
      0.7,
      12,
    );
    pendant.add(shade);

    // Warm glow point light
    const bulb = new THREE.PointLight(0xf5be58, 2.4, 4.5, 2);
    bulb.position.set(0, -0.88, 0);
    pendant.add(bulb);

    // Small emissive bulb mesh
    const bulbMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 8, 8),
      new THREE.MeshStandardMaterial({
        color: 0xf5be58,
        emissive: 0xf5be58,
        emissiveIntensity: 1.2,
      }),
    );
    bulbMesh.position.set(0, -0.85, 0);
    pendant.add(bulbMesh);

    pendant.position.set(lx, 3.3, -0.4);
    pendulumLights.push(pendant);
    root.add(pendant);
  }

  // Left shelving unit
  const leftShelf = new THREE.Group();
  leftShelf.position.set(-3.8, 0, -1.3);

  // Shelf vertical struts
  for (const sx of [-0.7, 0.7]) {
    const strut = blueprintBox(
      0.06,
      2.3,
      0.06,
      { x: sx, y: 1.15, z: 0 },
      bp.cyan,
      bp.midBlue,
      0.4,
      0.55,
    );
    leftShelf.add(strut);
  }

  // Shelf planes (3 tiers)
  const shelfHeights = [0.55, 1.2, 1.85];
  for (const sy of shelfHeights) {
    const shelf = blueprintBox(
      1.5,
      0.05,
      0.55,
      { x: 0, y: sy, z: 0 },
      bp.cyan,
      bp.midBlue,
      0.5,
      0.6,
    );
    leftShelf.add(shelf);
  }

  // Small boxes on left shelves
  const shelfBoxConfigs = [
    { w: 0.22, h: 0.2, d: 0.2, x: -0.3, sy: 0.55 },
    { w: 0.3, h: 0.15, d: 0.25, x: 0.15, sy: 0.55 },
    { w: 0.18, h: 0.25, d: 0.18, x: -0.4, sy: 1.2 },
    { w: 0.35, h: 0.12, d: 0.3, x: 0.1, sy: 1.2 },
    { w: 0.2, h: 0.18, d: 0.2, x: 0.4, sy: 1.2 },
    { w: 0.25, h: 0.22, d: 0.22, x: -0.15, sy: 1.85 },
  ];
  for (const cfg of shelfBoxConfigs) {
    const sbox = blueprintBox(
      cfg.w,
      cfg.h,
      cfg.d,
      { x: cfg.x, y: cfg.sy + cfg.h / 2 + 0.025, z: 0 },
      bp.cyan,
      bp.midBlue,
      0.5,
      0.55,
    );
    leftShelf.add(sbox);
  }

  root.add(leftShelf);

  // Right shelving unit
  const rightShelf = new THREE.Group();
  rightShelf.position.set(3.8, 0, -1.3);

  for (const sx of [-0.6, 0.6]) {
    const strut = blueprintBox(
      0.06,
      1.8,
      0.06,
      { x: sx, y: 0.9, z: 0 },
      bp.cyan,
      bp.midBlue,
      0.4,
      0.55,
    );
    rightShelf.add(strut);
  }

  for (const sy of [0.55, 1.2]) {
    const shelf = blueprintBox(
      1.3,
      0.05,
      0.5,
      { x: 0, y: sy, z: 0 },
      bp.cyan,
      bp.midBlue,
      0.5,
      0.6,
    );
    rightShelf.add(shelf);
  }

  // Cylinder tubes on right shelf
  const tube1 = blueprintCylinder(
    0.06,
    0.06,
    0.5,
    { x: -0.2, y: 0.635, z: 0 },
    bp.cyan,
    bp.midBlue,
    0.45,
    0.55,
    12,
  );
  tube1.rotation.z = Math.PI / 2;
  rightShelf.add(tube1);

  const tube2 = blueprintCylinder(
    0.06,
    0.06,
    0.4,
    { x: 0.2, y: 0.635, z: 0.05 },
    bp.cyan,
    bp.midBlue,
    0.45,
    0.55,
    12,
  );
  tube2.rotation.z = Math.PI / 2;
  rightShelf.add(tube2);

  // Small crate on right shelf upper tier
  const rCrate = blueprintBox(
    0.28,
    0.2,
    0.24,
    { x: 0.1, y: 1.325, z: 0 },
    bp.cyan,
    bp.midBlue,
    0.5,
    0.55,
  );
  rightShelf.add(rCrate);

  root.add(rightShelf);

  // Back wall signage (2 placards)
  const signPositions = [
    { x: -1.4, y: 2.4 },
    { x: 1.5, y: 2.2 },
  ];
  for (const sp of signPositions) {
    const sign = blueprintBox(
      0.65,
      0.45,
      0.02,
      { x: sp.x, y: sp.y, z: -1.75 },
      0xf0a830,
      bp.midBlue,
      0.4,
      0.65,
    );
    // Emissive accent bar across the top
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.06, 0.025),
      new THREE.MeshStandardMaterial({
        color: 0xf0a830,
        emissive: 0xf0a830,
        emissiveIntensity: 0.4,
        transparent: true,
        opacity: 0.7,
      }),
    );
    bar.position.set(0, 0.15, 0.01);
    sign.add(bar);
    root.add(sign);
  }

  // Floor pallet stacks
  const palletConfigs = [
    { x: -3.6, z: 0.6 },
    { x: 3.2, z: 1.1 },
  ];
  for (const pc of palletConfigs) {
    const palletBase = blueprintBox(
      0.9,
      0.07,
      0.7,
      { x: pc.x, y: 0.04, z: pc.z },
      bp.cyan,
      bp.midBlue,
      0.4,
      0.5,
    );
    root.add(palletBase);

    // Stacked boxes on pallet
    const pBox1 = blueprintBox(
      0.7,
      0.35,
      0.55,
      { x: pc.x, y: 0.255, z: pc.z },
      bp.cyan,
      bp.midBlue,
      0.45,
      0.55,
    );
    root.add(pBox1);

    const pBox2 = blueprintBox(
      0.5,
      0.25,
      0.4,
      { x: pc.x + 0.05, y: 0.555, z: pc.z - 0.03 },
      bp.cyan,
      bp.midBlue,
      0.4,
      0.5,
    );
    root.add(pBox2);
  }

  /* ── Phase 3: Enhanced conveyor ───────────────────────────────── */

  // Main conveyor beam
  const conveyorBase = blueprintBox(
    6.2,
    0.22,
    0.88,
    { x: 0.3, y: 0.16, z: 1.58 },
    bp.cyan,
    bp.midBlue,
    0.55,
    0.7,
  );
  root.add(conveyorBase);

  // Side rails
  const sideRailZ = [1.16, 2.0];
  for (const rz of sideRailZ) {
    const rail = blueprintBox(
      6.2,
      0.1,
      0.05,
      { x: 0.3, y: 0.34, z: rz },
      bp.cyan,
      bp.midBlue,
      0.4,
      0.65,
    );
    root.add(rail);
  }

  // Support legs (4 pairs)
  for (let i = 0; i < 4; i += 1) {
    const legX = -2.2 + i * 1.65;
    for (const lz of [1.2, 1.96]) {
      const leg = blueprintBox(
        0.08,
        0.16,
        0.08,
        { x: legX, y: 0.02, z: lz },
        bp.cyan,
        bp.midBlue,
        0.35,
        0.5,
      );
      root.add(leg);
    }
  }

  // Conveyor rollers (11)
  for (let i = 0; i < 11; i += 1) {
    const roller = blueprintCylinder(
      0.04,
      0.04,
      0.75,
      { x: -2.55 + i * 0.57, y: 0.32, z: 1.58 },
      bp.cyan,
      bp.midBlue,
      0.35,
      0.55,
      12,
    );
    roller.rotation.set(0, 0, Math.PI / 2);
    conveyorRollers.push(roller);
    root.add(roller);
  }

  // Diverse conveyor packages (7)
  const packageDefs = [
    // 0: small flat envelope
    {
      w: 0.4,
      h: 0.08,
      d: 0.55,
      edge: bp.cyan,
      body: bp.midBlue,
      speed: 0.38,
      offset: 0,
      bounce: 0.005,
    },
    // 1: medium cube
    {
      w: 0.45,
      h: 0.45,
      d: 0.45,
      edge: bp.cyan,
      body: bp.midBlue,
      speed: 0.44,
      offset: 0.95,
      bounce: 0.012,
    },
    // 2: large tall box
    {
      w: 0.4,
      h: 0.68,
      d: 0.48,
      edge: 0xf0a830,
      body: 0x1a2e3a,
      speed: 0.36,
      offset: 1.9,
      bounce: 0.008,
    },
    // 3: wide short box
    {
      w: 0.72,
      h: 0.2,
      d: 0.58,
      edge: bp.cyan,
      body: bp.midBlue,
      speed: 0.48,
      offset: 2.85,
      bounce: 0.014,
    },
    // 4: cylindrical tube (handled separately)
    {
      w: 0.12,
      h: 0.12,
      d: 0.65,
      edge: 0xd4783a,
      body: 0x2a1e12,
      speed: 0.42,
      offset: 3.8,
      bounce: 0.006,
    },
    // 5: small square box
    {
      w: 0.3,
      h: 0.3,
      d: 0.3,
      edge: bp.cyan,
      body: bp.midBlue,
      speed: 0.5,
      offset: 4.65,
      bounce: 0.01,
    },
    // 6: tall narrow box
    {
      w: 0.24,
      h: 0.55,
      d: 0.24,
      edge: bp.cyan,
      body: bp.midBlue,
      speed: 0.4,
      offset: 5.5,
      bounce: 0.009,
    },
  ];

  for (let i = 0; i < packageDefs.length; i += 1) {
    const def = packageDefs[i];
    let pkg: THREE.Group;

    if (i === 4) {
      // Cylindrical poster tube
      pkg = blueprintCylinder(
        0.1,
        0.1,
        0.65,
        { x: 0, y: 0.42, z: 1.58 },
        def.edge,
        def.body,
        0.55,
        0.7,
        16,
      );
      pkg.rotation.set(0, 0, Math.PI / 2);
    } else {
      pkg = blueprintBox(
        def.w,
        def.h,
        def.d,
        { x: 0, y: 0.32 + def.h / 2, z: 1.58 },
        def.edge,
        def.body,
        0.55,
        0.7,
      );
    }

    // Tape stripe on larger boxes
    if (i === 1 || i === 2 || i === 3) {
      const tape = new THREE.Mesh(
        new THREE.BoxGeometry(def.w + 0.01, 0.015, def.d + 0.01),
        new THREE.MeshBasicMaterial({
          color: bp.cyan,
          transparent: true,
          opacity: 0.35,
        }),
      );
      if (i === 4) {
        tape.position.set(0, 0, 0);
      } else {
        tape.position.set(0, def.h / 2 + 0.005, 0);
      }
      pkg.add(tape);
    }

    // Shipping label on select boxes
    if (i === 1 || i === 3) {
      const lbl = new THREE.Mesh(
        new THREE.PlaneGeometry(0.15, 0.1),
        new THREE.MeshBasicMaterial({
          color: 0xf0a830,
          transparent: true,
          opacity: 0.55,
          side: THREE.DoubleSide,
        }),
      );
      lbl.position.set(0, 0, def.d / 2 + 0.005);
      pkg.add(lbl);
    }

    conveyorPackages.push(pkg);
    root.add(pkg);
  }

  /* ── Phase 4: Desk & workstation ──────────────────────────────── */

  const desk = blueprintBox(
    5.2,
    0.22,
    1.6,
    { x: -0.15, y: 0.46, z: 0.2 },
    bp.cyan,
    bp.midBlue,
    0.55,
    0.7,
  );
  root.add(desk);

  const tower = blueprintBox(
    0.8,
    1.36,
    0.72,
    { x: -2.85, y: 1.14, z: 0.18 },
    bp.cyan,
    bp.midBlue,
    0.5,
    0.65,
  );
  root.add(tower);

  // Monitor
  const monitorStand = blueprintBox(
    0.12,
    0.38,
    0.12,
    { x: -0.9, y: 0.78, z: -0.15 },
    bp.cyan,
    bp.midBlue,
    0.4,
    0.6,
  );
  root.add(monitorStand);

  const monitorScreen = blueprintBox(
    1.3,
    0.85,
    0.06,
    { x: -0.9, y: 1.39, z: -0.15 },
    bp.cyan,
    bp.deepNavy,
    0.65,
    0.8,
  );
  // Screen glow
  const screenFace = new THREE.Mesh(
    new THREE.PlaneGeometry(1.18, 0.72),
    new THREE.MeshStandardMaterial({
      color: bp.cyan,
      emissive: bp.cyan,
      emissiveIntensity: 0.22,
      transparent: true,
      opacity: 0.18,
    }),
  );
  screenFace.position.set(0, 0, 0.035);
  monitorScreen.add(screenFace);
  root.add(monitorScreen);

  // Status panels (3)
  for (let i = 0; i < 3; i += 1) {
    const isActive = i === 1;
    const panelColor = isActive ? 0xf0a830 : bp.cyan;

    const panelShell = blueprintBox(
      0.95,
      0.65,
      0.08,
      { x: -1.75 + i * 1.15, y: 1.14 + i * 0.04, z: -0.08 },
      panelColor,
      bp.midBlue,
      0.45,
      0.65,
    );

    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.75, 0.45),
      new THREE.MeshStandardMaterial({
        color: panelColor,
        emissive: panelColor,
        emissiveIntensity: isActive ? 0.45 : 0.2,
        transparent: true,
        opacity: isActive ? 0.35 : 0.2,
      }),
    );
    glow.position.set(0, 0, 0.05);
    panelShell.add(glow);
    panels.push(panelShell);
    root.add(panelShell);
  }

  const keyboard = blueprintBox(
    1.7,
    0.05,
    0.48,
    { x: -0.22, y: 0.61, z: 0.88 },
    bp.cyan,
    bp.midBlue,
    0.4,
    0.6,
  );
  root.add(keyboard);

  // Label cards (4)
  for (let i = 0; i < 4; i += 1) {
    const label = blueprintBox(
      0.68,
      0.025,
      0.48,
      { x: 1.5 + i * 0.16, y: 0.62 + i * 0.022, z: 0.4 - i * 0.09 },
      bp.cyan,
      bp.deepNavy,
      0.45,
      0.6,
    );
    label.rotation.z = 0.1 - i * 0.07;

    const stamp = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.008, 0.1),
      new THREE.MeshStandardMaterial({
        color: i % 2 === 0 ? 0xd4783a : 0xf0a830,
        emissive: i % 2 === 0 ? 0xd4783a : 0xf0a830,
        emissiveIntensity: 0.4,
      }),
    );
    stamp.position.set(0.18, 0.018, 0.08);
    label.add(stamp);
    labelCards.push(label);
    root.add(label);
  }

  // Scale / weight station on desk
  const scale = blueprintBox(
    0.48,
    0.05,
    0.44,
    { x: 1.1, y: 0.6, z: 0.9 },
    bp.cyan,
    bp.midBlue,
    0.45,
    0.6,
  );
  // Digital readout bar
  const readout = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.04, 0.02),
    new THREE.MeshStandardMaterial({
      color: 0x34d399,
      emissive: 0x34d399,
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: 0.6,
    }),
  );
  readout.position.set(0, 0.045, -0.18);
  scale.add(readout);
  root.add(scale);

  /* ── Phase 4b: Floor details ──────────────────────────────────── */

  // Caution stripes near conveyor
  for (let i = 0; i < 3; i += 1) {
    const stripe = blueprintBox(
      0.6,
      0.01,
      0.08,
      { x: -1.8 + i * 2.1, y: 0.01, z: 2.18 },
      0xf0a830,
      0x2a1e0a,
      0.5,
      0.7,
    );
    root.add(stripe);
  }

  // Hand truck leaning against pillar
  const handTruckGroup = new THREE.Group();
  handTruckGroup.position.set(-4.35, 0, 0.3);
  handTruckGroup.rotation.z = 0.2;

  // L-frame vertical
  const htVert = blueprintBox(
    0.06,
    0.9,
    0.06,
    { x: 0, y: 0.45, z: 0 },
    bp.cyan,
    bp.midBlue,
    0.4,
    0.55,
  );
  handTruckGroup.add(htVert);

  // L-frame base
  const htBase = blueprintBox(
    0.06,
    0.06,
    0.4,
    { x: 0, y: 0.03, z: 0.2 },
    bp.cyan,
    bp.midBlue,
    0.4,
    0.55,
  );
  handTruckGroup.add(htBase);

  // Wheels
  for (const wz of [-0.02, 0.04]) {
    const wheel = blueprintCylinder(
      0.06,
      0.06,
      0.03,
      { x: 0, y: 0.06, z: wz },
      bp.cyan,
      bp.midBlue,
      0.35,
      0.5,
      10,
    );
    wheel.rotation.x = Math.PI / 2;
    handTruckGroup.add(wheel);
  }

  root.add(handTruckGroup);

  /* ── Phase 5: Blueprint annotations ───────────────────────────── */

  // Dimension line: conveyor length (horizontal)
  const dimLineMat = new THREE.LineDashedMaterial({
    color: bp.cyan,
    dashSize: 0.1,
    gapSize: 0.05,
    transparent: true,
    opacity: 0.55,
  });

  // Conveyor length dimension
  const convDimPts = [
    new THREE.Vector3(-2.8, 0.65, 2.2),
    new THREE.Vector3(3.4, 0.65, 2.2),
  ];
  const convDimGeo = new THREE.BufferGeometry().setFromPoints(convDimPts);
  const convDimLine = new THREE.Line(convDimGeo, dimLineMat.clone());
  convDimLine.computeLineDistances();
  root.add(convDimLine);

  // Tick marks for conveyor dimension
  for (const tx of [-2.8, 3.4]) {
    const tickPts = [
      new THREE.Vector3(tx, 0.55, 2.2),
      new THREE.Vector3(tx, 0.75, 2.2),
    ];
    const tickGeo = new THREE.BufferGeometry().setFromPoints(tickPts);
    const tick = new THREE.Line(
      tickGeo,
      new THREE.LineBasicMaterial({
        color: bp.cyan,
        transparent: true,
        opacity: 0.55,
      }),
    );
    root.add(tick);
  }

  // Column height dimension (vertical)
  const colDimPts = [
    new THREE.Vector3(4.55, 0.1, -1.7),
    new THREE.Vector3(4.55, 3.1, -1.7),
  ];
  const colDimGeo = new THREE.BufferGeometry().setFromPoints(colDimPts);
  const colDimLine = new THREE.Line(colDimGeo, dimLineMat.clone());
  colDimLine.computeLineDistances();
  root.add(colDimLine);

  for (const ty of [0.1, 3.1]) {
    const tickPts = [
      new THREE.Vector3(4.42, ty, -1.7),
      new THREE.Vector3(4.68, ty, -1.7),
    ];
    const tickGeo = new THREE.BufferGeometry().setFromPoints(tickPts);
    const tick = new THREE.Line(
      tickGeo,
      new THREE.LineBasicMaterial({
        color: bp.cyan,
        transparent: true,
        opacity: 0.55,
      }),
    );
    root.add(tick);
  }

  // Desk width dimension
  const deskDimPts = [
    new THREE.Vector3(-2.75, 0.82, 1.05),
    new THREE.Vector3(2.45, 0.82, 1.05),
  ];
  const deskDimGeo = new THREE.BufferGeometry().setFromPoints(deskDimPts);
  const deskDimLine = new THREE.Line(deskDimGeo, dimLineMat.clone());
  deskDimLine.computeLineDistances();
  root.add(deskDimLine);

  for (const tx of [-2.75, 2.45]) {
    const tickPts = [
      new THREE.Vector3(tx, 0.75, 1.05),
      new THREE.Vector3(tx, 0.89, 1.05),
    ];
    const tickGeo = new THREE.BufferGeometry().setFromPoints(tickPts);
    const tick = new THREE.Line(
      tickGeo,
      new THREE.LineBasicMaterial({
        color: bp.cyan,
        transparent: true,
        opacity: 0.55,
      }),
    );
    root.add(tick);
  }

  // Technical crosshair callout markers
  const crosshairPositions = [
    { x: -4.2, y: 0.05, z: -1.7 }, // column base
    { x: 0, y: 3.1, z: -1.4 }, // rafter junction
    { x: 3.4, y: 0.32, z: 1.58 }, // conveyor end
  ];

  for (const cp of crosshairPositions) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.08, 0.1, 24),
      new THREE.MeshBasicMaterial({
        color: bp.cyan,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
      }),
    );
    ring.position.set(cp.x, cp.y, cp.z + 0.02);
    root.add(ring);

    // Cross lines
    const crossSize = 0.15;
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
    ] as const) {
      const pts = [
        new THREE.Vector3(
          cp.x - dx * crossSize,
          cp.y - dy * crossSize,
          cp.z + 0.02,
        ),
        new THREE.Vector3(
          cp.x + dx * crossSize,
          cp.y + dy * crossSize,
          cp.z + 0.02,
        ),
      ];
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({
          color: bp.cyan,
          transparent: true,
          opacity: 0.35,
        }),
      );
      root.add(line);
    }
  }

  // Collect all edge materials for pulse animation
  const allEdges = collectBlueprintEdges(root);

  /* ── Animation ────────────────────────────────────────────────── */

  return {
    root,
    update: (time, activity, reducedMotion) => {
      // Edge pulse (schematic breathing)
      const pulseOpacity = 0.55 + Math.sin(time * 1.6) * 0.15;
      for (const edge of allEdges) {
        (edge.material as THREE.LineBasicMaterial).opacity = pulseOpacity;
      }

      // Pendant light sway
      pendulumLights.forEach((pendant, i) => {
        pendant.rotation.z = Math.sin(time * 0.7 + i * 1.2) * 0.015 * activity;
        pendant.rotation.x = Math.cos(time * 0.55 + i * 0.9) * 0.008 * activity;
      });

      // Panel float
      panels.forEach((panel, i) => {
        panel.position.y =
          1.14 + i * 0.04 + Math.sin(time * 1.4 + i * 0.55) * 0.035 * activity;
        panel.rotation.z = Math.sin(time * 0.85 + i) * 0.025;
      });

      // Label card flutter
      labelCards.forEach((label, i) => {
        label.rotation.z =
          0.1 - i * 0.07 + Math.sin(time * 1.1 + i * 0.45) * 0.03 * activity;
        label.position.y =
          0.62 +
          i * 0.022 +
          Math.cos(time * 1.25 + i * 0.35) * 0.015 * activity;
      });

      // Conveyor packages
      conveyorPackages.forEach((pkg, i) => {
        const def = packageDefs[i];
        const speed = reducedMotion ? 0 : def.speed;
        const wrapLen = 6.8;
        const rawX = (time * speed + def.offset) % wrapLen;
        pkg.position.x = -3.1 + rawX;

        const baseY = i === 4 ? 0.42 : 0.32 + def.h / 2;
        pkg.position.y =
          baseY + Math.sin(time * 2.2 + i * 1.1) * def.bounce * activity;

        // Poster tube rolls
        if (i === 4 && !reducedMotion) {
          pkg.rotation.x += 0.008 * activity;
        }
      });

      // Roller spin
      if (!reducedMotion) {
        conveyorRollers.forEach((roller) => {
          roller.children.forEach((child) => {
            child.rotation.y += 0.02 * activity;
          });
        });
      }
    },
  };
}

function createPrinterScene({ colors }: SceneContext): SceneController {
  const root = new THREE.Group();
  const rollers: THREE.Mesh[] = [];
  const labels: THREE.Mesh[] = [];
  const beacons: THREE.Mesh[] = [];

  const printerBody = box(
    4.6,
    1.28,
    1.92,
    colors.postalNavy,
    { x: 0, y: 0.95, z: 0.35 },
    0.28,
    0.32,
  );
  root.add(printerBody);

  const lid = box(
    4.1,
    0.18,
    1.38,
    colors.federalBlue,
    { x: 0, y: 1.68, z: 0.15 },
    0.22,
    0.28,
  );
  lid.rotation.x = -0.08;
  root.add(lid);

  const slot = box(
    3.26,
    0.16,
    0.24,
    colors.postalNavy,
    { x: 0, y: 0.86, z: 1.18 },
    0.1,
    0.6,
  );
  root.add(slot);

  for (let index = 0; index < 3; index += 1) {
    const roller = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 3.25, 28),
      new THREE.MeshStandardMaterial({
        color: index === 1 ? colors.cautionYellow : colors.formGray,
        metalness: 0.54,
        roughness: 0.28,
      }),
    );
    roller.rotation.z = Math.PI / 2;
    roller.position.set(0, 1.08 + index * 0.26, 0.52 - index * 0.2);
    rollers.push(roller);
    root.add(roller);
  }

  for (let index = 0; index < 4; index += 1) {
    const label = box(
      2.2,
      0.02,
      0.7,
      colors.pureWhite,
      { x: 0.12, y: 0.38 - index * 0.24, z: 1.42 + index * 0.08 },
      0.08,
      0.94,
    );
    label.rotation.x = -0.18;
    const mark = box(
      0.32,
      0.01,
      0.16,
      index % 2 === 0 ? colors.safetyOrange : colors.cautionYellow,
      { x: 0.58, y: 0.01, z: 0.12 },
      0.08,
      0.4,
    );
    label.add(mark);
    labels.push(label);
    root.add(label);
  }

  const headGlow = box(
    3.2,
    0.12,
    0.3,
    colors.safetyOrange,
    { x: 0, y: 0.94, z: 0.88 },
    0.06,
    0.22,
  );
  headGlow.material = new THREE.MeshStandardMaterial({
    color: colors.safetyOrange,
    emissive: colors.safetyOrange,
    emissiveIntensity: 0.6,
    metalness: 0.08,
    roughness: 0.24,
  });
  root.add(headGlow);

  for (let index = 0; index < 2; index += 1) {
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.16, 0.28, 24),
      new THREE.MeshStandardMaterial({
        color: index === 0 ? colors.cautionYellow : colors.safetyOrange,
        emissive: index === 0 ? colors.cautionYellow : colors.safetyOrange,
        emissiveIntensity: 0.26,
        metalness: 0.08,
        roughness: 0.34,
      }),
    );
    beacon.position.set(-1.6 + index * 3.2, 1.92, 0.08);
    beacons.push(beacon);
    root.add(beacon);
  }

  return {
    root,
    update: (time, activity, reducedMotion) => {
      rollers.forEach((roller, index) => {
        roller.rotation.x =
          (reducedMotion ? 0.2 : time * (2.4 + index * 0.4)) *
          (index % 2 === 0 ? 1 : -1);
      });

      labels.forEach((label, index) => {
        label.position.y =
          0.42 - (((reducedMotion ? 0 : time * 0.9) + index * 0.22) % 1.1);
        label.rotation.z = Math.sin(time * 1.8 + index * 0.3) * 0.03 * activity;
      });

      beacons.forEach((beacon, index) => {
        beacon.scale.y =
          0.92 + Math.sin(time * 3 + index * 0.75) * 0.18 * activity;
      });
    },
  };
}

function createSyncScene({ colors }: SceneContext): SceneController {
  const root = new THREE.Group();
  const nodeColumns: THREE.Group[] = [];
  const flow = createPacketFlow(
    new THREE.CatmullRomCurve3([
      new THREE.Vector3(-3.8, 1.0, 0.65),
      new THREE.Vector3(-1.8, 1.22, 0.4),
      new THREE.Vector3(-0.4, 0.92, 0.08),
      new THREE.Vector3(1.2, 1.08, -0.16),
      new THREE.Vector3(3.5, 0.98, -0.35),
    ]),
    6,
    colors.cautionYellow,
  );
  const repairFlow = createPacketFlow(
    new THREE.CatmullRomCurve3([
      new THREE.Vector3(-3.1, 0.48, 1.12),
      new THREE.Vector3(-0.8, 0.66, 0.82),
      new THREE.Vector3(0.25, 0.38, 0.46),
      new THREE.Vector3(1.1, 0.86, 0.18),
      new THREE.Vector3(3.2, 0.56, -0.1),
    ]),
    4,
    colors.safetyOrange,
  );

  root.add(flow.group, repairFlow.group);

  for (let column = 0; column < 4; column += 1) {
    const stack = new THREE.Group();

    for (let row = 0; row < 4; row += 1) {
      const node = box(
        0.58,
        0.16,
        0.5,
        row === 2 && column === 1 ? colors.safetyOrange : colors.federalBlue,
        { x: 0, y: row * 0.22, z: 0 },
        0.16,
        0.34,
      );
      stack.add(node);
    }

    stack.position.set(
      -2.8 + column * 1.8,
      0.36,
      column % 2 === 0 ? 0.48 : -0.12,
    );
    nodeColumns.push(stack);
    root.add(stack);
  }

  const manifest = box(
    2.8,
    1.64,
    0.16,
    colors.pureWhite,
    { x: 1.95, y: 1.1, z: -0.95 },
    0.04,
    0.92,
  );
  root.add(manifest);

  for (let row = 0; row < 5; row += 1) {
    const stripe = box(
      2.2,
      0.04,
      0.04,
      row === 2 ? colors.cautionYellow : colors.formGray,
      { x: 1.95, y: 0.6 + row * 0.25, z: -0.82 },
      0.1,
      0.96,
    );
    root.add(stripe);
  }

  const brokenBridge = new THREE.Group();
  const leftBridge = box(
    1.2,
    0.06,
    0.08,
    colors.envelopeTan,
    { x: -0.4, y: 0.92, z: 0.24 },
    0.08,
    0.38,
  );
  const rightBridge = box(
    1.05,
    0.06,
    0.08,
    colors.envelopeTan,
    { x: 1.05, y: 0.84, z: 0.08 },
    0.08,
    0.38,
  );
  brokenBridge.add(leftBridge, rightBridge);
  root.add(brokenBridge);

  return {
    root,
    update: (time, activity, reducedMotion) => {
      nodeColumns.forEach((column, index) => {
        column.position.y =
          0.36 + Math.sin(time * 1.2 + index * 0.6) * 0.08 * activity;
        column.rotation.y = Math.sin(time * 0.75 + index) * 0.08;
      });

      brokenBridge.children[0].rotation.z =
        Math.sin(time * 2.4) * 0.12 * activity;
      brokenBridge.children[1].rotation.z =
        -Math.sin(time * 2.4) * 0.12 * activity;

      flow.update(time, reducedMotion ? 0 : activity);
      repairFlow.update(time * 1.2 + 0.35, reducedMotion ? 0 : activity);
    },
  };
}

function createRatesScene({ colors }: SceneContext): SceneController {
  const root = new THREE.Group();
  const orbitals: THREE.Object3D[] = [];
  const posts: THREE.Mesh[] = [];

  const scaleBase = box(
    4.6,
    0.32,
    2.2,
    colors.postalNavy,
    { x: 0, y: 0.24, z: 0.36 },
    0.28,
    0.34,
  );
  root.add(scaleBase);

  const weighingPlate = box(
    2.45,
    0.16,
    1.4,
    colors.formGray,
    { x: 0, y: 0.62, z: 0.28 },
    0.22,
    0.68,
  );
  root.add(weighingPlate);

  const parcel = box(
    1.18,
    1.02,
    0.96,
    colors.envelopeTan,
    { x: 0, y: 1.18, z: 0.3 },
    0.08,
    0.52,
  );
  const parcelBand = box(
    0.16,
    1.06,
    1.0,
    colors.federalBlue,
    { x: 0, y: 0, z: 0.02 },
    0.12,
    0.32,
  );
  parcel.add(parcelBand);
  root.add(parcel);

  for (let index = 0; index < 2; index += 1) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 1.8, 24),
      new THREE.MeshStandardMaterial({
        color: colors.federalBlue,
        emissive: colors.federalBlue,
        emissiveIntensity: 0.2,
        metalness: 0.34,
        roughness: 0.28,
      }),
    );
    post.position.set(index === 0 ? -2.85 : 2.85, 1.05, 0.18);
    posts.push(post);
    root.add(post);
  }

  const beamMaterial = new THREE.MeshBasicMaterial({
    color: colors.cautionYellow,
    transparent: true,
    opacity: 0.38,
  });
  for (let index = 0; index < 3; index += 1) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.75 + index * 0.32, 0.035, 14, 96),
      beamMaterial.clone(),
    );
    ring.rotation.x = Math.PI / 2.7;
    ring.rotation.y = index * 0.3;
    ring.position.set(0, 1.28, 0.18 - index * 0.08);
    orbitals.push(ring);
    root.add(ring);
  }

  const routeCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-2.75, 1.5, 0.15),
    new THREE.Vector3(-1.2, 2.1, -0.25),
    new THREE.Vector3(0.2, 1.8, 0.25),
    new THREE.Vector3(1.5, 1.65, 0),
    new THREE.Vector3(2.8, 1.48, -0.1),
  ]);
  const route = new THREE.Mesh(
    new THREE.TubeGeometry(routeCurve, 100, 0.06, 16, false),
    new THREE.MeshStandardMaterial({
      color: colors.safetyOrange,
      emissive: colors.safetyOrange,
      emissiveIntensity: 0.38,
      metalness: 0.12,
      roughness: 0.3,
    }),
  );
  root.add(route);

  return {
    root,
    update: (time, activity, reducedMotion) => {
      parcel.position.y = 1.18 + Math.sin(time * 1.4) * 0.08 * activity;
      parcel.rotation.y = Math.sin(time * 0.85) * 0.15 * activity;
      weighingPlate.rotation.z = Math.sin(time * 1.55) * 0.05 * activity;
      orbitals.forEach((orbital, index) => {
        orbital.rotation.z =
          (reducedMotion ? 0.15 : time * (0.25 + index * 0.08)) *
          (index % 2 === 0 ? 1 : -1);
      });
      posts.forEach((post, index) => {
        post.scale.y =
          0.92 + Math.sin(time * 2.5 + index * 0.8) * 0.14 * activity;
      });
    },
  };
}

function createNetworkScene({ colors }: SceneContext): SceneController {
  const root = new THREE.Group();
  const screens: THREE.Mesh[] = [];
  const towerLights: THREE.Mesh[] = [];

  const leftDesk = box(2.25, 0.24, 1.28, colors.federalBlue, {
    x: -2.35,
    y: 0.48,
    z: 0.55,
  });
  const rightDesk = box(2.25, 0.24, 1.28, colors.federalBlue, {
    x: 2.35,
    y: 0.48,
    z: 0.2,
  });
  const tower = box(
    1.2,
    2.2,
    1.12,
    colors.postalNavy,
    { x: 0, y: 1.18, z: 0.22 },
    0.34,
    0.26,
  );
  root.add(leftDesk, rightDesk, tower);

  for (let index = 0; index < 2; index += 1) {
    const screen = box(
      0.94,
      0.62,
      0.08,
      index === 0 ? colors.cautionYellow : colors.envelopeTan,
      { x: index === 0 ? -2.35 : 2.35, y: 1.14, z: index === 0 ? 0.12 : -0.22 },
      0.08,
      0.28,
    );
    screen.material = new THREE.MeshStandardMaterial({
      color: index === 0 ? colors.cautionYellow : colors.envelopeTan,
      emissive: index === 0 ? colors.cautionYellow : colors.envelopeTan,
      emissiveIntensity: 0.34,
      metalness: 0.08,
      roughness: 0.3,
    });
    screens.push(screen);
    root.add(screen);
  }

  for (let index = 0; index < 5; index += 1) {
    const light = box(
      0.54,
      0.1,
      0.08,
      index % 2 === 0 ? colors.cautionYellow : colors.safetyOrange,
      { x: 0, y: 0.46 + index * 0.34, z: 0.62 },
      0.08,
      0.24,
    );
    light.material = new THREE.MeshStandardMaterial({
      color: index % 2 === 0 ? colors.cautionYellow : colors.safetyOrange,
      emissive: index % 2 === 0 ? colors.cautionYellow : colors.safetyOrange,
      emissiveIntensity: 0.42,
      metalness: 0.08,
      roughness: 0.2,
    });
    towerLights.push(light);
    root.add(light);
  }

  const cables = [
    new THREE.CatmullRomCurve3([
      new THREE.Vector3(-2.3, 0.88, 0.26),
      new THREE.Vector3(-1.2, 1.95, -0.12),
      new THREE.Vector3(-0.2, 1.7, 0.08),
      new THREE.Vector3(0, 1.35, 0.38),
    ]),
    new THREE.CatmullRomCurve3([
      new THREE.Vector3(2.3, 0.86, -0.04),
      new THREE.Vector3(1.25, 1.88, 0.22),
      new THREE.Vector3(0.35, 1.6, 0.06),
      new THREE.Vector3(0, 1.32, 0.3),
    ]),
    new THREE.CatmullRomCurve3([
      new THREE.Vector3(-2.05, 0.78, 0.72),
      new THREE.Vector3(-0.8, 0.62, 1.18),
      new THREE.Vector3(0.8, 0.72, 1.08),
      new THREE.Vector3(2.05, 0.8, 0.4),
    ]),
  ];

  const flows = cables.map((curve, index) =>
    createPacketFlow(
      curve,
      4 + index,
      index === 2 ? colors.envelopeTan : colors.cautionYellow,
      0.11,
    ),
  );
  flows.forEach((flow) => root.add(flow.group));

  cables.forEach((curve, index) => {
    const cable = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 96, 0.045, 12, false),
      new THREE.MeshStandardMaterial({
        color: index === 2 ? colors.envelopeTan : colors.federalBlue,
        metalness: 0.42,
        roughness: 0.3,
        emissive: index === 2 ? colors.envelopeTan : colors.federalBlue,
        emissiveIntensity: 0.14,
      }),
    );
    root.add(cable);
  });

  return {
    root,
    update: (time, activity, reducedMotion) => {
      screens.forEach((screen, index) => {
        screen.scale.x =
          0.96 + Math.sin(time * 2.1 + index * 0.6) * 0.05 * activity;
      });

      towerLights.forEach((light, index) => {
        light.scale.x =
          0.9 + Math.sin(time * 2.6 + index * 0.5) * 0.2 * activity;
      });

      flows.forEach((flow, index) => {
        flow.update(time * (reducedMotion ? 0 : 1 + index * 0.15), activity);
      });
    },
  };
}

function createAutomationScene({ colors }: SceneContext): SceneController {
  const root = new THREE.Group();
  const switchArms: THREE.Mesh[] = [];
  const movers = [
    createPacketFlow(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-3.8, 0.72, 0.82),
        new THREE.Vector3(-1.8, 0.88, 0.9),
        new THREE.Vector3(-0.2, 1.1, 0.58),
        new THREE.Vector3(1.8, 0.92, 0.12),
        new THREE.Vector3(3.9, 0.76, -0.08),
      ]),
      5,
      colors.cautionYellow,
      0.14,
      true,
    ),
    createPacketFlow(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-3.3, 0.42, 1.42),
        new THREE.Vector3(-1.0, 0.48, 1.24),
        new THREE.Vector3(0.4, 0.66, 0.98),
        new THREE.Vector3(1.55, 1.02, 0.36),
        new THREE.Vector3(3.65, 1.18, -0.42),
      ]),
      4,
      colors.safetyOrange,
      0.12,
      true,
    ),
  ];

  movers.forEach((flow) => root.add(flow.group));

  const tracks = [
    new THREE.CatmullRomCurve3([
      new THREE.Vector3(-4.1, 0.56, 0.84),
      new THREE.Vector3(-1.8, 0.68, 0.94),
      new THREE.Vector3(0.15, 0.82, 0.72),
      new THREE.Vector3(2.2, 0.76, 0.15),
      new THREE.Vector3(4.2, 0.62, -0.08),
    ]),
    new THREE.CatmullRomCurve3([
      new THREE.Vector3(-3.6, 0.26, 1.36),
      new THREE.Vector3(-1.0, 0.26, 1.2),
      new THREE.Vector3(0.55, 0.42, 0.98),
      new THREE.Vector3(1.8, 0.92, 0.42),
      new THREE.Vector3(3.9, 1.06, -0.46),
    ]),
  ];

  tracks.forEach((curve, index) => {
    const track = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 96, 0.08, 12, false),
      new THREE.MeshStandardMaterial({
        color: index === 0 ? colors.federalBlue : colors.envelopeTan,
        metalness: 0.4,
        roughness: 0.3,
        emissive: index === 0 ? colors.federalBlue : colors.envelopeTan,
        emissiveIntensity: 0.18,
      }),
    );
    root.add(track);
  });

  for (let index = 0; index < 3; index += 1) {
    const arm = box(
      1.05,
      0.08,
      0.18,
      index === 1 ? colors.cautionYellow : colors.formGray,
      { x: -0.8 + index * 1.4, y: 1.1 - index * 0.1, z: 0.68 - index * 0.38 },
      0.12,
      0.44,
    );
    switchArms.push(arm);
    root.add(arm);
  }

  const jamGate = box(
    0.22,
    1.05,
    0.12,
    colors.safetyOrange,
    { x: 0.48, y: 1.14, z: 0.82 },
    0.1,
    0.22,
  );
  jamGate.material = new THREE.MeshStandardMaterial({
    color: colors.safetyOrange,
    emissive: colors.safetyOrange,
    emissiveIntensity: 0.44,
    metalness: 0.08,
    roughness: 0.22,
  });
  root.add(jamGate);

  return {
    root,
    update: (time, activity, reducedMotion) => {
      switchArms.forEach((arm, index) => {
        arm.rotation.z = Math.sin(time * 1.6 + index * 0.8) * 0.18 * activity;
      });

      jamGate.position.x = 0.48 + Math.sin(time * 1.25) * 0.24 * activity;
      movers[0].update(time * (reducedMotion ? 0 : 1), activity);
      movers[1].update(time * (reducedMotion ? 0 : 0.85) + 0.35, activity);
    },
  };
}

function createPacketFlow(
  curve: THREE.CatmullRomCurve3,
  count: number,
  color: number,
  size = 0.09,
  boxPackets = false,
) {
  const group = new THREE.Group();
  const packets: THREE.Object3D[] = [];

  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 72, size * 0.35, 10, false),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.16,
      metalness: 0.14,
      roughness: 0.48,
      transparent: true,
      opacity: 0.46,
    }),
  );
  group.add(tube);

  for (let index = 0; index < count; index += 1) {
    const packet = boxPackets
      ? new THREE.Mesh(
          new THREE.BoxGeometry(size * 2.2, size * 1.4, size * 1.6),
          new THREE.MeshStandardMaterial({
            color,
            emissive: color,
            emissiveIntensity: 0.46,
            metalness: 0.08,
            roughness: 0.32,
          }),
        )
      : new THREE.Mesh(
          new THREE.SphereGeometry(size, 18, 18),
          new THREE.MeshStandardMaterial({
            color,
            emissive: color,
            emissiveIntensity: 0.62,
            metalness: 0.08,
            roughness: 0.3,
          }),
        );
    packets.push(packet);
    group.add(packet);
  }

  return {
    group,
    update(time: number, activity: number) {
      packets.forEach((packet, index) => {
        const progress =
          (time * (0.18 + activity * 0.18) + index / packets.length) % 1;
        const point = curve.getPointAt(progress);
        const tangent = curve.getTangentAt(progress);

        packet.position.copy(point);
        packet.lookAt(point.clone().add(tangent));
      });
    },
  };
}

function box(
  width: number,
  height: number,
  depth: number,
  color: number,
  position: { x: number; y: number; z: number },
  metalness = 0.18,
  roughness = 0.42,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({ color, metalness, roughness }),
  );

  mesh.position.set(position.x, position.y, position.z);
  return mesh;
}
