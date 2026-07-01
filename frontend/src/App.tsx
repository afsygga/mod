import React, { useState, useEffect, useCallback, useRef } from 'react';
import { LayoutDashboard, ScrollText, Settings as SettingsIcon, Globe, Crown, Star, Gem, Shield, LogOut, ShieldCheck, Twitch, Menu, X, BarChart2, Radio } from 'lucide-react';
import { useIsMobile } from './hooks/useIsMobile';
import { Channel, ChatMessage, QueueItem, AppSettings } from './types';
import { ChannelManager } from './components/ChannelManager/ChannelManager';
import { ModerationQueue } from './components/ModerationQueue/ModerationQueue';
import { Settings } from './components/Settings/Settings';
import { Logs } from './components/Logs/Logs';
import { UserCard } from './components/UserCard/UserCard';
import { CommandConsole } from './components/CommandConsole/CommandConsole';
import { LoginPage } from './components/Auth/LoginPage';
import { SuccessAnimation } from './components/Auth/SuccessAnimation';
import { TwitchSetup } from './components/Auth/TwitchSetup';
import { AdminPanel } from './components/Admin/AdminPanel';
import { Analytics } from './components/Analytics/Analytics';
import { useAuth } from './hooks/useAuth';
import { AnimatePresence, motion } from 'framer-motion';
import { useWebSocket } from './hooks/useWebSocket';
import { api } from './hooks/useApi';
import { getUserColor } from './utils/colors';
import { playNotification } from './utils/sound';
import { T, Lang } from './utils/i18n';

type Tab = 'dashboard' | 'logs' | 'settings' | 'admin' | 'analytics' | 'streams';

const ROLE_OPTIONS = [
  { id: 'Broadcaster', icon: Crown, color: '#f04747' },
  { id: 'Mod', icon: Shield, color: '#00c878' },
  { id: 'VIP', icon: Gem, color: '#ffc800' },
  { id: 'Sub', icon: Star, color: '#a070ff' },
];

const DEFAULT_SETTINGS: AppSettings = {
  detect_threshold: 70, auto_mute_threshold: 90, similarity_threshold: 75,
  burst_limit: 6, mem_window_seconds: 120, link_detection: true,
  auto_mode: true, default_mute_duration: 600, set_game_enabled: false,
};

