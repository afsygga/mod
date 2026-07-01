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
  daily_activity: { day: string; c: number; mutes: number; auto_mutes: number; bans: number; unbans: number; deletes: number }[];
  daily_messages?: { day: string; c: number }[];
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
  const [hoverDay, setHoverDay] = useState<number | null>(null);

  useEffect(() => {
    const username = mod.twitch_login;
    const ch = profileChannel || '';
    api.get<ModProfile>(`/api/admin/moderators/${encodeURIComponent(username)}/profile?channel=${encodeURIComponent(ch)}`)
      .then(setProfile).catch(() => {});
  }, [mod.twitch_login, profileChannel]);

  const rankColors = ['#ffc800', '#9e9e9e', '#cd7f32'];
  const rankColor = rankColors[rank - 1] || 'rgba(255,255,255,0.3)';

  const bans = mod.bans || 0;
  const mutes = mod.mutes || 0;
  const autoMutes = mod.auto_mutes || 0;
  const total = mod.total || 1;

  // Format average reaction time
  const fmtReaction = (sec: number | null): string => {
    if (sec === null || sec === undefined) return '—';
    if (sec < 60) return `${Math.round(sec)}с`;
    return `${Math.floor(sec / 60)}м ${Math.round(sec % 60)}с`;
  };

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

  // Daily activity 30-day detailed chart
  type Day30 = { day: string; total: number; mutes: number; bans: number; unbans: number; deletes: number; msgs: number };
  const last30: Day30[] = [];
  if (profile) {
    const actMap: Record<string, ModProfile['daily_activity'][number]> = {};
    profile.daily_activity.forEach(d => { actMap[d.day.slice(0, 10)] = d; });
    const msgMap: Record<string, number> = {};
    (profile.daily_messages || []).forEach(d => { msgMap[d.day.slice(0, 10)] = d.c; });
    // MSK calendar days
    const mskKey = (dt: Date) => {
      const s = dt.toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' }); // YYYY-MM-DD
      return s;
    };
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = mskKey(d);
      const a = actMap[key];
      const mutes = a ? (a.mutes || 0) + (a.auto_mutes || 0) : 0;
      last30.push({
        day: key,
        total: mutes + (a?.bans || 0) + (a?.unbans || 0) + (a?.deletes || 0),
        mutes,
        bans: a?.bans || 0,
        unbans: a?.unbans || 0,
        deletes: a?.deletes || 0,
        msgs: msgMap[key] || 0,
      });
    }
  }
  const maxDayTotal = Math.max(...last30.map(d => d.total), 1);
  const maxDayMsgs = Math.max(...last30.map(d => d.msgs), 1);
  const hasAny30 = last30.some(d => d.total > 0 || d.msgs > 0);

  // Action distribution
  const totalAct = profile?.action_breakdown.reduce((s, a) => s + a.c, 0) || 1;

  const hasActionData = !!(profile && profile.action_breakdown.length > 0);
  const hasRecentData = !!(profile && profile.recent_actions.length > 0);

  const sectionCard: React.CSSProperties = {
    padding: '14px', borderRadius: '14px',
    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
  };
  const sectionTitle: React.CSSProperties = {
    fontSize: '9px', fontWeight: 700, color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '10px',
  };
  const emptyLine = (label: string) => (
    <div style={{ ...sectionCard, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span style={{ ...sectionTitle, marginBottom: 0 }}>{label}</span>
      <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.25)' }}>Нет данных</span>
    </div>
  );

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
          width: '100%', maxWidth: '720px', maxHeight: '88vh', overflowY: 'auto',
          background: 'rgba(12,12,18,1)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '18px',
        }}>

        {/* Header */}
        <div style={{ padding: '18px 20px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
          {/* Avatar */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            {mod.twitch_avatar ? (
              <img src={mod.twitch_avatar} alt="" style={{ width: '52px', height: '52px', borderRadius: '50%', border: `2px solid ${rankColor}66` }} />
            ) : (
              <div style={{ width: '52px', height: '52px', borderRadius: '50%', background: 'rgba(160,112,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', fontWeight: 800, color: '#a070ff', border: `2px solid ${rankColor}66` }}>
                {mod.twitch_display_name[0]?.toUpperCase()}
              </div>
            )}
            <div style={{ position: 'absolute', bottom: '-2px', right: '-2px', background: '#9147ff', borderRadius: '50%', width: '16px', height: '16px', border: '2px solid rgba(12,12,18,1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="7" height="7" viewBox="0 0 24 24" fill="white"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/></svg>
            </div>
          </div>

          {/* Name + rank */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
              <span style={{ fontSize: '17px', fontWeight: 800, color: '#fff' }}>{mod.twitch_display_name}</span>
              <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px', background: `${rankColor}18`, color: rankColor, border: `1px solid ${rankColor}44` }}>#{rank}</span>
            </div>
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', marginBottom: mod.last_action ? '5px' : 0 }}>@{mod.twitch_login}</div>
            {mod.last_action && <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.2)' }}>Последнее действие: {msk(mod.last_action)}</div>}
          </div>

          {/* Channel selector */}
          {channels.length > 1 && (
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <select value={profileChannel} onChange={e => setProfileChannel(e.target.value)}
                style={{ appearance: 'none', padding: '6px 26px 6px 10px', borderRadius: '8px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: '11px', cursor: 'pointer', outline: 'none' }}>
                <option value="">Все каналы</option>
                {channels.map(ch => <option key={ch} value={ch}>{ch}</option>)}
              </select>
              <ChevronDown size={11} style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.4)', pointerEvents: 'none' }} />
            </div>
          )}

          {/* Close */}
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.3)', padding: '4px', borderRadius: '6px', display: 'flex', flexShrink: 0 }}
            onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.7)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.3)')}>
            <X size={17} />
          </button>
        </div>

        <div style={{ padding: '16px 20px' }}>
          {/* Stats row */}
          <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
            {[
              { label: 'Ср. реакция', value: fmtReaction(avgRespSec), color: '#00e5cc', icon: true },
              { label: 'Всего', value: total, color: '#fff' },
              { label: 'Мутов', value: mutes, color: '#ffc800' },
              { label: 'Банов', value: bans, color: '#ff5959' },
              { label: 'Разбанов', value: mod.unbans || 0, color: '#00c878' },
              { label: 'Авто-мут', value: autoMutes, color: '#ff9800' },
            ].map(({ label, value, color, icon }) => (
              <div key={label} style={{ flex: '1', minWidth: '90px', padding: '10px 12px', borderRadius: '14px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  {icon && <Clock size={14} style={{ color }} />}
                  <div style={{ fontSize: '20px', fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
                </div>
                <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)', marginTop: '5px', letterSpacing: '0.05em' }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Radar + Action Distribution */}
          <div style={{ display: 'grid', gridTemplateColumns: '170px 1fr', gap: '10px', marginBottom: '10px' }}>
            {/* Radar chart */}
            <div style={{ ...sectionCard, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={sectionTitle}>Профиль</div>
              <svg width="150" height="150" viewBox="0 0 180 180">
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
            <div style={sectionCard}>
              <div style={sectionTitle}>Распределение действий</div>
              {hasActionData ? (
                <>
                  {/* Segmented bar */}
                  <div style={{ height: '10px', borderRadius: '5px', overflow: 'hidden', display: 'flex', marginBottom: '10px' }}>
                    {profile!.action_breakdown.map(a => (
                      <div key={a.action} style={{ flex: a.c, background: ACTION_COLOR[a.action] || '#555', transition: 'flex 0.4s' }} />
                    ))}
                  </div>
                  {/* List */}
                  {profile!.action_breakdown.map(a => {
                    const color = ACTION_COLOR[a.action] || '#aaa';
                    const pct = Math.round((a.c / totalAct) * 100);
                    return (
                      <div key={a.action} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: color, flexShrink: 0 }} />
                        <span style={{ flex: 1, fontSize: '11px', color: 'rgba(255,255,255,0.7)' }}>{ACTION_LABEL[a.action] || a.action}</span>
                        <span style={{ fontSize: '12px', fontWeight: 700, color }}>{a.c}</span>
                        <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.25)', minWidth: '30px', textAlign: 'right' }}>{pct}%</span>
                      </div>
                    );
                  })}
                </>
              ) : (
                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.25)' }}>Нет данных</div>
              )}
            </div>
          </div>

          {/* 30-day activity chart */}
          {(() => {
            const VB_W = 600, CHART_H = 130, PAD_T = 8, PAD_B = 18, PAD_L = 24, PAD_R = 6;
            const plotW = VB_W - PAD_L - PAD_R;
            const plotH = CHART_H - PAD_T - PAD_B;
            const n = last30.length || 30;
            const slot = plotW / n;
            const barW = Math.max(3, slot * 0.62);
            const barGap = (slot - barW) / 2;
            const xOf = (i: number) => PAD_L + i * slot + barGap;
            const cxOf = (i: number) => PAD_L + i * slot + slot / 2;
            const yOf = (v: number) => PAD_T + plotH - (v / maxDayTotal) * plotH;
            const yMsg = (v: number) => PAD_T + plotH - (v / maxDayMsgs) * plotH;
            const rTop = Math.min(3, barW / 2);
            const gridLevels = [0.5, 1];
            const msgPts: [number, number][] = last30.map((d, i) => [i, d.msgs]);
            // build smooth msg path scaled to msg max within plot
            const toXm = (i: number) => cxOf(i);
            const smoothMsg = (close: boolean) => {
              if (last30.length < 2) return '';
              let dd = `M ${toXm(0)} ${yMsg(msgPts[0][1])}`;
              for (let i = 1; i < last30.length; i++) {
                const cpx = (toXm(i - 1) + toXm(i)) / 2;
                dd += ` C ${cpx} ${yMsg(msgPts[i - 1][1])}, ${cpx} ${yMsg(msgPts[i][1])}, ${toXm(i)} ${yMsg(msgPts[i][1])}`;
              }
              if (close) dd += ` L ${toXm(last30.length - 1)} ${PAD_T + plotH} L ${toXm(0)} ${PAD_T + plotH} Z`;
              return dd;
            };
            const hd = hoverDay !== null ? last30[hoverDay] : null;
            const legendItems = [
              { c: '#ffc800', l: 'Муты' }, { c: '#ff5959', l: 'Баны' },
              { c: '#00c878', l: 'Разбаны' }, { c: '#a070ff', l: 'Удаления' },
              { c: '#00e5cc', l: 'Чат' },
            ];
            return (
              <div style={{ ...sectionCard, marginBottom: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div style={{ ...sectionTitle, marginBottom: 0 }}>Активность за 30 дней</div>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    {legendItems.map(it => (
                      <span key={it.l} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '9px', color: 'rgba(255,255,255,0.45)' }}>
                        <span style={{ width: it.l === 'Чат' ? '10px' : '7px', height: it.l === 'Чат' ? '2px' : '7px', borderRadius: it.l === 'Чат' ? '1px' : '2px', background: it.c, display: 'inline-block' }} />
                        {it.l}
                      </span>
                    ))}
                  </div>
                </div>
                {!hasAny30 ? (
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.25)', padding: '6px 0' }}>Нет активности</div>
                ) : (
                  <div style={{ position: 'relative', width: '100%' }}>
                    <svg viewBox={`0 0 ${VB_W} ${CHART_H}`} width="100%" style={{ display: 'block', overflow: 'visible' }}
                      onMouseLeave={() => setHoverDay(null)}
                      onMouseMove={e => {
                        const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
                        const x = ((e.clientX - rect.left) / rect.width) * VB_W;
                        const idx = Math.floor((x - PAD_L) / slot);
                        setHoverDay(idx >= 0 && idx < n ? idx : null);
                      }}>
                      {/* gridlines */}
                      {gridLevels.map(f => (
                        <g key={f}>
                          <line x1={PAD_L} y1={yOf(maxDayTotal * f)} x2={VB_W - PAD_R} y2={yOf(maxDayTotal * f)}
                            stroke="rgba(255,255,255,0.06)" strokeWidth="1" strokeDasharray="3 4" />
                          <text x={PAD_L - 4} y={yOf(maxDayTotal * f) + 3} textAnchor="end"
                            style={{ fontSize: '8px', fill: 'rgba(255,255,255,0.3)', fontFamily: 'Inter,sans-serif' }}>
                            {Math.round(maxDayTotal * f)}
                          </text>
                        </g>
                      ))}
                      {/* max label top */}
                      <text x={PAD_L - 4} y={PAD_T + 3} textAnchor="end"
                        style={{ fontSize: '8px', fill: 'rgba(255,255,255,0.35)', fontFamily: 'Inter,sans-serif' }}>{maxDayTotal}</text>

                      {/* chat area + line */}
                      <path d={smoothMsg(true)} fill="rgba(0,229,204,0.06)" stroke="none" />
                      <path d={smoothMsg(false)} fill="none" stroke="rgba(0,229,204,0.55)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />

                      {/* hover crosshair */}
                      {hoverDay !== null && (
                        <line x1={cxOf(hoverDay)} y1={PAD_T} x2={cxOf(hoverDay)} y2={PAD_T + plotH}
                          stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
                      )}

                      {/* stacked bars */}
                      {last30.map((d, i) => {
                        if (d.total === 0) return null;
                        const segs = [
                          { v: d.mutes, c: '#ffc800' },
                          { v: d.bans, c: '#ff5959' },
                          { v: d.unbans, c: '#00c878' },
                          { v: d.deletes, c: '#a070ff' },
                        ];
                        let acc = 0;
                        const x = xOf(i);
                        return (
                          <g key={i} opacity={hoverDay === null || hoverDay === i ? 1 : 0.45}>
                            {segs.map((s, si) => {
                              if (s.v <= 0) return null;
                              const segH = (s.v / maxDayTotal) * plotH;
                              const yTop = PAD_T + plotH - acc - segH;
                              acc += segH;
                              const isTop = acc >= (d.total / maxDayTotal) * plotH - 0.01;
                              return (
                                <rect key={si} x={x} y={yTop} width={barW} height={segH}
                                  rx={isTop ? rTop : 0} ry={isTop ? rTop : 0} fill={s.c} />
                              );
                            })}
                          </g>
                        );
                      })}

                      {/* x-axis date labels every 6th */}
                      {last30.map((d, i) => {
                        if (i % 6 !== 0 && i !== last30.length - 1) return null;
                        const [, mm, dd] = d.day.split('-');
                        return (
                          <text key={i} x={cxOf(i)} y={CHART_H - 5} textAnchor="middle"
                            style={{ fontSize: '8px', fill: 'rgba(255,255,255,0.35)', fontFamily: 'Inter,sans-serif' }}>
                            {dd}.{mm}
                          </text>
                        );
                      })}
                    </svg>

                    {/* tooltip */}
                    {hd && (
                      <div style={{
                        position: 'absolute', top: 0,
                        left: `${(cxOf(hoverDay!) / VB_W) * 100}%`,
                        transform: `translateX(${hoverDay! > n / 2 ? '-105%' : '5%'})`,
                        pointerEvents: 'none', zIndex: 5,
                        background: 'rgba(18,18,26,0.97)', border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '8px', padding: '8px 10px', minWidth: '120px',
                        boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
                      }}>
                        <div style={{ fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.9)', marginBottom: '5px' }}>
                          {(() => { const [, mm, dd] = hd.day.split('-'); return `${dd}.${mm}`; })()}
                        </div>
                        {[
                          { l: 'Муты', v: hd.mutes, c: '#ffc800' },
                          { l: 'Баны', v: hd.bans, c: '#ff5959' },
                          { l: 'Разбаны', v: hd.unbans, c: '#00c878' },
                          { l: 'Удаления', v: hd.deletes, c: '#a070ff' },
                          { l: 'Сообщений', v: hd.msgs, c: '#00e5cc' },
                        ].map(r => (
                          <div key={r.l} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', padding: '1px 0' }}>
                            <span style={{ width: '6px', height: '6px', borderRadius: '2px', background: r.c }} />
                            <span style={{ flex: 1, color: 'rgba(255,255,255,0.55)' }}>{r.l}</span>
                            <span style={{ fontWeight: 700, color: 'rgba(255,255,255,0.9)' }}>{r.v}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Recent actions */}
          {hasRecentData ? (
            <div style={sectionCard}>
              <div style={sectionTitle}>Последние действия</div>
              {profile!.recent_actions.map((a, i) => {
                const color = ACTION_COLOR[a.action] || '#888';
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ fontSize: '9px', fontWeight: 700, padding: '2px 7px', borderRadius: '4px', background: `${color}18`, color, border: `1px solid ${color}28`, flexShrink: 0 }}>
                      {ACTION_LABEL[a.action] || a.action}
                    </span>
                    <span style={{ flex: 1, fontSize: '11px', color: 'rgba(255,255,255,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.target_username}
                    </span>
                    <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.25)', flexShrink: 0 }}>{a.channel_name}</span>
                    <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.2)', flexShrink: 0 }}>{timeAgo(a.created_at)}</span>
                  </div>
                );
              })}
            </div>
          ) : emptyLine('Последние действия')}
        </div>
      </motion.div>
    </div>
  );
}

// ─── stream area chart ────────────────────────────────────────────────────────
function smoothLinePath(pts: [number, number][], w: number, h: number, maxY: number): string {
  if (pts.length < 2) return '';
  const toX = (i: number) => (i / (pts.length - 1)) * w;
  const toY = (v: number) => h - (v / maxY) * h;
  let d = `M ${toX(0)} ${toY(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) {
    const cpx = (toX(i - 1) + toX(i)) / 2;
    d += ` C ${cpx} ${toY(pts[i - 1][1])}, ${cpx} ${toY(pts[i][1])}, ${toX(i)} ${toY(pts[i][1])}`;
  }
  return d;
}

function areaFillPath(pts: [number, number][], w: number, h: number, maxY: number): string {
  if (pts.length < 2) return '';
  const toX = (i: number) => (i / (pts.length - 1)) * w;
  const toY = (v: number) => h - (v / maxY) * h;
  let d = `M ${toX(0)} ${toY(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) {
    const cpx = (toX(i - 1) + toX(i)) / 2;
    d += ` C ${cpx} ${toY(pts[i - 1][1])}, ${cpx} ${toY(pts[i][1])}, ${toX(i)} ${toY(pts[i][1])}`;
  }
  d += ` L ${toX(pts.length - 1)} ${h} L ${toX(0)} ${h} Z`;
  return d;
}

function SparkLine({ data, color, w = 80, h = 28 }: { data: number[]; color: string; w?: number; h?: number }) {
  if (data.length < 2) return null;
  const maxV = Math.max(...data, 1);
  const pts: [number, number][] = data.map((v, i) => [i, v]);
  const line = smoothLinePath(pts, w, h, maxV);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: `${h}px`, display: 'block', overflow: 'visible' }} preserveAspectRatio="none">
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function StreamAreaChart({ streamId, isLive, startedAt, endedAt }: {
  streamId: number;
  isLive: boolean;
  startedAt: string;
  endedAt: string | null;
}) {
  const [data, setData] = useState<MinuteData[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewStart, setViewStart] = useState(0);
  const [viewEnd, setViewEnd] = useState(0);
  const [tooltip, setTooltip] = useState<{ svgX: number; idx: number } | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const panStartRef = useRef<{ clientX: number; viewStart: number; viewEnd: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const W = 800;
  const H = 180;
  const OVERVIEW_H = 40;
  const Y_LABEL_W = 40;
  const X_LABEL_H = 24;
  const CHART_W = W - Y_LABEL_W;
  const CHART_H = H - X_LABEL_H;

  const fetchData = useCallback((append = false) => {
    api.get<MinuteData[]>(`/api/streams/${streamId}/messages-by-minute`)
      .then(newData => {
        setData(prev => {
          if (!append || prev.length === 0) {
            const end = newData.length - 1;
            setViewStart(0);
            setViewEnd(end);
            return newData;
          }
          // Append only truly new points
          const lastMinute = prev[prev.length - 1]?.minute;
          const fresh = newData.filter(d => d.minute > lastMinute);
          if (fresh.length === 0) return prev;
          const merged = [...prev, ...fresh];
          // Auto-scroll: shift viewEnd forward
          setViewEnd(e => Math.min(merged.length - 1, e + fresh.length));
          setViewStart(s => Math.min(s + fresh.length, merged.length - 1));
          return merged;
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [streamId]);

  useEffect(() => {
    fetchData(false);
  }, [fetchData]);

  useEffect(() => {
    if (!isLive) return;
    pollRef.current = setInterval(() => fetchData(true), 30_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [isLive, fetchData]);

  // Wheel zoom — non-passive to allow preventDefault
  const zoomRef = useRef({ viewStart: 0, viewEnd: 0, dataLen: 0 });
  zoomRef.current = { viewStart, viewEnd, dataLen: data.length };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { viewStart: vs, viewEnd: ve, dataLen: len } = zoomRef.current;
      if (len < 2) return;
      const range = ve - vs;
      const delta = Math.sign(e.deltaY) * Math.max(1, Math.round(range * 0.1));
      const newRange = Math.max(5, Math.min(len - 1, range + delta));
      const svgEl = svgRef.current;
      let frac = 0.5;
      if (svgEl) {
        const rect = svgEl.getBoundingClientRect();
        frac = Math.max(0, Math.min(1, (e.clientX - rect.left - Y_LABEL_W) / CHART_W));
      }
      const anchor = vs + frac * range;
      let newVs = Math.round(anchor - frac * newRange);
      let newVe = newVs + newRange;
      if (newVs < 0) { newVs = 0; newVe = Math.min(len - 1, newRange); }
      if (newVe >= len) { newVe = len - 1; newVs = Math.max(0, newVe - newRange); }
      setViewStart(newVs);
      setViewEnd(newVe);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [CHART_W]);

  const viewData = data.slice(viewStart, viewEnd + 1);
  const maxY = Math.max(...viewData.map(d => d.msgs), 1);

  const msgPts: [number, number][] = viewData.map((d, i) => [i, d.msgs]);
  const spamPts: [number, number][] = viewData.map((d, i) => [i, d.spam]);

  const msgArea = areaFillPath(msgPts, CHART_W, CHART_H, maxY);
  const msgLine = smoothLinePath(msgPts, CHART_W, CHART_H, maxY);
  const spamLine = smoothLinePath(spamPts, CHART_W, CHART_H, maxY);

  // Y grid lines at 25/50/75/100%
  const gridLevels = [0.25, 0.5, 0.75, 1.0];

  // X labels — show ~5 evenly spaced
  const xLabelCount = Math.min(6, viewData.length);
  const xLabelIndices: number[] = [];
  for (let i = 0; i < xLabelCount; i++) {
    xLabelIndices.push(Math.round((i / Math.max(1, xLabelCount - 1)) * (viewData.length - 1)));
  }

  // KPI
  const totalMsgs = data.reduce((s, d) => s + d.msgs, 0);
  const totalSpam = data.reduce((s, d) => s + d.spam, 0);
  const avgMsgsMin = data.length > 0 ? (totalMsgs / data.length).toFixed(1) : '0';
  const peakMsgsMin = data.length > 0 ? Math.max(...data.map(d => d.msgs)) : 0;
  const spamPct = totalMsgs > 0 ? Math.round((totalSpam / totalMsgs) * 100) : 0;
  const sparkMsgs = data.map(d => d.msgs);
  const sparkSpam = data.map(d => d.spam);

  // Pan handlers
  const onPanStart = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setPanning(true);
    panStartRef.current = { clientX: e.clientX, viewStart, viewEnd };
  };
  const onPanMove = (e: React.MouseEvent) => {
    if (!panning || !panStartRef.current || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const pxPerIdx = rect.width / Math.max(1, viewEnd - viewStart);
    const dx = Math.round((panStartRef.current.clientX - e.clientX) / pxPerIdx);
    if (dx === 0) return;
    const range = panStartRef.current.viewEnd - panStartRef.current.viewStart;
    let newVs = panStartRef.current.viewStart + dx;
    let newVe = newVs + range;
    if (newVs < 0) { newVs = 0; newVe = range; }
    if (newVe >= data.length) { newVe = data.length - 1; newVs = Math.max(0, newVe - range); }
    setViewStart(newVs);
    setViewEnd(newVe);
  };
  const onPanEnd = () => setPanning(false);

  // Tooltip hover
  const onSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    const px = e.clientX - rect.left - Y_LABEL_W;
    const fraction = Math.max(0, Math.min(1, px / CHART_W));
    const idx = Math.round(fraction * (viewData.length - 1));
    const svgX = Y_LABEL_W + (idx / Math.max(1, viewData.length - 1)) * CHART_W;
    setTooltip({ svgX, idx });
    setTooltipPos({ x: e.clientX, y: e.clientY });
  };

  // Overview strip
  const allMaxY = Math.max(...data.map(d => d.msgs), 1);
  const allMsgPts: [number, number][] = data.map((d, i) => [i, d.msgs]);
  const overviewLine = data.length > 1 ? smoothLinePath(allMsgPts, CHART_W, OVERVIEW_H - 4, allMaxY) : '';
  const overviewArea = data.length > 1 ? areaFillPath(allMsgPts, CHART_W, OVERVIEW_H - 4, allMaxY) : '';
  const rangeLeft = data.length > 1 ? (viewStart / (data.length - 1)) * 100 : 0;
  const rangeWidth = data.length > 1 ? ((viewEnd - viewStart) / (data.length - 1)) * 100 : 100;

  if (loading) {
    return (
      <div style={{ marginBottom: '16px', padding: '18px', borderRadius: '16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.2)', fontSize: '12px' }}>
        Загрузка данных по минутам...
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div style={{ marginBottom: '16px', padding: '18px', borderRadius: '16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.2)', fontSize: '12px' }}>
        Нет данных по минутам
      </div>
    );
  }

  const tooltipData = tooltip !== null ? viewData[tooltip.idx] : null;

  return (
    <div style={{ marginBottom: '16px' }}>
      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '10px' }}>
        {[
          { label: 'Среднее сообщ/мин', value: avgMsgsMin, color: '#a070ff', spark: sparkMsgs },
          { label: 'Пик сообщ/мин', value: String(peakMsgsMin), color: '#a070ff', spark: sparkMsgs },
          { label: 'Всего сообщений', value: totalMsgs.toLocaleString(), color: '#5b9eff', spark: sparkMsgs },
          { label: 'Спам %', value: `${spamPct}%`, color: '#00e5cc', spark: sparkSpam },
        ].map(({ label, value, color, spark }) => (
          <div key={label} style={{ padding: '12px 14px 8px', borderRadius: '16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: '9px', fontWeight: 700, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '4px' }}>{label}</div>
            <div style={{ fontSize: '22px', fontWeight: 800, color, lineHeight: 1, marginBottom: '6px' }}>{value}</div>
            <SparkLine data={spark} color={color} />
          </div>
        ))}
      </div>

      {/* Main chart card */}
      <div ref={containerRef} style={{ padding: '16px', borderRadius: '16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', userSelect: 'none' }}>
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '14px' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em', flex: 1 }}>
            Активность по минутам
          </div>
          {/* LIVE badge */}
          {isLive && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '3px 10px', borderRadius: '20px', background: 'rgba(0,200,120,0.1)', border: '1px solid rgba(0,200,120,0.25)' }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#00c878', animation: 'livePulse 1.5s ease-in-out infinite' }} />
              <span style={{ fontSize: '10px', fontWeight: 800, color: '#00c878', letterSpacing: '0.12em' }}>LIVE</span>
            </div>
          )}
          {/* Legend */}
          <div style={{ display: 'flex', gap: '14px', marginLeft: '16px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>
              <span style={{ width: '10px', height: '3px', borderRadius: '2px', background: '#a070ff', display: 'inline-block' }} />
              Сообщений
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>
              <span style={{ width: '10px', height: '2px', borderRadius: '1px', background: '#00e5cc', display: 'inline-block' }} />
              Спам
            </span>
          </div>
        </div>

        {/* SVG chart */}
        <div style={{ position: 'relative', cursor: panning ? 'grabbing' : 'crosshair' }}
          onMouseDown={onPanStart}
          onMouseMove={onPanMove}
          onMouseUp={onPanEnd}
          onMouseLeave={() => { setTooltip(null); onPanEnd(); }}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            style={{ width: '100%', height: '200px', display: 'block', overflow: 'visible' }}
            preserveAspectRatio="none"
            onMouseMove={onSvgMouseMove}
          >
            <defs>
              <linearGradient id="sacAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#a070ff" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#a070ff" stopOpacity="0" />
              </linearGradient>
              <clipPath id="sacClip">
                <rect x={Y_LABEL_W} y={0} width={CHART_W} height={CHART_H} />
              </clipPath>
            </defs>

            {/* Y axis labels + grid lines */}
            {gridLevels.map(f => {
              const yVal = Math.round(f * maxY);
              const yPx = CHART_H - f * CHART_H;
              return (
                <g key={f}>
                  <line x1={Y_LABEL_W} y1={yPx} x2={W} y2={yPx}
                    stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray="4 4" />
                  <text x={Y_LABEL_W - 6} y={yPx + 4} textAnchor="end"
                    style={{ fontSize: '9px', fill: 'rgba(255,255,255,0.25)', fontFamily: 'Inter,sans-serif' }}>
                    {yVal}
                  </text>
                </g>
              );
            })}

            {/* Chart content clipped */}
            <g clipPath="url(#sacClip)" transform={`translate(${Y_LABEL_W}, 0)`}>
              {/* Area fill */}
              {msgArea && <path d={msgArea} fill="url(#sacAreaGrad)" />}
              {/* Msgs line */}
              {msgLine && <path d={msgLine} fill="none" stroke="#a070ff" strokeWidth="2" strokeLinecap="round" />}
              {/* Spam line */}
              {spamLine && <path d={spamLine} fill="none" stroke="#00e5cc" strokeWidth="2" strokeLinecap="round" strokeDasharray="0" />}
            </g>

            {/* Crosshair */}
            {tooltip && (
              <line x1={tooltip.svgX} y1={0} x2={tooltip.svgX} y2={CHART_H}
                stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
            )}

            {/* X axis labels */}
            {xLabelIndices.map(idx => {
              if (idx >= viewData.length) return null;
              const d = viewData[idx];
              const xPx = Y_LABEL_W + (idx / Math.max(1, viewData.length - 1)) * CHART_W;
              return (
                <text key={idx} x={xPx} y={CHART_H + 16} textAnchor="middle"
                  style={{ fontSize: '9px', fill: 'rgba(255,255,255,0.25)', fontFamily: 'Inter,sans-serif' }}>
                  {mskTime(d.minute)}
                </text>
              );
            })}
          </svg>

          {/* Floating tooltip */}
          {tooltip && tooltipData && (
            <div style={{
              position: 'fixed',
              left: tooltipPos.x + 14,
              top: tooltipPos.y - 60,
              zIndex: 9999,
              background: 'rgba(8,8,18,0.95)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '10px',
              padding: '10px 14px',
              pointerEvents: 'none',
              fontSize: '11px',
              minWidth: '160px',
            }}>
              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', marginBottom: '6px' }}>
                {msk(tooltipData.minute)}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '3px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#a070ff', flexShrink: 0 }} />
                <span style={{ color: 'rgba(255,255,255,0.6)' }}>Сообщений/мин:</span>
                <span style={{ color: '#a070ff', fontWeight: 700, marginLeft: 'auto' }}>{tooltipData.msgs}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '3px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#00e5cc', flexShrink: 0 }} />
                <span style={{ color: 'rgba(255,255,255,0.6)' }}>Спам/мин:</span>
                <span style={{ color: '#00e5cc', fontWeight: 700, marginLeft: 'auto' }}>{tooltipData.spam}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#5b9eff', flexShrink: 0 }} />
                <span style={{ color: 'rgba(255,255,255,0.6)' }}>Спам-юзеров:</span>
                <span style={{ color: '#5b9eff', fontWeight: 700, marginLeft: 'auto' }}>{tooltipData.spam_users}</span>
              </div>
            </div>
          )}
        </div>

        {/* Overview strip */}
        <div style={{ marginTop: '8px', position: 'relative', height: `${OVERVIEW_H}px`, background: 'rgba(255,255,255,0.02)', borderRadius: '6px', overflow: 'hidden' }}>
          <svg viewBox={`0 0 ${CHART_W} ${OVERVIEW_H - 4}`} style={{ width: '100%', height: '100%', display: 'block' }} preserveAspectRatio="none">
            {overviewArea && <path d={overviewArea} fill="rgba(160,112,255,0.12)" />}
            {overviewLine && <path d={overviewLine} fill="none" stroke="rgba(160,112,255,0.4)" strokeWidth="1" />}
          </svg>
          {/* Selected range indicator */}
          <div style={{
            position: 'absolute', top: 0, bottom: 0,
            left: `${rangeLeft}%`,
            width: `${rangeWidth}%`,
            background: 'rgba(160,112,255,0.15)',
            border: '1px solid rgba(160,112,255,0.4)',
            borderRadius: '3px',
            pointerEvents: 'none',
          }} />
          {data.length > 1 && (
            <div style={{ position: 'absolute', bottom: '3px', left: '6px', fontSize: '8px', color: 'rgba(255,255,255,0.2)', pointerEvents: 'none' }}>
              {mskTime(data[0].minute)} — {mskTime(data[data.length - 1].minute)}
            </div>
          )}
        </div>
        <div style={{ marginTop: '4px', fontSize: '9px', color: 'rgba(255,255,255,0.2)', textAlign: 'center' }}>
          Колёсико мыши — масштаб · Перетащите — прокрутка
        </div>
      </div>

      {/* LIVE pulse animation */}
      <style>{`@keyframes livePulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(1.4)} }`}</style>
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
    api.get<StreamStats>(`/api/streams/${streamId}/stats`).then(setData);
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

      {/* Stream area chart */}
      <StreamAreaChart
        streamId={streamId}
        isLive={!session.ended_at}
        startedAt={session.started_at}
        endedAt={session.ended_at}
      />

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
export function Analytics({ initialSection, streamEventTick }: { initialSection?: 'mods' | 'streams'; streamEventTick?: number } = {}) {
  const [channels, setChannels] = useState<string[]>([]);
  const [selectedChannel, setSelectedChannel] = useState('');
  const [mods, setMods] = useState<TwitchMod[]>([]);
  const [streams, setStreams] = useState<StreamSession[]>([]);
  const [selectedStream, setSelectedStream] = useState<number | null>(null);
  const [section, setSection] = useState<'mods' | 'streams'>(initialSection || 'mods');
  const [modsLoading, setModsLoading] = useState(false);
  const [modsError, setModsError] = useState<string | null>(null);
  const [init, setInit] = useState(false);
  const [heatmap, setHeatmap] = useState<{ day: string; count: number }[]>([]);
  const [hourlyHeatmap, setHourlyHeatmap] = useState<{ dow: number; hour: number; c: number }[]>([]);
  const [hourCell, setHourCell] = useState<{ x: number; y: number; label: string } | null>(null);
  const [selectedMod, setSelectedMod] = useState<{ mod: TwitchMod; rank: number } | null>(null);
  const [heatmapTooltip, setHeatmapTooltip] = useState<HeatmapTooltip | null>(null);
  const heatmapTooltipCache = useRef<Record<string, any>>({});

  useEffect(() => {
    api.get<{ day: string; count: number }[]>('/api/streams/heatmap').then(setHeatmap).catch(() => {});
    api.get<{ dow: number; hour: number; c: number }[]>('/api/streams/hourly-heatmap').then(setHourlyHeatmap).catch(() => {});
  }, []);

  useEffect(() => {
    const loadStreams = () =>
      api.get<StreamSession[]>('/api/streams').catch(() => [] as StreamSession[]);

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

  // Live refetch when backend broadcasts a stream start/end over WebSocket
  useEffect(() => {
    if (streamEventTick === undefined) return;
    api.get<StreamSession[]>('/api/streams').then(setStreams).catch(() => {});
  }, [streamEventTick]);

  const loadModsFromLogs = useCallback((ch: string) => {
    api.get<any[]>(`/api/admin/stats/moderators?channel=${encodeURIComponent(ch)}`)
      .then(data => {
        const converted: TwitchMod[] = (data || []).map((m: any) => ({
          twitch_login: m.twitch_username || m.twitch_display_name || m.display_name || '—',
          twitch_display_name: m.twitch_display_name || m.twitch_username || m.display_name || 'Без Twitch',
          twitch_avatar: m.twitch_avatar || null,
          mutes: m.mutes || 0,
          auto_mutes: m.auto_mutes || 0,
          bans: m.bans || 0,
          unbans: m.unbans || 0,
          total: m.total || 0,
          last_action: m.last_action || null,
        }));
        setMods(converted);
        setModsError(null);
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
      const info = await api.get<any>(`/api/streams/heatmap-detail?date=${key}${chParam}`);
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

            {/* Hour × Day-of-week heatmap */}
            {hourlyHeatmap.length > 0 && (() => {
              // Postgres dow: 0=Sun..6=Sat. Display rows Mon..Sun.
              const dowOrder = [1, 2, 3, 4, 5, 6, 0];
              const rowLabels = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
              const grid: number[][] = dowOrder.map(() => new Array(24).fill(0));
              let maxC = 1;
              hourlyHeatmap.forEach(({ dow, hour, c }) => {
                const rowIdx = dowOrder.indexOf(dow);
                if (rowIdx >= 0 && hour >= 0 && hour < 24) {
                  grid[rowIdx][hour] = c;
                  if (c > maxC) maxC = c;
                }
              });
              const CELL = 15, GAP = 3, LEFT = 26, TOP = 16;
              const w = LEFT + 24 * (CELL + GAP);
              const h = TOP + 7 * (CELL + GAP) + 12;
              return (
                <div style={{ marginBottom: '24px', padding: '18px 20px', borderRadius: '14px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', position: 'relative' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '14px' }}>
                    Активность: час × день
                  </div>
                  <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', maxWidth: `${w}px`, height: 'auto', display: 'block', overflow: 'visible' }}
                    onMouseLeave={() => setHourCell(null)}>
                    {/* Hour column labels */}
                    {[0, 6, 12, 18, 23].map(hr => (
                      <text key={hr} x={LEFT + hr * (CELL + GAP) + CELL / 2} y={10} textAnchor="middle"
                        style={{ fontSize: '8px', fill: 'rgba(255,255,255,0.3)', fontFamily: 'Inter,sans-serif' }}>{hr}</text>
                    ))}
                    {/* Row labels */}
                    {rowLabels.map((label, row) => (
                      <text key={label} x={0} y={TOP + row * (CELL + GAP) + CELL - 3}
                        style={{ fontSize: '8px', fill: 'rgba(255,255,255,0.25)', fontFamily: 'Inter,sans-serif' }}>{label}</text>
                    ))}
                    {/* Cells */}
                    {grid.map((rowArr, row) =>
                      rowArr.map((count, hour) => {
                        const opacity = count === 0 ? 0.06 : 0.08 + (count / maxC) * 0.82;
                        return (
                          <rect key={`${row}-${hour}`}
                            x={LEFT + hour * (CELL + GAP)} y={TOP + row * (CELL + GAP)}
                            width={CELL} height={CELL} rx={2} ry={2}
                            fill={`rgba(0,200,120,${opacity.toFixed(2)})`}
                            style={{ cursor: 'default' }}
                            onMouseEnter={e => {
                              const rect = (e.currentTarget as SVGRectElement).getBoundingClientRect();
                              setHourCell({ x: rect.left + rect.width / 2, y: rect.top, label: `${rowLabels[row]} ${String(hour).padStart(2, '0')}:00 — ${count.toLocaleString()} сообщений` });
                            }}
                          />
                        );
                      })
                    )}
                  </svg>
                  {hourCell && (
                    <div style={{
                      position: 'fixed', left: hourCell.x + 8, top: hourCell.y - 10, zIndex: 9998,
                      background: 'rgba(12,12,18,0.98)', border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '10px', padding: '8px 12px', pointerEvents: 'none',
                      fontSize: '11px', color: '#00c878', fontWeight: 600, whiteSpace: 'nowrap',
                    }}>{hourCell.label}</div>
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
