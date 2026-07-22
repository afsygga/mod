import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, X, Check, AlertTriangle } from 'lucide-react';
import { QueueItem, SuspicionMark } from '../../types';
import { getInitials } from '../../utils/colors';
import { Avatar } from '../UserCard/Avatar';
import { api } from '../../hooks/useApi';
import { T, Lang, muteDurations } from '../../utils/i18n';
import { useIsMobile } from '../../hooks/useIsMobile';
import { ChatterName } from '../common/ChatterName';

interface Props {
  items: QueueItem[];
  onRemove: (id: string) => void;
  onMuted: (id: string) => void;
  onClearAll: () => void;
  onUserClick: (username: string, channel: string, color: string) => void;
  onSuspicionCleared: (channel: string, username: string) => void;
  lang: Lang;
}

interface CardProps {
  item: QueueItem;
  duration: number;
  onDurationChange: (n: number) => void;
  onMute: (durationOverride?: number) => void;
  onBan: () => void;
  onRemove: () => void;
  onUserClick: () => void;
  isSelected: boolean;
  onToggleSelected: () => void;
  onSuspicionCleared: (channel: string, username: string) => void;
  lang: Lang;
}

function formatAge(ts: number, lang: Lang): string {
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return lang === 'ru' ? `${sec}с` : `${sec}s`;
  const min = Math.floor(sec / 60);
  return lang === 'ru' ? `${min}м` : `${min}m`;
}

/**
 * Метка Twitch о подозрительном аккаунте. Это внешний сигнал (обход бана, бан в
 * связанных каналах), который поднял спам-скор — поэтому рядом с ним всегда
 * лежит кнопка снятия: если наблюдение ложное, модератор гасит его в один клик
 * и юзер перестаёт получать надбавку.
 */
function SuspicionBadge({ channel, username, mark, onCleared, lang }: {
  channel: string;
  username: string;
  mark: SuspicionMark;
  onCleared: (channel: string, username: string) => void;
  lang: Lang;
}) {
  const [busy, setBusy] = useState(false);
  const label = mark.ban_evasion === 'likely' || mark.types.includes('ban_evader')
    ? (lang === 'ru' ? 'обход бана' : 'ban evader')
    : mark.types.includes('banned_in_shared_channel')
      ? (lang === 'ru' ? 'бан в связанных' : 'shared ban')
      : mark.status === 'restricted'
        ? (lang === 'ru' ? 'ограничен' : 'restricted')
        : (lang === 'ru' ? 'под наблюдением' : 'monitored');

  const clear = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      await api.post('/api/moderation/suspicious/clear', { channel, username, cleared: true });
      onCleared(channel, username);
    } catch {
      setBusy(false);
    }
  };

  return (
    <span
      title={lang === 'ru'
        ? `Twitch пометил аккаунт: ${label}. Спам-скор повышен. Крестик — снять метку, если наблюдение ложное.`
        : `Twitch flagged this account: ${label}. Spam score raised. Click × to clear a false positive.`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '4px', flexShrink: 0,
        padding: '1px 4px 1px 6px', borderRadius: '6px',
        background: 'rgba(255,89,89,0.1)', border: '1px solid rgba(255,89,89,0.28)',
        fontSize: '10px', fontWeight: 700, color: '#ff5959',
        opacity: busy ? 0.4 : 1, transition: 'opacity 0.15s',
      }}>
      <AlertTriangle size={9} />
      {label}
      <button
        onClick={clear}
        disabled={busy}
        title={lang === 'ru' ? 'Снять метку' : 'Clear mark'}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: '13px', height: '13px', padding: 0, marginLeft: '1px',
          borderRadius: '4px', border: 'none', cursor: busy ? 'default' : 'pointer',
          background: 'transparent', color: '#ff5959',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,89,89,0.2)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
        <X size={9} />
      </button>
    </span>
  );
}

