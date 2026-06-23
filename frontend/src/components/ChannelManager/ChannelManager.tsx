import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, X, Tv2 } from 'lucide-react';
import { Channel } from '../../types';
import { getChannelColor } from '../../utils/colors';
import { api } from '../../hooks/useApi';
import { T, Lang } from '../../utils/i18n';

interface Props {
  channels: Channel[];
  activeChannel: string;
  onSelect: (name: string) => void;
  onAdd: (ch: Channel) => void;
  onRemove: (name: string) => void;
  queueCounts: Record<string, number>;
  lang: Lang;
}

export function ChannelManager({ channels, activeChannel, onSelect, onAdd, onRemove, queueCounts, lang }: Props) {
  const [showModal, setShowModal] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const t = T[lang];

  const statusColor = (s: Channel['status']) => ({ connected: '#00c878', connecting: '#ffc800', disconnected: '#f04747' }[s] || '#f04747');

  const handleAdd = async () => {
    const name = input.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!name) return;
    setLoading(true);
    try {
      const ch = await api.post<Channel>('/api/channels', { name });
      onAdd(ch);
      setInput('');
      setShowModal(false);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const handleRemove = async (name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try { await api.delete(`/api/channels/${name}`); onRemove(name); }
    catch (err) { console.error(err); }
  };

  const itemStyle = (active: boolean, color?: string): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: '10px',
    padding: '9px 11px', borderRadius: '11px', cursor: 'pointer',
    marginBottom: '4px',
    background: active ? 'rgba(255,255,255,0.04)' : 'transparent',
    border: active
      ? `1px solid ${color ? color + '20' : 'rgba(255,200,0,0.12)'}`
      : '1px solid transparent',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '14px 12px' }}>
        <p style={{
          fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.16em', marginBottom: '12px', paddingLeft: '6px',
          color: 'rgba(255,255,255,0.3)',
        }}>{t.channels}</p>

        <div onClick={() => onSelect('all')} style={itemStyle(activeChannel === 'all')}
          onMouseEnter={e => { if (activeChannel !== 'all') e.currentTarget.style.background = 'rgba(255,255,255,0.035)'; }}
          onMouseLeave={e => { if (activeChannel !== 'all') e.currentTarget.style.background = 'transparent'; }}>
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0, background: '#00c878', boxShadow: '0 0 6px #00c878' }} />
          <span style={{ fontSize: '13px', fontWeight: 500, color: activeChannel === 'all' ? '#ffc800' : 'rgba(255,255,255,0.75)' }}>
            {t.allChannels}
          </span>
        </div>

        <AnimatePresence>
          {channels.map((ch, i) => {
            const color = getChannelColor(i);
            const active = activeChannel === ch.name;
            return (
              <motion.div key={ch.name}
                initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}
                onClick={() => onSelect(ch.name)}
                onAuxClick={(e: React.MouseEvent) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    window.open(`https://twitch.tv/${ch.name}`, '_blank', 'noopener,noreferrer');
                  }
                }}
                onMouseDown={(e: React.MouseEvent) => {
                  // Prevent middle-click auto-scroll
                  if (e.button === 1) e.preventDefault();
                }}
                title={`Twitch: twitch.tv/${ch.name} (средняя кнопка мыши)`}
                style={itemStyle(active, color)}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.035)'; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0, background: statusColor(ch.status), boxShadow: `0 0 6px ${statusColor(ch.status)}` }} />
                <Tv2 size={12} style={{ color, flexShrink: 0 }} />
                <span style={{ fontSize: '13px', fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color }}>{ch.name}</span>
                {queueCounts[ch.name] > 0 && (
                  <span style={{
                    fontSize: '10px', padding: '2px 7px', borderRadius: '999px', fontWeight: 700,
                    background: 'rgba(240,71,71,0.18)', color: '#ff7070', border: '1px solid rgba(240,71,71,0.25)',
                  }}>{queueCounts[ch.name]}</span>
                )}
                <button onClick={(e) => handleRemove(ch.name, e)} style={{
                  padding: '3px', borderRadius: '6px', background: 'transparent', border: 'none', cursor: 'pointer',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(240,71,71,0.15)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <X size={11} style={{ color: '#f04747' }} />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>

        <button onClick={() => setShowModal(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: '7px', width: '100%', marginTop: '10px',
            padding: '9px 11px', borderRadius: '11px', fontSize: '12px', fontWeight: 500,
            background: 'transparent', cursor: 'pointer',
            border: '1px dashed rgba(255,200,0,0.28)', color: '#ffc800',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,200,0,0.06)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
          <Plus size={12} />{t.addChannel}
        </button>
      </div>

      {ReactDOM.createPortal(
        <AnimatePresence>
          {showModal && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowModal(false)}
              style={{
                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 9999,
                background: 'rgba(0,0,0,0.55)',
                backdropFilter: 'blur(16px) saturate(140%)',
                WebkitBackdropFilter: 'blur(16px) saturate(140%)',
              }}>
              <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
                onClick={e => e.stopPropagation()}
                className="glass-card"
                style={{ padding: '24px', width: '320px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '14px', color: '#ffc800' }}>{t.addChannel}</h3>
                <input autoFocus value={input} onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAdd()}
                  placeholder={t.addChannelPlaceholder}
                  style={{
                    width: '100%', fontSize: '13px', padding: '10px 12px', borderRadius: '11px',
                    marginBottom: '14px', outline: 'none',
                    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#f0f0ff',
                  }} />
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <button onClick={() => setShowModal(false)} style={{
                    padding: '8px 16px', borderRadius: '11px', fontSize: '13px',
                    background: 'transparent', color: 'rgba(255,255,255,0.55)',
                    border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer',
                  }}>{t.cancel}</button>
                  <button onClick={handleAdd} disabled={loading} style={{
                    padding: '8px 16px', borderRadius: '11px', fontSize: '13px', fontWeight: 600,
                    background: 'rgba(255,200,0,0.18)', color: '#ffc800',
                    border: '1px solid rgba(255,200,0,0.3)', cursor: 'pointer', opacity: loading ? 0.5 : 1,
                  }}>{loading ? t.adding : t.add}</button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}