export default function App() {
  const { user, loading, networkError, logout } = useAuth();
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('dashboard');
  const [lang, setLang] = useState<Lang>('en');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeChannel, setActiveChannel] = useState('all');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [autoMode, setAutoMode] = useState(true);
  const [wsStatus, setWsStatus] = useState<'connected' | 'connecting' | 'disconnected'>('connecting');
  const [selectedUser, setSelectedUser] = useState<{ username: string; channel: string; color: string } | null>(null);
  const [streamEventTick, setStreamEventTick] = useState(0);
  const [logEventTick, setLogEventTick] = useState(0);
  const [ignoredRoles, setIgnoredRoles] = useState<string[]>([]);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [twitchSetupOpen, setTwitchSetupOpen] = useState(false);
  const [twitchSetupChecked, setTwitchSetupChecked] = useState(false);
  const [twitchConnected, setTwitchConnected] = useState(
    () => localStorage.getItem('twitch_connected') === 'true'
  );
  const [showSuccess, setShowSuccess] = useState(false);
  const [oauthMsg, setOauthMsg] = useState<string | null>(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('twitch_connected')) {
      window.history.replaceState({}, '', window.location.pathname);
      return `Twitch подключён как @${p.get('twitch_login') || ''}`;
    }
    if (p.get('twitch_error')) {
      window.history.replaceState({}, '', window.location.pathname);
      return `Ошибка: ${p.get('twitch_error')}`;
    }
    return null;
  });
  const prevUserRef = useRef<typeof user>(null);
  const msgIdRef = useRef(0);
  const autoModeRef = useRef(true);
  const t = T[lang];

  useEffect(() => { autoModeRef.current = autoMode; }, [autoMode]);



  useEffect(() => {
    api.get<Channel[]>('/api/channels').then(setChannels).catch(console.error);
    api.get<Record<string, string>>('/api/settings').then(raw => {
      const parsed: AppSettings = {
        detect_threshold: parseInt(raw.detect_threshold ?? '70'),
        auto_mute_threshold: parseInt(raw.auto_mute_threshold ?? '90'),
        similarity_threshold: parseInt(raw.similarity_threshold ?? '75'),
        burst_limit: parseInt(raw.burst_limit ?? '6'),
        mem_window_seconds: parseInt(raw.mem_window_seconds ?? '120'),
        link_detection: raw.link_detection === 'true',
        auto_mode: raw.auto_mode === 'true',
        default_mute_duration: parseInt(raw.default_mute_duration ?? '600'),
        set_game_enabled: raw.set_game_enabled === 'true',
      };
      setSettings(parsed);
      setAutoMode(parsed.auto_mode);
      autoModeRef.current = parsed.auto_mode;
      try {
        const ir = JSON.parse(raw.ignored_roles || '[]');
        if (Array.isArray(ir)) setIgnoredRoles(ir);
      } catch {}
    }).catch(console.error);
  }, []);

  const toggleIgnoredRole = useCallback(async (role: string) => {
    setIgnoredRoles(prev => {
      const next = prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role];
      api.put('/api/settings', { ignored_roles: JSON.stringify(next) }).catch(console.error);
      return next;
    });
  }, []);

  const toggleAutoMode = useCallback(async () => {
    const next = !autoModeRef.current;
    setAutoMode(next);
    autoModeRef.current = next;
    await api.put('/api/settings', { auto_mode: String(next) }).catch(console.error);
  }, []);

  const handleWsMessage = useCallback((data: any) => {
    if (data.type === 'connected') { setWsStatus('connected'); return; }
    if (data.type === 'channel_status') {
      setChannels(prev => prev.map(ch => ch.name === data.channel ? { ...ch, status: data.status } : ch));
      return;
    }
    if (data.type === 'channel_removed') {
      setChannels(prev => prev.filter(ch => ch.name !== data.channel));
      return;
    }
    if (data.type === 'message') {
      // Still track messages for stats, but don't display chat
      const msg: ChatMessage = {
        id: String(msgIdRef.current++), channel: data.channel, username: data.username,
        message: data.message, role: data.role || 'Viewer', score: data.score || 0,
        reasons: data.reasons || [], ts: data.ts || Date.now(), color: getUserColor(data.username),
      };
      // Track messages for stats — keep up to 10000 in memory to avoid leaks
      setMessages(prev => [...prev.slice(-10000), msg]);
      return;
    }
    if (data.type === 'queue_add') {
      const stableId = `q-${data.channel}-${data.username}`;
      setQueue(prev => {
        const exists = prev.find(q => q.id === stableId);
        if (exists) return prev.map(q => q.id === stableId
          ? {
              ...q,
              score: data.score, reasons: data.reasons, lastMsg: data.lastMsg, muted: false,
              spamCount: (q.spamCount || 1) + 1,
            }
          : q);
        // New spammer in queue — play sound
        playNotification();
        const item: QueueItem = {
          id: stableId, channel: data.channel, username: data.username,
          score: data.score, lastMsg: data.lastMsg, reasons: data.reasons,
          color: getUserColor(data.username), muted: false, ts: Date.now(),
          spamCount: 1,
        };
        return [item, ...prev].slice(0, 100);
      });
      return;
    }
    if (data.type === 'user_muted' || data.type === 'user_banned') {
      const stableId = `q-${data.channel}-${data.username}`;
      setQueue(prev => prev.map(q => q.id === stableId ? { ...q, muted: true } : q));
      // Remove after 60 seconds
      setTimeout(() => setQueue(prev => prev.filter(q => q.id !== stableId)), 60000);
      return;
    }
    if (data.type === 'stream_start' || data.type === 'stream_end') {
      setStreamEventTick(t => t + 1);
      return;
    }
    if (data.type === 'mod_action') {
      setLogEventTick(t => t + 1);
      return;
    }
  }, []);

  const { setIdentify } = useWebSocket(handleWsMessage);

  useEffect(() => {
    setIdentify(user ? { type: 'identify', email: user.email, name: user.name, picture: user.picture } : null);
  }, [user, setIdentify]);

  // Detect login transition (null → user) to trigger success animation
  // Only trigger AFTER initial auth check completes (so F5 with existing session doesn't show it)
  const initialLoadDoneRef = useRef(false);
  useEffect(() => {
    if (loading) return;
    if (!initialLoadDoneRef.current) {
      // First time loading finished — snapshot current state, no animation
      initialLoadDoneRef.current = true;
      prevUserRef.current = user;
      return;
    }
    if (!prevUserRef.current && user) {
      setShowSuccess(true);
    }
    prevUserRef.current = user;
  }, [user, loading]);

  // Check Twitch creds on login
  useEffect(() => {
    if (!user) {
      setTwitchSetupChecked(false);
      // Don't reset twitchConnected — keep cached value
      return;
    }

    // If we have a cached "connected" status, show the app immediately
    // while checking in the background
    const cached = localStorage.getItem('twitch_connected') === 'true';
    if (cached) setTwitchSetupChecked(true);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    fetch(`${(import.meta.env.VITE_API_URL || '')}/api/twitch-creds`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}` },
      signal: ctrl.signal,
    })
      .then(r => r.ok ? r.json() : null)
      .then(s => {
        if (s !== null) {
          // Got a real response — update cache and state
          const connected = !!s?.twitch_username && !!s?.has_oauth;
          localStorage.setItem('twitch_connected', String(connected));
          setTwitchConnected(connected);
        }
        // If s === null (server error) — keep cached value, don't change state
        setTwitchSetupChecked(true);
      })
      .catch(() => {
        // Network error / timeout — use cached value, don't show setup modal
        setTwitchSetupChecked(true);
      })
      .finally(() => clearTimeout(timer));
  }, [user]);

  // === AUTH GATES ===
  if (loading) {
    return (
      <div style={{
        height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          width: '28px', height: '28px', borderRadius: '50%',
          border: '2px solid rgba(255,255,255,0.08)',
          borderTop: '2px solid rgba(255,255,255,0.4)',
          animation: 'spin 0.8s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }
  // networkError — do NOT redirect to login, let the main app render with a banner below

  if (!user) {
    return (
      <>
        <LoginPage />
        <AnimatePresence>
          {showSuccess && (
            <SuccessAnimation
              userName={undefined}
              onComplete={() => setShowSuccess(false)}
            />
          )}
        </AnimatePresence>
      </>
    );
  }

  // Force Twitch setup as onboarding step
  if (twitchSetupChecked && !twitchConnected) {
    return (
      <TwitchSetup onDone={() => {
        localStorage.setItem('twitch_connected', 'true');
        setTwitchConnected(true);
      }} />
    );
  }

  if (!twitchSetupChecked) {
    return (
      <div style={{
        height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'rgba(255,255,255,0.4)', fontSize: '13px',
      }}>Проверка Twitch...</div>
    );
  }
  // === /AUTH GATES ===

  const filteredQueue = activeChannel === 'all' ? queue : queue.filter(q => q.channel === activeChannel);

  const queueCounts = channels.reduce((acc, ch) => {
    acc[ch.name] = queue.filter(q => q.channel === ch.name && !q.muted).length;
    return acc;
  }, {} as Record<string, number>);

  const totalActive = queue.filter(q => !q.muted).length;
  const totalMuted = queue.filter(q => q.muted).length;
  const activeMessages = activeChannel === 'all' ? messages : messages.filter(m => m.channel === activeChannel);
  const flagged = messages.filter(m => m.score >= settings.detect_threshold).length;

  const wsColor = { connected: '#00c878', connecting: '#ffc800', disconnected: '#f04747' }[wsStatus];
  const wsLabel = { connected: t.connected, connecting: t.connecting, disconnected: t.disconnected }[wsStatus];

  const tabStyle = (id: string): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: '7px',
    padding: '7px 14px', borderRadius: '10px', fontSize: '13px', fontWeight: 500,
    cursor: 'pointer', border: 'none', outline: 'none',
    background: tab === id ? 'rgba(255,255,255,0.04)' : 'transparent',
    color: tab === id ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.4)',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* Topbar */}
      <div style={{
        height: '56px', display: 'flex', alignItems: 'center',
        padding: isMobile ? '0 12px' : '0 22px',
        gap: isMobile ? '8px' : '14px', flexShrink: 0,
        background: 'rgba(8,8,12,0.55)',
        backdropFilter: 'blur(32px) saturate(180%)',
        WebkitBackdropFilter: 'blur(32px) saturate(180%)',
        borderBottom: '1px solid rgba(255,255,255,0.025)',
        position: 'relative', zIndex: 10,
      }}>
        {/* Hamburger on mobile */}
        {isMobile && (
          <button onClick={() => setSidebarOpen(v => !v)} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '36px', height: '36px', borderRadius: '10px', flexShrink: 0,
            background: 'rgba(255,255,255,0.04)', border: 'none', cursor: 'pointer',
            color: 'rgba(255,255,255,0.7)',
          }}>
            <Menu size={18} />
          </button>
        )}

        <div onClick={() => setTab('dashboard')} title="afsyg.gay" style={{
          display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', flexShrink: 0,
        }}>
          <img src="/lightning.gif" alt=""
            style={{ width: '28px', height: '28px', objectFit: 'contain', filter: 'drop-shadow(0 0 12px rgba(255,200,0,0.4))' }} />
          {!isMobile && (
            <span style={{
              fontWeight: 700, fontSize: '15px', color: '#ffc800',
              letterSpacing: '-0.005em', textShadow: '0 0 28px rgba(255,200,0,0.35)',
            }}>afsyg.gay</span>
          )}
        </div>

        <div style={{ display: 'flex', gap: '4px', flex: 1, marginLeft: isMobile ? '0' : '12px' }}>
          {([
            ['dashboard', t.dashboard, LayoutDashboard],
            ['logs', t.logs, ScrollText],
            ['settings', t.settings, SettingsIcon],
            ...(user.role === 'admin' ? [
              ['analytics', 'Аналитика', BarChart2] as const,
              ['streams', 'Стримы', Radio] as const,
              ['admin', 'Admin', ShieldCheck] as const,
            ] : []),
          ] as const).map(([id, label, Icon]) => (
            <button key={id} onClick={() => setTab(id as Tab)}
              style={{ ...tabStyle(id), padding: isMobile ? '8px 10px' : '7px 14px', gap: isMobile ? '0' : '7px' }}
              onMouseEnter={e => { if (tab !== id) e.currentTarget.style.background = 'rgba(255,255,255,0.025)'; }}
              onMouseLeave={e => { if (tab !== id) e.currentTarget.style.background = 'transparent'; }}>
              <Icon size={14} />
              {!isMobile && label}
              {id === 'dashboard' && totalActive > 0 && (
                <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '999px', background: 'rgba(240,71,71,0.18)', color: '#ff7070', fontWeight: 700 }}>{totalActive}</span>
              )}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '6px' : '8px' }}>
          {!isMobile && (
            <button onClick={() => setLang(l => l === 'en' ? 'ru' : 'en')}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '7px 12px', borderRadius: '10px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                background: 'rgba(255,255,255,0.025)', color: 'rgba(255,255,255,0.55)',
                border: 'none', outline: 'none',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.025)')}>
              <Globe size={12} />{lang === 'en' ? 'RU' : 'EN'}
            </button>
          )}

          {/* WS status dot — always visible */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '7px', height: '7px', borderRadius: '50%',
            background: wsColor, boxShadow: `0 0 6px ${wsColor}`, flexShrink: 0,
          }} title={wsLabel} />

          <button onClick={toggleAutoMode} style={{
            fontSize: '11px', fontWeight: 700,
            padding: isMobile ? '7px 8px' : '7px 13px',
            borderRadius: '10px', cursor: 'pointer',
            background: autoMode ? 'rgba(0,200,120,0.1)' : 'rgba(255,255,255,0.025)',
            color: autoMode ? '#00c878' : 'rgba(255,255,255,0.45)',
            border: 'none', outline: 'none', letterSpacing: '0.03em',
          }}>
            {isMobile ? (autoMode ? '✓' : '○') : (autoMode ? t.autoOn : t.autoOff)}
          </button>

          {/* User menu */}
          <div style={{ position: 'relative' }}>
            <button onClick={() => setUserMenuOpen(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '4px 10px 4px 4px', borderRadius: '999px', cursor: 'pointer',
                background: userMenuOpen ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.025)',
                border: 'none', outline: 'none',
              }}>
              {user.picture ? (
                <img src={user.picture} alt="" style={{ width: 26, height: 26, borderRadius: '50%', objectFit: 'cover' }} />
              ) : (
                <div style={{
                  width: 26, height: 26, borderRadius: '50%',
                  background: 'rgba(255,200,0,0.15)', color: '#ffc800',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '11px', fontWeight: 700,
                }}>{user.email[0]?.toUpperCase()}</div>
              )}
              <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)', fontWeight: 600, maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.name || user.email}
              </span>
            </button>

            <AnimatePresence>
              {userMenuOpen && (
                <>
                  <div onClick={() => setUserMenuOpen(false)}
                    style={{ position: 'fixed', inset: 0, zIndex: 998 }} />
                  <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.96 }}
                    transition={{ duration: 0.15 }}
                    className="glass-card"
                    style={{
                      position: 'absolute', top: 'calc(100% + 8px)', right: 0,
                      minWidth: '240px', padding: '6px', zIndex: 999,
                    }}>
                    <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.05)', marginBottom: '4px' }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>
                        {user.name || user.email}
                      </div>
                      <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginTop: '2px' }}>
                        {user.email}
                      </div>
                      {user.role === 'admin' && (
                        <div style={{
                          display: 'inline-flex', alignItems: 'center', gap: '4px',
                          marginTop: '6px',
                          fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px',
                          background: 'rgba(255,200,0,0.12)', color: '#ffc800',
                        }}>
                          <Crown size={9} /> ADMIN
                        </div>
                      )}
                    </div>
                    <button onClick={() => { setUserMenuOpen(false); setTwitchSetupOpen(true); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '10px',
                        width: '100%', padding: '9px 12px', borderRadius: '8px', cursor: 'pointer',
                        background: 'transparent', color: 'rgba(255,255,255,0.7)',
                        border: 'none', fontSize: '13px', fontWeight: 500, textAlign: 'left',
                        marginBottom: '2px',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(145,70,255,0.08)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <Twitch size={12} style={{ color: '#a070ff' }} />
                      Twitch аккаунт
                    </button>
                    <button onClick={async () => { setUserMenuOpen(false); await logout(); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '10px',
                        width: '100%', padding: '9px 12px', borderRadius: '8px', cursor: 'pointer',
                        background: 'transparent', color: '#ff7070',
                        border: 'none', fontSize: '13px', fontWeight: 500, textAlign: 'left',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(240,71,71,0.08)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <LogOut size={12} />
                      Выйти
                    </button>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Dashboard */}
      {tab === 'dashboard' && (
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
          {/* Sidebar — overlay on mobile, fixed on desktop */}
          {isMobile ? (
            <>
              {/* Backdrop */}
              {sidebarOpen && (
                <div onClick={() => setSidebarOpen(false)} style={{
                  position: 'fixed', inset: 0, zIndex: 40,
                  background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
                }} />
              )}
              {/* Drawer */}
              <div style={{
                position: 'fixed', top: 0, left: 0, bottom: 0,
                width: '280px', zIndex: 50, overflowY: 'auto',
                background: 'rgba(8,8,12,0.96)',
                backdropFilter: 'blur(32px)',
                WebkitBackdropFilter: 'blur(32px)',
                borderRight: '1px solid rgba(255,255,255,0.06)',
                transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
                transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)',
              }}>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)',
                }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#ffc800' }}>afsyg.gay</span>
                  <button onClick={() => setSidebarOpen(false)} style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'rgba(255,255,255,0.5)', display: 'flex', alignItems: 'center',
                  }}>
                    <X size={18} />
                  </button>
                </div>
                <ChannelManager channels={channels} activeChannel={activeChannel}
                  onSelect={name => { setActiveChannel(name); setSidebarOpen(false); }}
                  onAdd={ch => setChannels(prev => [...prev, ch])}
                  onRemove={name => setChannels(prev => prev.filter(c => c.name !== name))}
                  queueCounts={queueCounts} lang={lang} />
              </div>
            </>
          ) : (
            <div style={{
              width: '215px', flexShrink: 0, overflowY: 'auto',
              background: 'rgba(8,8,12,0.4)',
              backdropFilter: 'blur(28px) saturate(170%)',
              WebkitBackdropFilter: 'blur(28px) saturate(170%)',
              borderRight: '1px solid rgba(255,255,255,0.025)',
            }}>
              <ChannelManager channels={channels} activeChannel={activeChannel} onSelect={setActiveChannel}
                onAdd={ch => setChannels(prev => [...prev, ch])}
                onRemove={name => setChannels(prev => prev.filter(c => c.name !== name))}
                queueCounts={queueCounts} lang={lang} />
            </div>
          )}

          {/* Main */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Stats row */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)',
              gap: '8px', padding: isMobile ? '10px 12px' : '14px 18px',
              flexShrink: 0,
              borderBottom: '1px solid rgba(255,255,255,0.04)',
            }}>
              {[
                { num: activeMessages.length, label: t.messages, color: 'rgba(255,255,255,0.85)' },
                { num: flagged, label: t.flagged, color: '#ffc800' },
                { num: totalMuted, label: t.muted, color: '#00c878' },
                { num: channels.length, label: t.channels, color: 'rgba(255,255,255,0.5)' },
              ].map(({ num, label, color }) => (
                <div key={label} style={{
                  padding: isMobile ? '9px 12px' : '11px 16px', borderRadius: '12px',
                  background: 'rgba(255,255,255,0.025)',
                  border: '1px solid rgba(255,255,255,0.05)',
                  backdropFilter: 'blur(20px)',
                }}>
                  <div style={{ fontSize: isMobile ? '18px' : '22px', fontWeight: 700, color, lineHeight: 1 }}>{num}</div>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', marginTop: '4px' }}>{label}</div>
                </div>
              ))}
            </div>

            {/* Trigger threshold bar — only when specific channel selected */}
            {activeChannel !== 'all' && (() => {
              const ch = channels.find(c => c.name === activeChannel);
              if (!ch) return null;
              const current = ch.trigger_after_n || 1;
              const setTrigger = async (n: number) => {
                setChannels(prev => prev.map(c => c.name === activeChannel ? { ...c, trigger_after_n: n } : c));
                await api.patch(`/api/channels/${activeChannel}/trigger`, { trigger_after_n: n }).catch(console.error);
              };
              return (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 18px',
                  flexShrink: 0,
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                }}>
                  <span style={{
                    fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.4)',
                    textTransform: 'uppercase', letterSpacing: '0.12em',
                  }}>
                    {lang === 'ru' ? 'Реагировать с' : 'React after'}:
                  </span>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    {[1, 2, 3, 4, 5, 7, 10].map(n => (
                      <button key={n} onClick={() => setTrigger(n)} style={{
                        padding: '5px 10px', borderRadius: '8px', cursor: 'pointer',
                        fontSize: '11px', fontWeight: 700,
                        background: current === n ? 'rgba(255,200,0,0.15)' : 'rgba(255,255,255,0.025)',
                        color: current === n ? '#ffc800' : 'rgba(255,255,255,0.45)',
                        border: 'none', outline: 'none',
                        minWidth: '32px',
                      }}>
                        ×{n}
                      </button>
                    ))}
                  </div>
                  <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', flex: 1 }}>
                    {current === 1
                      ? (lang === 'ru' ? 'Бот реагирует с первого спам-сообщения' : 'Bot reacts on first spam message')
                      : (lang === 'ru'
                          ? `Бот срабатывает после ${current}-го одинакового сообщения`
                          : `Bot triggers after the ${current}th identical message`)}
                  </span>
                </div>
              );
            })()}

            {/* Ignored Roles bar */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 18px',
              flexShrink: 0,
              borderBottom: '1px solid rgba(255,255,255,0.04)',
            }}>
              <span style={{
                fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.4)',
                textTransform: 'uppercase', letterSpacing: '0.12em',
              }}>
                {lang === 'ru' ? 'Игнорировать роли:' : 'Ignore roles:'}
              </span>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {ROLE_OPTIONS.map(({ id, icon: Icon, color }) => {
                  const active = ignoredRoles.includes(id);
                  return (
                    <button key={id} onClick={() => toggleIgnoredRole(id)} style={{
                      display: 'flex', alignItems: 'center', gap: '5px',
                      padding: '5px 10px', borderRadius: '8px', cursor: 'pointer',
                      fontSize: '11px', fontWeight: 600,
                      background: active ? color + '18' : 'rgba(255,255,255,0.025)',
                      color: active ? color : 'rgba(255,255,255,0.4)',
                      border: 'none', outline: 'none',
                      textDecoration: active ? 'none' : 'line-through',
                      opacity: active ? 1 : 0.6,
                    }}>
                      <Icon size={11} />
                      {id}
                    </button>
                  );
                })}
              </div>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)' }}>
                {ignoredRoles.length > 0
                  ? (lang === 'ru' ? `${ignoredRoles.length} ролей игнорируется` : `${ignoredRoles.length} role(s) ignored`)
                  : (lang === 'ru' ? 'Все роли проверяются' : 'All roles checked')}
              </span>
            </div>

            {/* Moderation Queue takes the whole area now */}
            <ModerationQueue items={filteredQueue}
              onRemove={id => setQueue(prev => prev.filter(q => q.id !== id))}
              onMuted={id => {
                setQueue(prev => prev.map(q => q.id === id ? { ...q, muted: true } : q));
                setTimeout(() => setQueue(prev => prev.filter(q => q.id !== id)), 60000);
              }}
              onClearAll={() => setQueue([])}
              onUserClick={(username, channel, color) => setSelectedUser({ username, channel, color })}
              lang={lang} />
          </div>
        </div>
      )}

      {/* User card modal */}
      <AnimatePresence>
        {selectedUser && (
          <UserCard
            username={selectedUser.username}
            channel={selectedUser.channel}
            color={selectedUser.color}
            messages={messages}
            detectThreshold={settings.detect_threshold}
            onClose={() => setSelectedUser(null)}
            onAction={() => {
              // Mark user as muted in queue
              const stableId = `q-${selectedUser.channel}-${selectedUser.username}`;
              setQueue(prev => prev.map(q => q.id === stableId ? { ...q, muted: true } : q));
              setTimeout(() => setQueue(prev => prev.filter(q => q.id !== stableId)), 60000);
            }}
            lang={lang}
          />
        )}
      </AnimatePresence>

      {tab === 'logs' && (
        <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <span style={{ fontSize: '14px', fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>{t.moderationLogs}</span>
          </div>
          <Logs lang={lang} liveTick={logEventTick} />
        </div>
      )}

      {tab === 'settings' && (
        <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <span style={{ fontSize: '14px', fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>{t.settings}</span>
          </div>
          <Settings settings={settings} channels={channels}
            onSave={s => { setSettings(s); setAutoMode(s.auto_mode); autoModeRef.current = s.auto_mode; }}
            lang={lang} />
        </div>
      )}

      {tab === 'analytics' && user.role === 'admin' && (
        <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
          <Analytics initialSection="mods" streamEventTick={streamEventTick} />
        </div>
      )}

      {tab === 'streams' && user.role === 'admin' && (
        <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
          <Analytics initialSection="streams" streamEventTick={streamEventTick} />
        </div>
      )}

      {tab === 'admin' && user.role === 'admin' && (
        <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
          <AdminPanel />
        </div>
      )}

      {/* Command Console — only on dashboard, not on "all channels" */}
      {tab === 'dashboard' && <CommandConsole channel={activeChannel} lang={lang} />}

      {twitchSetupOpen && (
        <TwitchSetup
          closeable
          onClose={() => setTwitchSetupOpen(false)}
          onDone={() => { setTwitchSetupOpen(false); localStorage.setItem('twitch_connected', 'true'); setTwitchConnected(true); }}
        />
      )}

      <AnimatePresence>
        {showSuccess && (
          <SuccessAnimation
            userName={user.name?.split(' ')[0] || undefined}
            onComplete={() => setShowSuccess(false)}
          />
        )}
      </AnimatePresence>

      {/* Twitch OAuth result toast */}
      <AnimatePresence>
        {oauthMsg && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            style={{
              position: 'fixed', bottom: '28px', left: '50%', transform: 'translateX(-50%)',
              zIndex: 99998, padding: '11px 20px', borderRadius: '12px', whiteSpace: 'nowrap',
              background: oauthMsg.startsWith('Ошибка') ? 'rgba(240,71,71,0.15)' : 'rgba(0,200,120,0.15)',
              border: `1px solid ${oauthMsg.startsWith('Ошибка') ? 'rgba(240,71,71,0.3)' : 'rgba(0,200,120,0.3)'}`,
              color: oauthMsg.startsWith('Ошибка') ? '#ff7070' : '#00c878',
              fontSize: '13px', fontWeight: 600, backdropFilter: 'blur(20px)',
            }}>
            {oauthMsg}
            <button onClick={() => setOauthMsg(null)} style={{ marginLeft: '12px', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', opacity: 0.6, fontSize: '14px' }}>×</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Network error banner */}
      <AnimatePresence>
        {networkError && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            style={{
              position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99997,
              padding: '6px 16px', textAlign: 'center',
              background: 'rgba(240,71,71,0.12)',
              borderBottom: '1px solid rgba(240,71,71,0.2)',
              fontSize: '11px', color: 'rgba(255,120,120,0.9)',
              backdropFilter: 'blur(10px)',
            }}>
            Нет соединения с сервером — переподключение...
          </motion.div>
        )}
      </AnimatePresence>


    </div>
  );
}
