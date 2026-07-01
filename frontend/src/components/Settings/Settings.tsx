import React, { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sliders, Clock, ShieldCheck, Tv2, MessageSquare, Save, Check, Volume2, ListChecks, Send } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Channel, AppSettings } from '../../types';
import { api } from '../../hooks/useApi';
import { T, Lang } from '../../utils/i18n';
import { SoundSettings } from './SoundSettings';
import { WhitelistSettings } from './WhitelistSettings';
import { TelegramSettings } from './TelegramSettings';
import { Footer } from '../Footer/Footer';
import { useIsMobile } from '../../hooks/useIsMobile';

interface Props {
  settings: AppSettings;
  channels: Channel[];
  onSave: (s: AppSettings) => void;
  lang: Lang;
}

// ============================================================================
// Toggle
// ============================================================================
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)}
      style={{
        position: 'relative', width: '42px', height: '24px', borderRadius: '12px',
        background: checked ? 'rgba(0,200,120,0.28)' : 'rgba(255,255,255,0.06)',
        border: checked ? '1px solid rgba(0,200,120,0.5)' : '1px solid rgba(255,255,255,0.1)',
        cursor: 'pointer', flexShrink: 0, transition: 'background 0.18s, border-color 0.18s',
      }}>
      <span style={{
        position: 'absolute', top: '2px',
        left: checked ? '20px' : '2px',
        width: '18px', height: '18px', borderRadius: '50%',
        background: checked ? '#00e08a' : 'rgba(255,255,255,0.35)',
        boxShadow: checked ? '0 0 10px rgba(0,200,120,0.5)' : 'none',
        transition: 'left 0.22s cubic-bezier(0.4,0,0.2,1), background 0.18s',
      }} />
    </button>
  );
}

// ============================================================================
// Draggable Slider — pure pointer events, smooth
// ============================================================================
function Slider({ value, min, max, step = 1, onChange, color = '#ffffff' }: {
  value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void; color?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [, forceRender] = useState(0);
  const pct = ((value - min) / (max - min)) * 100;

  const updateFromX = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const rawPct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const rawValue = min + rawPct * (max - min);
    const snapped = Math.round(rawValue / step) * step;
    const clamped = Math.max(min, Math.min(max, snapped));
    onChange(clamped);
  }, [min, max, step, onChange]);

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      e.preventDefault();
      updateFromX(e.clientX);
    };
    const handleUp = () => {
      if (draggingRef.current) {
        draggingRef.current = false;
        forceRender(n => n + 1);
      }
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [updateFromX]);

  const handleDown = (e: React.PointerEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    forceRender(n => n + 1);
    updateFromX(e.clientX);
  };

  return (
    <div
      ref={trackRef}
      onPointerDown={handleDown}
      style={{
        position: 'relative', flex: 1, minWidth: 0, height: '24px',
        display: 'flex', alignItems: 'center', cursor: 'pointer',
        touchAction: 'none', userSelect: 'none',
      }}>
      {/* Track background */}
      <div style={{
        position: 'absolute', left: 0, right: 0, height: '4px', borderRadius: '4px',
        background: 'rgba(255,255,255,0.08)', pointerEvents: 'none',
      }} />
      {/* Fill */}
      <div style={{
        position: 'absolute', left: 0, height: '4px', width: `${pct}%`,
        borderRadius: '4px', background: color, pointerEvents: 'none',
        boxShadow: `0 0 10px ${color}40`,
      }} />
      {/* Thumb */}
      <div
        style={{
          position: 'absolute', top: '50%',
          left: `calc(${pct}% - 9px)`,
          marginTop: '-9px',
          width: '18px', height: '18px', borderRadius: '50%',
          background: '#ffffff',
          border: `2px solid ${color}`,
          boxShadow: draggingRef.current ? `0 0 18px ${color}80` : `0 0 10px ${color}40`,
          transform: draggingRef.current ? 'scale(1.18)' : 'scale(1)',
          pointerEvents: 'none',
          transition: 'transform 0.12s, box-shadow 0.12s',
        }} />
    </div>
  );
}

