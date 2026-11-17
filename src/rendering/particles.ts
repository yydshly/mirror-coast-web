import { Color, DynamicDrawUsage, InstancedMesh, Matrix4, MeshStandardMaterial, BoxGeometry, Scene, Vector3 } from 'three';
import {palette,Material} from '../world/palette';
import type {VoxelWorld} from '../world/voxel';

type Particle = { position: Vector3; velocity: Vector3; life: number; total: number; size: number };

/** A bounded pool of visual chips; these have no collision or persistent state. */
export class EditParticles {
  private mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ roughness: 1 }), 120);
  private particles: Particle[] = [];
  private matrix = new Matrix4();
  private cursor = 0;
  constructor(scene: Scene,private readonly world?:VoxelWorld) {
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < 120; i++) {
      this.particles.push({ position: new Vector3(), velocity: new Vector3(), life: 0, total: 1, size: 0.1 });
      this.mesh.setMatrixAt(i, this.matrix.makeScale(0, 0, 0));
      this.mesh.setColorAt(i, new Color().setHSL(0.08 + Math.random() * 0.045, 0.18, 0.55 + Math.random() * 0.2));
    }
    scene.add(this.mesh);
  }
  spawn(position: { x: number; y: number; z: number }, blast: boolean,material:number=Material.Rock): void {
    const c=palette[material]?.color??palette[Material.Rock].color;
    for (let i = 0; i < (blast ? 30 : 7); i++) {
      const index=this.cursor++ % this.particles.length,p = this.particles[index];
      p.position.set(position.x, position.y, position.z);
      const scatter=blast?8:3;
      p.velocity.set((Math.random() - .5) * scatter, 1 + Math.random() * (blast?5:2), (Math.random() - .5) * scatter);
      p.life = p.total = .6 + Math.random() * .7;
      p.size = (blast ? .17 : .1) + Math.random() * .12;
      this.mesh.setColorAt(index,new Color().setRGB(...c).multiplyScalar(.8+Math.random()*.35));
    }
    if(this.mesh.instanceColor)this.mesh.instanceColor.needsUpdate=true;
  }
  update(dt: number): void {
    let changed = false;
    this.particles.forEach((p, i) => {
      if (p.life <= 0) return;
      p.life -= dt;
      p.velocity.y -= dt * 11;
      // Visual chips bounce off the current terrain instead of disappearing
      // through intact roads or the newly exposed bottom of an excavation.
      const steps=Math.max(1,Math.ceil(p.velocity.length()*dt/.12));
      for(let s=0;s<steps;s++){
        const next=p.position.clone().addScaledVector(p.velocity,dt/steps);
        if(this.world?.getVoxel(Math.floor(next.x),Math.floor(next.y-p.size/2),Math.floor(next.z))){
          p.velocity.x*=.55;p.velocity.z*=.55;p.velocity.y=Math.abs(p.velocity.y)*.22;
        }else p.position.copy(next);
      }
      const size = p.life > 0 ? p.size * Math.min(1, p.life * 3) : 0;
      this.matrix.makeScale(size, size, size).setPosition(p.position);
      this.mesh.setMatrixAt(i, this.matrix);
      changed = true;
    });
    if (changed) this.mesh.instanceMatrix.needsUpdate = true;
  }
  dispose(): void { this.mesh.geometry.dispose(); (this.mesh.material as MeshStandardMaterial).dispose(); }
}
