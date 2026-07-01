import React, { useEffect, useState, useMemo } from 'react';
import { Search, Filter, RefreshCw, Tv2, User, AlertTriangle, Ban, Volume2, Trash2, RotateCcw, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ModerationLog } from '../../types';
import { api } from '../../hooks/useApi';
import { T, Lang } from '../../utils/i18n';
import { Footer } from '../Footer/Footer';

const ACTION_STYLES: Record<string, { bg: string; color: string; icon: any; label: string; labelEn: string }> = {
  MUTED:      { bg: 'rgba(255,200,0,0.1)',   color: '#ffc800', icon: Volume2,        label: 'Мут',   labelEn: 'Mute' },
  AUTO_MUTED: { bg: 'rgba(255,152,0,0.12)',  color: '#ff9800', icon: Volume2,        label: 'Авто',  labelEn: 'Auto' },
  BANNED:     { bg: 'rgba(255,89,89,0.12)',  color: '#ff5959', icon: Ban,            label: 'Бан',   labelEn: 'Ban' },
  UNBANNED:   { bg: 'rgba(0,200,120,0.12)',  color: '#00c878', icon: RotateCcw,      label: 'Разбан', labelEn: 'Unban' },
  FLAGGED:    { bg: 'rgba(160,112,255,0.12)',color: '#a070ff', icon: AlertTriangle,  label: 'Флаг',  labelEn: 'Flag' },
};

function actionLabel(action: string, lang: Lang): string {
  const s = ACTION_STYLES[action];
  if (!s) return action;
  return lang === 'ru' ? s.label : s.labelEn;
}

