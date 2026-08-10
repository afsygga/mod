import React, { useEffect, useState } from 'react';
import { Twitch, Check, AlertTriangle, Copy, Lock, KeyRound } from 'lucide-react';
import { motion } from 'framer-motion';

// Токен для стороннего клиента (Chatterino). Implicit-флоу: access-токен приходит
// во фрагмент URL прямо в браузер, на сервер НЕ уходит и НИГДЕ не сохраняется.
const CONNECT_URL = '/backend/api/twitch-oauth/client-connect';

const ERROR_TEXT: Record<string, string> = {
  access_denied: 'Ты отменил авторизацию на Twitch. Нажми кнопку ещё раз, если передумал.',
  redirect_mismatch: 'Redirect URL не зарегистрирован в приложении Twitch. Напиши админу.',
};

export default function ClientLogin() {
  const [token, setToken] = useState('');
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState<'raw' | 'oauth' | ''>('');

  useEffect(() => {
    // Implicit возвращает данные во фрагменте: #access_token=...&scope=...
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const at = hash.get('access_token');
    const error = hash.get('error') || new URLSearchParams(window.location.search).get('error');
    if (at) {
      setToken(at);
      // Убираем токен из адресной строки/истории сразу после чтения.
      window.history.replaceState({}, '', '/client_login');
    } else if (error) {
      setErr(error);
      window.history.replaceState({}, '', '/client_login');
    }
  }, []);

  const copy = (text: string, which: 'raw' | 'oauth') => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(''), 1500);
    }).catch(() => {});
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#050508', padding: '20px' }}>
      <motion.div
        initial={{ scale: 0.96, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        style={{ width: '100%', maxWidth: '460px', padding: '32px', borderRadius: '20px', background: 'rgba(20,20,26,0.66)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '22px' }}>
          <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: 'rgba(145,70,255,0.15)', border: '1px solid rgba(145,70,255,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a070ff' }}>
            <KeyRound size={20} />
          </div>
          <div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: 'rgba(255,255,255,0.95)' }}>Токен для Chatterino</div>
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)' }}>afsyg.gay — вход через Twitch</div>
          </div>
        </div>

        {!token && !err && (
          <>
            <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.65)', lineHeight: 1.6, marginBottom: '18px' }}>
              Один вход через Twitch — и получишь OAuth-токен со всеми модераторскими
              правами, чтобы вставить его в Chatterino. Токен приходит прямо тебе в
              браузер и <b style={{ color: 'rgba(255,255,255,0.85)' }}>нигде не сохраняется</b>.
            </p>
            <a href={CONNECT_URL} style={{ textDecoration: 'none', display: 'block' }}>
              <button style={btn}><Twitch size={16} />Войти через Twitch</button>
            </a>
            <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', marginTop: '12px', textAlign: 'center' }}>
              Отозвать доступ можно в любой момент: Twitch → Настройки → Подключения
            </p>
          </>
        )}

        {token && (
          <>
            <div style={{ padding: '14px 16px', borderRadius: '12px', marginBottom: '14px', background: 'rgba(0,200,120,0.08)', border: '1px solid rgba(0,200,120,0.2)', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Check size={18} style={{ color: '#00c878', flexShrink: 0 }} />
              <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.8)' }}>Готово — токен получен. Скопируй и вставь в Chatterino.</div>
            </div>

            <TokenBox label="OAuth-токен" value={token} copied={copied === 'raw'} onCopy={() => copy(token, 'raw')} />
            <TokenBox label="Для формата oauth: (IRC/чат-клиенты)" value={`oauth:${token}`} copied={copied === 'oauth'} onCopy={() => copy(`oauth:${token}`, 'oauth')} />

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '9px', marginTop: '14px', padding: '12px 14px', borderRadius: '10px', background: 'rgba(255,89,89,0.08)', border: '1px solid rgba(255,89,89,0.2)' }}>
              <Lock size={14} style={{ color: '#ff7070', flexShrink: 0, marginTop: '1px' }} />
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)', lineHeight: 1.55 }}>
                Никому не показывай этот токен — это доступ к твоему аккаунту. Мы его
                не храним. Если утёк — отзови в Twitch → Настройки → Подключения.
              </div>
            </div>
          </>
        )}

        {err && (
          <>
            <div style={{ padding: '16px', borderRadius: '12px', marginBottom: '14px', background: 'rgba(240,71,71,0.08)', border: '1px solid rgba(240,71,71,0.2)', display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
              <AlertTriangle size={18} style={{ color: '#ff7070', flexShrink: 0, marginTop: '1px' }} />
              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.55)', lineHeight: 1.55 }}>
                {ERROR_TEXT[err] || `Ошибка: ${err}`}
              </div>
            </div>
            <a href={CONNECT_URL} style={{ textDecoration: 'none', display: 'block' }}>
              <button style={btn}><Twitch size={16} />Попробовать ещё раз</button>
            </a>
          </>
        )}
      </motion.div>
    </div>
  );
}

function TokenBox({ label, value, copied, onCopy }: { label: string; value: string; copied: boolean; onCopy: () => void }) {
  return (
    <div style={{ marginBottom: '10px' }}>
      <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <input readOnly value={value} onFocus={e => e.currentTarget.select()}
          style={{ flex: 1, minWidth: 0, padding: '9px 12px', borderRadius: '10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.85)', fontSize: '12px', fontFamily: 'monospace', outline: 'none' }} />
        <button onClick={onCopy} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '5px', padding: '9px 12px', borderRadius: '10px', cursor: 'pointer', border: 'none', background: copied ? 'rgba(0,200,120,0.15)' : 'rgba(145,70,255,0.15)', color: copied ? '#00c878' : '#c49dff', fontSize: '12px', fontWeight: 700 }}>
          {copied ? <Check size={13} /> : <Copy size={13} />}{copied ? 'Ок' : 'Копировать'}
        </button>
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  width: '100%', padding: '14px 18px', borderRadius: '12px', cursor: 'pointer',
  background: 'rgba(145,70,255,0.18)', border: '1px solid rgba(145,70,255,0.35)',
  color: '#c49dff', fontSize: '14px', fontWeight: 700,
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
};
