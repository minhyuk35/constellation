// Cricket call frequencies and chirp cadence sit in a plausible range for a
// field-cricket chorus (a burst of a few short pulses, then a pause), not a
// literal recording — there is no audio asset here, only synthesis.
const CRICKET_VOICES = [4200, 4550, 3900, 4350];

export class Soundscape {
  constructor() {
    this.enabled = false;
    this.activity = 0;
    this.cricketTimers = [];
  }
  async toggle() {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.context.destination);
      // A very soft, still night-air bed underneath the crickets — barely
      // more than room tone, so the chirping reads as the main character of
      // a summer evening rather than a synth pad with insects on top.
      const filter = this.context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 260;
      filter.connect(this.master);
      this.voices = [];
      for (const frequency of [55, 82.5]) {
        const oscillator = this.context.createOscillator();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        const gain = this.context.createGain();
        gain.gain.value = 0.018;
        oscillator.connect(gain);
        gain.connect(filter);
        oscillator.start();
        this.voices.push(oscillator);
      }
      // A separate high voice, silent at rest, that setIntensity() opens up as
      // movement in front of the camera picks up — the "사운드가 움직임 강도에
      // 반응" cue from the exhibition brief, layered on top of the ambience.
      const shimmer = this.context.createOscillator();
      shimmer.type = 'triangle';
      shimmer.frequency.value = 880;
      this.shimmerGain = this.context.createGain();
      this.shimmerGain.gain.value = 0;
      shimmer.connect(this.shimmerGain);
      this.shimmerGain.connect(this.master);
      shimmer.start();
      this.voices.push(shimmer);
      // A small chorus of crickets, each chirping on its own random cadence so
      // they overlap and drift the way real ones do rather than looping in sync.
      this.cricketGain = this.context.createGain();
      this.cricketGain.gain.value = 1;
      this.cricketGain.connect(this.master);
      CRICKET_VOICES.forEach((frequency, index) => this.scheduleCricket(frequency, index));
    }
    await this.context.resume();
    this.enabled = !this.enabled;
    this.master.gain.setTargetAtTime(this.enabled ? 0.35 : 0, this.context.currentTime, 0.6);
    return this.enabled;
  }
  // One cricket's chirp train (a few quick pulses) followed by a randomized
  // silence, rescheduling itself indefinitely. Real crickets go quiet when
  // something moves nearby, so higher setIntensity() activity thins the chorus
  // rather than muting it outright.
  scheduleCricket(frequency, index) {
    const chirp = () => {
      if (this.enabled && Math.random() > this.activity * 0.7) {
        const pulses = 3 + Math.floor(Math.random() * 3);
        for (let p = 0; p < pulses; p++)
          this.cricketPulse(frequency + (Math.random() - 0.5) * 90, p * (0.045 + Math.random() * 0.015));
      }
      const next = 700 + Math.random() * 2200 + index * 180;
      this.cricketTimers[index] = setTimeout(chirp, next);
    };
    this.cricketTimers[index] = setTimeout(chirp, Math.random() * 2500);
  }
  cricketPulse(frequency, delaySeconds) {
    const now = this.context.currentTime + delaySeconds;
    const oscillator = this.context.createOscillator(),
      gain = this.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.055, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.04);
    oscillator.connect(gain);
    gain.connect(this.cricketGain);
    oscillator.start(now);
    oscillator.stop(now + 0.05);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
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
    const clamped = Math.max(0, Math.min(1, value));
    this.activity = clamped;
    if (!this.enabled || !this.shimmerGain) return;
    this.shimmerGain.gain.setTargetAtTime(clamped * 0.05, this.context.currentTime, 0.35);
  }
  reveal() {
    if (!this.enabled) return;
    for (let i = 0; i < 3; i++) setTimeout(() => this.chime(i * 2), i * 250);
  }
  // A soft descending "poof" for a star shaken out of existence.
  pop() {
    if (!this.enabled) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator(),
      gain = this.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(500, now);
    oscillator.frequency.exponentialRampToValueAtTime(120, now + 0.22);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 0.26);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
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
    this.cricketTimers.forEach((timer) => clearTimeout(timer));
    this.voices?.forEach((v) => v.stop());
    this.context?.close();
  }
}
