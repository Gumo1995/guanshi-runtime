import * as T from "./vendor/three.module.min.js";
import { GLTFLoader } from "./vendor/GLTFLoader.js";
import { OrbitControls } from "./vendor/OrbitControls.js";

export async function createForestScene(host, onSelect, onFailure) {
  const renderer = new T.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.VSMShadowMap;
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  host.append(renderer.domElement);
  renderer.domElement.setAttribute(
    "aria-label",
    "时间森林三维视图；可在上方记录详情列表中用键盘选择",
  );
  const scene = new T.Scene();
  scene.fog = new T.Fog("#f7f9fc", 65, 110);
  const island = new T.Group();
  scene.add(island);
  const camera = new T.OrthographicCamera(-25, 25, 20, -20, 0.1, 180);
  camera.position.set(30, 40, 45);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.minZoom = 0.65;
  controls.maxZoom = 3;
  controls.minPolarAngle = 0.35;
  controls.maxPolarAngle = 1.15;
  controls.enableDamping = false;
  controls.mouseButtons.LEFT = T.MOUSE.PAN;
  controls.mouseButtons.RIGHT = T.MOUSE.ROTATE;
  const hemi = new T.HemisphereLight("#edf5ff", "#63795d", 1.9);
  scene.add(hemi);
  const light = new T.DirectionalLight("#fff0d8", 2.8);
  light.position.set(-20, 35, 15);
  light.castShadow = true;
  Object.assign(light.shadow.camera, {
    left: -30,
    right: 30,
    top: 28,
    bottom: -28,
    near: 1,
    far: 90,
  });
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.bias = -0.0003;
  light.shadow.normalBias = 0.04;
  light.shadow.radius = 4;
  light.shadow.blurSamples = 8;
  scene.add(light);
  const meshes = [],
    geometries = new Set(),
    materials = new Set(),
    textures = new Set();
  let frame = 0,
    visible = true,
    disposed = false,
    selected = "",
    trees = [];
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let autoRotate = !reducedMotion.matches, interacting = false;
  let idleAt = 0, idleTimer = 0, returning = null, lastFrame = 0;
  const home = new T.Vector3(30, 40, 45);
  const motionPreference = () => { returning = null; lastFrame = 0; invalidate(); };
  reducedMotion.addEventListener("change", motionPreference);
  function activeMotion() { return autoRotate && !reducedMotion.matches && !selected && !interacting; }
  function wakeIdle() {
    if (disposed) return;
    const remaining = idleAt - performance.now();
    if (remaining > 0) idleTimer = setTimeout(wakeIdle, Math.ceil(remaining));
    else invalidate();
  }
  function interact() {
    returning = null;
    idleAt = performance.now() + 20000;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(wakeIdle, 20000);
    invalidate();
  }
  const startInteraction = () => { interacting = true; interact(); };
  const endInteraction = () => { interacting = false; interact(); };
  controls.addEventListener("start", startInteraction);
  controls.addEventListener("end", endInteraction);
  function beginReturn(now) {
    island.rotation.y = T.MathUtils.euclideanModulo(island.rotation.y + Math.PI, Math.PI * 2) - Math.PI;
    returning = { islandAngle: island.rotation.y, at: now, position: camera.position.clone(), target: controls.target.clone(), zoom: camera.zoom };
  }
  function draw(now) {
    frame = 0;
    if (!disposed && visible && !document.hidden) {
      const dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.05) : 0;
      lastFrame = now;
      if (activeMotion()) {
        if (idleAt && now >= idleAt && !returning) beginReturn(now);
        if (returning) {
          const t = Math.min((now - returning.at) / 2000, 1);
          const ease = t * t * (3 - 2 * t);
          island.rotation.y = returning.islandAngle * (1 - ease);
          camera.position.lerpVectors(returning.position, home, ease);
          controls.target.lerpVectors(returning.target, new T.Vector3(), ease);
          camera.zoom = T.MathUtils.lerp(returning.zoom, 1.9, ease);
          camera.updateProjectionMatrix();
          if (t === 1) { returning = null; idleAt = 0; }
          controls.update();
        } else if (!idleAt) {
          island.rotation.y = (island.rotation.y + dt * Math.PI * 2 / 180) % (Math.PI * 2);
        }
      }
      renderer.render(scene, camera);
      host.dataset.renderStats = JSON.stringify({
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        geometries: renderer.info.memory.geometries,
      });
      if (activeMotion() && (!idleAt || now >= idleAt)) invalidate();
      else if (activeMotion() && idleAt > now) {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(wakeIdle, Math.ceil(idleAt - now) + 17);
      }
    }
  }
  function invalidate() {
    if (!frame && visible && !document.hidden && !disposed)
      frame = requestAnimationFrame(draw);
  }
  function resize() {
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height);
    const ratio = width / height;
    camera.left = -22 * ratio;
    camera.right = 22 * ratio;
    camera.top = 22;
    camera.bottom = -22;
    camera.updateProjectionMatrix();
    invalidate();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  const visibility = () => {
    lastFrame = 0;
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else invalidate();
  };
  document.addEventListener("visibilitychange", visibility);
  controls.addEventListener("change", invalidate);
  const lost = (event) => {
    event.preventDefault();
    onFailure(new Error("图形显示已暂停，请重试"));
  };
  renderer.domElement.addEventListener("webglcontextlost", lost);
  const ringGeometry = new T.RingGeometry(0.85, 1.02, 48);
  ringGeometry.rotateX(-Math.PI / 2);
  const ringMaterial = new T.MeshBasicMaterial({
    color: "#e1c987",
    side: T.DoubleSide,
  });
  const ring = new T.Mesh(ringGeometry, ringMaterial);
  ring.position.y = 0.18;
  ring.visible = false;
  island.add(ring);
  geometries.add(ringGeometry);
  materials.add(ringMaterial);
  let pointerDown = null;
  const down = (e) => {
    pointerDown = { x: e.clientX, y: e.clientY };
  };
  const up = (e) => {
    if (
      !pointerDown ||
      Math.hypot(e.clientX - pointerDown.x, e.clientY - pointerDown.y) > 5
    )
      return;
    const r = renderer.domElement.getBoundingClientRect();
    const ray = new T.Raycaster();
    ray.setFromCamera(
      new T.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        (-(e.clientY - r.top) / r.height) * 2 + 1,
      ),
      camera,
    );
    const hit = ray
      .intersectObjects(meshes)
      .find((h) => h.instanceId !== undefined);
    if (hit) onSelect(hit.object.userData.ids[hit.instanceId]);
  };
  renderer.domElement.addEventListener("pointerdown", down);
  renderer.domElement.addEventListener("pointerup", up);
  function clearInstances() {
    for (const m of meshes) {
      island.remove(m);
      m.dispose();
    }
    meshes.length = 0;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    clearTimeout(idleTimer);
    reducedMotion.removeEventListener("change", motionPreference);
    controls.removeEventListener("start", startInteraction);
    controls.removeEventListener("end", endInteraction);
    resizeObserver.disconnect();
    controls.dispose();
    document.removeEventListener("visibilitychange", visibility);
    renderer.domElement.removeEventListener("webglcontextlost", lost);
    renderer.domElement.removeEventListener("pointerdown", down);
    renderer.domElement.removeEventListener("pointerup", up);
    clearInstances();
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    for (const texture of textures) texture.dispose();
    light.shadow.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }
  let gltf;
  try {
    gltf = await new GLTFLoader().loadAsync(
      new URL("./forest-v1.glb", import.meta.url).href,
    );
  } catch (error) {
    dispose();
    throw error;
  }
  const templates = new Map();
  let terrainMesh;
  const groundRay = new T.Raycaster();
  function groundHeight(x, z) {
    groundRay.set(new T.Vector3(x, 8, z), new T.Vector3(0, -1, 0));
    return terrainMesh ? (groundRay.intersectObject(terrainMesh)[0]?.point.y ?? 0) : 0;
  }
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    let owner = o;
    while (owner.parent && !owner.name.startsWith("decor_")) owner = owner.parent;
    const decoration = owner.name.startsWith("decor_") ? owner.name : "";
    const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
    geometries.add(geometry);
    geometries.add(o.geometry);
    const mat = o.material;
    for (const value of Object.values(mat)) if (value?.isTexture) textures.add(value);
    if (o.name === "ground_grass") mat.side = T.DoubleSide;
    materials.add(mat);
    if (["terrain", "terrain_edge", "ground_grass", "ground_stones"].includes(o.name) || decoration) {
      const ground = new T.Mesh(geometry, mat);
      ground.receiveShadow = true;
      ground.castShadow = Boolean(decoration) && decoration !== "decor_pond";
      island.add(ground);
      if (o.name === "terrain") { terrainMesh = new T.Mesh(geometry, mat); terrainMesh.updateMatrixWorld(true); }
    } else templates.set(o.name, { geometry, material: mat });
  });
  if (!templates.has("tree_0_0_crown")) {
    dispose();
    throw new Error("森林模型不完整");
  }
  function select(id) {
    if (selected && !id) interact();
    selected = id;
    const t = trees.find((t) => t.id === id);
    ring.visible = Boolean(t);
    if (t) {
      ring.position.set(t.x, groundHeight(t.x, t.z) + 0.045, t.z);
      const s = [0.65, 0.85, 1.1, 1.4][t.stage];
      ring.scale.setScalar(s);
    }
    invalidate();
  }
  const treeHeights = new Map();
  function update(next) {
    trees = next;
    treeHeights.clear();
    for (const t of trees) treeHeights.set(t.id, groundHeight(t.x, t.z));
    clearInstances();
    const groups = new Map();
    for (const t of trees) {
      const key = `tree_${t.species}_${t.stage}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    }
    const dummy = new T.Object3D();
    for (const [key, list] of groups)
      for (const part of ["trunk", "crown", "flowers"]) {
        const source = templates.get(`${key}_${part}`);
        if (!source) continue;
        const items = part === "flowers" ? list.filter((t) => t.flowers) : list;
        if (!items.length) continue;
        const mesh = new T.InstancedMesh(
          source.geometry,
          source.material,
          items.length,
        );
        mesh.userData.ids = items.map((t) => t.id);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        items.forEach((t, i) => {
          dummy.position.set(t.x, treeHeights.get(t.id), t.z);
          dummy.rotation.set(0, t.rotation, 0);
          const s =
            part === "crown"
              ? t.fullness
              : part === "flowers"
                ? t.flowers === 1
                  ? 0.72
                  : 1
                : 1;
          dummy.scale.set(s, 1, s);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          mesh.setColorAt(i, new T.Color(t.unrated ? "#aab8a1" : "#ffffff"));
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        meshes.push(mesh);
        island.add(mesh);
      }
    select(selected);
    invalidate();
  }
  function setVisible(v) {
    if (visible !== v) lastFrame = 0;
    visible = v;
    host.dataset.scenePaused = String(!v);
    if (!v) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else {
      resize();
      invalidate();
    }
  }
  camera.zoom = 1.9;
  camera.updateProjectionMatrix();
  resize();
  controls.update();
  return {
    update,
    select,
    setVisible,
    dispose,
    setAutoRotate(value) {
      autoRotate = Boolean(value);
      returning = null;
      idleAt = 0;
      lastFrame = 0;
      invalidate();
    },
    reset() {
      interact();
      island.rotation.y = 0;
      camera.position.copy(home);
      controls.target.set(0, 0, 0);
      camera.zoom = 1.9;
      camera.updateProjectionMatrix();
      controls.update();
      invalidate();
    },
    zoom(f) {
      interact();
      camera.zoom = T.MathUtils.clamp(camera.zoom * f, 0.65, 3);
      camera.updateProjectionMatrix();
      invalidate();
    },
    stats: () => ({
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      framePending: Boolean(frame),
      motion: selected ? "detail" : interacting ? "interacting" : returning ? "returning" : idleAt ? "waiting" : activeMotion() ? "rotating" : "paused",
      camera: camera.position.toArray(),
      textures: renderer.info.memory.textures,
      islandAngle: island.rotation.y,
      light: light.position.toArray(),
    }),
  };
}
