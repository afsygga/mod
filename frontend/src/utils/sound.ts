const PRESET_KEY = 'sound_preset';
const CUSTOM_KEY = 'sound_custom_data';
const ENABLED_KEY = 'sound_enabled';
const VOLUME_KEY = 'sound_volume';

export type SoundPreset = 'ding' | 'pop' | 'alert' | 'chime' | 'pluck' | 'custom' | 'off';

interface Settings {
  enabled: boolean;
  preset: SoundPreset;
  customDataUrl: string | null;
  volume: number;
}

export function getSoundSettings(): Settings {
  return {
    enabled: localStorage.getItem(ENABLED_KEY) !== 'false',
    preset: (localStorage.getItem(PRESET_KEY) as SoundPreset) || 'ding',
    customDataUrl: localStorage.getItem(CUSTOM_KEY),
    volume: parseFloat(localStorage.getItem(VOLUME_KEY) || '0.5'),
  };
}

export function setSoundSettings(s: Partial<Settings>): void {
  if (s.enabled !== undefined) localStorage.setItem(ENABLED_KEY, String(s.enabled));
  if (s.preset !== undefined) localStorage.setItem(PRESET_KEY, s.preset);
  if (s.customDataUrl !== undefined) {
    if (s.customDataUrl) localStorage.setItem(CUSTOM_KEY, s.customDataUrl);
    else localStorage.removeItem(CUSTOM_KEY);
  }
  if (s.volume !== undefined) localStorage.setItem(VOLUME_KEY, String(s.volume));
}

// Web Audio API for synth built-in tones (no files, instant)
let audioCtx: AudioContext | null = null;
function ctx(): AudioContext {
  if (!audioCtx) audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  return audioCtx;
}

function tone(freq: number, durationMs: number, type: OscillatorType = 'sine', volume = 0.3, attackMs = 5, releaseMs = 80) {
  const ac = ctx();
  if (ac.state === 'suspended') ac.resume();
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const now = ac.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + attackMs / 1000);
  gain.gain.linearRampToValueAtTime(0.0001, now + durationMs / 1000);
  gain.gain.exponentialRampToValueAtTime(0.00001, now + (durationMs + releaseMs) / 1000);
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start(now);
  osc.stop(now + (durationMs + releaseMs) / 1000);
}

function play(preset: SoundPreset, volume: number) {
  switch (preset) {
    case 'ding':
      tone(1318, 80, 'sine', volume * 0.4);     // E6
      tone(2093, 220, 'sine', volume * 0.3, 5, 200); // C7
      break;
    case 'pop':
      tone(880, 50, 'square', volume * 0.25);  // A5 — short pop
      break;
    case 'alert':
      tone(622, 120, 'triangle', volume * 0.4); // D#5
      setTimeout(() => tone(740, 120, 'triangle', volume * 0.4), 140); // F#5
      setTimeout(() => tone(622, 180, 'triangle', volume * 0.4), 280); // D#5
      break;
    case 'chime':
      tone(1568, 600, 'sine', volume * 0.3, 10, 400); // G6 — soft chime
      setTimeout(() => tone(2349, 600, 'sine', volume * 0.25, 10, 400), 80); // D7
      break;
    case 'pluck':
      tone(440, 250, 'sawtooth', volume * 0.2, 1, 200); // A4 — pluck
      break;
  }
}

let lastPlayedAt = 0;
const THROTTLE_MS = 800; // don't play more than once every 800ms

export function playNotification(): void {
  const s = getSoundSettings();
  if (!s.enabled || s.preset === 'off') return;
  const now = Date.now();
  if (now - lastPlayedAt < THROTTLE_MS) return;
  lastPlayedAt = now;

  if (s.preset === 'custom' && s.customDataUrl) {
    try {
      const audio = new Audio(s.customDataUrl);
      audio.volume = s.volume;
      audio.play().catch(() => {});
    } catch {}
  } else {
    play(s.preset, s.volume);
  }
}

export function previewSound(preset: SoundPreset, volume = 0.5): void {
  if (preset === 'off') return;
  if (preset === 'custom') {
    const s = getSoundSettings();
    if (s.customDataUrl) {
      const audio = new Audio(s.customDataUrl);
      audio.volume = volume;
      audio.play().catch(() => {});
    }
    return;
  }
  play(preset, volume);
}
