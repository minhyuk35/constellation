export class Soundscape {
  constructor() {
    this.enabled = false;
  }
  async toggle() {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.context.destination);
      const filter = this.context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 550;
      filter.connect(this.master);
      this.voices = [];
      for (const frequency of [65.406, 98, 130.813, 196]) {
        const oscillator = this.context.createOscillator();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        const gain = this.context.createGain();
        gain.gain.value = 0.04;
        oscillator.connect(gain);
        gain.connect(filter);
        oscillator.start();
        this.voices.push(oscillator);
      }
      // A separate high voice, silent at rest, that setIntensity() opens up as
      // movement in front of the camera picks up — the "사운드가 움직임 강도에
      // 반응" cue from the exhibition brief, layered on top of the fixed drone.
      const shimmer = this.context.createOscillator();
      shimmer.type = 'triangle';
      shimmer.frequency.value = 880;
      this.shimmerGain = this.context.createGain();
      this.shimmerGain.gain.value = 0;
      shimmer.connect(this.shimmerGain);
      this.shimmerGain.connect(this.master);
      shimmer.start();
      this.voices.push(shimmer);
    }
    await this.context.resume();
    this.enabled = !this.enabled;
    this.master.gain.setTargetAtTime(this.enabled ? 0.35 : 0, this.context.currentTime, 0.6);
    return this.enabled;
  }
  chime(index = 0) {
    if (!this.enabled) return;
    const frequencies = [261.626, 293.665, 329.628, 391.995, 440, 523.251];
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator(),
      gain = this.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequencies[index % frequencies.length];
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.17, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 2.8);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 3);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }
  // value: 0 (still/empty) to 1 (someone actively interacting). Smoothed so it
  // never pops when presence or editing activity turns on and off quickly.
  setIntensity(value) {
    if (!this.enabled || !this.shimmerGain) return;
    const clamped = Math.max(0, Math.min(1, value));
    this.shimmerGain.gain.setTargetAtTime(clamped * 0.05, this.context.currentTime, 0.35);
  }
  reveal() {
    if (!this.enabled) return;
    for (let i = 0; i < 3; i++) setTimeout(() => this.chime(i * 2), i * 250);
  }
  // A short filtered-noise click, timed with the held-pose silhouette reveal's
  // screen flash — "클라이맥스 순간 셔터음+화면 플래시로 촬영 타이밍 암시" from the
  // exhibition brief's photo-op ideas. Synthesized rather than a sound asset.
  shutter() {
    if (!this.enabled) return;
    const now = this.context.currentTime;
    const duration = 0.09;
    const buffer = this.context.createBuffer(
      1,
      Math.floor(this.context.sampleRate * duration),
      this.context.sampleRate,
    );
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    const filter = this.context.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1800;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(now);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }
  dispose() {
    this.voices?.forEach((v) => v.stop());
    this.context?.close();
  }
}
