import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertTriangle, Calendar, Hash } from 'lucide-react';
import { ChatMessage } from '../../types';
import { getInitials, formatTime } from '../../utils/colors';
import { Avatar } from './Avatar';
import { api } from '../../hooks/useApi';
import { T, Lang, muteDurations } from '../../utils/i18n';

interface Props {
  username: string;
  channel: string;
  color: string;
  messages: ChatMessage[];
  detectThreshold: number;
  onClose: () => void;
  onAction: () => void;
  lang: Lang;
}

interface UserStats {
  message_count: number;
  flagged_count: number;
  mute_count: number;
  spam_score: number;
  created_at: string;
}

interface UserMeta {
  profile_image_url?: string;
  display_name?: string;
  created_at?: string;
  description?: string;
}

interface TimelinePoint { day: string; msgs: number; spam: number; max_score: number; }
interface MuteEvent { created_at: string; action: string; channel_name: string; duration_seconds: number | null; reasons: string[] | null; }
interface ProfileData {
  twitch: UserMeta & { exists?: boolean };
  profile: UserStats[] | null;
  timeline: TimelinePoint[];
  mute_history: MuteEvent[];
}

const PRESETS = [
  { value: 60, label: '1m' },
  { value: 300, label: '5m' },
  { value: 600, label: '10m' },
  { value: 3600, label: '1h' },
  { value: 86400, label: '1d' },
  { value: 259200, label: '3d' },
  { value: 604800, label: '1w' },
  { value: 1209600, label: '2w' },
];

function classifyBot(meta: UserMeta | null, timeline: TimelinePoint[], muteHistory: MuteEvent[]): { level: 'safe' | 'suspicious' | 'high' | 'unknown'; reasons: string[] } {
  const reasons: string[] = [];
  if (!meta || !meta.created_at) return { level: 'unknown', reasons: [] };
  const accountAgeDays = (Date.now() - new Date(meta.created_at).getTime()) / 86400000;
  if (accountAgeDays < 30) reasons.push(`аккаунт ${Math.round(accountAgeDays)}д`);
  if (accountAgeDays < 7) reasons.push('very new account');
  if (!meta.description) reasons.push('no bio');
  // Username patterns (random_user_123456)
  const username = meta.display_name || '';
  if (/^[a-z]+_?[a-z]*\d{4,}$/i.test(username)) reasons.push('random username pattern');
  // Mute history
  const totalMutes = muteHistory.filter(m => m.action === 'MUTED' || m.action === 'AUTO_MUTED' || m.action === 'BANNED').length;
  if (totalMutes >= 5) reasons.push(`${totalMutes} previous mutes`);
  // Burst — many spam msgs in single day
  const maxDay = timeline.reduce((max, t) => t.spam > max ? t.spam : max, 0);
  if (maxDay >= 20) reasons.push(`${maxDay} spam in 1 day`);

  let level: 'safe' | 'suspicious' | 'high' | 'unknown' = 'safe';
  const score = (accountAgeDays < 7 ? 3 : 0)
    + (accountAgeDays < 30 ? 2 : 0)
    + (!meta.description ? 1 : 0)
    + (/^[a-z]+_?[a-z]*\d{4,}$/i.test(username) ? 2 : 0)
    + (totalMutes >= 5 ? 2 : totalMutes >= 2 ? 1 : 0)
    + (maxDay >= 20 ? 2 : 0);
  if (score >= 5) level = 'high';
  else if (score >= 2) level = 'suspicious';
  return { level, reasons };
}

