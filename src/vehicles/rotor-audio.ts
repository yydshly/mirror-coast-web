/** Quiet, local synthesis; never creates or resumes audio before a user gesture. */
export class RotorAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private lowpass?: BiquadFilterNode;
  private tone?: OscillatorNode;
  private pulse?: OscillatorNode;
  private sources: Array<AudioScheduledSourceNode> = [];
  private muted = true;

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) { this.master?.gain.setTargetAtTime(0, this.context!.currentTime, .15); return; }
    if (typeof AudioContext === 'undefined') return;
    try {
      if (!this.context) {
        const context = this.context = new AudioContext();
        this.master = context.createGain(); this.master.gain.value = 0; this.master.connect(context.destination);
        const noise = context.createBufferSource();
        const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        noise.buffer = buffer; noise.loop = true;
        this.lowpass = context.createBiquadFilter(); this.lowpass.type = 'lowpass'; this.lowpass.frequency.value = 180;
        const noiseLevel = context.createGain(); noiseLevel.gain.value = .055;
        noise.connect(this.lowpass).connect(noiseLevel).connect(this.master);
        this.pulse = context.createOscillator(); this.pulse.type = 'sine'; this.pulse.frequency.value = 16;
        const pulseDepth = context.createGain(); pulseDepth.gain.value = .026;
        this.pulse.connect(pulseDepth).connect(noiseLevel.gain);
        this.tone = context.createOscillator(); this.tone.type = 'triangle'; this.tone.frequency.value = 55;
        const toneLevel = context.createGain(); toneLevel.gain.value = .006;
        this.tone.connect(toneLevel).connect(this.master);
        this.sources.push(noise, this.pulse, this.tone);
        for (const source of this.sources) source.start();
      }
      void this.context.resume().catch(() => undefined);
    } catch { this.muted = true; }
  }

  update(rpm: number, piloting: boolean): void {
    if (!this.context || !this.master || this.context.state === 'closed') return;
    const now = this.context.currentTime;
    const volume = this.muted ? 0 : rpm * rpm * (piloting ? .65 : .12);
    this.master.gain.setTargetAtTime(volume, now, .18);
    this.lowpass?.frequency.setTargetAtTime(90 + rpm * 230, now, .15);
    this.tone?.frequency.setTargetAtTime(28 + rpm * 38, now, .15);
    this.pulse?.frequency.setTargetAtTime(5 + rpm * 17, now, .15);
  }

  dispose(): void {
    for (const source of this.sources) { try { source.stop(); } catch { /* Already stopped. */ } }
    this.sources = [];
    if (this.context) void this.context.close().catch(() => undefined);
  }
}
