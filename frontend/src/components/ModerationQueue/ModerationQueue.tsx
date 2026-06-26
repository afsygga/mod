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
  onUserClick: (username: string, channel: string, color: string) => void;
  lang: Lang;
}

interface CardProps {
  item: QueueItem;
  duration: number;
  onDurationChange: (n: number) => void;
  onMute: () => void;
  onBan: () => void;
  onRemove: () => void;
  onUserClick: () => void;
  lang: Lang;
}

function QueueCard({ item, duration, onDurationChange, onMute, onBan, onRemove, onUserClick, lang }: CardProps) {
  const t = T[lang];
  const durations = muteDurations(lang);
  const isMuted = item.muted;
  const customReason = typeof window !== 'undefined' ? localStorage.getItem('mute_reason') : null;
  const reasons = isMuted ? (customReason ? [customReason] : [lang === 'ru' ? 'Замьючен' : 'Muted']) : item.reasons;
  const accentColor = item.score >= 90 ? '#ff5959' : '#ffc800';
  const accentBg = item.score >= 90 ? 'rgba(240,71,71,0.06)' : 'rgba(255,200,0,0.04)';
  const accentBorder = item.score >= 90 ? 'rgba(240,71,71,0.16)' : 'rgba(255,200,0,0.13)';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 30, scale: 0.94 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, scale: 0.9, transition: { duration: 0.3 } }}
      transition={{ type: 'spring', stiffness: 260, damping: 24 }}
      className={isMuted ? 'queue-muted' : ''}
      style={{
        background: isMuted ? 'rgba(255,255,255,0.025)' : accentBg,
        backdropFilter: 'blur(28px) saturate(180%)',
        WebkitBackdropFilter: 'blur(28px) saturate(180%)',
        border: isMuted ? '1px solid rgba(255,255,255,0.08)' : `1px solid ${accentBorder}`,
        borderRadius: '14px',
        padding: '13px',
        position: 'relative',
        boxShadow: '0 6px 24px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.04)',
      }}>

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
        <div onClick={onUserClick} style={{ cursor: 'pointer', flexShrink: 0 }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '1')}>
          <Avatar username={item.username} color={item.color} size={32} fontSize={11} />
        </div>

        <div onClick={onUserClick} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
          <div className="username" style={{
            fontWeight: 600, fontSize: '13px',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            color: item.color,
            textDecoration: 'none',
          }}
          onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
          onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}>
            {item.username}
          </div>
          <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', marginTop: '1px' }}>
            📺 {item.channel}
          </div>
        </div>

        {!isMuted && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {(item.spamCount || 1) > 1 && (() => {
              const c = item.spamCount || 1;
              const isRed = c >= 4;
              const isYellow = c >= 2 && c <= 3;
              const badgeBg = isRed ? 'rgba(240,71,71,0.12)' : isYellow ? 'rgba(255,200,0,0.12)' : 'rgba(255,255,255,0.04)';
              const badgeColor = isRed ? '#ff7070' : isYellow ? '#ffc800' : 'rgba(255,255,255,0.6)';
              const badgeBorder = isRed ? 'rgba(240,71,71,0.28)' : isYellow ? 'rgba(255,200,0,0.28)' : 'rgba(255,255,255,0.08)';
              return (
                <div title={`${c} спам-сообщений подряд`} style={{
                  display: 'flex', alignItems: 'center', gap: '3px',
                  fontSize: '11px', fontWeight: 700, padding: '3px 7px', borderRadius: '8px',
                  background: badgeBg, color: badgeColor,
                  border: `1px solid ${badgeBorder}`,
                }}>
                  ×{c}
                </div>
              );
            })()}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              fontSize: '12px', fontWeight: 700, padding: '3px 9px', borderRadius: '10px',
              background: 'rgba(255,255,255,0.04)',
              color: accentColor,
              border: `1px solid ${accentBorder}`,
            }}>
              <AlertTriangle size={10} />
              {item.score}
            </div>
          </div>
        )}

        {isMuted && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '4px',
            fontSize: '10px', fontWeight: 700, padding: '3px 9px', borderRadius: '10px',
            background: 'rgba(0,200,120,0.12)', color: '#00c878',
            border: '1px solid rgba(0,200,120,0.25)',
          }}>
            <Check size={10} /> MUTED
          </div>
        )}

        {!isMuted && (
          <button onClick={onRemove} style={{
            padding: '5px', borderRadius: '8px', background: 'transparent', border: 'none', cursor: 'pointer',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
            <X size={12} style={{ color: 'rgba(255,255,255,0.4)' }} />
          </button>
        )}
      </div>

      {/* Last message */}
      <div className="lastmsg" style={{
        fontSize: '12px', padding: '8px 11px', borderRadius: '10px', marginBottom: '10px',
        fontStyle: 'italic', lineHeight: 1.5,
        background: 'rgba(255,255,255,0.02)',
        color: 'rgba(255,255,255,0.55)',
        border: '1px solid rgba(255,255,255,0.04)',
      }}>"{item.lastMsg.slice(0, 90)}"</div>

      {/* Reasons / "Don't spam" */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: isMuted ? 0 : '10px' }}>
        {reasons.map((r, i) => (
          <span key={i} style={{
            fontSize: '10px', padding: '3px 9px', borderRadius: '999px',
            background: isMuted ? 'rgba(0,200,120,0.08)' : 'rgba(240,71,71,0.08)',
            color: isMuted ? '#00c878' : '#ff7575',
            border: isMuted ? '1px solid rgba(0,200,120,0.18)' : '1px solid rgba(240,71,71,0.16)',
            fontWeight: 500,
          }}>{r}</span>
        ))}
      </div>

      {!isMuted && (
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <select value={duration} onChange={e => onDurationChange(parseInt(e.target.value))}
            style={{
              fontSize: '11px', padding: '5px 8px', borderRadius: '9px',
              background: 'rgba(255,255,255,0.045)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.85)', cursor: 'pointer',
              maxWidth: '90px',
            }}>
            {durations.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>

          <button onClick={onMute} style={{
            flex: 1, padding: '6px 0', borderRadius: '9px',
            fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
            background: 'rgba(255,255,255,0.06)', color: '#ffffff',
            border: '1px solid rgba(255,255,255,0.13)', cursor: 'pointer',
          }} onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.14)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}>
            {T[lang].mute}
          </button>

          <button onClick={onBan} style={{
            flex: 1, padding: '6px 0', borderRadius: '9px',
            fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
            background: 'rgba(240,71,71,0.08)', color: '#ff7070',
            border: '1px solid rgba(240,71,71,0.22)', cursor: 'pointer',
          }} onMouseEnter={e => (e.currentTarget.style.background = 'rgba(240,71,71,0.18)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(240,71,71,0.08)')}>
            {T[lang].ban}
          </button>
        </div>
      )}
    </motion.div>
  );
}

