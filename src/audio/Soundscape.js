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
  dispose() {
    this.voices?.forEach((v) => v.stop());
    this.context?.close();
  }
}
