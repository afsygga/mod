import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, Mail, Tv2, Activity, BarChart3, Trash2, Shield, ShieldOff,
  UserPlus, Search, Crown, X, Plus, TrendingUp,
} from 'lucide-react';
import { api } from '../../hooks/useApi';

type Tab = 'overview' | 'users' | 'whitelist' | 'channels' | 'logs';

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
        {tab === 'logs' && <LogsTab />}
      </div>
    </div>
  );
}

// ============================================================================
// Overview / Stats
// ============================================================================
function Overview() {
  const [stats, setStats] = useState<any>(null);
  const [timeline, setTimeline] = useState<any[]>([]);

  useEffect(() => {
    api.get('/api/admin/stats').then(setStats).catch(console.error);
    api.get<any[]>('/api/admin/stats/timeline').then(setTimeline).catch(console.error);
  }, []);

  if (!stats) return <div style={{ color: 'rgba(255,255,255,0.4)' }}>Загрузка статистики...</div>;

  const maxTimeline = Math.max(1, ...timeline.map(t => t.total));

  return (
    <div>
      <h2 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '4px', color: 'rgba(255,255,255,0.95)' }}>Обзор</h2>
      <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginBottom: '24px' }}>Аналитика всей системы</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
        <StatCard num={stats.users.c} label="Пользователи" sub={`${stats.users.active} активны, ${stats.users.admins} админ`} color="#ffc800" />
        <StatCard num={stats.whitelist_count} label="В whitelist" color="#00c878" />
        <StatCard num={stats.channels.c} label="Каналы" sub={`${stats.channels.connected} подключено`} color="#a070ff" />
        <StatCard num={stats.mutes_24h} label="Мутов за 24ч" color="#ff7070" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '24px' }}>
        <StatCard num={stats.total_messages.toLocaleString()} label="Сообщений всего" />
        <StatCard num={stats.messages_24h.toLocaleString()} label="Сообщений за 24ч" />
        <StatCard num={stats.total_logs.toLocaleString()} label="Действий модерации" />
      </div>

      {/* Timeline */}
      <div className="glass-card" style={{ padding: '20px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
          <TrendingUp size={14} style={{ color: '#ffc800' }} />
          <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>Активность за 14 дней</h3>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', height: '120px' }}>
          {timeline.map((t, i) => {
            const h = (t.total / maxTimeline) * 100;
            const sh = (t.spam / maxTimeline) * 100;
            return (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', position: 'relative', height: '100%' }}>
                <div style={{
                  width: '100%', height: `${h}%`, borderRadius: '4px 4px 0 0',
                  background: 'rgba(255,255,255,0.08)', position: 'relative', overflow: 'hidden',
                }}>
                  <div style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0,
                    height: `${maxTimeline > 0 ? (t.spam / t.total) * 100 : 0}%`,
                    background: 'linear-gradient(to top, #ff5959, #ffc800)',
                  }} />
                </div>
                <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.3)', marginTop: '4px', textAlign: 'center' }}>
                  {new Date(t.day).getDate()}.{new Date(t.day).getMonth() + 1}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Top spam users */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
        <div className="glass-card" style={{ padding: '18px' }}>
          <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.85)', marginBottom: '12px' }}>Топ нарушителей</h3>
          {stats.top_users.length === 0 ? (
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: '12px' }}>Нет данных</div>
          ) : stats.top_users.map((u: any) => (
            <div key={u.username + u.channel_name} style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)',
              fontSize: '12px',
            }}>
              <span style={{ fontWeight: 600, color: 'rgba(255,255,255,0.85)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.username}</span>
              <span style={{ color: '#ffc800', fontSize: '11px' }}>📺 {u.channel_name}</span>
              <span style={{ padding: '2px 7px', borderRadius: '6px', background: 'rgba(240,71,71,0.12)', color: '#ff7070', fontSize: '10px', fontWeight: 700 }}>
                {u.mute_count}× muted
              </span>
            </div>
          ))}
        </div>

        <div className="glass-card" style={{ padding: '18px' }}>
          <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.85)', marginBottom: '12px' }}>Топ каналов по спаму</h3>
          {stats.top_channels.length === 0 ? (
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: '12px' }}>Нет данных</div>
          ) : stats.top_channels.map((c: any) => (
            <div key={c.channel_name} style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)',
              fontSize: '12px',
            }}>
              <span style={{ fontWeight: 600, color: '#ffc800', flex: 1 }}>📺 {c.channel_name}</span>
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '11px' }}>{c.msg_count} msgs</span>
              <span style={{ padding: '2px 7px', borderRadius: '6px', background: 'rgba(255,200,0,0.12)', color: '#ffc800', fontSize: '10px', fontWeight: 700 }}>
                {c.spam_count} спам
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Actions breakdown */}
      <div className="glass-card" style={{ padding: '18px' }}>
        <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.85)', marginBottom: '12px' }}>Действия модерации</h3>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {stats.actions.map((a: any) => (
            <div key={a.action} style={{
              padding: '8px 14px', borderRadius: '10px',
              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)',
            }}>
              <div style={{ fontSize: '16px', fontWeight: 700, color: 'rgba(255,255,255,0.9)' }}>{a.c}</div>
              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', marginTop: '2px' }}>{a.action}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ num, label, sub, color }: { num: any; label: string; sub?: string; color?: string }) {
  return (
    <div className="glass-card" style={{ padding: '16px 20px' }}>
      <div style={{ fontSize: '26px', fontWeight: 700, color: color || 'rgba(255,255,255,0.92)', lineHeight: 1 }}>{num}</div>
      <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', marginTop: '6px' }}>{label}</div>
      {sub && <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.25)', marginTop: '3px' }}>{sub}</div>}
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
