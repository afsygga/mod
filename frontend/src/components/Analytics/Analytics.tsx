import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Radio, Calendar, Clock, Zap, ChevronDown, ChevronLeft, VolumeX, Ban, RotateCcw, Shield, Users, TrendingUp, X } from 'lucide-react';
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
  top_spammers: { username: string; mute_count: number }[];
  buckets: { bucket: string; msgs: number; spam: number }[];
}

interface MinuteData {
  minute: string;
  msgs: number;
  spam: number;
  spam_users: number;
}

interface ModProfile {
  action_breakdown: { action: string; c: number }[];
  daily_activity: { day: string; c: number }[];
  recent_actions: { action: string; target_username: string; channel_name: string; created_at: string }[];
  avg_response_sec: number | null;
  profile_image_url: string | null;
  display_name: string | null;
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
function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'только что';
  if (m < 60) return `${m}м назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}ч назад`;
  return `${Math.floor(h / 24)}д назад`;
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

// ─── moderator profile modal ──────────────────────────────────────────────────
function ModProfileModal({ mod, rank, channel, channels, onClose }: {
  mod: TwitchMod;
  rank: number;
  channel: string;
  channels: string[];
  onClose: () => void;
}) {
  const [profile, setProfile] = useState<ModProfile | null>(null);
  const [profileChannel, setProfileChannel] = useState(channel);

  useEffect(() => {
    const username = mod.twitch_login;
    const ch = profileChannel || '';
    api.get<ModProfile>(`/api/admin/moderators/${encodeURIComponent(username)}/profile?channel=${encodeURIComponent(ch)}`)
      .then(setProfile).catch(() => {});
  }, [mod.twitch_login, profileChannel]);

  const rankColors = ['#ffc800', '#9e9e9e', '#cd7f32'];
  const rankColor = rankColors[rank - 1] || 'rgba(255,255,255,0.3)';

  // Compute KPD
  const bans = mod.bans || 0;
  const mutes = mod.mutes || 0;
  const autoMutes = mod.auto_mutes || 0;
  const total = mod.total || 1;
  const kpd = Math.min(100, Math.round((bans * 3 + mutes * 1 + autoMutes * 0.5) / Math.max(1, total) * 100));

  // Radar scores (0-100 each)
  const avgRespSec = profile?.avg_response_sec || null;
  const daysActive = profile ? new Set(profile.daily_activity.map(d => d.day)).size : 0;
  const totalActions30 = profile ? profile.daily_activity.reduce((s, d) => s + d.c, 0) : 0;
  const actionsPerDay = daysActive > 0 ? totalActions30 / daysActive : 0;
  const maxActDay = 50; // normalize: 50 actions/day = 100%

  const radarScores = {
    speed: avgRespSec !== null ? Math.max(0, Math.min(100, 100 - (avgRespSec / 600) * 100)) : 50,
    activity: Math.min(100, (actionsPerDay / maxActDay) * 100),
    presence: Math.min(100, (daysActive / 30) * 100),
    harshness: Math.min(100, (bans / Math.max(1, total)) * 100 * 10),
    mutes: Math.min(100, (mutes / Math.max(1, total)) * 100 * 2),
  };

  // SVG pentagon radar
  const radarLabels = ['Скорость', 'Активность', 'Присутствие', 'Жёсткость', 'Мутов'];
  const radarVals = [radarScores.speed, radarScores.activity, radarScores.presence, radarScores.harshness, radarScores.mutes];
  const CX = 90, CY = 90, R = 70;
  const angles = radarLabels.map((_, i) => (i * 2 * Math.PI / 5) - Math.PI / 2);
  const outerPts = angles.map(a => ({ x: CX + R * Math.cos(a), y: CY + R * Math.sin(a) }));
  const innerPts = angles.map((a, i) => ({
    x: CX + (R * radarVals[i] / 100) * Math.cos(a),
    y: CY + (R * radarVals[i] / 100) * Math.sin(a),
  }));
  const polygon = innerPts.map(p => `${p.x},${p.y}`).join(' ');
  const outerPolygon = outerPts.map(p => `${p.x},${p.y}`).join(' ');

  // KPD SVG circle
  const KPD_R = 36;
  const KPD_CIRC = 2 * Math.PI * KPD_R;
  const kpdDash = (kpd / 100) * KPD_CIRC;

  // Daily activity 30-day bar chart
  const last30: { day: string; c: number }[] = [];
  if (profile) {
    const dayMap: Record<string, number> = {};
    profile.daily_activity.forEach(d => { dayMap[d.day.slice(0, 10)] = d.c; });
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      last30.push({ day: key, c: dayMap[key] || 0 });
    }
  }
  const maxDayC = Math.max(...last30.map(d => d.c), 1);

