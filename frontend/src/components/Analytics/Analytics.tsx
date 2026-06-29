import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Radio, Calendar, Clock, Zap, ChevronDown, ChevronLeft, VolumeX, Ban, RotateCcw, Shield, Users, TrendingUp } from 'lucide-react';
import { api } from '../../hooks/useApi';

// ─── types ────────────────────────────────────────────────────────────────────
interface TwitchMod {
  twitch_login: string;
  twitch_display_name: string;
  twitch_avatar: string | null;
  mutes: number;
  auto_mutes: number;
  bans: number;
  unbans: number;
  total: number;
  last_action: string | null;
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
function msk(iso: string) {
  return new Date(iso).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit',
    year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
function mskDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', {
    timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric',
  });
}
function mskTime(iso: string) {
  return new Date(iso).toLocaleTimeString('ru-RU', {
    timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit',
  });
}
function dur(sec: number) {
  if (!sec) return '—';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}ч ${m}м` : `${m}м`;
}

const ACTION_COLOR: Record<string, string> = {
  MUTED: '#ffc800', AUTO_MUTED: '#ff9800', BANNED: '#ff4444', UNBANNED: '#00c878',
};
const ACTION_LABEL: Record<string, string> = {
  MUTED: 'МУТ', AUTO_MUTED: 'АВТО', BANNED: 'БАН', UNBANNED: 'РАЗБАН',
};

// ─── stat pill ────────────────────────────────────────────────────────────────
function Pill({ value, type }: { value: number; type: string }) {
  const color = ACTION_COLOR[type] || '#fff';
  if (!value) return null;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '2px 8px', borderRadius: '5px', fontSize: '10px', fontWeight: 700,
      background: `${color}14`, color, border: `1px solid ${color}28`,
      letterSpacing: '0.04em',
    }}>
      {value} {ACTION_LABEL[type]}
    </span>
  );
}

// ─── stream detail ────────────────────────────────────────────────────────────
function StreamDetail({ streamId, onBack }: { streamId: number; onBack: () => void }) {
  const [data, setData] = useState<StreamStats | null>(null);

  useEffect(() => {
    api.get<StreamStats>(`/api/admin/streams/${streamId}/stats`).then(setData);
  }, [streamId]);

  if (!data) return <div style={{ color: 'rgba(255,255,255,0.3)', padding: '40px', fontSize: '13px' }}>Загрузка...</div>;

  const { session, actions, timeline, top_spammers } = data;
  const maxBar = Math.max(...timeline.map(t => t.total), 1);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <button onClick={onBack} style={{
        display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '20px',
        background: 'none', border: 'none', cursor: 'pointer',
        color: 'rgba(255,255,255,0.35)', fontSize: '12px', fontWeight: 500,
        transition: 'color 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.7)')}
      onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.35)')}>
        <ChevronLeft size={14} /> Назад к стримам
      </button>

      {/* Stream header */}
      <div style={{ marginBottom: '20px', padding: '18px 20px', borderRadius: '14px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: session.ended_at ? 'rgba(255,255,255,0.2)' : '#ff4444', boxShadow: session.ended_at ? 'none' : '0 0 10px #ff444488', flexShrink: 0 }} />
          <span style={{ fontSize: '16px', fontWeight: 700, color: '#fff' }}>{session.channel_name}</span>
          {session.game && <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', padding: '2px 8px', background: 'rgba(255,255,255,0.04)', borderRadius: '5px' }}>{session.game}</span>}
        </div>
        {session.title && <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginBottom: '10px' }}>{session.title}</div>}
        <div style={{ display: 'flex', gap: '20px', fontSize: '11px', color: 'rgba(255,255,255,0.3)' }}>
          <span>{msk(session.started_at)} МСК</span>
          <span>Длительность: {dur(session.duration_seconds)}</span>
          {session.peak_viewers > 0 && <span>Пик: {session.peak_viewers.toLocaleString()} зрит.</span>}
        </div>
      </div>

      {/* Action counters */}
      {actions.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
          {actions.map(a => {
            const color = ACTION_COLOR[a.action] || '#fff';
            return (
              <div key={a.action} style={{
                padding: '14px 18px', borderRadius: '12px', flex: '1', minWidth: '80px',
                background: `${color}0d`, border: `1px solid ${color}22`,
              }}>
                <div style={{ fontSize: '26px', fontWeight: 800, color, lineHeight: 1 }}>{a.c}</div>
                <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', marginTop: '5px', letterSpacing: '0.08em' }}>{ACTION_LABEL[a.action] || a.action}</div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        {/* Timeline */}
        {timeline.length > 0 && (
          <div style={{ padding: '18px', borderRadius: '14px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '14px' }}>Активность по часам</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '80px' }}>
              {timeline.map((t, i) => {
                const h = Math.max(2, (t.total / maxBar) * 80);
                const sh = t.total > 0 ? (t.spam / t.total) * h : 0;
                return (
                  <div key={i} title={`${mskTime(t.hour)} — ${t.total} сообщ., ${t.spam} спам`}
                    style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '80px' }}>
                    <div style={{ width: '100%', height: `${h}px`, borderRadius: '2px 2px 0 0', background: 'rgba(255,255,255,0.1)', position: 'relative', overflow: 'hidden' }}>
                      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${sh}px`, background: 'rgba(255,68,68,0.7)' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Top spammers */}
        {top_spammers.length > 0 && (
          <div style={{ padding: '18px', borderRadius: '14px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '14px' }}>Топ нарушителей</div>
            {top_spammers.map((s, i) => (
              <div key={s.username} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.2)', minWidth: '18px', fontWeight: 700 }}>#{i + 1}</span>
                <span style={{ flex: 1, fontSize: '12px', color: 'rgba(255,255,255,0.75)', fontWeight: 500 }}>{s.username}</span>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#ff7070' }}>{s.actions}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── main ─────────────────────────────────────────────────────────────────────
export function Analytics() {
  const [channels, setChannels] = useState<string[]>([]);
  const [selectedChannel, setSelectedChannel] = useState('');
  const [mods, setMods] = useState<TwitchMod[]>([]);
  const [streams, setStreams] = useState<StreamSession[]>([]);
  const [selectedStream, setSelectedStream] = useState<number | null>(null);
  const [section, setSection] = useState<'mods' | 'streams'>('mods');
  const [modsLoading, setModsLoading] = useState(false);
  const [modsError, setModsError] = useState<string | null>(null);
  const [init, setInit] = useState(false);

  useEffect(() => {
    const loadStreams = () =>
      api.get<StreamSession[]>('/api/admin/streams').catch(() => [] as StreamSession[]);

    const sync = () =>
      api.post<any>('/api/admin/streams/sync', {})
        .then(() => loadStreams()).then(setStreams)
        .catch(() => {});

    Promise.all([
      api.get<{ name: string }[]>('/api/channels').catch(() => [] as { name: string }[]),
      loadStreams(),
    ]).then(([chs, strms]) => {
      const names = chs.map(c => c.name);
      setChannels(names);
      setStreams(strms);
      if (names.length > 0) setSelectedChannel(names[0]);
    }).finally(() => { setInit(true); sync(); });

    const interval = setInterval(sync, 60_000);
    return () => clearInterval(interval);
  }, []);

  const loadModsFromLogs = useCallback((ch: string) => {
    api.get<any[]>(`/api/admin/stats/moderators?channel=${encodeURIComponent(ch)}`)
      .then(data => {
        // Convert log-based stats to TwitchMod shape
        const converted: TwitchMod[] = (data || []).map((m: any) => ({
          twitch_login: m.twitch_username || m.performed_by,
          twitch_display_name: m.twitch_display_name || m.display_name || m.performed_by?.split('@')[0] || m.performed_by,
          twitch_avatar: m.twitch_avatar || null,
          mutes: m.mutes || 0,
          auto_mutes: m.auto_mutes || 0,
          bans: m.bans || 0,
          unbans: m.unbans || 0,
          total: m.total || 0,
          last_action: m.last_action || null,
        }));
        setMods(converted);
        setModsError('Показаны только модераторы которые действовали через сайт (нет scope channel:read:moderators)');
      })
      .catch(() => setModsError('Не удалось загрузить данные'))
      .finally(() => setModsLoading(false));
  }, []);

  const loadMods = useCallback((ch: string) => {
    if (!ch) return;
    setModsLoading(true);
    setModsError(null);
    api.get<any>(`/api/admin/channels/${encodeURIComponent(ch)}/moderators`)
      .then(data => {
        if (Array.isArray(data)) { setMods(data); setModsError(null); setModsLoading(false); }
        else loadModsFromLogs(ch);
      })
      .catch(() => loadModsFromLogs(ch));
  }, [loadModsFromLogs]);

  useEffect(() => {
    if (selectedChannel) loadMods(selectedChannel);
  }, [selectedChannel, loadMods]);

  if (!init) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'rgba(255,255,255,0.25)', fontSize: '13px' }}>
      Загрузка...
    </div>
  );

  const maxTotal = Math.max(...mods.map(m => m.total), 1);
  const streamsByDate = streams.reduce<Record<string, StreamSession[]>>((acc, s) => {
    const d = mskDate(s.started_at);
    (acc[d] = acc[d] || []).push(s);
    return acc;
  }, {});

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>

        {/* Section tabs */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '24px', padding: '4px', background: 'rgba(255,255,255,0.03)', borderRadius: '11px', width: 'fit-content', border: '1px solid rgba(255,255,255,0.06)' }}>
          {([['mods', 'Модераторы', Users], ['streams', 'Стримы', Radio]] as const).map(([id, label, Icon]) => (
            <button key={id} onClick={() => { setSection(id); setSelectedStream(null); }}
              style={{
                display: 'flex', alignItems: 'center', gap: '7px',
                padding: '7px 18px', borderRadius: '8px', cursor: 'pointer',
                fontSize: '12px', fontWeight: 600, border: 'none', outline: 'none',
                background: section === id ? 'rgba(255,255,255,0.08)' : 'transparent',
                color: section === id ? '#fff' : 'rgba(255,255,255,0.35)',
                transition: 'all 0.15s',
              }}>
              <Icon size={13} />{label}
            </button>
          ))}
        </div>

        {/* ── MODS ── */}
        {section === 'mods' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {/* Channel selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
              <span style={{ fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.14em' }}>Канал</span>
              <div style={{ position: 'relative' }}>
                <select value={selectedChannel} onChange={e => setSelectedChannel(e.target.value)}
                  style={{
                    appearance: 'none', padding: '8px 36px 8px 14px', borderRadius: '10px',
                    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                    color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', outline: 'none',
                  }}>
                  {channels.map(ch => <option key={ch} value={ch}>{ch}</option>)}
                </select>
                <ChevronDown size={12} style={{ position: 'absolute', right: '11px', top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.4)', pointerEvents: 'none' }} />
              </div>
              <button onClick={() => loadMods(selectedChannel)} style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '8px 12px', borderRadius: '9px', border: '1px solid rgba(255,255,255,0.07)',
                background: 'rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.4)',
                fontSize: '11px', fontWeight: 600, cursor: 'pointer',
              }}>
                <RotateCcw size={11} /> Обновить
              </button>
            </div>

            {/* Table header */}
            {!modsLoading && mods.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 80px 80px 80px 80px 80px', gap: '0', padding: '0 16px 10px', fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                <span>#</span>
                <span>Модератор</span>
                <span style={{ textAlign: 'right' }}>Мут</span>
                <span style={{ textAlign: 'right' }}>Авто</span>
                <span style={{ textAlign: 'right' }}>Бан</span>
                <span style={{ textAlign: 'right' }}>Разбан</span>
                <span style={{ textAlign: 'right' }}>Всего</span>
              </div>
            )}

            <div style={{ borderRadius: '14px', border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden' }}>
              {modsLoading ? (
                <div style={{ padding: '40px', textAlign: 'center', color: 'rgba(255,255,255,0.25)', fontSize: '13px' }}>
                  Загрузка модераторов с Twitch...
                </div>
              ) : mods.length === 0 ? (
                <div style={{ padding: '40px', textAlign: 'center', color: 'rgba(255,255,255,0.25)', fontSize: '13px' }}>
                  Нет модераторов на этом канале
                </div>
              ) : mods.map((m, i) => {
                const isActive = m.total > 0;
                const barPct = maxTotal > 0 ? (m.total / maxTotal) * 100 : 0;
                const rankColors = ['#ffc800', '#9e9e9e', '#cd7f32'];
                const rankColor = rankColors[i] || 'rgba(255,255,255,0.15)';

                return (
                  <motion.div
                    key={m.twitch_login}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.03 }}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '40px 1fr 80px 80px 80px 80px 80px',
                      alignItems: 'center',
                      padding: '12px 16px',
                      borderBottom: '1px solid rgba(255,255,255,0.04)',
                      background: i % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent',
                      opacity: isActive ? 1 : 0.45,
                      position: 'relative', overflow: 'hidden',
                    }}>

                    {/* Progress bg */}
                    {isActive && (
                      <div style={{
                        position: 'absolute', left: 0, top: 0, bottom: 0,
                        width: `${barPct}%`, background: `${rankColor}08`,
                        pointerEvents: 'none', transition: 'width 0.6s ease',
                      }} />
                    )}

                    {/* Rank */}
                    <span style={{ fontSize: '11px', fontWeight: 800, color: rankColor, position: 'relative' }}>
                      {i + 1}
                    </span>

                    {/* Avatar + name */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', position: 'relative', minWidth: 0 }}>
                      <div style={{ position: 'relative', flexShrink: 0 }}>
                        {m.twitch_avatar ? (
                          <img src={m.twitch_avatar} alt="" style={{ width: '32px', height: '32px', borderRadius: '50%', display: 'block', border: `1.5px solid ${rankColor}44` }} />
                        ) : (
                          <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, color: 'rgba(255,255,255,0.4)', border: `1.5px solid ${rankColor}44` }}>
                            {m.twitch_display_name[0]?.toUpperCase()}
                          </div>
                        )}
                        {/* Twitch badge */}
                        <div style={{ position: 'absolute', bottom: '-2px', right: '-2px', width: '11px', height: '11px', borderRadius: '50%', background: '#9147ff', border: '1.5px solid rgba(5,5,8,1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <svg width="6" height="6" viewBox="0 0 24 24" fill="white"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/></svg>
                        </div>
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: isActive ? '#fff' : 'rgba(255,255,255,0.6)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {m.twitch_display_name}
                        </div>
                        {m.last_action && (
                          <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.2)', marginTop: '1px' }}>
                            {msk(m.last_action)}
                          </div>
                        )}
                        {!m.last_action && (
                          <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.15)', marginTop: '1px' }}>нет действий</div>
                        )}
                      </div>
                    </div>

                    {/* Stats columns */}
                    {[
                      { v: m.mutes, color: '#ffc800' },
                      { v: m.auto_mutes, color: '#ff9800' },
                      { v: m.bans, color: '#ff4444' },
                      { v: m.unbans, color: '#00c878' },
                      { v: m.total, color: '#fff' },
                    ].map(({ v, color }, ci) => (
                      <div key={ci} style={{ textAlign: 'right', position: 'relative' }}>
                        <span style={{ fontSize: ci === 4 ? '14px' : '13px', fontWeight: ci === 4 ? 800 : 600, color: v > 0 ? color : 'rgba(255,255,255,0.12)' }}>
                          {v > 0 ? v : '—'}
                        </span>
                      </div>
                    ))}
                  </motion.div>
                );
              })}
            </div>

            {/* Fallback notice */}
            {modsError && mods.length > 0 && (
              <div style={{ marginTop: '10px', padding: '8px 14px', borderRadius: '8px', background: 'rgba(255,200,0,0.06)', border: '1px solid rgba(255,200,0,0.12)', fontSize: '11px', color: 'rgba(255,200,0,0.6)' }}>
                {modsError}
              </div>
            )}

            {/* Legend */}
            {mods.length > 0 && (
              <div style={{ display: 'flex', gap: '20px', padding: '12px 4px 0', fontSize: '10px' }}>
                {[['Мут', '#ffc800'], ['Авто-мут', '#ff9800'], ['Бан', '#ff4444'], ['Разбан', '#00c878']].map(([l, c]) => (
                  <span key={l} style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'rgba(255,255,255,0.25)' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: c, display: 'inline-block', opacity: 0.8 }} />
                    {l}
                  </span>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {/* ── STREAMS ── */}
        {section === 'streams' && !selectedStream && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {streams.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
                <button onClick={async () => {
                  if (!confirm('Удалить все записи стримов?')) return;
                  await api.delete('/api/admin/streams');
                  setStreams([]);
                }} style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '7px 14px', borderRadius: '9px', border: '1px solid rgba(240,71,71,0.2)',
                  background: 'rgba(240,71,71,0.06)', color: 'rgba(255,100,100,0.7)',
                  fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(240,71,71,0.14)'; e.currentTarget.style.color = '#ff7070'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(240,71,71,0.06)'; e.currentTarget.style.color = 'rgba(255,100,100,0.7)'; }}>
                  <RotateCcw size={11} /> Очистить историю
                </button>
              </div>
            )}
            {streams.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', padding: '60px 20px', textAlign: 'center', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.02)' }}>
                <Radio size={28} style={{ color: 'rgba(255,255,255,0.12)' }} />
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'rgba(255,255,255,0.35)' }}>Стримы ещё не обнаружены</div>
                <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.2)', maxWidth: '280px' }}>Система отслеживает стримы автоматически каждую минуту</div>
              </div>
            ) : Object.entries(streamsByDate).map(([date, dayStreams]) => (
              <div key={date} style={{ marginBottom: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                  <Calendar size={10} />{date} МСК
                  <span style={{ fontWeight: 400, color: 'rgba(255,255,255,0.15)' }}>· {dayStreams.length} {dayStreams.length === 1 ? 'стрим' : 'стрима'}</span>
                </div>
                {dayStreams.map(s => (
                  <motion.div key={s.id} whileHover={{ x: 4 }}
                    onClick={() => setSelectedStream(s.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 18px', marginBottom: '5px', borderRadius: '12px', cursor: 'pointer', border: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.02)', transition: 'border-color 0.15s, background 0.15s' }}
                    onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'rgba(255,255,255,0.1)'; el.style.background = 'rgba(255,255,255,0.04)'; }}
                    onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'rgba(255,255,255,0.05)'; el.style.background = 'rgba(255,255,255,0.02)'; }}>

                    <div style={{ width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0, background: s.ended_at ? 'rgba(255,255,255,0.12)' : '#ff4444', boxShadow: s.ended_at ? 'none' : '0 0 8px #ff444466' }} />

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.85)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: '3px' }}>
                        {s.title || s.channel_name}
                      </div>
                      <div style={{ display: 'flex', gap: '14px', fontSize: '10px', color: 'rgba(255,255,255,0.28)' }}>
                        <span>{s.channel_name}</span>
                        <span>{mskTime(s.started_at)} МСК</span>
                        <span>{dur(s.duration_seconds)}</span>
                        {s.peak_viewers > 0 && <span>{s.peak_viewers.toLocaleString()} зрит.</span>}
                        {s.game && <span>{s.game}</span>}
                      </div>
                    </div>

                    <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', color: s.ended_at ? 'rgba(255,255,255,0.2)' : '#ff4444', flexShrink: 0 }}>
                      {s.ended_at ? 'АРХИВ' : 'LIVE'}
                    </div>
                    <Zap size={12} style={{ color: 'rgba(255,255,255,0.15)', flexShrink: 0 }} />
                  </motion.div>
                ))}
              </div>
            ))}
          </motion.div>
        )}

        {section === 'streams' && selectedStream && (
          <StreamDetail streamId={selectedStream} onBack={() => setSelectedStream(null)} />
        )}
      </div>
    </div>
  );
}