// ============================================================================
// Static row components (OUTSIDE Settings so input doesn't lose focus)
// ============================================================================
const SliderRow = React.memo(function SliderRow({ label, desc, value, min, max, onChange, color, unit }: {
  label: string; desc: string; value: number; min: number; max: number;
  onChange: (v: number) => void; color?: string; unit?: string;
}) {
  const c = color || '#ffffff';
  return (
    <div style={{ padding: '18px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', marginBottom: '14px' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: c, boxShadow: `0 0 8px ${c}80`, flexShrink: 0 }} />
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>{label}</div>
          </div>
          <div style={{ fontSize: '11px', marginTop: '4px', color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>{desc}</div>
        </div>
        <div style={{
          fontSize: '16px', fontWeight: 700, minWidth: '52px', textAlign: 'center',
          padding: '6px 12px', borderRadius: '10px', flexShrink: 0,
          background: `${c}14`,
          color: c,
          border: `1px solid ${c}33`,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {value}{unit || ''}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace', minWidth: '20px' }}>{min}</span>
        <Slider value={value} min={min} max={max} onChange={onChange} color={c} />
        <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace', minWidth: '20px' }}>{max}</span>
      </div>
    </div>
  );
});

const ToggleRow = React.memo(function ToggleRow({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px',
      padding: '15px 0', borderBottom: '1px solid rgba(255,255,255,0.05)',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>{label}</div>
        <div style={{ fontSize: '11px', marginTop: '3px', color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>{desc}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
        <span style={{
          fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', width: '26px', textAlign: 'right',
          color: checked ? '#00c878' : 'rgba(255,255,255,0.3)', transition: 'color 0.18s',
        }}>{checked ? 'ON' : 'OFF'}</span>
        <Toggle checked={checked} onChange={onChange} />
      </div>
    </div>
  );
});

const SelectRow = React.memo(function SelectRow({ label, desc, value, options, onChange }: {
  label: string; desc: string; value: number; options: { value: number; label: string }[]; onChange: (v: number) => void;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '14px 0', borderBottom: '1px solid rgba(255,255,255,0.05)',
    }}>
      <div>
        <div style={{ fontSize: '13px', fontWeight: 500, color: 'rgba(255,255,255,0.88)' }}>{label}</div>
        <div style={{ fontSize: '11px', marginTop: '2px', color: 'rgba(255,255,255,0.34)' }}>{desc}</div>
      </div>
      <select value={value} onChange={e => onChange(parseInt(e.target.value))}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
});

const InputRow = React.memo(function InputRow({ label, desc, value, onChange, placeholder }: {
  label: string; desc: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div style={{ padding: '14px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <div style={{ marginBottom: '10px' }}>
        <div style={{ fontSize: '13px', fontWeight: 500, color: 'rgba(255,255,255,0.88)' }}>{label}</div>
        <div style={{ fontSize: '11px', marginTop: '2px', color: 'rgba(255,255,255,0.34)' }}>{desc}</div>
      </div>
      <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{
          width: '100%', padding: '10px 14px', borderRadius: '11px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          color: 'rgba(255,255,255,0.9)', fontSize: '13px',
          outline: 'none',
        }} />
    </div>
  );
});

const Section = React.memo(function Section({ title, subtitle, icon: Icon, color = '#a070ff', children }: {
  title: string; subtitle?: string; icon?: LucideIcon; color?: string; children: React.ReactNode;
}) {
  return (
    <div style={{
      padding: '22px 24px', marginBottom: '16px',
      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: '16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '13px', marginBottom: '4px', paddingBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        {Icon && (
          <div style={{
            width: '38px', height: '38px', borderRadius: '11px', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: `${color}18`, border: `1px solid ${color}33`,
          }}>
            <Icon size={18} style={{ color }} />
          </div>
        )}
        <div style={{ paddingTop: Icon ? '2px' : 0 }}>
          <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'rgba(255,255,255,0.92)', letterSpacing: '-0.01em' }}>{title}</h3>
          {subtitle && <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginTop: '4px', lineHeight: 1.5 }}>{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
});

// ============================================================================
// Main Settings component
// ============================================================================
export function Settings({ settings, channels, onSave, lang }: Props) {
  const isMobile = useIsMobile();
  const [s, setS] = useState<AppSettings>(settings);
  const [baseline, setBaseline] = useState<AppSettings>(settings);
  const [muteReason, setMuteReason] = useState<string>(
    () => localStorage.getItem('mute_reason') || ''
  );
  const [muteReasonBaseline, setMuteReasonBaseline] = useState<string>(
    () => localStorage.getItem('mute_reason') || ''
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeSection, setActiveSection] = useState('detection');
  const contentRef = useRef<HTMLDivElement>(null);
  const t = T[lang];

  // Dirty = current differs from last-saved baseline
  const isDirty = JSON.stringify(s) !== JSON.stringify(baseline)
    || muteReason !== muteReasonBaseline;

  // Load actual mute_reason from backend (DB) on mount so UI matches what's really used
  useEffect(() => {
    api.get<Record<string, string>>('/api/settings').then(raw => {
      if (typeof raw.mute_reason === 'string') {
        setMuteReason(raw.mute_reason);
        setMuteReasonBaseline(raw.mute_reason);
        localStorage.setItem('mute_reason', raw.mute_reason);
      }
    }).catch(() => {});
  }, []);

  const update = useCallback((k: keyof AppSettings, v: any) => {
    setS(prev => ({ ...prev, [k]: v }));
  }, []);

  // Stable callbacks per-key so memoized rows don't ref-change
  const updaters = useRef<Record<string, (v: any) => void>>({});
  const getUpdater = (key: keyof AppSettings) => {
    if (!updaters.current[key as string]) {
      updaters.current[key as string] = (v: any) => update(key, v);
    }
    return updaters.current[key as string];
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put('/api/settings', {
        detect_threshold: String(s.detect_threshold),
        auto_mute_threshold: String(s.auto_mute_threshold),
        similarity_threshold: String(s.similarity_threshold),
        burst_limit: String(s.burst_limit),
        mem_window_seconds: String(s.mem_window_seconds),
        link_detection: String(s.link_detection),
        auto_mode: String(s.auto_mode),
        default_mute_duration: String(s.default_mute_duration),
        set_game_enabled: String(s.set_game_enabled),
        mute_reason: muteReason,
      });
      localStorage.setItem('mute_reason', muteReason);
      onSave(s);
      setBaseline(s);
      setMuteReasonBaseline(muteReason);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) { console.error(err); }
    finally { setSaving(false); }
  };

  const sections = [
    { id: 'detection', icon: Sliders, color: '#ffc800', label: lang === 'ru' ? 'Детекция' : 'Detection' },
    { id: 'timing', icon: Clock, color: '#a070ff', label: lang === 'ru' ? 'Время' : 'Timing' },
    { id: 'automod', icon: ShieldCheck, color: '#00c878', label: lang === 'ru' ? 'Автомод' : 'AutoMod' },
    { id: 'message', icon: MessageSquare, color: '#00e5cc', label: lang === 'ru' ? 'Сообщение' : 'Reason' },
    { id: 'sounds', icon: Volume2, color: '#ffc800', label: lang === 'ru' ? 'Звуки' : 'Sounds' },
    { id: 'telegram', icon: Send, color: '#7eaaff', label: 'Telegram' },
    { id: 'whitelist', icon: ListChecks, color: '#00c878', label: lang === 'ru' ? 'Whitelist' : 'Whitelist' },
    { id: 'channels', icon: Tv2, color: '#a070ff', label: lang === 'ru' ? 'Каналы' : 'Channels' },
  ];

  // Scroll-spy: highlight the section currently in view
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    const ids = sections.map(s => s.id);
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter(e => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible.length > 0) {
        const id = visible[0].target.id.replace('sec-', '');
        setActiveSection(id);
      }
    }, { root, rootMargin: '-10% 0px -70% 0px', threshold: 0 });
    ids.forEach(id => { const el = document.getElementById(`sec-${id}`); if (el) observer.observe(el); });
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels.length]);

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      {/* Section sidebar — hidden on mobile */}
      <div className="settings-sidebar" style={{
        width: '180px', flexShrink: 0, padding: '20px 12px',
        borderRight: '1px solid rgba(255,255,255,0.04)',
        background: 'rgba(255,255,255,0.012)',
        overflowY: 'auto',
        display: isMobile ? 'none' : undefined,
      }}>
        <div style={{
          fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.16em', marginBottom: '14px', paddingLeft: '10px',
          color: 'rgba(255,255,255,0.3)',
        }}>{lang === 'ru' ? 'Разделы' : 'Sections'}</div>

        {sections.map(({ id, icon: Icon, label, color }) => {
          const active = activeSection === id;
          return (
            <button key={id} onClick={() => {
              setActiveSection(id);
              document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
              style={{
                position: 'relative',
                display: 'flex', alignItems: 'center', gap: '11px',
                width: '100%', padding: '10px 12px', marginBottom: '3px',
                borderRadius: '10px', cursor: 'pointer',
                background: active ? `${color}18` : 'transparent',
                border: active ? `1px solid ${color}33` : '1px solid transparent',
                color: active ? '#ffffff' : 'rgba(255,255,255,0.5)',
                fontSize: '13px', fontWeight: active ? 600 : 500, textAlign: 'left',
                transition: 'background 0.15s, color 0.15s, border-color 0.15s',
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
              <Icon size={15} style={{ color: active ? color : 'rgba(255,255,255,0.4)', flexShrink: 0 }} />
              {label}
            </button>
          );
        })}
      </div>

      {/* Settings content */}
      <div ref={contentRef} className="settings-content" style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '14px 16px' : '24px 32px' }}>
        <div style={{ maxWidth: '720px', margin: '0 auto', paddingBottom: '80px' }}>

          <div id="sec-detection">
            <Section icon={Sliders} color="#ffc800" title={lang === 'ru' ? 'Движок обнаружения спама' : 'Spam Detection Engine'}
              subtitle={lang === 'ru'
                ? 'Каждое сообщение получает оценку 0–100. Чем выше score, тем выше вероятность спама.'
                : 'Each message gets a 0–100 score. Higher score means higher spam probability.'}>
              <SliderRow label={t.detectThreshold}
                desc={lang === 'ru'
                  ? 'Score ≥ этого значения → пользователь попадает в очередь модерации. Например: 70 = 7 повторяющихся "ку" появятся в очереди.'
                  : 'Score ≥ this → user appears in queue. Example: 70 = 7 repeating "lol" will appear in queue.'}
                value={s.detect_threshold} min={30} max={95}
                onChange={getUpdater('detect_threshold')} color="#ffc800" />
              <SliderRow label={t.autoMuteThreshold}
                desc={lang === 'ru'
                  ? 'Score ≥ этого значения → пользователь будет автоматически замьючен. Например: 90 = очевидный спам с ссылкой или 5+ одинаковых сообщений.'
                  : 'Score ≥ this → user is auto-muted. Example: 90 = obvious spam with links or 5+ identical messages.'}
                value={s.auto_mute_threshold} min={50} max={100}
                onChange={getUpdater('auto_mute_threshold')} color="#ff7070" />
              <SliderRow label={t.similarityThreshold}
                desc={lang === 'ru'
                  ? 'Насколько похожими должны быть сообщения для флага. 75% = "кукуку" и "кукукук" считаются одинаковыми.'
                  : 'How similar messages must be to flag. 75% = "lolol" and "lololo" treated as same.'}
                value={s.similarity_threshold} min={50} max={100}
                onChange={getUpdater('similarity_threshold')} unit="%" />
              <SliderRow label={t.burstLimit}
                desc={lang === 'ru'
                  ? 'Максимум сообщений за окно памяти до флага. 6 = на 7-м сообщении за 2 минуты сработает burst активность.'
                  : 'Max messages in memory window before burst flag. 6 = on 7th message in 2 minutes burst triggers.'}
                value={s.burst_limit} min={2} max={20}
                onChange={getUpdater('burst_limit')} />
            </Section>
          </div>

          <div id="sec-timing">
            <Section icon={Clock} color="#a070ff" title={lang === 'ru' ? 'Окна времени' : 'Time Windows'}
              subtitle={lang === 'ru' ? 'Период анализа и длительность мута' : 'Analysis period and mute duration'}>
              <SelectRow label={t.memoryDuration} desc={t.memoryDurationDesc} value={s.mem_window_seconds}
                options={[
                  { value: 10, label: '10s' }, { value: 30, label: '30s' },
                  { value: 60, label: '60s' }, { value: 120, label: '120s' },
                  { value: 300, label: '300s' }, { value: 600, label: '600s' },
                ]} onChange={getUpdater('mem_window_seconds')} />
              <SelectRow label={t.defaultMuteDuration} desc={t.defaultMuteDurationDesc} value={s.default_mute_duration}
                options={[
                  { value: 60, label: lang === 'ru' ? '1 минута' : '1 minute' },
                  { value: 300, label: lang === 'ru' ? '5 минут' : '5 minutes' },
                  { value: 600, label: lang === 'ru' ? '10 минут' : '10 minutes' },
                  { value: 1800, label: lang === 'ru' ? '30 минут' : '30 minutes' },
                  { value: 3600, label: lang === 'ru' ? '1 час' : '1 hour' },
                  { value: 21600, label: lang === 'ru' ? '6 часов' : '6 hours' },
                  { value: 86400, label: lang === 'ru' ? '1 день' : '1 day' },
                  { value: 259200, label: lang === 'ru' ? '3 дня' : '3 days' },
                  { value: 604800, label: lang === 'ru' ? '1 неделя' : '1 week' },
                  { value: 1209600, label: lang === 'ru' ? '2 недели' : '2 weeks' },
                ]} onChange={getUpdater('default_mute_duration')} />
            </Section>
          </div>

          <div id="sec-automod">
            <Section icon={ShieldCheck} color="#00c878" title={lang === 'ru' ? 'Автоматическая модерация' : 'Auto Moderation'}
              subtitle={lang === 'ru' ? 'Управление автоматическими действиями' : 'Control automatic actions'}>
              <ToggleRow label={t.autoMode} desc={t.autoModeDesc} checked={s.auto_mode} onChange={getUpdater('auto_mode')} />
              <ToggleRow label={t.linkDetection} desc={t.linkDetectionDesc} checked={s.link_detection} onChange={getUpdater('link_detection')} />
              <ToggleRow label={lang === 'ru' ? 'Команда !g' : '!g command'} desc={lang === 'ru' ? 'Позволяет модераторам менять категорию канала через !g <игра>' : 'Allows mods to change channel category via !g <game>'} checked={s.set_game_enabled} onChange={getUpdater('set_game_enabled')} />
            </Section>
          </div>

          <div id="sec-message">
            <Section icon={MessageSquare} color="#00e5cc" title={lang === 'ru' ? 'Причина мута' : 'Mute Reason'}
              subtitle={lang === 'ru' ? 'Текст, который будет отображаться при муте' : 'Text shown when muting users'}>
              <InputRow label={lang === 'ru' ? 'Причина' : 'Reason'}
                desc={lang === 'ru' ? 'Отображается в карточке после мута' : 'Shown in card after muting'}
                value={muteReason} onChange={setMuteReason}
                placeholder={lang === 'ru' ? 'Например: Не спамить.' : 'e.g. Don\'t spam.'} />
              <div style={{ paddingTop: '16px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.55)', marginBottom: '9px' }}>
                  {lang === 'ru' ? 'Предпросмотр:' : 'Preview:'}
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  <div style={{
                    width: '30px', height: '30px', borderRadius: '50%', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(0,229,204,0.15)', border: '1px solid rgba(0,229,204,0.3)',
                    color: '#00e5cc', fontSize: '13px', fontWeight: 700,
                  }}>M</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: '#00e5cc', marginBottom: '3px' }}>
                      ModBot <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 500 }}>· mod</span>
                    </div>
                    <div style={{
                      display: 'inline-block',
                      fontSize: '12.5px', padding: '8px 13px',
                      borderRadius: '4px 13px 13px 13px', lineHeight: 1.45,
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      color: muteReason ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.35)',
                      fontStyle: muteReason ? 'normal' : 'italic',
                    }}>{muteReason || (lang === 'ru' ? '(без причины)' : '(no reason)')}</div>
                  </div>
                </div>
              </div>
            </Section>
          </div>

          <div id="sec-sounds">
            <Section icon={Volume2} color="#ffc800" title={lang === 'ru' ? 'Звуковые уведомления' : 'Sound notifications'}
              subtitle={lang === 'ru' ? 'Реагирует когда новый спамер попадает в очередь' : 'Plays when new spammer enters queue'}>
              <SoundSettings lang={lang} />
            </Section>
          </div>

          <div id="sec-telegram">
            <Section icon={Send} color="#7eaaff" title={lang === 'ru' ? 'Telegram бот' : 'Telegram bot'}
              subtitle={lang === 'ru' ? 'Управляй модерацией со смартфона' : 'Manage moderation from your phone'}>
              <TelegramSettings lang={lang} />
            </Section>
          </div>

          <div id="sec-whitelist">
            <Section icon={ListChecks} color="#00c878" title={lang === 'ru' ? 'Whitelist фраз' : 'Whitelist phrases'}
              subtitle={lang === 'ru' ? 'Фразы которые НЕ считаются спамом (per-channel)' : 'Phrases that won\'t be flagged as spam (per-channel)'}>
              <WhitelistSettings channels={channels} lang={lang} />
            </Section>
          </div>

          {channels.length > 0 && (
            <div id="sec-channels">
              <Section icon={Tv2} color="#a070ff" title={lang === 'ru' ? 'Настройки каналов' : 'Channel Settings'}
                subtitle={lang === 'ru' ? 'Авто-модерация для каждого канала' : 'Auto-moderation for each channel'}>
                {channels.map(ch => (
                  <ToggleRow key={ch.name} label={`📺 ${ch.name}`} desc={`${t.status}: ${ch.status}`}
                    checked={ch.auto_mod} onChange={async (v: boolean) => {
                      await api.patch(`/api/channels/${ch.name}/automod`, { enabled: v }).catch(console.error);
                    }} />
                ))}
              </Section>
            </div>
          )}
        </div>

        <Footer />

        {/* Sticky save bar at bottom edge — only when there are unsaved changes */}
        <AnimatePresence>
          {(isDirty || saving || saved) && (
            <motion.div
              initial={{ y: 80, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 80, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              style={{
                position: 'fixed', bottom: 0, left: isMobile ? 0 : '180px', right: 0,
                padding: isMobile ? '14px 16px 18px' : '18px 32px 22px',
                background: 'linear-gradient(to top, rgba(5,5,8,0.98) 45%, rgba(5,5,8,0.85) 72%, transparent)',
                pointerEvents: 'none',
                zIndex: 10,
              }}>
              <div style={{
                maxWidth: '720px', margin: '0 auto',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px',
                padding: '10px 12px 10px 18px', borderRadius: '14px',
                background: 'rgba(20,20,26,0.85)', border: '1px solid rgba(255,255,255,0.08)',
                boxShadow: '0 8px 28px rgba(0,0,0,0.5)', pointerEvents: 'auto',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '9px', minWidth: 0 }}>
                  <span style={{
                    width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
                    background: saved ? '#00c878' : '#ffc800',
                    boxShadow: `0 0 8px ${saved ? '#00c878' : '#ffc800'}`,
                  }} />
                  <span style={{ fontSize: '12.5px', fontWeight: 500, color: 'rgba(255,255,255,0.75)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {saved
                      ? (lang === 'ru' ? 'Настройки сохранены' : 'Settings saved')
                      : (lang === 'ru' ? 'Есть несохранённые изменения' : 'You have unsaved changes')}
                  </span>
                </div>
                <button onClick={handleSave} disabled={saving}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0,
                    padding: '11px 22px', borderRadius: '11px',
                    fontSize: '13px', fontWeight: 700, cursor: saving ? 'default' : 'pointer',
                    background: saved ? 'rgba(0,200,120,0.18)' : 'rgba(160,112,255,0.9)',
                    color: saved ? '#00c878' : '#ffffff',
                    border: saved ? '1px solid rgba(0,200,120,0.4)' : 'none', outline: 'none',
                    opacity: saving ? 0.6 : 1,
                    boxShadow: saved ? '0 0 20px rgba(0,200,120,0.2)' : '0 4px 16px rgba(160,112,255,0.35)',
                    transition: 'background 0.2s',
                  }}>
                  {saved ? <Check size={14} /> : <Save size={14} />}
                  {saving ? t.saving : saved ? t.saved : t.saveSettings}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
