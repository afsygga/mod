import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Twitch, ExternalLink, Check, AlertTriangle, Loader, Trash2 } from 'lucide-react';
import { api } from '../../hooks/useApi';

interface Status {
  twitch_username: string | null;
  has_oauth: boolean;
  oauth_preview?: string | null;
}

interface Props {
  onDone: () => void;
  /** If true, allow closing without setting (for "edit later" mode); default false (onboarding) */
  closeable?: boolean;
  onClose?: () => void;
}

export function TwitchSetup({ onDone, closeable, onClose }: Props) {
  const [status, setStatus] = useState<Status | null>(null);
  const [username, setUsername] = useState('');
  const [oauth, setOauth] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [step, setStep] = useState<'view' | 'form'>('view');

  useEffect(() => {
    api.get<Status>('/api/twitch-creds').then(s => {
      setStatus(s);
      if (s.twitch_username && s.has_oauth) {
        // Already setup — for onboarding, just proceed
        if (!closeable) onDone();
      } else {
        setStep('form');
      }
    }).catch(() => setStep('form'));
  }, [closeable, onDone]);

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      await api.put('/api/twitch-creds', { username: username.trim(), oauth: oauth.trim() });
      onDone();
    } catch (e: any) {
      try {
        const parsed = JSON.parse(e?.message || '{}');
        setErr(parsed.error || 'failed');
        if (parsed.suggested_username && !username) setUsername(parsed.suggested_username);
      } catch {
        setErr(e?.message || 'failed');
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm('Удалить Twitch credentials?')) return;
    await api.delete('/api/twitch-creds').catch(() => {});
    setStatus({ twitch_username: null, has_oauth: false });
    setUsername('');
    setOauth('');
    setStep('form');
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(16px)',
      padding: '20px',
    }}>
      <motion.div
        initial={{ scale: 0.96, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        className="glass-card"
        style={{
          width: '100%', maxWidth: '480px', padding: '32px',
          maxHeight: '90vh', overflowY: 'auto',
        }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <div style={{
            width: '40px', height: '40px', borderRadius: '11px',
            background: 'rgba(145,70,255,0.15)', border: '1px solid rgba(145,70,255,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#a070ff',
          }}>
            <Twitch size={18} />
          </div>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'rgba(255,255,255,0.95)' }}>
              Подключение Twitch
            </h2>
            <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)' }}>
              Свой бот-аккаунт для модерации
            </p>
          </div>
        </div>

        {step === 'view' && status?.has_oauth && (
          <div style={{ marginTop: '20px' }}>
            <div style={{
              padding: '14px 16px', borderRadius: '12px',
              background: 'rgba(0,200,120,0.08)', border: '1px solid rgba(0,200,120,0.2)',
              display: 'flex', alignItems: 'center', gap: '12px',
            }}>
              <Check size={16} style={{ color: '#00c878' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#00c878' }}>
                  Подключен как {status.twitch_username}
                </div>
                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginTop: '2px', fontFamily: 'monospace' }}>
                  {status.oauth_preview}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '14px' }}>
              <button onClick={() => setStep('form')} style={btnPrimary}>
                Изменить
              </button>
              <button onClick={remove} style={btnDanger}>
                <Trash2 size={12} /> Отключить
              </button>
              {closeable && onClose && (
                <button onClick={onClose} style={btnSecondary}>Закрыть</button>
              )}
            </div>
          </div>
        )}

        {step === 'form' && (
          <div style={{ marginTop: '20px' }}>
            {/* OAuth button */}
            <button
              onClick={async () => {
                try {
                  const data = await api.get<{ url: string }>('/api/twitch-oauth/connect-url');
                  window.location.href = data.url;
                } catch (e: any) {
                  setErr('Не удалось получить ссылку Twitch: ' + (e?.message || 'ошибка'));
                }
              }}
              style={{
                width: '100%', padding: '12px 18px', borderRadius: '11px', cursor: 'pointer',
                background: 'rgba(145,70,255,0.15)', border: '1px solid rgba(145,70,255,0.35)',
                color: '#c49dff', fontSize: '13px', fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '9px',
                marginBottom: '14px',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(145,70,255,0.25)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(145,70,255,0.15)')}>
              <Twitch size={15} />
              Войти через Twitch
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.07)' }} />
              <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.25)' }}>или вручную</span>
              <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.07)' }} />
            </div>

            <div style={{
              padding: '12px 14px', borderRadius: '10px',
              background: 'rgba(255,200,0,0.06)', border: '1px solid rgba(255,200,0,0.15)',
              fontSize: '12px', color: 'rgba(255,255,255,0.7)', marginBottom: '18px', lineHeight: 1.55,
            }}>
              💡 Этот аккаунт должен быть модератором на всех каналах, которые ты хочешь модерировать.
            </div>

            <label style={labelStyle}>Twitch username бота</label>
            <input value={username} onChange={e => setUsername(e.target.value)}
              placeholder="например: my_mod_bot"
              style={inputStyle} />

            <label style={{ ...labelStyle, marginTop: '14px' }}>
              OAuth токен
              <a href="https://chatterino.com/client_login" target="_blank" rel="noopener" style={{
                marginLeft: '10px', color: '#a070ff', textDecoration: 'none',
                display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px',
              }}>
                получить токен <ExternalLink size={10} />
              </a>
            </label>
            <input value={oauth} onChange={e => {
              const raw = e.target.value;
              // Auto-extract oauth_token if the user pastes the chatterino-style line
              // like: username=afsqq;user_id=...;client_id=...;oauth_token=abc123;
              const match = raw.match(/oauth_token\s*=\s*([a-z0-9]+)/i);
              if (match) {
                setOauth('oauth:' + match[1]);
                // Also auto-fill username if it's there and current is empty
                const userMatch = raw.match(/(?:^|[;\s])username\s*=\s*([a-z0-9_]+)/i);
                if (userMatch && !username) setUsername(userMatch[1]);
              } else {
                setOauth(raw);
              }
            }}
              placeholder="oauth:xxxxxxxx или username=...;oauth_token=...;"
              style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '12px' }} />

            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginTop: '8px', lineHeight: 1.5 }}>
              1. Залогинься в Twitch под аккаунтом бота<br />
              2. Открой <span style={{ color: '#a070ff' }}>chatterino.com/client_login</span> и скопируй всю строку<br />
              3. Вставь её сюда — токен извлечётся автоматически
            </div>

            {err && (
              <div style={{
                marginTop: '14px', padding: '10px 14px', borderRadius: '10px',
                background: 'rgba(240,71,71,0.1)', border: '1px solid rgba(240,71,71,0.25)',
                color: '#ff7070', fontSize: '12px',
                display: 'flex', alignItems: 'center', gap: '8px',
              }}>
                <AlertTriangle size={14} />
                {err}
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', marginTop: '20px' }}>
              <button onClick={save} disabled={saving || !username || !oauth} style={{
                ...btnPrimary,
                opacity: saving || !username || !oauth ? 0.5 : 1,
              }}>
                {saving ? <Loader size={12} className="animate-spin" /> : <Check size={12} />}
                {saving ? 'Проверка...' : 'Подключить'}
              </button>
              {closeable && onClose && (
                <button onClick={onClose} style={btnSecondary}>Отмена</button>
              )}
              {status?.has_oauth && (
                <button onClick={() => setStep('view')} style={btnSecondary}>Назад</button>
              )}
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '12px', fontWeight: 600,
  color: 'rgba(255,255,255,0.7)', marginBottom: '6px',
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', borderRadius: '11px',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  color: 'rgba(255,255,255,0.9)', fontSize: '13px', outline: 'none',
};

const btnPrimary: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
  padding: '10px 18px', borderRadius: '11px',
  background: 'rgba(145,70,255,0.18)', color: '#a070ff',
  border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
};

const btnSecondary: React.CSSProperties = {
  padding: '10px 16px', borderRadius: '11px',
  background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.6)',
  border: 'none', cursor: 'pointer', fontSize: '12px',
};

const btnDanger: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '6px',
  padding: '10px 14px', borderRadius: '11px',
  background: 'rgba(240,71,71,0.08)', color: '#ff7070',
  border: 'none', cursor: 'pointer', fontSize: '12px',
};