export function ModerationQueue({ items, onRemove, onMuted, onUserClick, lang }: Props) {
  const [muteDurs, setMuteDurs] = useState<Record<string, number>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const isMobile = useIsMobile();
  const t = T[lang];

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

  const handleMute = async (item: QueueItem) => {
    const duration = getDuration(item.id);
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
                <div key={item.id} style={{ position: 'relative' }}>
                  {!item.muted && (
                    <button onClick={() => toggleSelected(item.id)}
                      title={isSelected ? 'Снять выбор' : 'Выбрать'}
                      style={{
                        position: 'absolute', top: '12px', left: '12px',
                        width: '18px', height: '18px', borderRadius: '5px', cursor: 'pointer',
                        background: isSelected ? '#ffc800' : 'rgba(0,0,0,0.45)',
                        border: isSelected ? '1px solid #ffc800' : '1px solid rgba(255,255,255,0.2)',
                        zIndex: 5,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: 0, outline: 'none',
                        boxShadow: isSelected ? '0 0 0 3px rgba(255,200,0,0.25)' : 'none',
                      }}>
                      {isSelected && <Check size={11} style={{ color: '#000' }} />}
                    </button>
                  )}
                  <div style={{
                    outline: isSelected ? '2px solid rgba(255,200,0,0.5)' : 'none',
                    outlineOffset: '-2px',
                    borderRadius: '14px',
                  }}>
                    <QueueCard
                      item={item}
                      duration={getDuration(item.id)}
                      onDurationChange={n => setMuteDurs(p => ({ ...p, [item.id]: n }))}
                      onMute={() => handleMute(item)}
                      onBan={() => handleBan(item)}
                      onRemove={() => onRemove(item.id)}
                      onUserClick={() => onUserClick(item.username, item.channel, item.color)}
                      lang={lang} />
                  </div>
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
