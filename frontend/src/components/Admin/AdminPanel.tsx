import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, Mail, Tv2, Activity, BarChart3, Trash2, Shield, ShieldOff,
  UserPlus, Search, Crown, X, Plus, TrendingUp, MessageSquare, Zap,
  VolumeX, Ban, RotateCcw, AlertTriangle, ChevronDown, Circle, Clock, Wifi,
} from 'lucide-react';
import { api } from '../../hooks/useApi';

type Tab = 'overview' | 'users' | 'whitelist' | 'channels' | 'logs' | 'bans';

interface AdminUser {
  id: number; email: string; name: string | null; picture: string | null;
  role: 'admin' | 'user'; enabled: boolean; last_login: string | null;
  created_at: string; channel_count: number;
}

interface WLItem { id: number; email: string; added_by: string; note: string; created_at: string; }
interface ChannelItem { id: number; name: string; owner_email: string | null; owner_name: string | null;
  status: string; auto_mod: boolean; created_at: string; }

export function AdminPanel() {
  const [tab, setTab] = useState<Tab>('overview');

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      <div style={{
        width: '210px', flexShrink: 0, padding: '20px 12px',
        borderRight: '1px solid rgba(255,255,255,0.04)',
        background: 'rgba(8,8,12,0.3)', overflowY: 'auto',
      }}>
        <div style={{
          fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.16em', marginBottom: '14px', paddingLeft: '10px',
          color: 'rgba(255,255,255,0.3)',
        }}>Admin</div>
        {([
          ['overview', BarChart3, 'Обзор'],
          ['users', Users, 'Пользователи'],
          ['whitelist', Mail, 'Whitelist'],
          ['channels', Tv2, 'Все каналы'],
          ['bans', Ban, 'Баны'],
          ['logs', Activity, 'Все логи'],
        ] as const).map(([id, Icon, label]) => {
          const active = tab === id;
          return (
            <button key={id} onClick={() => setTab(id as Tab)} style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              width: '100%', padding: '10px 12px', marginBottom: '3px',
              borderRadius: '10px', cursor: 'pointer',
              background: active ? 'rgba(255,200,0,0.08)' : 'transparent',
              color: active ? '#ffc800' : 'rgba(255,255,255,0.5)',
              border: 'none', outline: 'none',
              fontSize: '13px', fontWeight: 500, textAlign: 'left',
            }}
            onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
            onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
              <Icon size={14} />
              {label}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
        {tab === 'overview' && <Overview />}
        {tab === 'users' && <UsersTab />}
        {tab === 'whitelist' && <WhitelistTab />}
        {tab === 'channels' && <ChannelsTab />}
        {tab === 'bans' && <BansTab />}
        {tab === 'logs' && <LogsTab />}
      </div>
    </div>
  );
}

// ============================================================================
// Overview / Stats
// ============================================================================

const ACTION_META: Record<string, { color: string; bg: string; icon: any; label: string }> = {
  MUTED:      { color: '#ffc800', bg: 'rgba(255,200,0,0.1)',    icon: VolumeX,    label: 'Мут' },
  AUTO_MUTED: { color: '#ff9800', bg: 'rgba(255,152,0,0.1)',    icon: Zap,        label: 'Авто-мут' },
  BANNED:     { color: '#ff5959', bg: 'rgba(240,71,71,0.1)',    icon: Ban,        label: 'Бан' },
  UNBANNED:   { color: '#00c878', bg: 'rgba(0,200,120,0.1)',    icon: RotateCcw,  label: 'Разбан' },
};

interface LiveStats {
  msg_per_5min: number;
  recent_actions: Array<{
    action: string;
    performed_by: string;
    channel_name: string;
    target_username: string | null;
    created_at: string;
  }>;
  channel_status: Array<{ name: string; status: string }>;
  auto_vs_manual: { auto_mutes: number; manual_mutes: number };
}

interface ChannelActivity {
  channel_name: string;
  total_msgs: number;
  spam_msgs: number;
  msgs_24h: number;
}

function relativeTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}с назад`;
  if (diff < 3600) return `${Math.floor(diff / 60)}м назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}ч назад`;
  return `${Math.floor(diff / 86400)}д назад`;
}

function Overview() {
  const [stats, setStats] = useState<any>(null);
  const [timeline, setTimeline] = useState<any[]>([]);
  const [period, setPeriod] = useState<7 | 14 | 30>(14);
  const [hoveredBar, setHoveredBar] = useState<number | null>(null);
  const [online, setOnline] = useState<{ count: number; users: any[] }>({ count: 0, users: [] });
  const [live, setLive] = useState<LiveStats | null>(null);
  const [channelActivity, setChannelActivity] = useState<ChannelActivity[]>([]);
  const [onlineExpanded, setOnlineExpanded] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadLive = () => {
    api.get<LiveStats>('/api/admin/stats/live').then(d => { setLive(d); setLastUpdated(new Date()); }).catch(() => {});
    api.get<ChannelActivity[]>('/api/admin/stats/channels-activity').then(setChannelActivity).catch(() => {});
    api.get<{ count: number; users: any[] }>('/api/admin/online').then(setOnline).catch(() => {});
  };

  const load = () => {
    api.get('/api/admin/stats').then(setStats).catch(console.error);
    api.get<any[]>('/api/admin/stats/timeline').then(setTimeline).catch(console.error);
    loadLive();
  };

  useEffect(() => {
    load();
    const interval = setInterval(loadLive, 15000);
    return () => clearInterval(interval);
  }, []);

  if (!stats) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '40px', color: 'rgba(255,255,255,0.3)', fontSize: '13px' }}>
      Загрузка статистики...
    </div>
  );

  const filteredTimeline = timeline.slice(-period);
  const maxBar = Math.max(1, ...filteredTimeline.map(t => t.total));

  const totalMutes = stats.actions.filter((a: any) => ['MUTED','AUTO_MUTED'].includes(a.action)).reduce((s: number, a: any) => s + a.c, 0);
  const totalBans = stats.actions.find((a: any) => a.action === 'BANNED')?.c || 0;
  const spamRate = stats.total_messages > 0
    ? ((stats.actions.reduce((s: number, a: any) => s + a.c, 0) / stats.total_messages) * 100).toFixed(2)
    : '0';

  // Trend line points for timeline chart
  const CHART_H = 106;
  const trendPoints = filteredTimeline.length > 1
    ? filteredTimeline.map((t, i) => {
        const x = (i / (filteredTimeline.length - 1)) * 100;
        const y = CHART_H - Math.max(2, (t.total / maxBar) * CHART_H);
        return `${x},${y}`;
      }).join(' ')
    : '';

  // Donut chart for auto vs manual
  const autoMutes = live?.auto_vs_manual.auto_mutes ?? 0;
  const manualMutes = live?.auto_vs_manual.manual_mutes ?? 0;
  const donutTotal = autoMutes + manualMutes;
  const autoPct = donutTotal > 0 ? autoMutes / donutTotal : 0.5;
  const DONUT_R = 36;
  const DONUT_CIRC = 2 * Math.PI * DONUT_R;
  const autoArc = autoPct * DONUT_CIRC;

  const maxActivity = Math.max(1, ...channelActivity.map(c => c.total_msgs));

  return (
    <div style={{ maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'rgba(255,255,255,0.95)', marginBottom: '2px' }}>Обзор системы</h2>
          <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.35)' }}>Аналитика всех каналов в реальном времени</p>
        </div>
        <button onClick={load} style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '7px 12px', borderRadius: '9px', fontSize: '11px', fontWeight: 600,
          background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.5)',
          border: '1px solid rgba(255,255,255,0.07)', cursor: 'pointer',
        }}>
          <RotateCcw size={11} /> Обновить
        </button>
      </div>

      {/* ── Live stats bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '20px',
        padding: '8px 16px', marginBottom: '14px', borderRadius: '10px',
        background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)',
        fontSize: '12px',
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#00c878' }}>
          <Circle size={8} fill="#00c878" />
          <b>{live?.msg_per_5min ?? '—'}</b>
          <span style={{ color: 'rgba(255,255,255,0.4)' }}>сообщ/5мин</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'rgba(255,255,255,0.4)' }}>
          <Clock size={11} />
          Обновлено: {lastUpdated ? lastUpdated.toLocaleTimeString() : '—'}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'rgba(255,255,255,0.4)' }}>
          <Wifi size={11} />
          {online.count} онлайн
        </span>
        <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'rgba(255,255,255,0.2)' }}>
          обновление каждые 15с
        </span>
      </div>

      {/* ── KPI row (5 columns) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px', marginBottom: '10px' }}>
        <KpiCard icon={Activity} label="Онлайн на сайте" value={online.count} color="#00e88f"
          sub={online.count > 0 ? online.users.slice(0, 3).map((u: any) => u.name || u.email.split('@')[0]).join(', ') : 'никого нет'} />
        <KpiCard icon={Users} label="Пользователи" value={stats.users.c}
          sub={`${stats.users.active} активны · ${stats.users.admins} админ`} color="#ffc800" />
        <KpiCard icon={Tv2} label="Каналы" value={stats.channels.c}
          sub={`${stats.channels.connected} подключено`} color="#a070ff" />
        <KpiCard icon={VolumeX} label="Мутов за 24ч" value={stats.mutes_24h} color="#ff7070"
          sub={`всего мутов: ${totalMutes.toLocaleString()}`} />
        <KpiCard icon={AlertTriangle} label="Spam rate" value={`${spamRate}%`} color="#ff9800"
          sub={`${stats.total_messages.toLocaleString()} сообщений`} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '16px' }}>
        <KpiCard icon={MessageSquare} label="Сообщений за 24ч" value={stats.messages_24h.toLocaleString()} color="#5b9eff" />
        <KpiCard icon={Ban} label="Банов всего" value={totalBans.toLocaleString()} color="#ff5959" />
        <KpiCard icon={Mail} label="В whitelist" value={stats.whitelist_count} color="#00c878" />
      </div>

      {/* ── Online users panel (collapsible) ── */}
      {online.users.length > 0 && (
        <div style={{
          marginBottom: '16px', borderRadius: '14px',
          background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)',
        }}>
          <button onClick={() => setOnlineExpanded(v => !v)} style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
            padding: '10px 16px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.7)',
          }}>
            <Activity size={13} style={{ color: '#00e88f' }} />
            <span style={{ fontSize: '12px', fontWeight: 600 }}>Сейчас на сайте ({online.count})</span>
            <ChevronDown size={12} style={{ marginLeft: 'auto', transform: onlineExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
          </button>
          {onlineExpanded && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '0 16px 14px' }}>
              {online.users.map((u: any, i: number) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 10px', borderRadius: '8px', background: 'rgba(0,232,143,0.06)', border: '1px solid rgba(0,232,143,0.12)' }}>
                  {u.picture ? (
                    <img src={u.picture} alt="" style={{ width: '22px', height: '22px', borderRadius: '50%' }} />
                  ) : (
                    <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: 'rgba(0,232,143,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700, color: '#00e88f' }}>
                      {(u.name || u.email || '?')[0].toUpperCase()}
                    </div>
                  )}
                  <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.8)', fontWeight: 500 }}>{u.name || u.email?.split('@')[0]}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Timeline chart (improved with trend line) ── */}
      <div className="glass-card" style={{ padding: '20px 22px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <TrendingUp size={14} style={{ color: '#ffc800' }} />
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>Активность чата</span>
          </div>
          <div style={{ display: 'flex', gap: '4px' }}>
            {([7, 14, 30] as const).map(p => (
              <button key={p} onClick={() => setPeriod(p)} style={{
                padding: '4px 10px', borderRadius: '7px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', border: 'none',
                background: period === p ? 'rgba(255,200,0,0.15)' : 'rgba(255,255,255,0.04)',
                color: period === p ? '#ffc800' : 'rgba(255,255,255,0.4)',
              }}>{p}д</button>
            ))}
          </div>
        </div>

        <div style={{ position: 'relative', height: '154px' }}>
          {/* SVG trend overlay */}
          {filteredTimeline.length > 1 && (
            <svg style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: `${CHART_H}px`, pointerEvents: 'none', overflow: 'visible' }}
              preserveAspectRatio="none" viewBox={`0 0 100 ${CHART_H}`}>
              <defs>
                <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ffc800" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#ffc800" stopOpacity="0" />
                </linearGradient>
              </defs>
              {/* Gradient fill area */}
              <polyline
                points={`0,${CHART_H} ${trendPoints} 100,${CHART_H}`}
                fill="url(#trendGrad)" stroke="none" />
              {/* Trend line */}
              <polyline
                points={trendPoints}
                fill="none" stroke="#ffc800" strokeWidth="0.8" strokeOpacity="0.6"
                strokeLinejoin="round" strokeLinecap="round" />
            </svg>
          )}

          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: '130px', paddingBottom: '24px', position: 'relative' }}>
            {/* Y-axis guide lines */}
            {[0.25, 0.5, 0.75, 1].map(f => (
              <div key={f} style={{
                position: 'absolute', left: 0, right: 0, bottom: `calc(24px + ${f * CHART_H}px)`,
                borderTop: '1px solid rgba(255,255,255,0.04)',
                fontSize: '8px', color: 'rgba(255,255,255,0.18)',
                paddingLeft: '2px', lineHeight: '1',
              }}>
                {Math.round(maxBar * f).toLocaleString()}
              </div>
            ))}

            {filteredTimeline.map((t, i) => {
              const totalH = Math.max(2, (t.total / maxBar) * CHART_H);
              const spamH = t.total > 0 ? (t.spam / t.total) * totalH : 0;
              const isHovered = hoveredBar === i;
              const d = new Date(t.day);
              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end', position: 'relative' }}
                  onMouseEnter={() => setHoveredBar(i)} onMouseLeave={() => setHoveredBar(null)}>
                  {isHovered && (
                    <div style={{
                      position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
                      background: 'rgba(8,8,12,0.95)', border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px', padding: '6px 10px', fontSize: '10px', whiteSpace: 'nowrap', zIndex: 10,
                      marginBottom: '4px', pointerEvents: 'none',
                    }}>
                      <div style={{ fontWeight: 700, color: '#fff', marginBottom: '2px' }}>
                        {d.getDate()}.{d.getMonth() + 1}.{d.getFullYear()}
                      </div>
                      <div style={{ color: 'rgba(255,255,255,0.6)' }}>Сообщений: <b style={{ color: '#fff' }}>{t.total.toLocaleString()}</b></div>
                      <div style={{ color: 'rgba(255,89,89,0.9)' }}>Спам: <b>{t.spam.toLocaleString()}</b> ({t.total > 0 ? Math.round(t.spam / t.total * 100) : 0}%)</div>
                    </div>
                  )}
                  <div style={{ width: '100%', height: `${totalH}px`, borderRadius: '4px 4px 0 0', overflow: 'hidden', position: 'relative',
                    background: isHovered ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.1)',
                    transition: 'background 0.15s',
                  }}>
                    <div style={{
                      position: 'absolute', bottom: 0, left: 0, right: 0, height: `${spamH}px`,
                      background: 'linear-gradient(to top, rgba(255,89,89,0.85), rgba(255,152,0,0.6))',
                    }} />
                  </div>
                  <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.28)', marginTop: '5px', textAlign: 'center' }}>
                    {d.getDate()}.{d.getMonth() + 1}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '16px', fontSize: '10px', marginTop: '4px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'rgba(255,255,255,0.35)' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: 'rgba(255,255,255,0.15)', display: 'inline-block' }} />
            Все сообщения
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'rgba(255,89,89,0.8)' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: 'rgba(255,89,89,0.7)', display: 'inline-block' }} />
            Спам
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'rgba(255,200,0,0.6)' }}>
            <span style={{ width: '24px', height: '2px', background: '#ffc800', display: 'inline-block', borderRadius: '2px', opacity: 0.7 }} />
            Тренд
          </span>
        </div>
      </div>

      {/* ── Actions breakdown (60%) + Auto vs Manual donut (40%) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: '12px', marginBottom: '12px' }}>
        <div className="glass-card" style={{ padding: '18px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <Shield size={14} style={{ color: '#a070ff' }} />
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>Действия модерации</span>
            <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'rgba(255,255,255,0.3)' }}>
              всего {stats.total_logs.toLocaleString()}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
            {stats.actions.map((a: any) => {
              const meta = ACTION_META[a.action] || { color: '#fff', bg: 'rgba(255,255,255,0.05)', icon: Activity, label: a.action };
              const Icon = meta.icon;
              const pct = stats.total_logs > 0 ? Math.round(a.c / stats.total_logs * 100) : 0;
              return (
                <div key={a.action} style={{
                  padding: '14px 16px', borderRadius: '12px',
                  background: meta.bg, border: `1px solid ${meta.color}22`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '8px' }}>
                    <Icon size={13} style={{ color: meta.color }} />
                    <span style={{ fontSize: '10px', fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{meta.label}</span>
                  </div>
                  <div style={{ fontSize: '24px', fontWeight: 800, color: meta.color, lineHeight: 1, marginBottom: '4px' }}>{a.c.toLocaleString()}</div>
                  <div style={{ height: '3px', borderRadius: '3px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                    <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8, ease: 'easeOut' }}
                      style={{ height: '100%', background: meta.color, borderRadius: '3px' }} />
                  </div>
                  <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', marginTop: '4px' }}>{pct}% от всех</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Auto vs Manual donut */}
        <div className="glass-card" style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', alignSelf: 'flex-start' }}>
            <Zap size={14} style={{ color: '#ff9800' }} />
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>Авто vs Ручные</span>
            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', marginLeft: 'auto' }}>7 дней</span>
          </div>
          <svg width="110" height="110" viewBox="0 0 110 110">
            <circle cx="55" cy="55" r={DONUT_R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="12" />
            <circle cx="55" cy="55" r={DONUT_R} fill="none" stroke="#ff9800" strokeWidth="12"
              strokeDasharray={`${autoArc} ${DONUT_CIRC - autoArc}`}
              strokeDashoffset={DONUT_CIRC * 0.25}
              strokeLinecap="round" />
            <circle cx="55" cy="55" r={DONUT_R} fill="none" stroke="#ffc800" strokeWidth="12"
              strokeDasharray={`${DONUT_CIRC - autoArc} ${autoArc}`}
              strokeDashoffset={DONUT_CIRC * 0.25 - autoArc}
              strokeLinecap="round" />
            <text x="55" y="50" textAnchor="middle" fill="rgba(255,255,255,0.8)" fontSize="13" fontWeight="700">{donutTotal.toLocaleString()}</text>
            <text x="55" y="65" textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="9">всего</text>
          </svg>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: '#ff9800', flexShrink: 0 }} />
              <span style={{ color: 'rgba(255,255,255,0.5)', flex: 1 }}>Авто-мут</span>
              <span style={{ fontWeight: 700, color: '#ff9800' }}>{autoMutes.toLocaleString()}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: '#ffc800', flexShrink: 0 }} />
              <span style={{ color: 'rgba(255,255,255,0.5)', flex: 1 }}>Ручной мут</span>
              <span style={{ fontWeight: 700, color: '#ffc800' }}>{manualMutes.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Channel status + Live event feed ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
        {/* Channel status */}
        <div className="glass-card" style={{ padding: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <Tv2 size={13} style={{ color: '#a070ff' }} />
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>Статус каналов</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px' }}>
            {(live?.channel_status ?? []).map(ch => {
              const dotColor = ch.status === 'connected' ? '#00c878' : ch.status === 'connecting' ? '#ffc800' : '#ff5959';
              return (
                <div key={ch.name} style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '5px 8px', borderRadius: '8px', background: 'rgba(255,255,255,0.025)' }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: dotColor, flexShrink: 0, boxShadow: `0 0 6px ${dotColor}88` }} />
                  <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.name}</span>
                </div>
              );
            })}
            {(live?.channel_status ?? []).length === 0 && (
              <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: '11px', gridColumn: '1 / -1' }}>Нет каналов</div>
            )}
          </div>
        </div>

        {/* Live event feed */}
        <div className="glass-card" style={{ padding: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <Activity size={13} style={{ color: '#00c878' }} />
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>Последние события</span>
            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.25)', marginLeft: 'auto' }}>авто 15с</span>
          </div>
          <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
            {(live?.recent_actions ?? []).length === 0 ? (
              <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: '11px' }}>Нет событий</div>
            ) : (live?.recent_actions ?? []).map((ev, i) => {
              const meta = ACTION_META[ev.action] || { color: '#aaa', bg: 'rgba(255,255,255,0.05)', label: ev.action };
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '11px' }}>
                  <span style={{ padding: '2px 6px', borderRadius: '5px', background: meta.bg, color: meta.color, fontWeight: 700, fontSize: '9px', flexShrink: 0 }}>{meta.label}</span>
                  <span style={{ color: 'rgba(255,255,255,0.6)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ev.target_username ? <b style={{ color: 'rgba(255,255,255,0.85)' }}>{ev.target_username}</b> : ev.performed_by}
                    {' '}<span style={{ color: 'rgba(255,255,255,0.3)' }}>в</span>{' '}
                    <span style={{ color: '#ffc800' }}>{ev.channel_name}</span>
                  </span>
                  <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.25)', flexShrink: 0 }}>{relativeTime(ev.created_at)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Top spammers + Top channels by messages ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <div className="glass-card" style={{ padding: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <AlertTriangle size={13} style={{ color: '#ff7070' }} />
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>Топ нарушителей</span>
          </div>
          {stats.top_users.length === 0 ? (
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: '12px' }}>Нет данных</div>
          ) : stats.top_users.map((u: any, i: number) => (
            <div key={u.username + u.channel_name} style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.04)',
            }}>
              <span style={{ fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.2)', minWidth: '16px' }}>#{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: 'rgba(255,255,255,0.85)', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.username}</div>
                <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', marginTop: '1px' }}>📺 {u.channel_name} · {u.flagged_count} флагов</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#ff7070' }}>{u.mute_count}× мут</div>
                {u.message_count > 0 && <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.25)', marginTop: '1px' }}>{u.message_count} сообщ.</div>}
              </div>
            </div>
          ))}
        </div>

        {/* Top channels by messages */}
        <div className="glass-card" style={{ padding: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <MessageSquare size={13} style={{ color: '#5b9eff' }} />
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>Топ каналов по сообщениям</span>
            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', marginLeft: 'auto' }}>7 дней</span>
          </div>
          {channelActivity.length === 0 ? (
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: '12px' }}>Нет данных</div>
          ) : channelActivity.map((c, i) => {
            const barW = Math.round((c.total_msgs / maxActivity) * 100);
            const spamPct = c.total_msgs > 0 ? Math.round(c.spam_msgs / c.total_msgs * 100) : 0;
            return (
              <div key={c.channel_name} style={{ padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span style={{ fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.2)', minWidth: '16px' }}>#{i + 1}</span>
                  <span style={{ fontWeight: 600, color: '#5b9eff', fontSize: '12px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📺 {c.channel_name}</span>
                  <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>{c.total_msgs.toLocaleString()}</span>
                </div>
                <div style={{ paddingLeft: '24px' }}>
                  <div style={{ height: '4px', borderRadius: '3px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden', marginBottom: '3px' }}>
                    <div style={{ height: '100%', width: `${barW}%`, background: 'linear-gradient(to right, #5b9eff, #a070ff)', borderRadius: '3px' }} />
                  </div>
                  <div style={{ display: 'flex', gap: '10px', fontSize: '9px', color: 'rgba(255,255,255,0.3)' }}>
                    <span>24ч: <b style={{ color: 'rgba(255,255,255,0.5)' }}>{c.msgs_24h.toLocaleString()}</b></span>
                    <span>спам: <b style={{ color: spamPct > 5 ? '#ff7070' : 'rgba(255,255,255,0.5)' }}>{spamPct}%</b></span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, sub, color }: { icon: any; label: string; value: any; sub?: string; color?: string }) {
  return (
    <div style={{
      padding: '14px 18px', display: 'flex', alignItems: 'flex-start', gap: '12px',
      background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: '16px',
    }}>
      <div style={{
        width: '32px', height: '32px', borderRadius: '9px', flexShrink: 0,
        background: color ? `${color}14` : 'rgba(255,255,255,0.05)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={15} style={{ color: color || 'rgba(255,255,255,0.5)' }} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', marginBottom: '3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
        <div style={{ fontSize: '22px', fontWeight: 800, color: color || 'rgba(255,255,255,0.92)', lineHeight: 1 }}>{value}</div>
        {sub && <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.25)', marginTop: '4px' }}>{sub}</div>}
      </div>
    </div>
  );
}

// ============================================================================
// USERS
// ============================================================================
function UsersTab() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [q, setQ] = useState('');
  const [confirmDel, setConfirmDel] = useState<AdminUser | null>(null);

  const load = () => api.get<AdminUser[]>('/api/admin/users').then(setUsers).catch(console.error);
  useEffect(() => { load(); }, []);

  const filtered = users.filter(u =>
    !q || u.email.toLowerCase().includes(q.toLowerCase()) || (u.name || '').toLowerCase().includes(q.toLowerCase())
  );

  const toggleRole = async (u: AdminUser) => {
    const newRole = u.role === 'admin' ? 'user' : 'admin';
    await api.patch(`/api/admin/users/${u.id}`, { role: newRole });
    load();
  };
  const toggleEnabled = async (u: AdminUser) => {
    await api.patch(`/api/admin/users/${u.id}`, { enabled: !u.enabled });
    load();
  };
  const del = async () => {
    if (!confirmDel) return;
    await api.delete(`/api/admin/users/${confirmDel.id}`);
    setConfirmDel(null);
    load();
  };

  return (
    <div>
      <h2 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '4px' }}>Пользователи</h2>
      <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginBottom: '20px' }}>
        Зарегистрированные через Google
      </p>

      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '8px 14px', borderRadius: '11px', marginBottom: '16px', maxWidth: '320px',
        background: 'rgba(255,255,255,0.025)',
      }}>
        <Search size={13} style={{ color: 'rgba(255,255,255,0.4)' }} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Поиск по email или имени..."
          style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'rgba(255,255,255,0.9)', fontSize: '12px' }} />
      </div>

      <div className="glass-card" style={{ overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: '13px' }}>Нет пользователей</div>
        ) : filtered.map(u => (
          <div key={u.id} style={{
            display: 'flex', alignItems: 'center', gap: '14px',
            padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,0.04)',
          }}>
            {u.picture ? (
              <img src={u.picture} alt="" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' }} />
            ) : (
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: 'rgba(255,255,255,0.6)' }}>
                {u.email[0]?.toUpperCase()}
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontWeight: 600, color: 'rgba(255,255,255,0.95)', fontSize: '13px' }}>{u.name || u.email}</span>
                {u.role === 'admin' && (
                  <span style={{ padding: '2px 7px', borderRadius: '6px', background: 'rgba(255,200,0,0.15)', color: '#ffc800', fontSize: '10px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '3px' }}>
                    <Crown size={9} /> ADMIN
                  </span>
                )}
                {!u.enabled && (
                  <span style={{ padding: '2px 7px', borderRadius: '6px', background: 'rgba(240,71,71,0.15)', color: '#ff7070', fontSize: '10px', fontWeight: 700 }}>
                    DISABLED
                  </span>
                )}
              </div>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.45)', marginTop: '2px' }}>
                {u.email} · {u.channel_count} канал(ов) · {u.last_login ? `был ${new Date(u.last_login).toLocaleDateString()}` : 'не входил'}
              </div>
            </div>
            <button onClick={() => toggleRole(u)} title="Toggle admin" style={{
              padding: '6px 10px', borderRadius: '8px', cursor: 'pointer',
              background: u.role === 'admin' ? 'rgba(255,200,0,0.12)' : 'rgba(255,255,255,0.04)',
              color: u.role === 'admin' ? '#ffc800' : 'rgba(255,255,255,0.5)',
              border: 'none', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 600,
            }}>
              <Crown size={11} />
            </button>
            <button onClick={() => toggleEnabled(u)} title={u.enabled ? 'Disable' : 'Enable'} style={{
              padding: '6px 10px', borderRadius: '8px', cursor: 'pointer',
              background: u.enabled ? 'rgba(0,200,120,0.1)' : 'rgba(240,71,71,0.1)',
              color: u.enabled ? '#00c878' : '#ff7070',
              border: 'none', display: 'flex', alignItems: 'center', fontSize: '11px',
            }}>
              {u.enabled ? <Shield size={11} /> : <ShieldOff size={11} />}
            </button>
            <button onClick={() => setConfirmDel(u)} title="Delete" style={{
              padding: '6px 10px', borderRadius: '8px', cursor: 'pointer',
              background: 'rgba(240,71,71,0.05)', color: '#ff7070',
              border: 'none', display: 'flex', alignItems: 'center',
            }}>
              <Trash2 size={11} />
            </button>
          </div>
        ))}
      </div>

      <ConfirmModal open={!!confirmDel} title="Удалить пользователя?"
        text={`${confirmDel?.email} будет удалён. Сессии прерваны.`}
        onConfirm={del} onClose={() => setConfirmDel(null)} />
    </div>
  );
}

// ============================================================================
// WHITELIST
// ============================================================================
function WhitelistTab() {
  const [list, setList] = useState<WLItem[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [note, setNote] = useState('');
  const [adding, setAdding] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const load = () => api.get<WLItem[]>('/api/admin/whitelist').then(setList).catch(console.error);
  useEffect(() => { load(); }, []);

  const add = async () => {
    setError(null);
    const email = newEmail.trim().toLowerCase();
    if (!email.includes('@')) {
      setError('Невалидный email');
      return;
    }
    setAdding(true);
    try {
      await api.post('/api/admin/whitelist', { email, note });
      setNewEmail(''); setNote('');
      await load();
    } catch (err: any) {
      console.error(err);
      setError(`Ошибка: ${err?.message || 'неизвестная'}`);
    } finally {
      setAdding(false);
    }
  };

  const del = async (id: number) => {
    await api.delete(`/api/admin/whitelist/${id}`).catch(console.error);
    load();
  };

  return (
    <div>
      <h2 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '4px' }}>Whitelist</h2>
      <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginBottom: '20px' }}>
        Только эти email могут логиниться
      </p>

      <div className="glass-card" style={{ padding: '16px', marginBottom: '14px' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input value={newEmail} onChange={e => setNewEmail(e.target.value)}
            placeholder="email@example.com"
            style={{
              flex: 1, padding: '10px 14px', borderRadius: '10px',
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.9)', fontSize: '13px', outline: 'none',
            }} />
          <input value={note} onChange={e => setNote(e.target.value)}
            placeholder="Заметка (опционально)"
            style={{
              width: '200px', padding: '10px 14px', borderRadius: '10px',
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.9)', fontSize: '13px', outline: 'none',
            }} />
          <button onClick={add} disabled={adding || !newEmail.includes('@')} style={{
            padding: '10px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            background: 'rgba(255,200,0,0.18)', color: '#ffc800', border: 'none',
            display: 'flex', alignItems: 'center', gap: '6px',
            opacity: adding || !newEmail.includes('@') ? 0.5 : 1,
          }}>
            <Plus size={13} />Добавить
          </button>
        </div>
        {error && (
          <div style={{
            marginTop: '10px', padding: '8px 12px', borderRadius: '8px',
            background: 'rgba(240,71,71,0.1)', border: '1px solid rgba(240,71,71,0.25)',
            color: '#ff7070', fontSize: '12px',
          }}>{error}</div>
        )}
      </div>

      <div className="glass-card" style={{ overflow: 'hidden' }}>
        {list.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: '13px' }}>Whitelist пуст</div>
        ) : list.map(w => (
          <div key={w.id} style={{
            display: 'flex', alignItems: 'center', gap: '14px',
            padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,0.04)',
          }}>
            <Mail size={14} style={{ color: 'rgba(255,200,0,0.6)', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: 'rgba(255,255,255,0.9)', fontSize: '13px' }}>{w.email}</div>
              {w.note && <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginTop: '2px' }}>{w.note}</div>}
            </div>
            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)' }}>
              {new Date(w.created_at).toLocaleDateString()} · {w.added_by}
            </div>
            <button onClick={() => del(w.id)} style={{
              padding: '6px 8px', borderRadius: '8px', cursor: 'pointer',
              background: 'rgba(240,71,71,0.05)', color: '#ff7070', border: 'none',
            }}>
              <Trash2 size={11} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// CHANNELS
// ============================================================================
function ChannelsTab() {
  const [list, setList] = useState<ChannelItem[]>([]);
  const [confirmDel, setConfirmDel] = useState<ChannelItem | null>(null);

  const load = () => api.get<ChannelItem[]>('/api/admin/channels').then(setList).catch(console.error);
  useEffect(() => { load(); }, []);

  const del = async () => {
    if (!confirmDel) return;
    await api.delete(`/api/admin/channels/${confirmDel.name}`);
    setConfirmDel(null);
    load();
  };

  return (
    <div>
      <h2 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '4px' }}>Все каналы</h2>
      <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginBottom: '20px' }}>
        Каналы всех пользователей системы
      </p>

      <div className="glass-card" style={{ overflow: 'hidden' }}>
        {list.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'rgba(255,255,255,0.3)' }}>Нет каналов</div>
        ) : list.map(c => (
          <div key={c.id} style={{
            display: 'flex', alignItems: 'center', gap: '14px',
            padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,0.04)',
          }}>
            <span style={{
              width: '8px', height: '8px', borderRadius: '50%',
              background: c.status === 'connected' ? '#00c878' : c.status === 'connecting' ? '#ffc800' : '#f04747',
            }} />
            <Tv2 size={13} style={{ color: '#ffc800' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: 'rgba(255,255,255,0.92)', fontSize: '13px' }}>{c.name}</div>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginTop: '2px' }}>
                Владелец: {c.owner_email || '—'} · {c.status} · automod {c.auto_mod ? 'on' : 'off'}
              </div>
            </div>
            <button onClick={() => setConfirmDel(c)} style={{
              padding: '6px 10px', borderRadius: '8px', cursor: 'pointer',
              background: 'rgba(240,71,71,0.05)', color: '#ff7070', border: 'none',
            }}>
              <Trash2 size={11} />
            </button>
          </div>
        ))}
      </div>

      <ConfirmModal open={!!confirmDel} title="Удалить канал?"
        text={`Канал #${confirmDel?.name} будет удалён из системы.`}
        onConfirm={del} onClose={() => setConfirmDel(null)} />
    </div>
  );
}

