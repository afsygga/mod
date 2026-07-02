import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, X, Check, AlertTriangle } from 'lucide-react';
import { QueueItem } from '../../types';
import { getInitials } from '../../utils/colors';
import { Avatar } from '../UserCard/Avatar';
import { api } from '../../hooks/useApi';
import { T, Lang, muteDurations } from '../../utils/i18n';
import { useIsMobile } from '../../hooks/useIsMobile';

interface Props {
  items: QueueItem[];
  onRemove: (id: string) => void;
  onMuted: (id: string) => void;
  onClearAll: () => void;
  onUserClick: (username: string, channel: string, color: string) => void;
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
  lang: Lang;
}

function formatAge(ts: number, lang: Lang): string {
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return lang === 'ru' ? `${sec}с` : `${sec}s`;
  const min = Math.floor(sec / 60);
  return lang === 'ru' ? `${min}м` : `${min}m`;
}

function QueueCard({ item, duration, onDurationChange, onMute, onBan, onRemove, onUserClick, isSelected, onToggleSelected, lang }: CardProps) {
  const durations = muteDurations(lang);
  const isMuted = item.muted;
  const customReason = typeof window !== 'undefined' ? localStorage.getItem('mute_reason') : null;
  const reasons = isMuted ? (customReason ? [customReason] : [lang === 'ru' ? 'Замьючен' : 'Muted']) : item.reasons;
  const accentColor = item.score >= 90 ? '#ff5959' : '#ffc800';
  const accentBg = item.score >= 90 ? 'rgba(255,89,89,0.05)' : 'rgba(255,255,255,0.035)';
  const accentBorder = item.score >= 90 ? 'rgba(255,89,89,0.18)' : 'rgba(255,200,0,0.14)';
  const spamCount = item.spamCount || 1;
  const quickPresets = lang === 'ru'
    ? [{ label: '10м', value: 600 }, { label: '1ч', value: 3600 }, { label: '24ч', value: 86400 }]
    : [{ label: '10m', value: 600 }, { label: '1h', value: 3600 }, { label: '24h', value: 86400 }];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 14, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 18, scale: 0.95, transition: { duration: 0.18 } }}
      transition={{ type: 'spring', stiffness: 340, damping: 26 }}
      className={isMuted ? 'queue-muted' : ''}
      style={{
        background: isMuted ? 'rgba(255,255,255,0.025)' : accentBg,
        border: isMuted ? '1px solid rgba(255,255,255,0.08)' : `1px solid ${accentBorder}`,
        borderRadius: '12px',
        padding: '10px 12px 10px 15px',
        position: 'relative',
        overflow: 'hidden',
      }}>

      {/* Left accent bar */}
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: '3px',
        background: isMuted ? '#00c878' : accentColor,
        opacity: isMuted ? 0.5 : 0.85,
      }} />

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '7px' }}>
        {!isMuted && (
          <button
            onClick={onToggleSelected}
            title={isSelected
              ? (lang === 'ru' ? 'Снять выбор' : 'Deselect')
              : (lang === 'ru' ? 'Выбрать' : 'Select')}
            style={{
              width: '14px', height: '14px', borderRadius: '4px', cursor: 'pointer', flexShrink: 0,
              background: isSelected ? '#ffc800' : 'rgba(255,255,255,0.05)',
              border: isSelected ? '1px solid #ffc800' : '1px solid rgba(255,255,255,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 0, outline: 'none',
              opacity: isSelected ? 1 : 0.6,
              transition: 'background 0.15s, border-color 0.15s, opacity 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={e => { if (!isSelected) e.currentTarget.style.opacity = '0.6'; }}>
            {isSelected && <Check size={9} style={{ color: '#000' }} />}
          </button>
        )}
        <div onClick={onUserClick} style={{ cursor: 'pointer', flexShrink: 0 }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '1')}>
          <Avatar username={item.username} color={item.color} size={24} fontSize={9} />
        </div>

        <div onClick={onUserClick} style={{
          flex: 1, minWidth: 0, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: '6px',
        }}>
          <span className="username" style={{
            fontWeight: 600, fontSize: '12.5px',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            color: item.color,
          }}
          onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
          onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}>
            {item.username}
          </span>
          <span title={item.channel} style={{
            fontSize: '9.5px', fontWeight: 600, padding: '1px 6px', borderRadius: '999px',
            background: 'rgba(255,200,0,0.08)', color: '#ffc800',
            border: '1px solid rgba(255,200,0,0.16)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            maxWidth: '90px', flexShrink: 0,
          }}>
            {item.channel}
          </span>
        </div>

        {!isMuted && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
            <span title={lang === 'ru' ? 'Время с момента обнаружения' : 'Time since detection'} style={{
              fontSize: '10px', color: 'rgba(255,255,255,0.3)', fontVariantNumeric: 'tabular-nums',
            }}>
              {formatAge(item.ts, lang)}
            </span>
            {spamCount > 1 && (
              <motion.span
                animate={{ scale: [1, 1.12, 1] }}
                transition={{ repeat: Infinity, duration: 1.6, ease: 'easeInOut' }}
                title={lang === 'ru' ? `${spamCount} спам-сообщений подряд` : `${spamCount} spam messages in a row`}
                style={{
                  fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '7px',
                  background: spamCount >= 4 ? 'rgba(255,89,89,0.12)' : 'rgba(255,200,0,0.12)',
                  color: spamCount >= 4 ? '#ff7070' : '#ffc800',
                  border: `1px solid ${spamCount >= 4 ? 'rgba(255,89,89,0.28)' : 'rgba(255,200,0,0.28)'}`,
                }}>
                ×{spamCount}
              </motion.span>
            )}
            <span title={lang === 'ru' ? `Спам-скор: ${item.score}` : `Spam score: ${item.score}`} style={{
              display: 'inline-flex', alignItems: 'center', gap: '3px',
              fontSize: '11px', fontWeight: 700, padding: '1px 7px', borderRadius: '8px',
              background: 'rgba(255,255,255,0.04)',
              color: accentColor,
              border: `1px solid ${accentBorder}`,
            }}>
              <AlertTriangle size={9} />
              {item.score}
            </span>
            <button onClick={onRemove}
              title={lang === 'ru' ? 'Скрыть' : 'Dismiss'}
              style={{
                padding: '4px', borderRadius: '7px', background: 'transparent', border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              <X size={11} style={{ color: 'rgba(255,255,255,0.4)' }} />
            </button>
          </div>
        )}

        {isMuted && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '4px', flexShrink: 0,
            fontSize: '9.5px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px',
            background: 'rgba(0,200,120,0.12)', color: '#00c878',
            border: '1px solid rgba(0,200,120,0.25)',
          }}>
            <Check size={9} /> MUTED
          </span>
        )}
      </div>

      {/* Message preview + reason tags on one info block */}
      <div className="lastmsg" title={item.lastMsg} style={{
        fontSize: '11.5px', fontStyle: 'italic', lineHeight: 1.4,
        color: 'rgba(255,255,255,0.5)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        marginBottom: '6px',
      }}>"{item.lastMsg}"</div>

      <div style={{
        display: 'flex', gap: '4px', alignItems: 'center', overflow: 'hidden',
        marginBottom: isMuted ? 0 : '8px',
      }} title={reasons.join(' · ')}>
        {reasons.slice(0, 2).map((r, i) => (
          <span key={i} style={{
            fontSize: '9.5px', padding: '1px 7px', borderRadius: '999px', fontWeight: 500,
            background: isMuted ? 'rgba(0,200,120,0.08)' : 'rgba(255,89,89,0.08)',
            color: isMuted ? '#00c878' : '#ff7575',
            border: isMuted ? '1px solid rgba(0,200,120,0.18)' : '1px solid rgba(255,89,89,0.16)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            maxWidth: '140px',
          }}>{r}</span>
        ))}
        {reasons.length > 2 && (
          <span style={{
            fontSize: '9.5px', padding: '1px 6px', borderRadius: '999px', fontWeight: 600,
            background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.45)',
            border: '1px solid rgba(255,255,255,0.08)', flexShrink: 0,
          }}>+{reasons.length - 2}</span>
        )}
      </div>

      {!isMuted && (
        <div style={{ display: 'flex', gap: '5px', alignItems: 'stretch' }}>
          {/* Quick mute presets */}
          <div style={{
            display: 'flex', borderRadius: '8px', overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.1)',
          }}>
            {quickPresets.map((p, i) => (
              <button key={p.value}
                onClick={() => onMute(p.value)}
                title={lang === 'ru' ? `Мут на ${p.label}` : `Mute for ${p.label}`}
                style={{
                  padding: '4px 8px', fontSize: '10.5px', fontWeight: 700,
                  background: 'rgba(255,255,255,0.045)', color: 'rgba(255,255,255,0.8)',
                  border: 'none', cursor: 'pointer',
                  borderLeft: i > 0 ? '1px solid rgba(255,255,255,0.08)' : 'none',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,200,0,0.18)'; e.currentTarget.style.color = '#ffc800'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.045)'; e.currentTarget.style.color = 'rgba(255,255,255,0.8)'; }}>
                {p.label}
              </button>
            ))}
          </div>

          {/* Custom duration select */}
          <select value={duration} onChange={e => onDurationChange(parseInt(e.target.value))}
            title={lang === 'ru' ? 'Другая длительность' : 'Other duration'}
            style={{
              fontSize: '10.5px', padding: '4px 4px', borderRadius: '8px',
              background: 'rgba(255,255,255,0.045)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.75)', cursor: 'pointer',
              maxWidth: '68px',
            }}>
            {durations.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>

          <button onClick={() => onMute()} style={{
            flex: 1, padding: '4px 0', borderRadius: '8px',
            fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
            background: 'rgba(255,255,255,0.06)', color: '#ffffff',
            border: '1px solid rgba(255,255,255,0.13)', cursor: 'pointer',
          }} onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.14)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}>
            {T[lang].mute}
          </button>

          <button onClick={onBan} style={{
            flex: 1, padding: '4px 0', borderRadius: '8px',
            fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
            background: 'rgba(255,89,89,0.1)', color: '#ff7070',
            border: '1px solid rgba(255,89,89,0.24)', cursor: 'pointer',
          }} onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,89,89,0.2)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,89,89,0.1)')}>
            {T[lang].ban}
          </button>
        </div>
      )}
    </motion.div>
  );
}

export function ModerationQueue({ items, onRemove, onMuted, onClearAll, onUserClick, lang }: Props) {
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
                  borderRadius: '12px',
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
