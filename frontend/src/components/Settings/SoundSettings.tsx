import React, { useState, useRef } from 'react';
import { Volume2, VolumeX, Play, Upload, Trash2 } from 'lucide-react';
import { getSoundSettings, setSoundSettings, previewSound, SoundPreset } from '../../utils/sound';

interface Props {
  lang: 'ru' | 'en';
}

const PRESETS: { id: SoundPreset; label: string }[] = [
  { id: 'ding', label: 'Ding' },
  { id: 'pop', label: 'Pop' },
  { id: 'alert', label: 'Alert' },
  { id: 'chime', label: 'Chime' },
  { id: 'pluck', label: 'Pluck' },
  { id: 'custom', label: 'Custom' },
];

export function SoundSettings({ lang }: Props) {
  const initial = getSoundSettings();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [preset, setPreset] = useState<SoundPreset>(initial.preset);
  const [volume, setVolume] = useState(initial.volume);
  const [customDataUrl, setCustomDataUrl] = useState<string | null>(initial.customDataUrl);
  const fileRef = useRef<HTMLInputElement>(null);

  const update = (changes: any) => {
    if (changes.enabled !== undefined) setEnabled(changes.enabled);
    if (changes.preset !== undefined) setPreset(changes.preset);
    if (changes.volume !== undefined) setVolume(changes.volume);
    if (changes.customDataUrl !== undefined) setCustomDataUrl(changes.customDataUrl);
    setSoundSettings(changes);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500_000) {
      alert(lang === 'ru' ? 'Файл слишком большой (макс 500 KB)' : 'File too large (max 500 KB)');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      update({ customDataUrl: dataUrl, preset: 'custom' });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div style={{ padding: '6px 0' }}>
      {/* Enable toggle */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.05)',
      }}>
        <div>
          <div style={{ fontSize: '13px', fontWeight: 500, color: 'rgba(255,255,255,0.88)' }}>
            {lang === 'ru' ? 'Звук уведомлений' : 'Notification sounds'}
          </div>
          <div style={{ fontSize: '11px', marginTop: '2px', color: 'rgba(255,255,255,0.34)' }}>
            {lang === 'ru' ? 'Проигрывать звук когда новый спамер попадает в очередь' : 'Play sound when new spammer enters queue'}
          </div>
        </div>
        <button onClick={() => update({ enabled: !enabled })} style={{
          padding: '8px 14px', borderRadius: '10px', cursor: 'pointer',
          background: enabled ? 'rgba(0,200,120,0.12)' : 'rgba(255,255,255,0.025)',
          color: enabled ? '#00c878' : 'rgba(255,255,255,0.5)',
          border: 'none', outline: 'none',
          display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600,
        }}>
          {enabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
          {enabled ? 'ON' : 'OFF'}
        </button>
      </div>

      {enabled && (
        <>
          {/* Volume */}
          <div style={{ padding: '16px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <div style={{ fontSize: '13px', fontWeight: 500, color: 'rgba(255,255,255,0.88)' }}>
                {lang === 'ru' ? 'Громкость' : 'Volume'}
              </div>
              <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', minWidth: '36px', textAlign: 'right' }}>
                {Math.round(volume * 100)}%
              </span>
            </div>
            <input type="range" min="0" max="1" step="0.05" value={volume}
              onChange={e => update({ volume: parseFloat(e.target.value) })}
              style={{ width: '100%' }} />
          </div>

          {/* Preset selection */}
          <div style={{ padding: '16px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ fontSize: '13px', fontWeight: 500, color: 'rgba(255,255,255,0.88)', marginBottom: '12px' }}>
              {lang === 'ru' ? 'Звук' : 'Sound'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
              {PRESETS.map(p => {
                const active = preset === p.id;
                const isCustom = p.id === 'custom';
                const disabled = isCustom && !customDataUrl;
                return (
                  <div key={p.id} style={{
                    padding: '12px',
                    borderRadius: '10px', cursor: disabled ? 'default' : 'pointer',
                    background: active ? 'rgba(255,200,0,0.1)' : 'rgba(255,255,255,0.025)',
                    border: active ? '1px solid rgba(255,200,0,0.25)' : '1px solid transparent',
                    opacity: disabled ? 0.4 : 1,
                  }}
                  onClick={() => { if (!disabled) update({ preset: p.id }); }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: active ? '#ffc800' : 'rgba(255,255,255,0.7)' }}>
                        {p.label}
                      </span>
                      <button onClick={e => { e.stopPropagation(); if (!disabled) previewSound(p.id, volume); }}
                        disabled={disabled}
                        style={{
                          padding: '4px', borderRadius: '6px',
                          background: 'rgba(255,255,255,0.04)', border: 'none',
                          cursor: disabled ? 'default' : 'pointer',
                          display: 'flex', alignItems: 'center',
                        }}>
                        <Play size={10} style={{ color: 'rgba(255,255,255,0.5)' }} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Custom file upload */}
            <div style={{ marginTop: '14px' }}>
              <input ref={fileRef} type="file" accept="audio/mp3,audio/mpeg,audio/wav,audio/ogg"
                onChange={handleFile} style={{ display: 'none' }} />
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button onClick={() => fileRef.current?.click()} style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '8px 14px', borderRadius: '10px', cursor: 'pointer',
                  background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.7)',
                  border: 'none', fontSize: '12px', fontWeight: 600,
                }}>
                  <Upload size={11} />
                  {customDataUrl
                    ? (lang === 'ru' ? 'Заменить файл' : 'Replace file')
                    : (lang === 'ru' ? 'Загрузить mp3' : 'Upload mp3')}
                </button>
                {customDataUrl && (
                  <button onClick={() => update({ customDataUrl: null, preset: preset === 'custom' ? 'ding' : preset })} style={{
                    padding: '8px 10px', borderRadius: '10px', cursor: 'pointer',
                    background: 'rgba(240,71,71,0.08)', color: '#ff7070', border: 'none',
                  }}>
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', marginTop: '8px', lineHeight: 1.4 }}>
                {lang === 'ru'
                  ? 'Поддержка mp3, wav, ogg. Макс 500 KB. Файл хранится локально в браузере.'
                  : 'mp3, wav, ogg. Max 500 KB. Stored locally in browser.'}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
