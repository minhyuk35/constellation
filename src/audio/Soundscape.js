export class Soundscape {
  constructor() {
    this.enabled = false;
    this.activity = 0;
  }
  async toggle() {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.context.destination);
      // No ambient bed is wired up right now — this is where one goes.
      // `this.master` is the shared output every sound here uses (including
      // chime/reveal/pop/shutter below), so route an ambience's own gain node
      // into `this.master` and .start() it, e.g.:
      //   const ambience = this.context.createBufferSource();
      //   ambience.buffer = await loadYourAudioBuffer(this.context);
      //   ambience.loop = true;
      //   const ambienceGain = this.context.createGain();
      //   ambienceGain.gain.value = 0.3;
      //   ambience.connect(ambienceGain).connect(this.master);
      //   ambience.start();
      // `setIntensity()` below already receives a live 0..1 "how much is
      // happening right now" value once a second from main.js's render loop
      // (pose-tracked presence, or recent star edits) — connect a gain node
      // to it there if the ambience should react to movement.
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
  // value: 0 (still/empty) to 1 (someone actively interacting). Not connected
  // to anything yet — see the note in toggle() above.
  setIntensity(value) {
    this.activity = Math.max(0, Math.min(1, value));
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
  // A short filtered-noise click, timed with the held-pose silhouette reveal
  // — "클라이맥스 순간 셔터음으로 촬영 타이밍 암시" from the exhibition brief's
  // photo-op ideas. Synthesized rather than a sound asset.
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
    this.context?.close();
  }
}
