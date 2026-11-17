import {
  CanvasTexture, Color, Mesh, MeshBasicMaterial, PlaneGeometry, PointLight,
  Scene, Vector3, type Camera,
} from 'three';
import type { Vec3 } from '../destruction/types';

type Puff = { mesh: Mesh<PlaneGeometry, MeshBasicMaterial>; velocity: Vector3; life: number; maxLife: number; size: number };

/** Bounded billboards: impact dust is visual, persistent debris is handled by Rapier. */
export class ImpactEffects {
  private puffs: Puff[] = [];
  private cursor = 0;
  private texture: CanvasTexture;
  private geometry = new PlaneGeometry(1, 1);
  private flash = new PointLight(0xffbd74, 0, 24, 2);
  private flashLife = 0;

  constructor(private scene: Scene, private camera: Camera) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const context = canvas.getContext('2d')!;
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,0.65)');
    gradient.addColorStop(.45, 'rgba(255,255,255,0.3)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient; context.fillRect(0, 0, 64, 64);
    this.texture = new CanvasTexture(canvas);
    for (let i = 0; i < 48; i++) {
      const material = new MeshBasicMaterial({ map: this.texture, color: new Color('#b7aa91'), transparent: true, depthWrite: false, opacity: 0 });
      const mesh = new Mesh(this.geometry, material);
      mesh.visible = false;
      this.puffs.push({ mesh, velocity: new Vector3(), life: 0, maxLife: 1, size: 1 });
      scene.add(mesh);
    }
    scene.add(this.flash);
  }

  burst(position: Vec3, strength = 1): void {
    const count = Math.min(12, Math.max(3, Math.round(strength * 6)));
    for (let i = 0; i < count; i++) {
      const puff = this.puffs[this.cursor++ % this.puffs.length];
      puff.life = puff.maxLife = 1.3 + Math.random() * 1.1;
      puff.size = (1 + Math.random() * 1.4) * Math.min(2, strength);
      puff.mesh.position.set(position.x + (Math.random() - .5) * 2, position.y + .4, position.z + (Math.random() - .5) * 2);
      puff.velocity.set((Math.random() - .5) * 2, .7 + Math.random(), (Math.random() - .5) * 2);
      puff.mesh.visible = true;
    }
    this.flash.position.copy(position);
    this.flash.intensity = 35 * strength;
    this.flashLife = .12;
  }

  update(dt: number): void {
    if (this.flashLife > 0) { this.flashLife -= dt; this.flash.intensity *= Math.exp(-dt * 28); }
    else this.flash.intensity = 0;
    for (const puff of this.puffs) {
      if (puff.life <= 0) continue;
      puff.life -= dt;
      if (puff.life <= 0) { puff.mesh.visible = false; continue; }
      const age = 1 - puff.life / puff.maxLife;
      puff.mesh.position.addScaledVector(puff.velocity, dt);
      puff.mesh.quaternion.copy(this.camera.quaternion);
      puff.mesh.scale.setScalar(puff.size * (1 + age * 2.5));
      puff.mesh.material.opacity = Math.sin(age * Math.PI) * .5;
    }
  }

  dispose(): void {
    for (const puff of this.puffs) { this.scene.remove(puff.mesh); puff.mesh.material.dispose(); }
    this.geometry.dispose(); this.texture.dispose(); this.scene.remove(this.flash); this.flash.dispose();
  }
}
