import * as THREE from './three.module.js';
import {OrbitControls} from './OrbitControls.js';
import {GLTFLoader} from './GLTFLoader.js';
import {calculateCameraFit} from './detail-3d-utils.js';
export {calculateCameraFit} from './detail-3d-utils.js';

/** Prefer the original GLB node name; Three sanitizes object.name for animation. */
export function detailNodeName(object) {
  let fallback = '';
  for (let node = object; node; node = node.parent) {
    if (node.userData?.name) return node.userData.name;
    fallback ||= node.name;
  }
  return fallback || '이름 없는 부재';
}

/** Release shared GLB resources once, including ImageBitmaps owned by the loader. */
export function disposeGltfResources(roots) {
  const geometries = new Set(), materials = new Set(), textures = new Set(), images = new Set(), skeletons = new Set(), instances = new Set();
  for (const root of Array.isArray(roots) ? roots : [roots]) root?.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.skeleton) skeletons.add(object.skeleton);
    if (object.isInstancedMesh) instances.add(object);
    for (const material of object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : []) materials.add(material);
  });
  for (const material of materials) for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
  for (const texture of textures) {
    const data = texture.source?.data ?? texture.image;
    for (const image of Array.isArray(data) ? data : [data]) if (image?.close) images.add(image);
    texture.dispose();
  }
  for (const image of images) image.close();
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const skeleton of skeletons) skeleton.dispose();
  for (const instance of instances) instance.dispose();
}

/** Returns immediately so dispose() also cancels a pending fetch/parse. Await ready to load. */
export function mount(container, glbUrlOrArrayBuffer) {
  if (!container?.append) throw new Error('3D 미리보기 영역이 없습니다.');
  const doc = container.ownerDocument, win = doc.defaultView;
  const renderer = new THREE.WebGLRenderer({antialias: true, alpha: false});
  renderer.setPixelRatio(Math.min(win.devicePixelRatio || 1, 2));
  const canvas = renderer.domElement;
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
  canvas.setAttribute('aria-label', '상세 3D 보기 · 드래그로 회전, 휠로 확대');
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#f5f8fa');
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb7c3cc, 2));
  const key = new THREE.DirectionalLight(0xffffff, 2.5); key.position.set(3, 5, 4); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 1); fill.position.set(-3, 2, -2); scene.add(fill);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false; controls.enablePan = true;
  const tooltip = doc.createElement('div'); tooltip.hidden = true; tooltip.setAttribute('role', 'tooltip');
  tooltip.style.cssText = 'position:absolute;pointer-events:none;max-width:calc(100% - 16px);overflow-wrap:anywhere;padding:4px 8px;border:1px solid #9dcbe0;background:#fff;color:#18212b;font:inherit;font-size:12px';
  const status = doc.createElement('p'); status.setAttribute('role', 'status'); status.textContent = '3D 모형을 불러오는 중입니다.';
  status.style.cssText = 'position:absolute;inset:8px 12px auto;margin:0;color:#18212b;font:inherit;text-wrap:pretty';
  const previousPosition = container.style.position;
  if (win.getComputedStyle(container).position === 'static') container.style.position = 'relative';
  container.append(canvas, tooltip, status);
  let disposed = false, frame = null, gltf = null, bounds = null;
  const abort = new AbortController(), meshes = [], raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  const hideTooltip = () => {tooltip.hidden = true;};
  function render() {
    if (disposed || frame !== null) return;
    frame = win.requestAnimationFrame(() => {frame = null; if (!disposed) renderer.render(scene, camera);});
  }
  function resize() {
    if (disposed) return;
    const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false); camera.aspect = width / height;
    if (bounds) {
      const fit = calculateCameraFit(bounds, camera.aspect, camera.fov);
      const direction = camera.position.clone().sub(controls.target);
      if (!direction.lengthSq()) direction.set(1, 0.8, 1);
      controls.target.set(fit.target.x, fit.target.y, fit.target.z);
      camera.position.copy(controls.target).addScaledVector(direction.normalize(), fit.distance);
      camera.near = fit.near; camera.far = fit.far;
      controls.minDistance = fit.radius * 0.05; controls.maxDistance = fit.distance * 10;
      controls.update();
    }
    camera.updateProjectionMatrix(); hideTooltip(); render();
  }
  function point(event) {
    if (disposed || !meshes.length || event.buttons) {hideTooltip(); return;}
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(meshes, false)[0];
    if (!hit) {hideTooltip(); return;}
    tooltip.textContent = detailNodeName(hit.object); tooltip.hidden = false;
    tooltip.style.left = Math.max(8, Math.min(event.clientX - rect.left + 12, rect.width - tooltip.offsetWidth - 8)) + 'px';
    tooltip.style.top = Math.max(8, Math.min(event.clientY - rect.top + 12, rect.height - tooltip.offsetHeight - 8)) + 'px';
  }
  controls.addEventListener('change', render); controls.addEventListener('start', hideTooltip);
  canvas.addEventListener('pointermove', point); canvas.addEventListener('pointerleave', hideTooltip);
  const observer = win.ResizeObserver ? new win.ResizeObserver(resize) : null;
  if (observer) observer.observe(container); else win.addEventListener('resize', resize);
  function dispose() {
    if (disposed) return; disposed = true; abort.abort();
    if (frame !== null) win.cancelAnimationFrame(frame); frame = null;
    observer?.disconnect(); if (!observer) win.removeEventListener('resize', resize);
    controls.removeEventListener('change', render); controls.removeEventListener('start', hideTooltip); controls.dispose();
    canvas.removeEventListener('pointermove', point); canvas.removeEventListener('pointerleave', hideTooltip);
    if (gltf) disposeGltfResources(gltf.scenes); gltf = null; meshes.length = 0;
    scene.clear(); renderer.renderLists.dispose(); renderer.dispose(); renderer.forceContextLoss();
    canvas.remove(); tooltip.remove(); status.remove(); container.style.position = previousPosition;
  }
  const ready = (async () => {
    let bytes = glbUrlOrArrayBuffer, resourcePath = '';
    if (typeof bytes === 'string') {
      resourcePath = new URL('.', new URL(bytes, doc.baseURI)).href;
      const response = await fetch(bytes, {signal: abort.signal});
      if (!response.ok) throw new Error('3D 자료를 읽지 못했습니다. (' + response.status + ')');
      bytes = await response.arrayBuffer();
    }
    if (disposed) return;
    if (!(bytes instanceof ArrayBuffer)) throw new Error('GLB 주소 또는 ArrayBuffer가 필요합니다.');
    const loaded = await new GLTFLoader().parseAsync(bytes, resourcePath);
    if (disposed) {disposeGltfResources(loaded.scenes); return;}
    gltf = loaded; bounds = new THREE.Box3().setFromObject(gltf.scene);
    if (bounds.isEmpty()) throw new Error('3D 모형에 표시할 부재가 없습니다.');
    gltf.scene.traverse(object => {if (object.isMesh) meshes.push(object);});
    for (const mesh of meshes) {
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 25), new THREE.LineBasicMaterial({color: 0x46535e, transparent: true, opacity: 0.45}));
      mesh.add(edges);
    }
    scene.add(gltf.scene); camera.position.set(1, 0.8, 1); controls.target.set(0, 0, 0); status.hidden = true; resize();
  })().catch(error => {
    if (disposed) return;
    dispose(); throw error;
  });
  resize();
  return {ready, dispose};
}