export function UserCard({ username, channel, color, messages, detectThreshold, onClose, onAction, lang }: Props) {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(false);
  const t = T[lang];

  useEffect(() => {
    api.get<ProfileData>(`/api/moderation/user/${username}`)
      .then(setProfile)
      .catch(console.error);
  }, [username]);

  const stats = profile?.profile?.find(p => true) || null;
  const twitch = profile?.twitch;
  const timeline = profile?.timeline || [];
  const muteHistory = profile?.mute_history || [];
  const classification = classifyBot(twitch || null, timeline, muteHistory);
  const userMessages = messages.filter(m => m.username.toLowerCase() === username.toLowerCase() && m.channel === channel);

  const handleMute = async (duration: number) => {
    setLoading(true);
    try {
      await api.post('/api/moderation/mute', { channel, username, duration });
      onAction();
      onClose();
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const handleBan = async () => {
    setLoading(true);
    try {
      await api.post('/api/moderation/ban', { channel, username });
      onAction();
      onClose();
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const handleUnban = async () => {
    setLoading(true);
    try {
      await api.post('/api/moderation/mute', { channel, username, duration: 1 });
      onAction();
      onClose();
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(14px)',
      }}>
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 10 }}
        transition={{ type: 'spring', stiffness: 280, damping: 26 }}
        onClick={e => e.stopPropagation()}
        className="glass-card"
        style={{
          width: '560px', maxHeight: '85vh', display: 'flex', flexDirection: 'column',
          padding: 0, overflow: 'hidden',
        }}>

        {/* Header */}
        <div style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', gap: '16px',
          borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <Avatar username={username} color={color} size={64} fontSize={22} borderRadius={14} />

          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ fontSize: '18px', fontWeight: 700, color, marginBottom: '4px', letterSpacing: '-0.01em' }}>
              {username}
            </h2>
            <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: 'rgba(255,255,255,0.4)', flexWrap: 'wrap' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>📺 {channel}</span>
              {stats?.created_at && (
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Calendar size={10} /> Joined {new Date(stats.created_at).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>

          <button onClick={onClose} style={{
            padding: '6px', borderRadius: '8px', background: 'transparent', border: 'none', cursor: 'pointer',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
            <X size={16} style={{ color: 'rgba(255,255,255,0.5)' }} />
          </button>
        </div>

        {/* Bot risk classification */}
        {twitch?.exists && classification.level !== 'unknown' && (
          <div style={{
            padding: '12px 24px', borderBottom: '1px solid rgba(255,255,255,0.05)',
            display: 'flex', alignItems: 'center', gap: '12px',
          }}>
            <div style={{
              padding: '5px 11px', borderRadius: '8px', fontSize: '10px', fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.06em',
              background: classification.level === 'high' ? 'rgba(240,71,71,0.15)'
                : classification.level === 'suspicious' ? 'rgba(255,200,0,0.12)'
                : 'rgba(0,200,120,0.1)',
              color: classification.level === 'high' ? '#ff7070'
                : classification.level === 'suspicious' ? '#ffc800'
                : '#00c878',
            }}>
              {classification.level === 'high' ? (lang === 'ru' ? '⚠ Высокий риск' : '⚠ High risk')
                : classification.level === 'suspicious' ? (lang === 'ru' ? 'Подозрительно' : 'Suspicious')
                : (lang === 'ru' ? '✓ Безопасен' : '✓ Safe')}
            </div>
            {classification.reasons.length > 0 && (
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', flex: 1 }}>
                {classification.reasons.join(' · ')}
              </div>
            )}
            {twitch.created_at && (
              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)' }}>
                {lang === 'ru' ? 'Создан' : 'Joined'}: {new Date(twitch.created_at).toLocaleDateString()}
              </div>
            )}
          </div>
        )}

        {/* 30-day activity timeline */}
        {timeline.length > 1 && (
          <div style={{ padding: '14px 24px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '10px' }}>
              {lang === 'ru' ? 'Активность за 30 дней' : '30-day activity'}
            </div>
            {(() => {
              const maxMsgs = Math.max(1, ...timeline.map(t => t.msgs));
              return (
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '50px' }}>
                  {timeline.map((t, i) => {
                    const h = (t.msgs / maxMsgs) * 100;
                    const spamPct = t.msgs > 0 ? (t.spam / t.msgs) * 100 : 0;
                    return (
                      <div key={i}
                        title={`${new Date(t.day).toLocaleDateString()}: ${t.msgs} msgs, ${t.spam} spam (max score ${t.max_score})`}
                        style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', minWidth: '6px' }}>
                        <div style={{
                          width: '100%', height: `${h}%`, borderRadius: '3px 3px 0 0',
                          background: 'rgba(255,255,255,0.08)', position: 'relative', overflow: 'hidden',
                        }}>
                          <div style={{
                            position: 'absolute', bottom: 0, left: 0, right: 0,
                            height: `${spamPct}%`,
                            background: 'linear-gradient(to top, #ff5959, #ffc800)',
                          }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}

        {/* Stats row */}
        {stats && (
          <div style={{ display: 'flex', gap: '8px', padding: '14px 24px',
            borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            {[
              { num: stats.message_count, label: 'Messages', color: 'rgba(255,255,255,0.85)' },
              { num: stats.flagged_count || userMessages.filter(m => m.score >= detectThreshold).length, label: 'Flagged', color: '#ffc800' },
              { num: stats.mute_count, label: 'Mutes', color: '#ff7575' },
              { num: stats.spam_score, label: 'Last Score',
                color: stats.spam_score >= 70 ? '#ff5959' : stats.spam_score >= 40 ? '#ffc800' : 'rgba(255,255,255,0.6)' },
            ].map(({ num, label, color }) => (
              <div key={label} style={{
                flex: 1, padding: '8px 10px', borderRadius: '10px',
                background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)',
              }}>
                <div style={{ fontSize: '15px', fontWeight: 700, color, lineHeight: 1 }}>{num}</div>
                <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', marginTop: '3px' }}>{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Mute presets bar */}
        <div style={{ padding: '14px 24px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: '10px',
          }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              {lang === 'ru' ? 'Действия' : 'Actions'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button onClick={handleUnban} disabled={loading} title="Unmute" style={{
              width: '36px', height: '34px', borderRadius: '9px', cursor: 'pointer',
              background: 'rgba(0,200,120,0.1)', border: '1px solid rgba(0,200,120,0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ color: '#00c878', fontSize: '14px' }}>⊘</span>
            </button>

            {PRESETS.map(p => (
              <button key={p.value} onClick={() => handleMute(p.value)} disabled={loading}
                style={{
                  flex: 1, height: '34px', borderRadius: '9px', cursor: 'pointer',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: 'rgba(255,255,255,0.85)',
                  fontSize: '12px', fontWeight: 600,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}>
                {p.label}
              </button>
            ))}

            <button onClick={handleBan} disabled={loading} title="Ban" style={{
              width: '36px', height: '34px', borderRadius: '9px', cursor: 'pointer',
              background: 'rgba(240,71,71,0.1)', border: '1px solid rgba(240,71,71,0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ color: '#f04747', fontSize: '14px' }}>⛔</span>
            </button>
          </div>
        </div>

        {/* Message history */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 24px', minHeight: '200px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              {lang === 'ru' ? 'История сообщений' : 'Message History'}
            </span>
            <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Hash size={10} /> {userMessages.length}
            </span>
          </div>

          {userMessages.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'rgba(255,255,255,0.3)', fontSize: '12px' }}>
              {lang === 'ru' ? 'Нет сообщений в текущей сессии' : 'No messages in current session'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {userMessages.slice().reverse().map(msg => {
                const isSpam = msg.score >= detectThreshold;
                return (
                  <div key={msg.id} style={{
                    padding: '7px 11px', borderRadius: '9px',
                    background: isSpam ? 'rgba(240,71,71,0.06)' : 'rgba(255,255,255,0.02)',
                    border: isSpam ? '1px solid rgba(240,71,71,0.15)' : '1px solid rgba(255,255,255,0.04)',
                    display: 'flex', alignItems: 'center', gap: '8px',
                  }}>
                    <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', flexShrink: 0, fontFamily: 'monospace' }}>
                      {formatTime(msg.ts)}
                    </span>
                    {isSpam && <AlertTriangle size={10} style={{ color: '#ff5959', flexShrink: 0 }} />}
                    <span style={{ fontSize: '12px', flex: 1, color: isSpam ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.65)' }}>
                      {msg.message}
                    </span>
                    {msg.score > 30 && (
                      <span style={{
                        fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '6px', flexShrink: 0,
                        background: isSpam ? 'rgba(240,71,71,0.18)' : 'rgba(255,200,0,0.12)',
                        color: isSpam ? '#ff7070' : '#ffc800',
                      }}>{msg.score}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