function QueueCard({ item, duration, onDurationChange, onMute, onBan, onRemove, onUserClick, isSelected, onToggleSelected, onSuspicionCleared, lang }: CardProps) {
  const durations = muteDurations(lang);
  const isMuted = item.muted;
  const customReason = typeof window !== 'undefined' ? localStorage.getItem('mute_reason') : null;
  const reasons = isMuted ? (customReason ? [customReason] : [lang === 'ru' ? 'Замьючен' : 'Muted']) : item.reasons;
  const scoreColor = item.score >= 90 ? '#ff5959' : item.score >= 70 ? '#ffc800' : 'rgba(255,255,255,0.5)';
  const leftBorder = isMuted ? '#00c878' : item.score >= 90 ? '#ff5959' : item.score >= 70 ? '#ffc800' : 'transparent';
  const spamCount = item.spamCount || 1;
  const quickPresets = lang === 'ru'
    ? [{ label: '10м', value: 600 }, { label: '1ч', value: 3600 }, { label: '24ч', value: 86400 }]
    : [{ label: '10m', value: 600 }, { label: '1h', value: 3600 }, { label: '24h', value: 86400 }];

  const flatBtn = (bg: string, color: string, border: string): React.CSSProperties => ({
    padding: '4px 10px', borderRadius: '7px', fontSize: '11px', fontWeight: 600,
    background: bg, color, border: `1px solid ${border}`, cursor: 'pointer',
    transition: 'background 0.15s, color 0.15s, border-color 0.15s',
  });

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      className={isMuted ? 'queue-muted' : ''}
      style={{
        background: 'rgba(255,255,255,0.025)',
        border: '1px solid rgba(255,255,255,0.05)',
        borderLeft: `2px solid ${leftBorder}`,
        borderRadius: '10px',
        padding: '8px 12px',
        marginBottom: '6px',
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.045)';
        const cb = e.currentTarget.querySelector('[data-qsel]') as HTMLElement | null;
        if (cb) cb.style.opacity = '1';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.025)';
        const cb = e.currentTarget.querySelector('[data-qsel]') as HTMLElement | null;
        if (cb && !isSelected) cb.style.opacity = '0.35';
      }}>

      {/* Line 1 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {!isMuted && (
          <button
            data-qsel
            onClick={onToggleSelected}
            title={isSelected
              ? (lang === 'ru' ? 'Снять выбор' : 'Deselect')
              : (lang === 'ru' ? 'Выбрать' : 'Select')}
            style={{
              width: '12px', height: '12px', borderRadius: '3px', cursor: 'pointer', flexShrink: 0,
              background: isSelected ? '#ffc800' : 'rgba(255,255,255,0.05)',
              border: isSelected ? '1px solid #ffc800' : '1px solid rgba(255,255,255,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 0, outline: 'none',
              opacity: isSelected ? 1 : 0.35,
              transition: 'background 0.15s, border-color 0.15s, opacity 0.15s',
            }}>
            {isSelected && <Check size={8} style={{ color: '#000' }} />}
          </button>
        )}

        <div onClick={onUserClick} style={{
          cursor: 'pointer', flexShrink: 0, borderRadius: '50%',
          boxShadow: '0 0 0 1px rgba(255,255,255,0.1)',
          display: 'flex',
        }}>
          <Avatar username={item.username} color={item.color} size={22} fontSize={8} />
        </div>

        <span className="username" onClick={onUserClick} style={{
          fontWeight: 600, fontSize: '13px', color: item.color, cursor: 'pointer',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
        onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
        onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}>
          <ChatterName channel={item.channel} name={item.username}>{item.username}</ChatterName>
        </span>

        <span title={item.channel} style={{
          fontSize: '11px', color: 'rgba(255,255,255,0.35)', flexShrink: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100px',
        }}>
          · {item.channel}
        </span>

        {item.suspicion && (
          <SuspicionBadge
            channel={item.channel}
            username={item.username}
            mark={item.suspicion}
            onCleared={onSuspicionCleared}
            lang={lang}
          />
        )}

        {!isMuted && spamCount > 1 && (
          <span
            title={lang === 'ru' ? `${spamCount} спам-сообщений подряд` : `${spamCount} spam messages in a row`}
            style={{ fontSize: '11px', fontWeight: 700, color: '#ff9800', flexShrink: 0 }}>
            ×{spamCount}
          </span>
        )}

        <span style={{ flex: 1 }} />

        {!isMuted && (
          <>
            <span title={lang === 'ru' ? `Спам-скор: ${item.score}` : `Spam score: ${item.score}`} style={{
              fontSize: '12px', fontWeight: 700, color: scoreColor, flexShrink: 0,
              fontVariantNumeric: 'tabular-nums',
            }}>
              {item.score}
            </span>
            <span title={lang === 'ru' ? 'Время с момента обнаружения' : 'Time since detection'} style={{
              fontSize: '10px', color: 'rgba(255,255,255,0.3)', fontVariantNumeric: 'tabular-nums', flexShrink: 0,
            }}>
              {formatAge(item.ts, lang)}
            </span>
            <button onClick={onRemove}
              title={lang === 'ru' ? 'Скрыть' : 'Dismiss'}
              style={{
                padding: '2px', background: 'transparent', border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', opacity: 0.4, transition: 'opacity 0.15s', flexShrink: 0,
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '0.4')}>
              <X size={14} style={{ color: 'rgba(255,255,255,0.6)' }} />
            </button>
          </>
        )}
      </div>

      {/* Line 2 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '5px' }}>
        <div className="lastmsg" title={item.lastMsg} style={{
          flex: 1, minWidth: 0,
          fontSize: '12px', fontStyle: 'italic', color: 'rgba(255,255,255,0.55)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>"{item.lastMsg}"</div>

        {reasons.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }} title={reasons.join(' · ')}>
            <span style={{
              fontSize: '10px', padding: '1px 6px', borderRadius: '5px',
              background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '120px',
            }}>{reasons[0]}</span>
            {reasons.length > 1 && (
              <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)' }}>+{reasons.length - 1}</span>
            )}
          </div>
        )}
      </div>

      {/* Line 3 — actions or muted marker */}
      {isMuted ? (
        <div style={{ marginTop: '7px', fontSize: '10px', fontWeight: 700, color: '#00c878', letterSpacing: '0.05em' }}>
          {lang === 'ru' ? 'ЗАМЬЮЧЕН' : 'MUTED'}
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '7px' }}>
          {quickPresets.map(p => (
            <button key={p.value}
              onClick={() => onMute(p.value)}
              title={lang === 'ru' ? `Мут на ${p.label}` : `Mute for ${p.label}`}
              style={flatBtn('rgba(255,255,255,0.04)', 'rgba(255,255,255,0.65)', 'rgba(255,255,255,0.07)')}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(160,112,255,0.12)';
                e.currentTarget.style.color = '#c49dff';
                e.currentTarget.style.borderColor = 'rgba(160,112,255,0.3)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                e.currentTarget.style.color = 'rgba(255,255,255,0.65)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)';
              }}>
              {p.label}
            </button>
          ))}

          <select value={duration} onChange={e => onDurationChange(parseInt(e.target.value))}
            title={lang === 'ru' ? 'Другая длительность' : 'Other duration'}
            style={{
              fontSize: '11px', fontWeight: 600, padding: '4px 4px', borderRadius: '7px',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.07)',
              color: 'rgba(255,255,255,0.65)', cursor: 'pointer',
              maxWidth: '68px',
            }}>
            {durations.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>

          <button onClick={() => onMute()}
            style={{ ...flatBtn('rgba(160,112,255,0.1)', '#b48aff', 'rgba(160,112,255,0.2)'), flex: 1 }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(160,112,255,0.2)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(160,112,255,0.1)')}>
            {T[lang].mute}
          </button>

          <button onClick={onBan}
            style={{ ...flatBtn('rgba(255,89,89,0.08)', '#ff7a7a', 'rgba(255,89,89,0.18)'), flex: 1 }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,89,89,0.16)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,89,89,0.08)')}>
            {T[lang].ban}
          </button>
        </div>
      )}
    </motion.div>
  );
}

