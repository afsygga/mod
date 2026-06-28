import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { BarChart2, Radio, Trophy, Calendar, Clock, Users, Zap, Shield, ChevronDown } from 'lucide-react';
import { api } from '../../hooks/useApi';

// ─── types ────────────────────────────────────────────────────────────────────
interface ModeratorStat {
  performed_by: string;
  display_name: string | null;
  twitch_username: string | null;
  twitch_avatar: string | null;
  twitch_display_name: string | null;
  mutes: number;
  auto_mutes: number;
  bans: number;
  unbans: number;
  total: number;
  last_action: string;
}

interface StreamSession {
  id: number;
  channel_name: string;
  started_at: string;
  ended_at: string | null;
  title: string | null;
  game: string | null;
  peak_viewers: number;
  duration_seconds: number;
}

interface StreamStats {
  session: StreamSession;
  actions: { action: string; c: number }[];
  timeline: { hour: string; spam: number; total: number }[];
  top_spammers: { username: string; actions: number }[];
}

// ─── helpers ──────────────────────────────────────────────────────────────────
function msk(isoStr: string) {
  return new Date(isoStr).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function mskDate(isoStr: string) {
  return new Date(isoStr).toLocaleDateString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function mskTime(isoStr: string) {
  return new Date(isoStr).toLocaleTimeString('ru-RU', {
    timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit',
  });
}

function duration(sec: number) {
  if (!sec) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}ч ${m}м` : `${m}м`;
}

function bestName(m: ModeratorStat) {
  if (m.twitch_display_name) return m.twitch_display_name;
  if (m.twitch_username) return m.twitch_username;
  if (m.display_name) return m.display_name;
  if (m.performed_by.includes('@')) return m.performed_by.split('@')[0];
  return m.performed_by;
}

// ─── mini bar ─────────────────────────────────────────────────────────────────
function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ flex: 1, height: '4px', borderRadius: '4px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        style={{ height: '100%', background: color, borderRadius: '4px' }}
      />
    </div>
  );
}

// ─── section card ─────────────────────────────────────────────────────────────
function Card({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: '16px', padding: '20px 22px', marginBottom: '16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
        <Icon size={15} style={{ color: '#ffc800' }} />
        <span style={{ fontSize: '13px', fontWeight: 700, color: 'rgba(255,255,255,0.85)' }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

// ─── stream detail ────────────────────────────────────────────────────────────
function StreamDetail({ streamId, onBack }: { streamId: number; onBack: () => void }) {
  const [data, setData] = useState<StreamStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<StreamStats>(`/api/admin/streams/${streamId}/stats`)
      .then(setData).finally(() => setLoading(false));
  }, [streamId]);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', color: 'rgba(255,255,255,0.3)' }}>
      Загрузка...
    </div>
  );
  if (!data) return null;

  const { session, actions, timeline, top_spammers } = data;
  const totalActions = actions.reduce((s, a) => s + a.c, 0);
  const maxTimeline = Math.max(...timeline.map(t => t.total), 1);

  const actionColor: Record<string, string> = {
    MUTED: '#ffc800', AUTO_MUTED: '#ff9800', BANNED: '#ff5959', UNBANNED: '#00c878',
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <button onClick={onBack} style={{
        display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '18px',
        background: 'none', border: 'none', cursor: 'pointer',
        color: 'rgba(255,255,255,0.45)', fontSize: '12px',
      }}>
        ← Назад к стримам
      </button>

      <div style={{ marginBottom: '16px' }}>
        <div style={{ fontSize: '16px', fontWeight: 700, color: '#fff', marginBottom: '4px' }}>
          📺 {session.channel_name}
        </div>
        {session.title && (
          <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.45)', marginBottom: '4px' }}>
            {session.title}
          </div>
        )}
        <div style={{ display: 'flex', gap: '16px', fontSize: '11px', color: 'rgba(255,255,255,0.35)' }}>
          <span>🕐 {msk(session.started_at)} МСК</span>
          <span>⏱ {duration(session.duration_seconds)}</span>
          {session.peak_viewers > 0 && <span>👁 {session.peak_viewers.toLocaleString()} зрит.</span>}
          {session.game && <span>🎮 {session.game}</span>}
        </div>
      </div>

      {/* Action breakdown */}
      <Card title="Действия модерации" icon={Shield}>
        {totalActions === 0 ? (
          <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.3)' }}>Нет действий за этот стрим</div>
        ) : (
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            {actions.map(a => (
              <div key={a.action} style={{
                padding: '10px 16px', borderRadius: '12px',
                background: (actionColor[a.action] || '#ffffff') + '12',
                border: `1px solid ${(actionColor[a.action] || '#ffffff')}28`,
                textAlign: 'center',
              }}>
                <div style={{ fontSize: '22px', fontWeight: 800, color: actionColor[a.action] || '#fff' }}>{a.c}</div>
                <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', marginTop: '2px' }}>{a.action}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Activity timeline */}
      {timeline.length > 0 && (
        <Card title="Активность по часам" icon={BarChart2}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: '80px' }}>
            {timeline.map((t, i) => {
              const totalH = Math.round((t.total / maxTimeline) * 80);
              const spamH = Math.round((t.spam / maxTimeline) * 80);
              return (
                <div key={i} title={`${mskTime(t.hour)} — ${t.total} сообщ., ${t.spam} спам`}
                  style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', cursor: 'default' }}>
                  <div style={{ width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '72px', position: 'relative' }}>
                    <div style={{ width: '100%', height: `${totalH}px`, background: 'rgba(255,255,255,0.08)', borderRadius: '3px 3px 0 0', position: 'absolute', bottom: 0 }} />
                    <div style={{ width: '100%', height: `${spamH}px`, background: 'rgba(255,89,89,0.6)', borderRadius: '3px 3px 0 0', position: 'absolute', bottom: 0 }} />
                  </div>
                  <div style={{ fontSize: '8px', color: 'rgba(255,255,255,0.2)' }}>{mskTime(t.hour)}</div>
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: '14px', marginTop: '8px', fontSize: '10px' }}>
            <span style={{ color: 'rgba(255,255,255,0.35)' }}>■ Всего сообщений</span>
            <span style={{ color: 'rgba(255,89,89,0.8)' }}>■ Спам</span>
          </div>
        </Card>
      )}

      {/* Top spammers */}
      {top_spammers.length > 0 && (
        <Card title="Топ нарушителей" icon={Trophy}>
          {top_spammers.map((s, i) => (
            <div key={s.username} style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '6px 0', borderBottom: i < top_spammers.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
            }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.25)', minWidth: '16px' }}>#{i + 1}</span>
              <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.8)', flex: 1 }}>{s.username}</span>
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#ff7070' }}>{s.actions}</span>
            </div>
          ))}
        </Card>
      )}
    </motion.div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────
export function Analytics() {
  const [moderators, setModerators] = useState<ModeratorStat[]>([]);
  const [streams, setStreams] = useState<StreamSession[]>([]);
  const [channels, setChannels] = useState<string[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<string>('');
  const [selectedStream, setSelectedStream] = useState<number | null>(null);
  const [section, setSection] = useState<'mods' | 'streams'>('mods');
  const [loading, setLoading] = useState(true);
  const [modsLoading, setModsLoading] = useState(false);

  // Load channels list + streams on mount
  useEffect(() => {
    Promise.all([
      api.get<{ name: string }[]>('/api/channels'),
      api.get<StreamSession[]>('/api/admin/streams'),
    ]).then(([chs, strms]) => {
      const names = chs.map(c => c.name);
      setChannels(names);
      setStreams(strms);
      if (names.length > 0) setSelectedChannel(names[0]);
    }).finally(() => setLoading(false));
  }, []);

  // Load moderators when channel changes
  useEffect(() => {
    if (!selectedChannel) return;
    setModsLoading(true);
    api.get<ModeratorStat[]>(`/api/admin/stats/moderators?channel=${encodeURIComponent(selectedChannel)}`)
      .then(setModerators)
      .finally(() => setModsLoading(false));
  }, [selectedChannel]);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'rgba(255,255,255,0.3)', fontSize: '13px' }}>
      Загрузка аналитики...
    </div>
  );

  const maxTotal = Math.max(...moderators.map(m => m.total), 1);

  // Group streams by MSK date
  const streamsByDate = streams.reduce<Record<string, StreamSession[]>>((acc, s) => {
    const d = mskDate(s.started_at);
    if (!acc[d]) acc[d] = [];
    acc[d].push(s);
    return acc;
  }, {});

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
      <div style={{ maxWidth: '860px', margin: '0 auto' }}>

        {/* Section tabs */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '22px' }}>
          {([
            ['mods', 'Модераторы', Users],
            ['streams', 'Стримы', Radio],
          ] as const).map(([id, label, Icon]) => (
            <button key={id} onClick={() => { setSection(id); setSelectedStream(null); }}
              style={{
                display: 'flex', alignItems: 'center', gap: '7px',
                padding: '8px 16px', borderRadius: '10px', cursor: 'pointer',
                fontSize: '12px', fontWeight: 600, border: 'none', outline: 'none',
                background: section === id ? 'rgba(255,200,0,0.1)' : 'rgba(255,255,255,0.03)',
                color: section === id ? '#ffc800' : 'rgba(255,255,255,0.45)',
              }}>
              <Icon size={13} />{label}
            </button>
          ))}
        </div>

        {/* ── MODERATORS ── */}
        {section === 'mods' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {/* Channel selector */}
            {channels.length > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Канал:</span>
                <div style={{ position: 'relative' }}>
                  <select
                    value={selectedChannel}
                    onChange={e => setSelectedChannel(e.target.value)}
                    style={{
                      appearance: 'none', padding: '7px 32px 7px 12px', borderRadius: '10px',
                      background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                      color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', outline: 'none',
                    }}>
                    {channels.map(ch => <option key={ch} value={ch}>{ch}</option>)}
                  </select>
                  <ChevronDown size={12} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.4)', pointerEvents: 'none' }} />
                </div>
              </div>
            )}

            <Card title={`Модераторы — ${selectedChannel || '...'}`} icon={Trophy}>
              {modsLoading ? (
                <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.3)', padding: '12px 0' }}>Загрузка...</div>
              ) : moderators.length === 0 ? (
                <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.3)', padding: '12px 0' }}>
                  Нет действий на этом канале
                </div>
              ) : moderators.map((m, i) => {
                const name = bestName(m);
                const rankColor = i === 0 ? '#ffc800' : i === 1 ? '#aaaaaa' : i === 2 ? '#cd7f32' : 'rgba(255,255,255,0.2)';
                return (
                  <div key={m.performed_by} style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    padding: '12px 0',
                    borderBottom: i < moderators.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                  }}>
                    {/* Rank */}
                    <span style={{ fontSize: '12px', fontWeight: 800, color: rankColor, minWidth: '22px', textAlign: 'center' }}>
                      #{i + 1}
                    </span>

                    {/* Twitch avatar */}
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      {m.twitch_avatar ? (
                        <img src={m.twitch_avatar} alt={name}
                          style={{ width: '36px', height: '36px', borderRadius: '50%', display: 'block', border: `2px solid ${rankColor}44` }} />
                      ) : (
                        <div style={{
                          width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0,
                          background: 'rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center',
                          justifyContent: 'center', fontSize: '14px', fontWeight: 700,
                          color: 'rgba(255,255,255,0.4)', border: `2px solid ${rankColor}44`,
                        }}>
                          {name[0]?.toUpperCase()}
                        </div>
                      )}
                      {/* Twitch purple dot */}
                      {m.twitch_username && (
                        <div style={{
                          position: 'absolute', bottom: '-1px', right: '-1px',
                          width: '12px', height: '12px', borderRadius: '50%',
                          background: '#9147ff', border: '2px solid rgba(5,5,8,1)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <svg width="7" height="7" viewBox="0 0 24 24" fill="white">
                            <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/>
                          </svg>
                        </div>
                      )}
                    </div>

                    {/* Name + stats */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                        <div>
                          <span style={{ fontSize: '13px', fontWeight: 700, color: 'rgba(255,255,255,0.9)' }}>
                            {name}
                          </span>
                          {m.twitch_username && m.twitch_display_name !== m.twitch_username && (
                            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', marginLeft: '6px' }}>
                              @{m.twitch_username}
                            </span>
                          )}
                        </div>
                        <span style={{ fontSize: '13px', fontWeight: 800, color: '#fff', marginLeft: '8px', flexShrink: 0 }}>{m.total}</span>
                      </div>
                      <MiniBar value={m.total} max={maxTotal} color={rankColor === 'rgba(255,255,255,0.2)' ? '#ffc800' : rankColor} />
                      <div style={{ display: 'flex', gap: '12px', marginTop: '6px', fontSize: '10px', flexWrap: 'wrap' }}>
                        {m.mutes > 0 && <span style={{ color: '#ffc800' }}>🔇 {m.mutes} мут</span>}
                        {m.auto_mutes > 0 && <span style={{ color: '#ff9800' }}>🤖 {m.auto_mutes} авто</span>}
                        {m.bans > 0 && <span style={{ color: '#ff5959' }}>🔨 {m.bans} бан</span>}
                        {m.unbans > 0 && <span style={{ color: '#00c878' }}>✅ {m.unbans} разбан</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </Card>

            {/* Legend */}
            <div style={{ display: 'flex', gap: '18px', fontSize: '10px', color: 'rgba(255,255,255,0.3)', padding: '0 4px' }}>
              <span>🔇 Мут вручную</span>
              <span>🤖 Авто-мут</span>
              <span>🔨 Бан</span>
              <span>✅ Разбан</span>
            </div>
          </motion.div>
        )}

        {/* ── STREAMS ── */}
        {section === 'streams' && !selectedStream && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {streams.length === 0 ? (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                padding: '60px 20px', gap: '12px', textAlign: 'center',
                background: 'rgba(255,255,255,0.02)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)',
              }}>
                <Radio size={32} style={{ color: 'rgba(255,255,255,0.15)' }} />
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'rgba(255,255,255,0.4)' }}>Стримы ещё не обнаружены</div>
                <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.25)', maxWidth: '280px' }}>
                  Система начнёт отслеживать стримы автоматически. Проверка идёт каждую минуту.
                </div>
              </div>
            ) : (
              Object.entries(streamsByDate).map(([date, dayStreams]) => (
                <div key={date} style={{ marginBottom: '20px' }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px',
                    fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.35)',
                    textTransform: 'uppercase', letterSpacing: '0.1em',
                  }}>
                    <Calendar size={11} />
                    {date} МСК
                    <span style={{ fontWeight: 400, color: 'rgba(255,255,255,0.2)' }}>· {dayStreams.length} {dayStreams.length === 1 ? 'стрим' : 'стрима'}</span>
                  </div>

                  {dayStreams.map(s => (
                    <motion.div
                      key={s.id}
                      whileHover={{ scale: 1.01 }}
                      onClick={() => setSelectedStream(s.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '14px',
                        padding: '13px 16px', marginBottom: '6px', borderRadius: '12px', cursor: 'pointer',
                        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                        transition: 'background 0.15s, border-color 0.15s',
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)';
                        (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,200,0,0.18)';
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)';
                        (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.06)';
                      }}>

                      {/* Live indicator */}
                      <div style={{
                        width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
                        background: s.ended_at ? 'rgba(255,255,255,0.15)' : '#ff5959',
                        boxShadow: s.ended_at ? 'none' : '0 0 8px #ff595988',
                      }} />

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.85)', marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {s.title || s.channel_name}
                        </div>
                        <div style={{ display: 'flex', gap: '12px', fontSize: '10px', color: 'rgba(255,255,255,0.35)' }}>
                          <span>📺 {s.channel_name}</span>
                          <span><Clock size={9} style={{ display: 'inline', verticalAlign: 'middle' }} /> {mskTime(s.started_at)} МСК</span>
                          <span>⏱ {duration(s.duration_seconds)}</span>
                          {s.peak_viewers > 0 && <span>👁 {s.peak_viewers.toLocaleString()}</span>}
                          {s.game && <span>🎮 {s.game}</span>}
                        </div>
                      </div>

                      <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.25)', flexShrink: 0 }}>
                        {s.ended_at ? 'Архив' : 'LIVE'}
                      </div>
                      <Zap size={12} style={{ color: 'rgba(255,255,255,0.2)', flexShrink: 0 }} />
                    </motion.div>
                  ))}
                </div>
              ))
            )}
          </motion.div>
        )}

        {/* ── STREAM DETAIL ── */}
        {section === 'streams' && selectedStream && (
          <StreamDetail streamId={selectedStream} onBack={() => setSelectedStream(null)} />
        )}
      </div>
    </div>
  );
}
