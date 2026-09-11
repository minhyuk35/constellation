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
  reveal() {
    if (!this.enabled) return;
    for (let i = 0; i < 3; i++) setTimeout(() => this.chime(i * 2), i * 250);
  }
  dispose() {
    this.voices?.forEach((v) => v.stop());
    this.context?.close();
  }
}