// ============================================================================
// LOGS — all
// ============================================================================
function LogsTab() {
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => {
    api.get<any[]>('/api/admin/logs?limit=500').then(setLogs).catch(console.error);
  }, []);

  return (
    <div>
      <h2 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '4px' }}>Все логи</h2>
      <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginBottom: '20px' }}>
        Действия модерации со всех каналов
      </p>

      <div className="glass-card" style={{ overflow: 'hidden' }}>
        {logs.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'rgba(255,255,255,0.3)' }}>Нет логов</div>
        ) : logs.slice(0, 200).map(l => (
          <div key={l.id} style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.03)',
            fontSize: '12px',
          }}>
            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace', minWidth: '56px' }}>
              {new Date(l.created_at).toLocaleTimeString()}
            </span>
            <span style={{
              fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '6px', minWidth: '76px', textAlign: 'center',
              background: l.action === 'BANNED' ? 'rgba(240,71,71,0.15)' : 'rgba(140,80,255,0.12)',
              color: l.action === 'BANNED' ? '#ff7070' : '#a070ff',
            }}>{l.action}</span>
            <span style={{ color: '#ffc800', minWidth: '90px' }}>📺 {l.channel_name}</span>
            <span style={{ fontWeight: 600, color: 'rgba(255,255,255,0.85)', minWidth: '120px' }}>{l.username}</span>
            {l.spam_score > 0 && (
              <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '6px', background: 'rgba(255,200,0,0.1)', color: '#ffc800', fontWeight: 700 }}>
                {l.spam_score}
              </span>
            )}
            <span style={{ flex: 1, color: 'rgba(255,255,255,0.4)', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {l.message || '—'}
            </span>
            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)' }}>{l.performed_by}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// BANS
// ============================================================================
interface BanRecord {
  id: number;
  username: string;
  channel_name: string;
  performed_by: string;
  created_at: string;
  performer_name: string | null;
  performer_picture: string | null;
  performer_twitch: string | null;
  performer_avatar: string | null;
  performer_display_name: string | null;
}

function BansTab() {
  const [bans, setBans] = useState<BanRecord[]>([]);
  const [channels, setChannels] = useState<string[]>([]);
  const [selectedChannel, setSelectedChannel] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    api.get<{ name: string }[]>('/api/channels').then(chs => {
      setChannels(chs.map(c => c.name));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const url = selectedChannel
      ? `/api/admin/bans?channel=${encodeURIComponent(selectedChannel)}`
      : '/api/admin/bans';
    api.get<BanRecord[]>(url).then(setBans).catch(() => {});
  }, [selectedChannel]);

  const filtered = bans.filter(b =>
    !q || b.username.toLowerCase().includes(q.toLowerCase())
  );

  function performerName(b: BanRecord) {
    if (b.performer_display_name) return b.performer_display_name;
    if (b.performer_twitch) return b.performer_twitch;
    if (b.performer_name) return b.performer_name;
    if (b.performed_by === 'AUTO') return 'Авто-модератор';
    if (b.performed_by.includes('@')) return b.performed_by.split('@')[0];
    return b.performed_by;
  }

  return (
    <div>
      <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '4px' }}>Баны</h2>
      <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginBottom: '20px' }}>
        История банов со всех каналов
      </p>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {/* Channel filter */}
        <div style={{ position: 'relative' }}>
          <select value={selectedChannel} onChange={e => setSelectedChannel(e.target.value)}
            style={{
              appearance: 'none', padding: '8px 32px 8px 12px', borderRadius: '10px',
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)',
              color: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer', outline: 'none',
            }}>
            <option value=''>Все каналы</option>
            {channels.map(ch => <option key={ch} value={ch}>{ch}</option>)}
          </select>
          <ChevronDown size={11} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.35)', pointerEvents: 'none' }} />
        </div>

        {/* Search */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 14px', borderRadius: '10px', background: 'rgba(255,255,255,0.025)', flex: 1, maxWidth: '300px' }}>
          <Search size={12} style={{ color: 'rgba(255,255,255,0.35)', flexShrink: 0 }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Поиск по нику..."
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'rgba(255,255,255,0.9)', fontSize: '12px' }} />
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', fontSize: '12px', color: 'rgba(255,255,255,0.3)' }}>
          {filtered.length} записей
        </div>
      </div>

      <div className="glass-card" style={{ overflow: 'hidden' }}>
        {/* Table header */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 160px 140px', gap: '0', padding: '10px 18px', fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.1em', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <span>Забаненный</span>
          <span>Канал</span>
          <span>Кем забанен</span>
          <span>Когда (МСК)</span>
        </div>

        {filtered.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'rgba(255,255,255,0.25)', fontSize: '13px' }}>
            Нет банов
          </div>
        ) : filtered.map(b => (
          <div key={b.id} style={{
            display: 'grid', gridTemplateColumns: '1fr 120px 160px 140px', gap: '0',
            padding: '10px 18px', borderBottom: '1px solid rgba(255,255,255,0.04)',
            alignItems: 'center',
          }}>
            {/* Banned user */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#ff4444', flexShrink: 0 }} />
              <span style={{ fontWeight: 600, fontSize: '13px', color: 'rgba(255,255,255,0.9)' }}>{b.username}</span>
            </div>

            {/* Channel */}
            <span style={{ fontSize: '11px', color: '#ffc800', fontWeight: 600 }}>📺 {b.channel_name}</span>

            {/* Performer */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              {b.performer_avatar ? (
                <img src={b.performer_avatar} alt="" style={{ width: '20px', height: '20px', borderRadius: '50%', flexShrink: 0 }} />
              ) : b.performer_picture ? (
                <img src={b.performer_picture} alt="" style={{ width: '20px', height: '20px', borderRadius: '50%', flexShrink: 0 }} />
              ) : (
                <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: 'rgba(255,255,255,0.07)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', color: 'rgba(255,255,255,0.4)' }}>
                  {performerName(b)[0]?.toUpperCase()}
                </div>
              )}
              <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.75)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {performerName(b)}
              </span>
            </div>

            {/* Time */}
            <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>
              {new Date(b.created_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Confirm Modal
// ============================================================================
function ConfirmModal({ open, title, text, onConfirm, onClose }: {
  open: boolean; title: string; text: string; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(14px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
          <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
            onClick={e => e.stopPropagation()} className="glass-card"
            style={{ padding: '24px', width: '380px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '8px' }}>{title}</h3>
            <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginBottom: '18px' }}>{text}</p>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={{
                padding: '8px 16px', borderRadius: '10px', fontSize: '13px',
                background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.6)', border: 'none', cursor: 'pointer',
              }}>Отмена</button>
              <button onClick={onConfirm} style={{
                padding: '8px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                background: 'rgba(240,71,71,0.18)', color: '#ff7070', border: 'none', cursor: 'pointer',
              }}>Удалить</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
