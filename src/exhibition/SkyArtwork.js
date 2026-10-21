import * as THREE from 'three';
import { skyArtLayout } from './sky-art.js';
import { artVertex, artFragment } from '../scene/shaders.js';

// Load only the part of the sky near the camera. Shared atlases have a single
// GPU texture; release it when the last nearby constellation leaves the view.
export class SkyArtwork {
  constructor({ blending = THREE.NormalBlending, opacity = 0.88, focusedOpacity = 0.96 } = {}) {
    this.assets = new Map();
    this.blending = blending;
    this.opacity = opacity;
    this.focusedOpacity = focusedOpacity;
    this.loader = new THREE.TextureLoader();
  }
  update(works, camera, forward, now) {
    const halfView = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.hypot(1, camera.aspect));
    const loadAt = Math.cos(halfView + 12 * Math.PI / 180);
    const releaseAt = Math.cos(halfView + 24 * Math.PI / 180);
    for (const entry of works.values()) {
      if (!entry.illustration) continue;
      const dot = forward.dot(entry.direction);
      if (dot > loadAt && !entry.artAsset && !entry.artFailed) this.attach(entry);
      if (dot < releaseAt) this.release(entry);
      if (entry.artMesh) {
        entry.artMesh.material.uniforms.uTime.value = now;
        entry.artMesh.material.uniforms.uOpacity.value = entry.focused ? this.focusedOpacity : this.opacity;
      }
    }
  }
  attach(entry) {
    const { art } = entry.illustration;
    let asset = this.assets.get(art.src);
    if (!asset) {
      asset = { src: art.src, users: 0 };
      asset.promise = this.loader.loadAsync(`${import.meta.env.BASE_URL}${art.src}`).then(texture => {
        texture.colorSpace = THREE.SRGBColorSpace;
        if (!asset.users) texture.dispose();
        else asset.texture = texture;
        return texture;
      });
      this.assets.set(art.src, asset);
    }
    asset.users++;
    entry.artAsset = asset;
    asset.promise.then(texture => {
      // A deleted/offscreen work must not be restored by a late image load.
      if (entry.artAsset !== asset || entry.artMesh) return;
      const layout = skyArtLayout(entry.data, entry.illustration);
      if (!layout) { this.release(entry); entry.artFailed = true; return; }
      const { x, y, w, h } = art.rect;
      const material = new THREE.ShaderMaterial({
        blending: this.blending,
        vertexShader: artVertex, fragmentShader: artFragment,
        transparent: true, depthWrite: false,
        uniforms: {
          uAtlas: { value: texture }, uRect: { value: new THREE.Vector4(x, 1 - y - h, w, h) },
          uExposure: { value: 1 },
          // Stellarium images and the zodiac atlas have opaque black mattes.
          // Other illustrations already have alpha, which must stay intact.
          uBlackKey: { value: art.blackMatte ? 1 : 0 },
          uOpacity: { value: this.opacity }, uTime: { value: 0 },
        },
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
      mesh.position.set(layout.x * entry.scale, layout.y * entry.scale, -0.02);
      mesh.scale.set(layout.width * entry.scale * layout.mirror, layout.height * entry.scale, 1);
      mesh.rotation.z = layout.angle;
      entry.artMesh = mesh;
      entry.group.add(mesh);
    }).catch(() => {
      // The saved star drawing remains usable if an illustration is unavailable.
      if (entry.artAsset === asset) { this.release(entry); entry.artFailed = true; }
    });
  }
  release(entry) {
    if (entry.artMesh) {
      entry.group.remove(entry.artMesh);
      entry.artMesh.geometry.dispose();
      entry.artMesh.material.dispose();
      entry.artMesh = null;
    }
    const asset = entry.artAsset;
    entry.artAsset = null;
    if (asset && --asset.users === 0) {
      asset.texture?.dispose();
      if (this.assets.get(asset.src) === asset) this.assets.delete(asset.src);
    }
  }
  async ready() {
    let timeout;
    await Promise.race([
      Promise.allSettled([...this.assets.values()].map(asset => asset.promise)),
      new Promise(resolve => { timeout = setTimeout(resolve, 4000); }),
    ]);
    clearTimeout(timeout);
  }
}