export function ModerationQueue({ items, onRemove, onMuted, onClearAll, onUserClick, onSuspicionCleared, lang }: Props) {
  const [muteDurs, setMuteDurs] = useState<Record<string, number>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const isMobile = useIsMobile();
  const t = T[lang];

  // Auto-dismiss items with no action after 60 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      items.forEach(item => {
        if (!item.muted && now - item.ts > 60_000) {
          onRemove(item.id);
        }
      });
    }, 5_000);
    return () => clearInterval(interval);
  }, [items, onRemove]);

  const getDuration = (id: string) => muteDurs[id] || 600;

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectAll = () => setSelectedIds(new Set(items.filter(i => !i.muted).map(i => i.id)));
  const clearSelection = () => setSelectedIds(new Set());

  const bulkAction = async (action: 'mute' | 'ban', duration?: number) => {
    const selected = items.filter(i => selectedIds.has(i.id) && !i.muted);
    if (selected.length === 0) return;
    setBulkLoading(true);
    try {
      const byChannel = new Map<string, string[]>();
      for (const item of selected) {
        if (!byChannel.has(item.channel)) byChannel.set(item.channel, []);
        byChannel.get(item.channel)!.push(item.username);
      }
      for (const [channel, usernames] of byChannel) {
        await api.post('/api/moderation/bulk', { action, channel, usernames, duration: duration || 600 });
      }
      for (const item of selected) onMuted(item.id);
      clearSelection();
    } catch (err) { console.error(err); }
    finally { setBulkLoading(false); }
  };

  const handleMute = async (item: QueueItem, durationOverride?: number) => {
    const duration = durationOverride ?? getDuration(item.id);
    try {
      await api.post('/api/moderation/mute', { channel: item.channel, username: item.username, duration });
      onMuted(item.id);
    } catch (err) { console.error(err); }
  };

  const handleBan = async (item: QueueItem) => {
    try {
      await api.post('/api/moderation/ban', { channel: item.channel, username: item.username });
      onMuted(item.id);
    } catch (err) { console.error(err); }
  };

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      position: 'relative',
    }}>
      <div style={{
        padding: '14px 18px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'rgba(255,255,255,0.95)', letterSpacing: '-0.01em' }}>
            {t.moderationQueue}
          </h2>
          <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.35)', marginTop: '2px' }}>
            {t.spamDetected}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {items.length > 0 && (
            <button onClick={onClearAll} style={{
              fontSize: '11px', fontWeight: 600,
              padding: '6px 11px', borderRadius: '8px',
              background: 'rgba(255,255,255,0.025)',
              color: 'rgba(255,255,255,0.45)',
              border: 'none', outline: 'none', cursor: 'pointer',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(240,71,71,0.1)'; e.currentTarget.style.color = '#ff7070'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.025)'; e.currentTarget.style.color = 'rgba(255,255,255,0.45)'; }}>
              {lang === 'ru' ? 'Очистить' : 'Clear all'}
            </button>
          )}
          {items.filter(i => !i.muted).length > 1 && (
            <button onClick={selectedIds.size > 0 ? clearSelection : selectAll} style={{
              fontSize: '11px', fontWeight: 600,
              padding: '6px 11px', borderRadius: '8px',
              background: selectedIds.size > 0 ? 'rgba(255,200,0,0.12)' : 'rgba(255,255,255,0.025)',
              color: selectedIds.size > 0 ? '#ffc800' : 'rgba(255,255,255,0.5)',
              border: 'none', outline: 'none', cursor: 'pointer',
            }}>
              {selectedIds.size > 0
                ? (lang === 'ru' ? `Снять (${selectedIds.size})` : `Clear (${selectedIds.size})`)
                : (lang === 'ru' ? 'Выбрать все' : 'Select all')}
            </button>
          )}
          <div style={{
            fontSize: '12px', padding: '6px 14px', borderRadius: '999px',
            background: 'rgba(255,255,255,0.04)',
            color: 'rgba(255,255,255,0.5)',
            border: '1px solid rgba(255,255,255,0.07)',
            fontWeight: 600,
          }}>
            {items.length} {items.length === 1 ? t.item : t.items}
          </div>
        </div>
      </div>

      <div style={{
        flex: 1, overflowY: 'auto', padding: '8px 16px 16px',
      }}>
        {items.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              minHeight: '70vh', gap: '14px', padding: '40px 20px', textAlign: 'center',
            }}>
            <div style={{
              width: '64px', height: '64px', borderRadius: '50%',
              background: 'rgba(0,200,120,0.06)', border: '1px solid rgba(0,200,120,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Shield size={28} style={{ color: '#00c878', opacity: 0.7 }} />
            </div>
            <div>
              <p style={{ fontSize: '15px', fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>{t.queueClean}</p>
              <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.3)', marginTop: '4px', maxWidth: '300px' }}>
                {t.queueCleanDesc}
              </p>
            </div>
          </motion.div>
        )}

        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: '10px',
          paddingBottom: selectedIds.size > 0 ? '90px' : '0',
        }}>
          <AnimatePresence mode="popLayout">
            {items.map(item => {
              const isSelected = selectedIds.has(item.id);
              return (
                <div key={item.id} style={{
                  outline: isSelected ? '2px solid rgba(255,200,0,0.5)' : 'none',
                  outlineOffset: '-2px',
                  borderRadius: '10px',
                }}>
                  <QueueCard
                    item={item}
                    duration={getDuration(item.id)}
                    onDurationChange={n => setMuteDurs(p => ({ ...p, [item.id]: n }))}
                    onMute={(d?: number) => handleMute(item, d)}
                    onBan={() => handleBan(item)}
                    onRemove={() => onRemove(item.id)}
                    onUserClick={() => onUserClick(item.username, item.channel, item.color)}
                    isSelected={isSelected}
                    onToggleSelected={() => toggleSelected(item.id)}
                    onSuspicionCleared={onSuspicionCleared}
                    lang={lang} />
                </div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>

      {/* Bulk action panel */}
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            style={{
              position: 'absolute', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
              padding: '12px 16px', borderRadius: '14px',
              background: 'rgba(8,8,12,0.92)',
              backdropFilter: 'blur(28px) saturate(180%)',
              border: '1px solid rgba(255,200,0,0.18)',
              boxShadow: '0 20px 40px rgba(0,0,0,0.5), 0 0 30px rgba(255,200,0,0.1)',
              display: 'flex', alignItems: 'center', gap: '12px',
              zIndex: 20,
            }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#ffc800', whiteSpace: 'nowrap' }}>
              {lang === 'ru' ? `Выбрано: ${selectedIds.size}` : `Selected: ${selectedIds.size}`}
            </div>
            <div style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.1)' }} />
            <button onClick={() => bulkAction('mute', 600)} disabled={bulkLoading}
              style={{
                padding: '7px 14px', borderRadius: '9px', cursor: 'pointer',
                background: 'rgba(255,200,0,0.15)', color: '#ffc800',
                border: 'none', outline: 'none', fontSize: '12px', fontWeight: 600,
                opacity: bulkLoading ? 0.5 : 1,
              }}>
              {lang === 'ru' ? 'Мут 10м' : 'Mute 10m'}
            </button>
            <button onClick={() => bulkAction('mute', 3600)} disabled={bulkLoading}
              style={{
                padding: '7px 14px', borderRadius: '9px', cursor: 'pointer',
                background: 'rgba(255,200,0,0.15)', color: '#ffc800',
                border: 'none', outline: 'none', fontSize: '12px', fontWeight: 600,
                opacity: bulkLoading ? 0.5 : 1,
              }}>
              {lang === 'ru' ? 'Мут 1ч' : 'Mute 1h'}
            </button>
            <button onClick={() => bulkAction('ban')} disabled={bulkLoading}
              style={{
                padding: '7px 14px', borderRadius: '9px', cursor: 'pointer',
                background: 'rgba(240,71,71,0.15)', color: '#ff7070',
                border: 'none', outline: 'none', fontSize: '12px', fontWeight: 700,
                opacity: bulkLoading ? 0.5 : 1,
              }}>
              {lang === 'ru' ? 'БАН ВСЕХ' : 'BAN ALL'}
            </button>
            <button onClick={clearSelection} style={{
              padding: '7px 12px', borderRadius: '9px', cursor: 'pointer',
              background: 'transparent', color: 'rgba(255,255,255,0.4)',
              border: 'none', outline: 'none', fontSize: '12px',
            }}>
              ×
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