  // Action distribution
  const totalAct = profile?.action_breakdown.reduce((s, a) => s + a.c, 0) || 1;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(5,5,8,0.92)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '24px', overflowY: 'auto',
      }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: '820px',
          background: 'rgba(12,12,18,1)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '20px', overflow: 'hidden',
        }}>

        {/* Header */}
        <div style={{ padding: '24px 28px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'flex-start', gap: '18px' }}>
          {/* Avatar */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            {mod.twitch_avatar ? (
              <img src={mod.twitch_avatar} alt="" style={{ width: '64px', height: '64px', borderRadius: '50%', border: `2px solid ${rankColor}66` }} />
            ) : (
              <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(160,112,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', fontWeight: 800, color: '#a070ff', border: `2px solid ${rankColor}66` }}>
                {mod.twitch_display_name[0]?.toUpperCase()}
              </div>
            )}
            <div style={{ position: 'absolute', bottom: '-2px', right: '-2px', background: '#9147ff', borderRadius: '50%', width: '18px', height: '18px', border: '2px solid rgba(12,12,18,1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="8" height="8" viewBox="0 0 24 24" fill="white"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/></svg>
            </div>
          </div>

          {/* Name + rank */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
              <span style={{ fontSize: '20px', fontWeight: 800, color: '#fff' }}>{mod.twitch_display_name}</span>
              <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 10px', borderRadius: '20px', background: `${rankColor}18`, color: rankColor, border: `1px solid ${rankColor}44` }}>#{rank}</span>
            </div>
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.35)', marginBottom: '8px' }}>@{mod.twitch_login}</div>
            {mod.last_action && <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.2)' }}>Последнее действие: {msk(mod.last_action)}</div>}
          </div>

          {/* Channel selector */}
          {channels.length > 1 && (
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <select value={profileChannel} onChange={e => setProfileChannel(e.target.value)}
                style={{ appearance: 'none', padding: '7px 28px 7px 12px', borderRadius: '9px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: '12px', cursor: 'pointer', outline: 'none' }}>
                <option value="">Все каналы</option>
                {channels.map(ch => <option key={ch} value={ch}>{ch}</option>)}
              </select>
              <ChevronDown size={11} style={{ position: 'absolute', right: '9px', top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.4)', pointerEvents: 'none' }} />
            </div>
          )}

          {/* Close */}
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.3)', padding: '4px', borderRadius: '6px', display: 'flex', flexShrink: 0 }}
            onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.7)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.3)')}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '24px 28px' }}>
          {/* KPD + Stats row */}
          <div style={{ display: 'flex', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' }}>
            {/* KPD Circle */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '16px 20px', borderRadius: '16px', background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.06)', minWidth: '110px' }}>
              <svg width="90" height="90" viewBox="0 0 90 90">
                <defs>
                  <linearGradient id="kpdGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#a070ff" />
                    <stop offset="100%" stopColor="#00e5cc" />
                  </linearGradient>
                </defs>
                <circle cx="45" cy="45" r={KPD_R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
                <circle cx="45" cy="45" r={KPD_R} fill="none" stroke="url(#kpdGrad)" strokeWidth="6"
                  strokeDasharray={`${kpdDash} ${KPD_CIRC}`}
                  strokeLinecap="round" strokeDashoffset={KPD_CIRC / 4}
                  style={{ transform: 'rotate(-90deg)', transformOrigin: '45px 45px' }} />
                <text x="45" y="42" textAnchor="middle" style={{ fontSize: '18px', fontWeight: 800, fill: '#fff', fontFamily: 'Inter,sans-serif' }}>{kpd}</text>
                <text x="45" y="55" textAnchor="middle" style={{ fontSize: '8px', fill: 'rgba(255,255,255,0.35)', fontFamily: 'Inter,sans-serif' }}>КПД</text>
              </svg>
            </div>

            {/* Stats */}
            {[
              { label: 'Всего', value: total, color: '#fff' },
              { label: 'Мутов', value: mutes, color: '#ffc800' },
              { label: 'Банов', value: bans, color: '#ff4444' },
              { label: 'Разбанов', value: mod.unbans || 0, color: '#00c878' },
              { label: 'Авто-мут', value: autoMutes, color: '#ff9800' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ flex: '1', minWidth: '80px', padding: '16px', borderRadius: '16px', background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ fontSize: '26px', fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
                <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', marginTop: '6px', letterSpacing: '0.06em' }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Radar + Action Distribution */}
          <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: '16px', marginBottom: '20px' }}>
            {/* Radar chart */}
            <div style={{ padding: '16px', borderRadius: '16px', background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px' }}>Профиль</div>
              <svg width="180" height="180" viewBox="0 0 180 180">
                {/* Grid rings */}
                {[0.25, 0.5, 0.75, 1].map(f => (
                  <polygon key={f}
                    points={outerPts.map(p => `${CX + (p.x - CX) * f},${CY + (p.y - CY) * f}`).join(' ')}
                    fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
                ))}
                {/* Axes */}
                {outerPts.map((p, i) => (
                  <line key={i} x1={CX} y1={CY} x2={p.x} y2={p.y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
                ))}
                {/* Data polygon */}
                <polygon points={polygon} fill="rgba(160,112,255,0.15)" stroke="#a070ff" strokeWidth="1.5" />
                {/* Data dots */}
                {innerPts.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r="3" fill="#a070ff" />
                ))}
                {/* Labels */}
                {outerPts.map((p, i) => {
                  const lx = CX + (p.x - CX) * 1.2;
                  const ly = CY + (p.y - CY) * 1.2;
                  return (
                    <text key={i} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
                      style={{ fontSize: '7px', fill: 'rgba(255,255,255,0.4)', fontFamily: 'Inter,sans-serif' }}>
                      {radarLabels[i]}
                    </text>
                  );
                })}
              </svg>
            </div>

            {/* Action distribution */}
            <div style={{ padding: '16px', borderRadius: '16px', background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '12px' }}>Распределение действий</div>
              {profile && profile.action_breakdown.length > 0 ? (
                <>
                  {/* Segmented bar */}
                  <div style={{ height: '12px', borderRadius: '6px', overflow: 'hidden', display: 'flex', marginBottom: '14px' }}>
                    {profile.action_breakdown.map(a => (
                      <div key={a.action} style={{ flex: a.c, background: ACTION_COLOR[a.action] || '#555', transition: 'flex 0.4s' }} />
                    ))}
                  </div>
                  {/* List */}
                  {profile.action_breakdown.map(a => {
                    const color = ACTION_COLOR[a.action] || '#aaa';
                    const pct = Math.round((a.c / totalAct) * 100);
                    return (
                      <div key={a.action} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: color, flexShrink: 0 }} />
                        <span style={{ flex: 1, fontSize: '12px', color: 'rgba(255,255,255,0.7)' }}>{ACTION_LABEL[a.action] || a.action}</span>
                        <span style={{ fontSize: '13px', fontWeight: 700, color }}>{a.c}</span>
                        <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.25)', minWidth: '32px', textAlign: 'right' }}>{pct}%</span>
                      </div>
                    );
                  })}
                </>
              ) : (
                <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: '12px' }}>Нет данных</div>
              )}
            </div>
          </div>

          {/* 30-day activity chart */}
          <div style={{ padding: '16px 18px', borderRadius: '16px', background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.06)', marginBottom: '20px' }}>
            <div style={{ fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '10px' }}>Активность за 30 дней</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '48px' }}>
              {last30.map((d, i) => {
                const h = d.c === 0 ? 2 : Math.max(4, (d.c / maxDayC) * 48);
                return (
                  <div key={i} title={`${d.day}: ${d.c}`}
                    style={{ flex: 1, height: `${h}px`, borderRadius: '2px 2px 0 0', background: d.c === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(160,112,255,0.6)', transition: 'background 0.15s' }}
                    onMouseEnter={e => { if (d.c > 0) (e.currentTarget as HTMLElement).style.background = 'rgba(160,112,255,1)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = d.c === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(160,112,255,0.6)'; }}
                  />
                );
              })}
            </div>
          </div>

          {/* Recent actions */}
          <div style={{ padding: '16px 18px', borderRadius: '16px', background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '12px' }}>Последние действия</div>
            {profile && profile.recent_actions.length > 0 ? profile.recent_actions.map((a, i) => {
              const color = ACTION_COLOR[a.action] || '#888';
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <span style={{ fontSize: '9px', fontWeight: 700, padding: '2px 7px', borderRadius: '4px', background: `${color}18`, color, border: `1px solid ${color}28`, flexShrink: 0 }}>
                    {ACTION_LABEL[a.action] || a.action}
                  </span>
                  <span style={{ flex: 1, fontSize: '12px', color: 'rgba(255,255,255,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.target_username}
                  </span>
                  <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.25)', flexShrink: 0 }}>{a.channel_name}</span>
                  <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.2)', flexShrink: 0 }}>{timeAgo(a.created_at)}</span>
                </div>
              );
            }) : (
              <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: '12px' }}>Нет данных</div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ─── zoomable stream chart ────────────────────────────────────────────────────
function ZoomableStreamChart({ streamId, buckets, maxBucket }: {
  streamId: number;
  buckets: { bucket: string; msgs: number; spam: number }[];
  maxBucket: number;
}) {
  const [minuteData, setMinuteData] = useState<MinuteData[] | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [selRange, setSelRange] = useState<[number, number] | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; data: MinuteData } | null>(null);
  // Brush state
  const [brushStart, setBrushStart] = useState<number | null>(null);
  const [brushEnd, setBrushEnd] = useState<number | null>(null);
  const [dragging, setDragging] = useState<'start' | 'end' | 'range' | null>(null);
  const brushRef = useRef<HTMLDivElement>(null);
  const BRUSH_W = 100; // percent

  const loadMinuteData = useCallback(() => {
    if (!minuteData) {
      api.get<MinuteData[]>(`/api/admin/streams/${streamId}/messages-by-minute`)
        .then(setMinuteData).catch(() => setMinuteData([]));
    }
  }, [streamId, minuteData]);

  // Get zoomed slice
  const zoomedData = (() => {
    if (!minuteData || minuteData.length === 0) return [];
    if (!selRange) return minuteData;
    const [s, e] = selRange;
    return minuteData.slice(s, e + 1);
  })();

  const maxMins = Math.max(...zoomedData.map(d => d.msgs), 1);
  const maxSpam = Math.max(...zoomedData.map(d => d.spam), 1);

  const CHART_H = 80;
  const CHART_W = 600;

  const getXY = (data: MinuteData[], i: number) => ({
    x: data.length > 1 ? (i / (data.length - 1)) * CHART_W : CHART_W / 2,
    y: CHART_H - (data[i].msgs / maxMins) * CHART_H,
  });

  const areaPath = zoomedData.length > 1
    ? `M ${zoomedData.map((_, i) => `${getXY(zoomedData, i).x},${getXY(zoomedData, i).y}`).join(' L ')} L ${CHART_W},${CHART_H} L 0,${CHART_H} Z`
    : '';
  const spamPath = zoomedData.length > 1
    ? `M ${zoomedData.map((d, i) => `${getXY(zoomedData, i).x},${CHART_H - (d.spam / maxMins) * CHART_H}`).join(' L ')}`
    : '';

  const rangeLabel = (() => {
    if (!selRange || !minuteData) return '';
    const s = minuteData[selRange[0]];
    const e = minuteData[selRange[1]];
    if (!s || !e) return '';
    return `${mskTime(s.minute)} — ${mskTime(e.minute)}`;
  })();

  return (
    <div style={{ marginBottom: '16px', padding: '18px', borderRadius: '14px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.1em', flex: 1 }}>
          {zoomed ? `Детализация: ${rangeLabel}` : 'Активность по 10-мин интервалам'}
        </div>
        {zoomed && (
          <button onClick={() => { setZoomed(false); setSelRange(null); }}
            style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'none', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '7px', color: 'rgba(255,255,255,0.5)', fontSize: '11px', padding: '4px 10px', cursor: 'pointer' }}>
            <ChevronLeft size={12} /> Назад
          </button>
        )}
      </div>

      {!zoomed ? (
        <>
          {/* Overview bars */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '60px', cursor: 'pointer' }}>
            {buckets.map((b, i) => {
              const h = Math.max(2, (b.msgs / maxBucket) * 60);
              const sh = b.msgs > 0 ? (b.spam / b.msgs) * h : 0;
              return (
                <div key={i}
                  title={`${new Date(b.bucket).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} — ${b.msgs} сообщ., ${b.spam} спам`}
                  onClick={() => { loadMinuteData(); setZoomed(true); setSelRange(null); }}
                  style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '60px' }}>
                  <div style={{ width: '100%', height: `${h}px`, borderRadius: '2px 2px 0 0', background: 'rgba(160,112,255,0.3)', position: 'relative', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${sh}px`, background: 'rgba(0,229,204,0.6)' }} />
                  </div>
                </div>
              );
            })}
          </div>
          {/* Brush / range selector */}
          <div style={{ marginTop: '8px', position: 'relative', height: '24px', background: 'rgba(255,255,255,0.03)', borderRadius: '4px', cursor: 'pointer' }}
            ref={brushRef}
            onMouseDown={e => {
              if (!brushRef.current) return;
              const rect = brushRef.current.getBoundingClientRect();
              const pct = (e.clientX - rect.left) / rect.width;
              const idx = Math.round(pct * (buckets.length - 1));
              setBrushStart(idx); setBrushEnd(idx); setDragging('end');
            }}
            onMouseMove={e => {
              if (!dragging || !brushRef.current) return;
              const rect = brushRef.current.getBoundingClientRect();
              const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              const idx = Math.round(pct * (buckets.length - 1));
              if (dragging === 'end') setBrushEnd(idx);
            }}
            onMouseUp={() => {
              if (brushStart !== null && brushEnd !== null && minuteData) {
                const s = Math.min(brushStart, brushEnd);
                const e2 = Math.max(brushStart, brushEnd);
                if (s !== e2) { setSelRange([s, e2]); setZoomed(true); }
              }
              setDragging(null);
            }}
            onMouseLeave={() => setDragging(null)}>
            {brushStart !== null && brushEnd !== null && (
              <div style={{
                position: 'absolute', top: 0, bottom: 0,
                left: `${(Math.min(brushStart, brushEnd) / Math.max(buckets.length - 1, 1)) * 100}%`,
                width: `${(Math.abs(brushEnd - brushStart) / Math.max(buckets.length - 1, 1)) * 100}%`,
                background: 'rgba(160,112,255,0.25)', border: '1px solid rgba(160,112,255,0.5)', borderRadius: '3px',
              }} />
            )}
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontSize: '9px', color: 'rgba(255,255,255,0.2)', pointerEvents: 'none', whiteSpace: 'nowrap' }}>
              Перетащите для выбора диапазона или кликните по столбцу
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Zoomed SVG line chart */}
          {(!minuteData || minuteData.length === 0) ? (
            <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: '12px', padding: '20px 0' }}>Нет данных по минутам</div>
          ) : (
            <div style={{ position: 'relative' }}
              onMouseLeave={() => setTooltip(null)}>
              <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} style={{ width: '100%', height: '80px', overflow: 'visible' }}
                onMouseMove={e => {
                  const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
                  const px = ((e.clientX - rect.left) / rect.width) * CHART_W;
                  const idx = Math.round((px / CHART_W) * (zoomedData.length - 1));
                  const clamped = Math.max(0, Math.min(idx, zoomedData.length - 1));
                  const d = zoomedData[clamped];
                  if (d) setTooltip({ x: e.clientX, y: e.clientY, data: d });
                }}>
                <defs>
                  <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#a070ff" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#a070ff" stopOpacity="0.02" />
                  </linearGradient>
                </defs>
                {/* Area fill */}
                {areaPath && <path d={areaPath} fill="url(#areaGrad)" />}
                {/* Spam line */}
                {spamPath && <path d={spamPath} fill="none" stroke="rgba(255,89,89,0.9)" strokeWidth="1.5" />}
                {/* Spam user dots */}
                {zoomedData.map((d, i) => d.spam_users > 0 && (
                  <circle key={i}
                    cx={getXY(zoomedData, i).x}
                    cy={CHART_H - (d.spam / maxMins) * CHART_H}
                    r={Math.min(5, 2 + d.spam_users)}
                    fill="#00e5cc" opacity="0.8" />
                ))}
              </svg>
              {/* Legend */}
              <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
                {[['#a070ff', 'Сообщения/мин'], ['rgba(255,89,89,0.9)', 'Спам/мин'], ['#00e5cc', 'Спам-юзеры']].map(([c, l]) => (
                  <span key={l} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10px', color: 'rgba(255,255,255,0.35)' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: c, display: 'inline-block' }} />{l}
                  </span>
                ))}
              </div>
              {/* Tooltip */}
              {tooltip && (
                <div style={{
                  position: 'fixed', left: tooltip.x + 12, top: tooltip.y - 40, zIndex: 9999,
                  background: 'rgba(12,12,18,0.98)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px',
                  padding: '8px 12px', pointerEvents: 'none', fontSize: '11px',
                }}>
                  <div style={{ color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}>{mskTime(tooltip.data.minute)}</div>
                  <div style={{ color: '#a070ff' }}>Сообщений: {tooltip.data.msgs}</div>
                  <div style={{ color: 'rgba(255,89,89,0.9)' }}>Спам: {tooltip.data.spam}</div>
                  <div style={{ color: '#00e5cc' }}>Спам-юзеров: {tooltip.data.spam_users}</div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── heatmap tooltip ──────────────────────────────────────────────────────────
interface HeatmapTooltip {
  x: number;
  y: number;
  date: string;
  count: number;
  streamInfo?: {
    title: string | null;
    game: string | null;
    peak_viewers: number;
    duration_sec: number;
    msg_count: number;
  } | null;
}

// ─── stream detail ────────────────────────────────────────────────────────────
function StreamDetail({ streamId, onBack }: { streamId: number; onBack: () => void }) {
  const [data, setData] = useState<StreamStats | null>(null);

  useEffect(() => {
    api.get<StreamStats>(`/api/admin/streams/${streamId}/stats`).then(setData);
  }, [streamId]);

  if (!data) return <div style={{ color: 'rgba(255,255,255,0.3)', padding: '40px', fontSize: '13px' }}>Загрузка...</div>;

  const { session, actions, timeline, top_spammers, buckets } = data;
  const maxBar = Math.max(...timeline.map(t => t.total), 1);
  const maxBucket = Math.max(...(buckets || []).map(b => b.msgs), 1);
  const totalMsgs = (buckets || []).reduce((s, b) => s + b.msgs, 0);
  const totalSpam = (buckets || []).reduce((s, b) => s + b.spam, 0);
  const avgMsgsPerMin = session.duration_seconds > 0 ? (totalMsgs / (session.duration_seconds / 60)).toFixed(1) : '—';
  const spamRate = totalMsgs > 0 ? Math.round(totalSpam / totalMsgs * 100) : 0;

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

      {/* Message stats summary */}
      {totalMsgs > 0 && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
          {[
            { label: 'Всего сообщений', value: totalMsgs.toLocaleString(), color: '#a070ff' },
            { label: 'Сред. сообщ/мин', value: avgMsgsPerMin, color: '#5b9eff' },
            { label: 'Спам', value: totalSpam.toLocaleString(), color: '#ff5959' },
            { label: 'Спам %', value: `${spamRate}%`, color: '#ff9800' },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ padding: '12px 16px', borderRadius: '12px', flex: '1', minWidth: '80px', background: `${color}0d`, border: `1px solid ${color}22` }}>
              <div style={{ fontSize: '22px', fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', marginTop: '5px' }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Zoomable 10-min bucket chart */}
      {buckets && buckets.length > 0 && (
        <ZoomableStreamChart streamId={streamId} buckets={buckets} maxBucket={maxBucket} />
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
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#ff7070' }}>{s.mute_count}</span>
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
  const [heatmap, setHeatmap] = useState<{ day: string; count: number }[]>([]);
  const [selectedMod, setSelectedMod] = useState<{ mod: TwitchMod; rank: number } | null>(null);
  const [heatmapTooltip, setHeatmapTooltip] = useState<HeatmapTooltip | null>(null);
  const heatmapTooltipCache = useRef<Record<string, any>>({});

  useEffect(() => {
    api.get<{ day: string; count: number }[]>('/api/admin/stats/heatmap').then(setHeatmap).catch(() => {});
  }, []);

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

  const handleHeatmapHover = useCallback(async (e: React.MouseEvent, date: Date, count: number) => {
    const key = date.toISOString().slice(0, 10);
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    if (heatmapTooltipCache.current[key] !== undefined) {
      setHeatmapTooltip({ x: rect.left + rect.width / 2, y: rect.top, date: key, count, streamInfo: heatmapTooltipCache.current[key] });
      return;
    }
    // Fetch stream info
    const chParam = selectedChannel ? `&channel=${encodeURIComponent(selectedChannel)}` : '';
    try {
      const info = await api.get<any>(`/api/admin/stats/heatmap-detail?date=${key}${chParam}`);
      heatmapTooltipCache.current[key] = info;
      setHeatmapTooltip({ x: rect.left + rect.width / 2, y: rect.top, date: key, count, streamInfo: info });
    } catch {
      heatmapTooltipCache.current[key] = null;
      setHeatmapTooltip({ x: rect.left + rect.width / 2, y: rect.top, date: key, count, streamInfo: null });
    }
  }, [selectedChannel]);

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
                    onClick={() => setSelectedMod({ mod: m, rank: i + 1 })}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '40px 1fr 80px 80px 80px 80px 80px',
                      alignItems: 'center',
                      padding: '12px 16px',
                      borderBottom: '1px solid rgba(255,255,255,0.04)',
                      background: i % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent',
                      opacity: isActive ? 1 : 0.45,
                      position: 'relative', overflow: 'hidden',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(160,112,255,0.06)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = i % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent'; }}>

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

            {/* Activity Heatmap */}
            {heatmap.length > 0 && (() => {
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const dayOfWeek = today.getDay();
              const daysFromMon = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
              const endDate = new Date(today);
              endDate.setDate(today.getDate() - daysFromMon + 6);

              const countMap: Record<string, number> = {};
              heatmap.forEach(h => { countMap[h.day.slice(0, 10)] = h.count; });
              const maxCount = Math.max(...heatmap.map(h => h.count), 1);

              const COLS = 16;
              const ROWS = 7;
              const CELL = 12;
              const GAP = 3;
              const LEFT_PAD = 22;

              const cells: { col: number; row: number; date: Date; count: number }[] = [];
              const startDate = new Date(endDate);
              startDate.setDate(endDate.getDate() - (COLS * ROWS - 1));

              for (let i = 0; i < COLS * ROWS; i++) {
                const d = new Date(startDate);
                d.setDate(startDate.getDate() + i);
                const col = Math.floor(i / ROWS);
                const row = i % ROWS;
                const key = d.toISOString().slice(0, 10);
                cells.push({ col, row, date: d, count: countMap[key] || 0 });
              }

              const monthLabels: { col: number; label: string }[] = [];
              const seenMonths = new Set<string>();
              cells.forEach(c => {
                const monthKey = `${c.date.getFullYear()}-${c.date.getMonth()}`;
                if (!seenMonths.has(monthKey) && c.row === 0) {
                  seenMonths.add(monthKey);
                  monthLabels.push({
                    col: c.col,
                    label: c.date.toLocaleDateString('ru-RU', { month: 'short' }),
                  });
                }
              });

              const svgW = LEFT_PAD + COLS * (CELL + GAP);
              const svgH = 18 + ROWS * (CELL + GAP);

              return (
                <div style={{ marginBottom: '24px', padding: '18px 20px', borderRadius: '14px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', position: 'relative' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '14px' }}>
                    Активность за 16 недель
                  </div>
                  <svg viewBox={`0 0 ${svgW} ${svgH}`} style={{ width: '100%', maxWidth: `${svgW}px`, height: 'auto', display: 'block', overflow: 'visible' }}
                    onMouseLeave={() => setHeatmapTooltip(null)}>
                    {/* Month labels */}
                    {monthLabels.map(({ col, label }) => (
                      <text key={label + col} x={LEFT_PAD + col * (CELL + GAP)} y={10}
                        style={{ fontSize: '8px', fill: 'rgba(255,255,255,0.3)', fontFamily: 'Inter,sans-serif' }}>
                        {label}
                      </text>
                    ))}
                    {/* Day labels */}
                    {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((label, row) => (
                      row % 2 === 0 ? (
                        <text key={label} x={0} y={18 + row * (CELL + GAP) + CELL - 2}
                          style={{ fontSize: '8px', fill: 'rgba(255,255,255,0.25)', fontFamily: 'Inter,sans-serif' }}>
                          {label}
                        </text>
                      ) : null
                    ))}
                    {/* Cells */}
                    {cells.map(({ col, row, date, count }) => {
                      const opacity = count === 0 ? 0.06 : 0.08 + (count / maxCount) * 0.82;
                      const key = `${col}-${row}`;
                      return (
                        <rect key={key}
                          x={LEFT_PAD + col * (CELL + GAP)}
                          y={18 + row * (CELL + GAP)}
                          width={CELL} height={CELL} rx={2} ry={2}
                          fill={`rgba(0,200,120,${opacity.toFixed(2)})`}
                          style={{ cursor: 'pointer' }}
                          onMouseEnter={e => handleHeatmapHover(e as any, date, count)}
                          onClick={() => {
                            // Find stream for this date and navigate
                            const dateStr = mskDate(date.toISOString());
                            if (streamsByDate[dateStr] && streamsByDate[dateStr].length > 0) {
                              setSection('streams');
                              setSelectedStream(streamsByDate[dateStr][0].id);
                            }
                          }}
                        />
                      );
                    })}
                  </svg>
                  {/* Heatmap tooltip */}
                  {heatmapTooltip && (
                    <div style={{
                      position: 'fixed',
                      left: heatmapTooltip.x + 8,
                      top: heatmapTooltip.y - 10,
                      zIndex: 9998,
                      background: 'rgba(12,12,18,0.98)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '10px',
                      padding: '10px 14px',
                      pointerEvents: 'none',
                      minWidth: '160px',
                      maxWidth: '220px',
                    }}>
                      <div style={{ fontSize: '11px', fontWeight: 700, color: '#fff', marginBottom: '4px' }}>
                        {new Date(heatmapTooltip.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'short' })}
                      </div>
                      <div style={{ fontSize: '11px', color: '#00c878' }}>{heatmapTooltip.count.toLocaleString()} сообщений</div>
                      {heatmapTooltip.streamInfo && (
                        <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                          {heatmapTooltip.streamInfo.title && (
                            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.7)', marginBottom: '3px', fontWeight: 600 }}>{heatmapTooltip.streamInfo.title}</div>
                          )}
                          {heatmapTooltip.streamInfo.game && (
                            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', marginBottom: '4px' }}>{heatmapTooltip.streamInfo.game}</div>
                          )}
                          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                            {heatmapTooltip.streamInfo.peak_viewers > 0 && (
                              <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.45)' }}>👁 {heatmapTooltip.streamInfo.peak_viewers.toLocaleString()}</span>
                            )}
                            {heatmapTooltip.streamInfo.duration_sec > 0 && (
                              <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.45)' }}>⏱ {dur(heatmapTooltip.streamInfo.duration_sec)}</span>
                            )}
                            {heatmapTooltip.streamInfo.duration_sec > 0 && heatmapTooltip.streamInfo.msg_count > 0 && (
                              <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.45)' }}>
                                {(heatmapTooltip.streamInfo.msg_count / (heatmapTooltip.streamInfo.duration_sec / 60)).toFixed(1)} сообщ/мин
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

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

      {/* Moderator Profile Modal */}
      <AnimatePresence>
        {selectedMod && (
          <ModProfileModal
            mod={selectedMod.mod}
            rank={selectedMod.rank}
            channel={selectedChannel}
            channels={channels}
            onClose={() => setSelectedMod(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
