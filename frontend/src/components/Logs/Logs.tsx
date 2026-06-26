import React, { useEffect, useState, useMemo } from 'react';
import { Search, Filter, RefreshCw, Tv2, User, AlertTriangle, Ban, Volume2, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ModerationLog } from '../../types';
import { api } from '../../hooks/useApi';
import { T, Lang } from '../../utils/i18n';
import { Footer } from '../Footer/Footer';

const ACTION_STYLES: Record<string, { bg: string; color: string; icon: any; label: string }> = {
  MUTED:      { bg: 'rgba(140,80,255,0.12)', color: '#a070ff', icon: Volume2,        label: 'Mute' },
  BANNED:     { bg: 'rgba(240,71,71,0.12)',  color: '#ff7070', icon: Ban,            label: 'Ban' },
  AUTO_MUTED: { bg: 'rgba(240,71,71,0.18)',  color: '#ff6060', icon: Volume2,        label: 'Auto' },
  FLAGGED:    { bg: 'rgba(255,200,0,0.1)',   color: '#ffc800', icon: AlertTriangle,  label: 'Flag' },
};

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

export function Logs({ lang }: { lang: Lang }) {
  const [logs, setLogs] = useState<ModerationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [channelFilter, setChannelFilter] = useState<string>('all');
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

  const channels = useMemo(() => {
    const set = new Set(logs.map(l => l.channel_name));
    return Array.from(set);
  }, [logs]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return logs.filter(l => {
      if (actionFilter !== 'all' && l.action !== actionFilter) return false;
      if (channelFilter !== 'all' && l.channel_name !== channelFilter) return false;
      if (q && !l.username.toLowerCase().includes(q) && !(l.message || '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [logs, search, actionFilter, channelFilter]);

  // Stats
  const stats = useMemo(() => ({
    total: logs.length,
    muted: logs.filter(l => l.action === 'MUTED' || l.action === 'AUTO_MUTED').length,
    banned: logs.filter(l => l.action === 'BANNED').length,
    flagged: logs.filter(l => l.action === 'FLAGGED').length,
    auto: logs.filter(l => l.action === 'AUTO_MUTED').length,
  }), [logs]);

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
          { num: stats.auto, label: lang === 'ru' ? 'Авто' : 'Auto', color: '#00c878' },
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
          {['all', 'MUTED', 'BANNED', 'AUTO_MUTED', 'FLAGGED'].map(a => {
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
                {a === 'all' ? (lang === 'ru' ? 'Все' : 'All') : style?.label}
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
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
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
          const style = ACTION_STYLES[log.action] || { bg: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.4)', icon: AlertTriangle, label: log.action };
          const Icon = style.icon;
          const isAuto = log.performed_by === 'AUTO';
          return (
            <div key={log.id} style={{
              display: 'flex', alignItems: 'center', gap: '12px',
              padding: '8px 18px',
              borderBottom: '1px solid rgba(255,255,255,0.025)',
              transition: 'background 0.12s',
              fontSize: '12px',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.015)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>

              {/* Time */}
              <div style={{
                fontSize: '10px', color: 'rgba(255,255,255,0.3)',
                fontFamily: 'monospace', minWidth: '56px', textAlign: 'right',
              }}>
                {new Date(log.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </div>

              {/* Action badge */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '3px 9px', borderRadius: '8px', minWidth: '72px',
                background: style.bg, color: style.color, fontWeight: 700, fontSize: '10px',
                textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0,
              }}>
                <Icon size={10} />
                {style.label}
                {isAuto && <span style={{ fontSize: '8px', opacity: 0.7 }}>•</span>}
              </div>

              {/* Channel */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                fontSize: '11px', color: '#ffc800', minWidth: '90px', flexShrink: 0,
              }}>
                <Tv2 size={10} />
                {log.channel_name}
              </div>

              {/* Username */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                fontSize: '12px', fontWeight: 600, color: 'rgba(255,255,255,0.9)',
                minWidth: '120px', flexShrink: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                <User size={10} style={{ color: 'rgba(255,255,255,0.4)' }} />
                {log.username}
              </div>

              {/* Score */}
              {log.spam_score > 0 && (
                <div style={{
                  fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '6px', flexShrink: 0,
                  background: log.spam_score >= 90 ? 'rgba(240,71,71,0.12)' : log.spam_score >= 70 ? 'rgba(255,200,0,0.1)' : 'rgba(255,255,255,0.04)',
                  color: log.spam_score >= 90 ? '#ff7070' : log.spam_score >= 70 ? '#ffc800' : 'rgba(255,255,255,0.5)',
                }}>
                  {log.spam_score}
                </div>
              )}

              {/* Message */}
              <div style={{
                flex: 1, fontSize: '11px', color: 'rgba(255,255,255,0.4)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                fontStyle: 'italic',
              }}>
                {log.message || '—'}
              </div>

              {/* Reasons */}
              {log.reasons && log.reasons.length > 0 && (
                <div style={{ display: 'flex', gap: '3px', flexShrink: 0, maxWidth: '260px', overflow: 'hidden' }}>
                  {log.reasons.slice(0, 3).map((r, i) => (
                    <span key={i} style={{
                      fontSize: '9px', padding: '2px 6px', borderRadius: '999px',
                      background: 'rgba(240,71,71,0.08)', color: '#ff7575',
                      whiteSpace: 'nowrap',
                    }}>{r}</span>
                  ))}
                  {log.reasons.length > 3 && (
                    <span style={{ fontSize: '9px', padding: '2px 6px', color: 'rgba(255,255,255,0.4)' }}>
                      +{log.reasons.length - 3}
                    </span>
                  )}
                </div>
              )}

              {/* Duration */}
              {log.duration_seconds && (
                <div style={{
                  fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.5)',
                  padding: '2px 7px', borderRadius: '6px', flexShrink: 0,
                  background: 'rgba(255,255,255,0.025)',
                }}>
                  {formatDuration(log.duration_seconds)}
                </div>
              )}

              {/* Ago */}
              <div style={{
                fontSize: '10px', color: 'rgba(255,255,255,0.25)',
                minWidth: '70px', textAlign: 'right', flexShrink: 0,
              }}>
                {timeAgo(log.created_at, lang)}
              </div>

              <button onClick={() => setConfirmDelete({ id: log.id })} style={{
                padding: '4px', borderRadius: '6px', background: 'transparent',
                border: 'none', outline: 'none', cursor: 'pointer', opacity: 0.5,
              }}
              onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'rgba(240,71,71,0.15)'; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '0.5'; e.currentTarget.style.background = 'transparent'; }}>
                <Trash2 size={11} style={{ color: '#ff7070' }} />
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
