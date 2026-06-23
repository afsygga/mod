import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Terminal, X, Minimize2, Send, ChevronUp } from 'lucide-react';
import { api } from '../../hooks/useApi';
import { Lang } from '../../utils/i18n';

interface HistoryItem {
  cmd: string;
  result: string;
  ok: boolean;
  ts: number;
}

interface Props {
  channel: string;
  lang: Lang;
}

export function CommandConsole({ channel, lang }: Props) {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [history]);

  useEffect(() => {
    if (open && !minimized) inputRef.current?.focus();
  }, [open, minimized]);

  const sendCommand = async (cmd: string) => {
    if (!cmd.trim()) return;
    setSending(true);
    try {
      const res = await api.post<{ ok: boolean; message?: string }>('/api/moderation/command', { channel, command: cmd.trim() });
      setHistory(prev => [...prev, {
        cmd: cmd.trim(),
        result: res.message || 'OK',
        ok: !!res.ok,
        ts: Date.now(),
      }]);
    } catch (err: any) {
      setHistory(prev => [...prev, {
        cmd: cmd.trim(),
        result: err?.message || 'Error',
        ok: false,
        ts: Date.now(),
      }]);
    } finally {
      setSending(false);
      setInput('');
      setHistoryIdx(-1);
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      sendCommand(input);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const cmds = history.map(h => h.cmd);
      if (cmds.length === 0) return;
      const next = historyIdx === -1 ? cmds.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(next);
      setInput(cmds[next]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIdx === -1) return;
      const cmds = history.map(h => h.cmd);
      const next = historyIdx + 1;
      if (next >= cmds.length) {
        setHistoryIdx(-1);
        setInput('');
      } else {
        setHistoryIdx(next);
        setInput(cmds[next]);
      }
    }
  };

  // Don't show on "all channels"
  if (channel === 'all') return null;

  // Closed state — just a small floating button
  if (!open) {
    return (
      <motion.button
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        onClick={() => setOpen(true)}
        style={{
          position: 'fixed', bottom: '20px', right: '20px',
          width: '44px', height: '44px', borderRadius: '12px',
          background: 'rgba(8,8,12,0.85)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,200,0,0.2)',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#ffc800',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4), 0 0 20px rgba(255,200,0,0.15)',
          zIndex: 50,
        }}
        title={lang === 'ru' ? `Консоль команд: #${channel}` : `Command console: #${channel}`}>
        <Terminal size={18} />
      </motion.button>
    );
  }

  // Minimized
  if (minimized) {
    return (
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        style={{
          position: 'fixed', bottom: '20px', right: '20px',
          width: '200px', height: '36px',
          background: 'rgba(8,8,12,0.85)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: '10px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 10px', zIndex: 50,
          boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
        }}>
        <div onClick={() => setMinimized(false)} style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, cursor: 'pointer' }}>
          <Terminal size={12} style={{ color: '#ffc800' }} />
          <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>#{channel}</span>
        </div>
        <button onClick={() => setOpen(false)} style={{
          padding: '3px', borderRadius: '6px', background: 'transparent', border: 'none', cursor: 'pointer',
        }}>
          <X size={11} style={{ color: 'rgba(255,255,255,0.4)' }} />
        </button>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ scale: 0.95, opacity: 0, y: 10 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      exit={{ scale: 0.95, opacity: 0, y: 10 }}
      transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      style={{
        position: 'fixed', bottom: '20px', right: '20px',
        width: '380px', height: '360px',
        background: 'rgba(8,8,12,0.92)',
        backdropFilter: 'blur(28px) saturate(180%)',
        WebkitBackdropFilter: 'blur(28px) saturate(180%)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '14px',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 20px 48px rgba(0,0,0,0.5), 0 0 40px rgba(255,200,0,0.05)',
        zIndex: 50,
      }}>

      {/* Header */}
      <div style={{
        padding: '10px 14px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        background: 'rgba(255,200,0,0.04)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Terminal size={13} style={{ color: '#ffc800' }} />
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#ffc800' }}>{lang === 'ru' ? 'КОНСОЛЬ' : 'CONSOLE'}</span>
          <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontWeight: 500 }}>#{channel}</span>
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button onClick={() => setMinimized(true)} style={{
            padding: '4px', borderRadius: '6px', background: 'transparent', border: 'none', cursor: 'pointer',
          }} title="Minimize">
            <Minimize2 size={11} style={{ color: 'rgba(255,255,255,0.4)' }} />
          </button>
          <button onClick={() => setOpen(false)} style={{
            padding: '4px', borderRadius: '6px', background: 'transparent', border: 'none', cursor: 'pointer',
          }} title="Close">
            <X size={11} style={{ color: 'rgba(255,255,255,0.4)' }} />
          </button>
        </div>
      </div>

      {/* Output */}
      <div ref={scrollRef} style={{
        flex: 1, overflowY: 'auto', padding: '10px 14px',
        fontFamily: 'monospace', fontSize: '11px', lineHeight: 1.6,
      }}>
        {history.length === 0 && (
          <div style={{ color: 'rgba(255,255,255,0.3)' }}>
            <div style={{ marginBottom: '6px' }}>
              {lang === 'ru' ? '// Введите команду Twitch:' : '// Enter Twitch command:'}
            </div>
            <div style={{ color: 'rgba(255,255,255,0.25)', fontSize: '10px' }}>
              /timeout user 600<br />
              /ban user reason<br />
              /unban user<br />
              /clear<br />
              /slow 30
            </div>
          </div>
        )}
        {history.map((h, i) => (
          <div key={i} style={{ marginBottom: '8px' }}>
            <div style={{ color: '#ffc800', display: 'flex', gap: '6px' }}>
              <span>›</span>
              <span>{h.cmd}</span>
            </div>
            <div style={{ color: h.ok ? '#00c878' : '#ff7070', paddingLeft: '12px' }}>
              {h.result}
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div style={{
        padding: '10px 14px',
        display: 'flex', alignItems: 'center', gap: '8px',
        borderTop: '1px solid rgba(255,255,255,0.05)',
        background: 'rgba(255,255,255,0.02)',
      }}>
        <ChevronUp size={12} style={{ color: '#ffc800', transform: 'rotate(90deg)' }} />
        <input ref={inputRef}
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder={lang === 'ru' ? '/timeout user 600' : '/timeout user 600'}
          disabled={sending}
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            color: 'rgba(255,255,255,0.9)', fontSize: '12px',
            fontFamily: 'monospace',
          }} />
        <button onClick={() => sendCommand(input)} disabled={sending || !input.trim()} style={{
          padding: '5px 10px', borderRadius: '7px',
          background: input.trim() ? 'rgba(255,200,0,0.15)' : 'rgba(255,255,255,0.04)',
          color: input.trim() ? '#ffc800' : 'rgba(255,255,255,0.3)',
          border: 'none', outline: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', fontSize: '10px',
        }}>
          <Send size={10} />
        </button>
      </div>
    </motion.div>
  );
}
