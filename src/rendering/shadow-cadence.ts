/** Cache the expensive static city shadow between updates. Moving actors still
 * refresh at up to 30 Hz; slow frames always retain an intervening cached frame.
 * Terrain/time/focus changes request an immediate update. */
export class ShadowCadence {
  private elapsed = Infinity;
  private renderedLastFrame=false;
  invalidate(): void { this.elapsed = Infinity; }
  update(dt: number): boolean {
    this.elapsed += Math.max(0, dt);
    if(Number.isFinite(this.elapsed)&&this.renderedLastFrame){this.renderedLastFrame=false;return false;}
    if (this.elapsed + 1e-6 < 1 / 30) return false;
    this.elapsed = 0;
    this.renderedLastFrame=true;
    return true;
  }
}