function formatDuration(s: number | null): string {
  if (!s) return '—';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s/60)}m`;
  if (s < 86400) return `${Math.round(s/3600)}h`;
  if (s < 604800) return `${Math.round(s/86400)}d`;
  return `${Math.round(s/604800)}w`;
}

function timeAgo(iso: string, lang: Lang): string {
  const now = Date.now();
  const ts = new Date(iso).getTime();
  const diff = Math.floor((now - ts) / 1000);
  if (lang === 'ru') {
    if (diff < 60) return `${diff}с назад`;
    if (diff < 3600) return `${Math.floor(diff/60)}м назад`;
    if (diff < 86400) return `${Math.floor(diff/3600)}ч назад`;
    return `${Math.floor(diff/86400)}д назад`;
  }
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return `${Math.floor(diff/86400)}d ago`;
}

export function Logs({ lang, liveTick }: { lang: Lang; liveTick?: number }) {
  const [logs, setLogs] = useState<ModerationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | '7d' | '30d'>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ id?: number; all?: boolean } | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const t = T[lang];

  const PAGE_SIZE = 500;

  const loadLogs = async (reset = true) => {
    if (reset) setRefreshing(true);
    else setLoadingMore(true);
    try {
      const offset = reset ? 0 : logs.length;
      const data = await api.get<ModerationLog[]>(`/api/logs?limit=${PAGE_SIZE}&offset=${offset}`);
      if (reset) {
        setLogs(data);
      } else {
        setLogs(prev => [...prev, ...data]);
      }
      setHasMore(data.length === PAGE_SIZE);
    } catch (err) { console.error(err); }
    finally { setLoading(false); setRefreshing(false); setLoadingMore(false); }
  };

  useEffect(() => { loadLogs(true); }, []);

  // Auto-refresh every 10s — only reload first page
  useEffect(() => {
    const i = setInterval(() => loadLogs(true), 10000);
    return () => clearInterval(i);
  }, []);

  // Live refresh when backend broadcasts a moderation action (EventSub)
  useEffect(() => {
    if (liveTick === undefined || liveTick === 0) return;
    loadLogs(true);
  }, [liveTick]);

  const channels = useMemo(() => {
    const set = new Set(logs.map(l => l.channel_name));
    return Array.from(set);
  }, [logs]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const now = Date.now();
    const ranges: Record<string, number> = { today: 86400e3, '7d': 7 * 86400e3, '30d': 30 * 86400e3 };
    return logs.filter(l => {
      if (actionFilter !== 'all' && l.action !== actionFilter) return false;
      if (channelFilter !== 'all' && l.channel_name !== channelFilter) return false;
      if (dateFilter !== 'all') {
        const span = ranges[dateFilter];
        if (now - new Date(l.created_at).getTime() > span) return false;
      }
      if (q && !l.username.toLowerCase().includes(q) && !(l.message || '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [logs, search, actionFilter, channelFilter, dateFilter]);

  // Stats
  const stats = useMemo(() => {
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const dayMs = dayStart.getTime();
    return {
      total: logs.length,
      muted: logs.filter(l => l.action === 'MUTED' || l.action === 'AUTO_MUTED').length,
      banned: logs.filter(l => l.action === 'BANNED').length,
      flagged: logs.filter(l => l.action === 'FLAGGED').length,
      auto: logs.filter(l => l.action === 'AUTO_MUTED').length,
      today: logs.filter(l => new Date(l.created_at).getTime() >= dayMs).length,
    };
  }, [logs]);

  // Shared grid template so header + rows align
  const GRID = '70px 95px 100px 130px 120px 50px minmax(120px,1fr) auto 50px 28px';

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      if (confirmDelete.all) {
        await api.delete('/api/logs');
        setLogs([]);
      } else if (confirmDelete.id) {
        await api.delete(`/api/logs/${confirmDelete.id}`);
        setLogs(prev => prev.filter(l => l.id !== confirmDelete.id));
      }
    } catch (err) { console.error(err); }
    setConfirmDelete(null);
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Stats bar */}
      <div style={{
        display: 'flex', gap: '8px', padding: '14px 18px',
        borderBottom: '1px solid rgba(255,255,255,0.03)',
      }}>
        {[
          { num: stats.total, label: lang === 'ru' ? 'Всего' : 'Total', color: 'rgba(255,255,255,0.9)' },
          { num: stats.muted, label: lang === 'ru' ? 'Муты' : 'Mutes', color: '#a070ff' },
          { num: stats.banned, label: lang === 'ru' ? 'Баны' : 'Bans', color: '#ff7070' },
          { num: stats.flagged, label: lang === 'ru' ? 'Помечено' : 'Flagged', color: '#ffc800' },
          { num: stats.auto, label: lang === 'ru' ? 'Авто' : 'Auto', color: '#ff9800' },
          { num: stats.today, label: lang === 'ru' ? 'За сегодня' : 'Today', color: '#00e5cc' },
        ].map(({ num, label, color }) => (
          <div key={label} style={{
            flex: 1, padding: '9px 14px', borderRadius: '11px',
            background: 'rgba(255,255,255,0.02)',
          }}>
            <div style={{ fontSize: '18px', fontWeight: 700, color, lineHeight: 1 }}>{num}</div>
            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', marginTop: '4px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 18px',
        borderBottom: '1px solid rgba(255,255,255,0.03)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px', flex: 1, maxWidth: '320px',
          padding: '7px 12px', borderRadius: '10px',
          background: 'rgba(255,255,255,0.025)',
        }}>
          <Search size={13} style={{ color: 'rgba(255,255,255,0.4)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={lang === 'ru' ? 'Поиск по нику или сообщению...' : 'Search by user or message...'}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: 'rgba(255,255,255,0.9)', fontSize: '12px',
            }} />
        </div>

        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <Filter size={11} style={{ color: 'rgba(255,255,255,0.3)', marginRight: '4px' }} />
          {['all', 'MUTED', 'AUTO_MUTED', 'BANNED', 'UNBANNED', 'FLAGGED'].map(a => {
            const active = actionFilter === a;
            const style = a === 'all' ? null : ACTION_STYLES[a];
            return (
              <button key={a} onClick={() => setActionFilter(a)} style={{
                padding: '6px 11px', borderRadius: '8px',
                fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                background: active ? (style?.bg || 'rgba(255,255,255,0.06)') : 'transparent',
                color: active ? (style?.color || '#ffffff') : 'rgba(255,255,255,0.45)',
                border: 'none', outline: 'none',
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
                {a === 'all' ? (lang === 'ru' ? 'Все' : 'All') : actionLabel(a, lang)}
              </button>
            );
          })}
        </div>

        {/* Date range filter */}
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          {([
            { key: 'today', ru: 'Сегодня', en: 'Today' },
            { key: '7d', ru: '7 дней', en: '7d' },
            { key: '30d', ru: '30 дней', en: '30d' },
            { key: 'all', ru: 'Всё', en: 'All' },
          ] as const).map(({ key, ru, en }) => {
            const active = dateFilter === key;
            return (
              <button key={key} onClick={() => setDateFilter(key)} style={{
                padding: '6px 11px', borderRadius: '8px',
                fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                background: active ? 'rgba(0,229,204,0.1)' : 'transparent',
                color: active ? '#00e5cc' : 'rgba(255,255,255,0.45)',
                border: 'none', outline: 'none',
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
                {lang === 'ru' ? ru : en}
              </button>
            );
          })}
        </div>

        {channels.length > 1 && (
          <select value={channelFilter} onChange={e => setChannelFilter(e.target.value)}
            style={{
              background: 'rgba(255,255,255,0.025)', border: 'none', outline: 'none',
              color: 'rgba(255,255,255,0.7)', fontSize: '12px',
              padding: '7px 11px', borderRadius: '10px', cursor: 'pointer',
            }}>
            <option value="all">{lang === 'ru' ? 'Все каналы' : 'All channels'}</option>
            {channels.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}

        <button onClick={() => loadLogs(true)} style={{
          padding: '7px 9px', borderRadius: '10px', cursor: 'pointer',
          background: 'rgba(255,255,255,0.025)', border: 'none', outline: 'none',
          display: 'flex', alignItems: 'center',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.025)')}>
          <RefreshCw size={12} style={{
            color: 'rgba(255,255,255,0.55)',
            animation: refreshing ? 'spin 1s linear infinite' : 'none',
          }} />
        </button>

        <button onClick={() => setConfirmDelete({ all: true })} disabled={logs.length === 0} style={{
          padding: '7px 9px', borderRadius: '10px', cursor: logs.length === 0 ? 'default' : 'pointer',
          background: 'rgba(240,71,71,0.08)', border: 'none', outline: 'none',
          display: 'flex', alignItems: 'center', opacity: logs.length === 0 ? 0.4 : 1,
        }} title={lang === 'ru' ? 'Удалить все логи' : 'Clear all logs'}
        onMouseEnter={e => { if (logs.length > 0) e.currentTarget.style.background = 'rgba(240,71,71,0.18)'; }}
        onMouseLeave={e => (e.currentTarget.style.background = 'rgba(240,71,71,0.08)')}>
          <Trash2 size={12} style={{ color: '#ff7070' }} />
        </button>

        <div style={{
          fontSize: '11px', color: 'rgba(255,255,255,0.35)', marginLeft: 'auto',
          padding: '5px 10px', borderRadius: '999px',
          background: 'rgba(255,255,255,0.02)',
        }}>
          {filtered.length} / {logs.length}
        </div>
      </div>

      {/* Logs list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0' }}>
        {/* Sticky header */}
        {!loading && filtered.length > 0 && (
          <div style={{
            position: 'sticky', top: 0, zIndex: 5,
            display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', gap: '12px',
            padding: '9px 18px',
            background: 'rgba(10,10,16,0.95)',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            fontSize: '9px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.3)',
          }}>
            <div style={{ textAlign: 'right' }}>{lang === 'ru' ? 'Время' : 'Time'}</div>
            <div>{lang === 'ru' ? 'Действие' : 'Action'}</div>
            <div>{lang === 'ru' ? 'Канал' : 'Channel'}</div>
            <div>{lang === 'ru' ? 'Польз.' : 'User'}</div>
            <div>{lang === 'ru' ? 'Модератор' : 'Moderator'}</div>
            <div>{lang === 'ru' ? 'Счёт' : 'Score'}</div>
            <div>{lang === 'ru' ? 'Сообщение' : 'Message'}</div>
            <div>{lang === 'ru' ? 'Причины' : 'Reasons'}</div>
            <div>{lang === 'ru' ? 'Длит.' : 'Dur.'}</div>
            <div></div>
          </div>
        )}

        {loading && (
          <div style={{ padding: '40px', textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: '13px' }}>
            {t.loadingLogs}
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div style={{ padding: '60px', textAlign: 'center', color: 'rgba(255,255,255,0.25)', fontSize: '13px' }}>
            {logs.length === 0 ? t.noLogs : (lang === 'ru' ? 'Нет результатов' : 'No results')}
          </div>
        )}

        {filtered.map(log => {
          const style = ACTION_STYLES[log.action] || { bg: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.4)', icon: AlertTriangle, label: log.action, labelEn: log.action };
          const Icon = style.icon;
          const isAuto = log.performed_by === 'AUTO' || log.action === 'AUTO_MUTED';
          const moderator = log.performed_by_display || log.performed_by;
          const absTime = new Date(log.created_at).toLocaleString();
          return (
            <div key={log.id} style={{
              display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', gap: '12px',
              padding: '8px 18px',
              borderBottom: '1px solid rgba(255,255,255,0.025)',
              transition: 'background 0.12s',
              fontSize: '12px',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.015)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>

              {/* Time */}
              <div style={{ textAlign: 'right' }} title={absTime}>
                <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.45)', fontFamily: 'monospace' }}>
                  {new Date(log.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </div>
                <div style={{ fontSize: '8px', color: 'rgba(255,255,255,0.22)' }}>
                  {timeAgo(log.created_at, lang)}
                </div>
              </div>

              {/* Action badge */}
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '5px', justifySelf: 'start',
                padding: '3px 9px', borderRadius: '8px',
                background: style.bg, color: style.color, fontWeight: 700, fontSize: '10px',
                textTransform: 'uppercase', letterSpacing: '0.06em',
              }}>
                <Icon size={10} />
                {lang === 'ru' ? style.label : style.labelEn}
              </div>

              {/* Channel */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                fontSize: '11px', color: '#ffc800', overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                <Tv2 size={10} style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{log.channel_name}</span>
              </div>

              {/* Username */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                fontSize: '12px', fontWeight: 600, color: 'rgba(255,255,255,0.9)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                <User size={10} style={{ color: 'rgba(255,255,255,0.4)', flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{log.username}</span>
              </div>

              {/* Moderator */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                fontSize: '11px', overflow: 'hidden',
              }}>
                {isAuto ? (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: '3px',
                    padding: '2px 7px', borderRadius: '999px',
                    background: 'rgba(255,152,0,0.12)', color: '#ff9800',
                    fontWeight: 700, fontSize: '9px', letterSpacing: '0.06em',
                  }}>
                    <Zap size={9} />
                    {lang === 'ru' ? 'АВТО' : 'AUTO'}
                  </span>
                ) : (
                  <>
                    <User size={10} style={{ color: 'rgba(255,255,255,0.3)', flexShrink: 0 }} />
                    <span style={{ color: 'rgba(255,255,255,0.55)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {moderator}
                    </span>
                  </>
                )}
              </div>

              {/* Score */}
              <div>
                {log.spam_score > 0 ? (
                  <span style={{
                    display: 'inline-block', fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '6px',
                    background: log.spam_score >= 90 ? 'rgba(255,89,89,0.12)' : log.spam_score >= 70 ? 'rgba(255,200,0,0.1)' : 'rgba(255,255,255,0.04)',
                    color: log.spam_score >= 90 ? '#ff5959' : log.spam_score >= 70 ? '#ffc800' : 'rgba(255,255,255,0.5)',
                  }}>
                    {log.spam_score}
                  </span>
                ) : <span style={{ color: 'rgba(255,255,255,0.2)' }}>—</span>}
              </div>

              {/* Message */}
              <div style={{
                fontSize: '11px', color: 'rgba(255,255,255,0.4)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                fontStyle: 'italic',
              }} title={log.message || ''}>
                {log.message || '—'}
              </div>

              {/* Reasons */}
              <div style={{ display: 'flex', gap: '3px', overflow: 'hidden', maxWidth: '220px' }}>
                {log.reasons && log.reasons.length > 0 ? (
                  <>
                    {log.reasons.slice(0, 2).map((r, i) => (
                      <span key={i} style={{
                        fontSize: '9px', padding: '2px 6px', borderRadius: '999px',
                        background: 'rgba(255,89,89,0.08)', color: '#ff7575',
                        whiteSpace: 'nowrap',
                      }}>{r}</span>
                    ))}
                    {log.reasons.length > 2 && (
                      <span style={{ fontSize: '9px', padding: '2px 6px', color: 'rgba(255,255,255,0.4)' }}>
                        +{log.reasons.length - 2}
                      </span>
                    )}
                  </>
                ) : <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: '10px' }}>—</span>}
              </div>

              {/* Duration */}
              <div>
                {log.duration_seconds ? (
                  <span style={{
                    fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.5)',
                    padding: '2px 7px', borderRadius: '6px',
                    background: 'rgba(255,255,255,0.025)',
                  }}>
                    {formatDuration(log.duration_seconds)}
                  </span>
                ) : <span style={{ color: 'rgba(255,255,255,0.2)' }}>—</span>}
              </div>

              {/* Delete */}
              <button onClick={() => setConfirmDelete({ id: log.id })} style={{
                padding: '4px', borderRadius: '6px', background: 'transparent',
                border: 'none', outline: 'none', cursor: 'pointer', opacity: 0.5,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
              onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'rgba(255,89,89,0.15)'; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '0.5'; e.currentTarget.style.background = 'transparent'; }}>
                <Trash2 size={11} style={{ color: '#ff5959' }} />
              </button>
            </div>
          );
        })}

        {hasMore && !loading && (
          <div style={{ padding: '14px', textAlign: 'center' }}>
            <button onClick={() => loadLogs(false)} disabled={loadingMore} style={{
              padding: '8px 18px', borderRadius: '10px', cursor: loadingMore ? 'default' : 'pointer',
              background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.6)',
              border: 'none', outline: 'none', fontSize: '12px', fontWeight: 600,
              opacity: loadingMore ? 0.5 : 1,
            }}>
              {loadingMore
                ? (lang === 'ru' ? 'Загрузка...' : 'Loading...')
                : (lang === 'ru' ? `Загрузить ещё (+${PAGE_SIZE})` : `Load more (+${PAGE_SIZE})`)}
            </button>
          </div>
        )}

        <Footer />
      </div>

      {/* Confirmation modal */}
      <AnimatePresence>
        {confirmDelete && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setConfirmDelete(null)}
            style={{
              position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 100, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(12px)',
            }}>
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="glass-card"
              style={{ padding: '24px', width: '360px' }}>
              <div style={{
                width: '48px', height: '48px', borderRadius: '12px',
                background: 'rgba(240,71,71,0.12)', border: '1px solid rgba(240,71,71,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginBottom: '14px',
              }}>
                <Trash2 size={20} style={{ color: '#ff7070' }} />
              </div>
              <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'rgba(255,255,255,0.95)', marginBottom: '6px' }}>
                {confirmDelete.all
                  ? (lang === 'ru' ? 'Удалить все логи?' : 'Delete all logs?')
                  : (lang === 'ru' ? 'Удалить запись?' : 'Delete entry?')}
              </h3>
              <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginBottom: '18px', lineHeight: 1.5 }}>
                {confirmDelete.all
                  ? (lang === 'ru'
                    ? `Будет удалено ${logs.length} записей. Это действие нельзя отменить.`
                    : `${logs.length} entries will be deleted. This cannot be undone.`)
                  : (lang === 'ru'
                    ? 'Эта запись будет удалена навсегда.'
                    : 'This entry will be permanently deleted.')}
              </p>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button onClick={() => setConfirmDelete(null)} style={{
                  padding: '8px 16px', borderRadius: '10px', fontSize: '13px',
                  background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.6)',
                  border: 'none', outline: 'none', cursor: 'pointer',
                }}>
                  {lang === 'ru' ? 'Отмена' : 'Cancel'}
                </button>
                <button onClick={handleDelete} style={{
                  padding: '8px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                  background: 'rgba(240,71,71,0.18)', color: '#ff7070',
                  border: 'none', outline: 'none', cursor: 'pointer',
                }}>
                  {lang === 'ru' ? 'Удалить' : 'Delete'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
