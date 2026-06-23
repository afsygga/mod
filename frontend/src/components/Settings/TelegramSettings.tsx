import React, { useEffect, useState } from 'react';
import { Send, Check, BellOff, Loader, X, AlertTriangle, ExternalLink } from 'lucide-react';
import { api } from '../../hooks/useApi';
import { Lang } from '../../utils/i18n';

interface Status {
  configured: boolean;
  user: {
    chat_id: string | null;
    enabled: boolean;
  };
}

export function TelegramSettings({ lang }: { lang: Lang }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [chatIdInput, setChatIdInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testSent, setTestSent] = useState(false);

  const load = () => api.get<Status>('/api/telegram/status')
    .then(setStatus)
    .catch(() => setStatus({ configured: false, user: { chat_id: null, enabled: false } }));
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.put('/api/telegram/chat-id', { chat_id: chatIdInput.trim() });
      setChatIdInput('');
      await load();
    } catch (err: any) {
      try {
        const parsed = JSON.parse(err?.message || '{}');
        setError(parsed.error || 'failed');
      } catch {
        setError(err?.message || 'failed');
      }
    } finally {
      setSaving(false);
    }
  };

  const toggle = async () => {
    if (!status?.user.chat_id) return;
    setSaving(true);
    try {
      await api.post('/api/telegram/toggle', { enabled: !status.user.enabled });
      await load();
    } catch (err) { console.error(err); }
    finally { setSaving(false); }
  };

  const disconnect = async () => {
    if (!confirm(lang === 'ru' ? 'Отключить Telegram?' : 'Disconnect Telegram?')) return;
    setSaving(true);
    try {
      await api.delete('/api/telegram/chat-id');
      await load();
    } catch (err) { console.error(err); }
    finally { setSaving(false); }
  };

  const test = async () => {
    setSaving(true);
    try {
      await api.post('/api/telegram/test', {});
      setTestSent(true);
      setTimeout(() => setTestSent(false), 3000);
    } catch (err) { console.error(err); }
    finally { setSaving(false); }
  };

  if (!status) return (
    <div style={{ padding: '14px 0', color: 'rgba(255,255,255,0.4)', fontSize: '12px' }}>
      {lang === 'ru' ? 'Проверка...' : 'Checking...'}
    </div>
  );

  if (!status.configured) {
    return (
      <div style={{ padding: '14px 0' }}>
        <div style={{
          padding: '14px 16px', borderRadius: '11px',
          background: 'rgba(255,200,0,0.06)',
          border: '1px solid rgba(255,200,0,0.18)',
          fontSize: '12px', color: 'rgba(255,255,255,0.7)', lineHeight: 1.6,
        }}>
          {lang === 'ru'
            ? 'Telegram бот не настроен администратором. Свяжись с админом для активации.'
            : 'Telegram bot not configured by admin. Contact admin to enable.'}
        </div>
      </div>
    );
  }

  const connected = !!status.user.chat_id;

  return (
    <div style={{ padding: '6px 0' }}>
      {!connected && (
        <>
          {/* Connect chat_id */}
          <div style={{
            padding: '14px 16px', borderRadius: '11px',
            background: 'rgba(126,170,255,0.05)',
            border: '1px solid rgba(126,170,255,0.18)',
            marginBottom: '14px',
          }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(255,255,255,0.88)', marginBottom: '10px' }}>
              {lang === 'ru' ? 'Как подключить:' : 'How to connect:'}
            </div>
            <ol style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)', marginBottom: 0, paddingLeft: '20px', lineHeight: 1.7 }}>
              <li>
                {lang === 'ru' ? 'Открой в Telegram ' : 'Open in Telegram '}
                <a href="https://t.me/userinfobot" target="_blank" rel="noopener" style={{ color: '#7eaaff', textDecoration: 'none' }}>
                  @userinfobot <ExternalLink size={9} style={{ display: 'inline', verticalAlign: 'baseline' }} />
                </a>
                {lang === 'ru' ? ' → нажми Start → получишь свой ' : ' → press Start → get your '}
                <code style={{ background: 'rgba(255,255,255,0.05)', padding: '1px 5px', borderRadius: '4px' }}>chat id</code>
              </li>
              <li>
                {lang === 'ru' ? 'Найди нашего бота (спроси у админа username) и напиши ему ' : 'Find our bot (ask admin for username) and send '}
                <code style={{ background: 'rgba(255,255,255,0.05)', padding: '1px 5px', borderRadius: '4px' }}>/start</code>
              </li>
              <li>{lang === 'ru' ? 'Введи свой chat id сюда:' : 'Enter your chat id here:'}</li>
            </ol>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <input value={chatIdInput} onChange={e => setChatIdInput(e.target.value)}
              placeholder={lang === 'ru' ? 'Например: 123456789' : 'e.g. 123456789'}
              style={{
                flex: 1, padding: '10px 14px', borderRadius: '10px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: 'rgba(255,255,255,0.9)', fontSize: '13px',
                fontFamily: 'monospace', outline: 'none',
              }} />
            <button onClick={save} disabled={saving || !chatIdInput.trim()} style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '10px 18px', borderRadius: '10px',
              background: 'rgba(126,170,255,0.15)', color: '#7eaaff',
              border: 'none', outline: 'none', cursor: 'pointer',
              fontSize: '12px', fontWeight: 600,
              opacity: saving || !chatIdInput.trim() ? 0.5 : 1,
            }}>
              {saving ? <Loader size={12} className="animate-spin" /> : <Send size={12} />}
              {lang === 'ru' ? 'Подключить' : 'Connect'}
            </button>
          </div>

          {error && (
            <div style={{
              marginTop: '10px', padding: '8px 12px', borderRadius: '8px',
              background: 'rgba(240,71,71,0.1)',
              border: '1px solid rgba(240,71,71,0.25)',
              color: '#ff7070', fontSize: '12px',
              display: 'flex', alignItems: 'center', gap: '8px',
            }}>
              <AlertTriangle size={13} />
              {error}
            </div>
          )}
        </>
      )}

      {connected && (
        <>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.05)',
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Send size={13} style={{ color: '#7eaaff' }} />
                <span style={{ fontSize: '13px', fontWeight: 500, color: 'rgba(255,255,255,0.88)' }}>
                  {lang === 'ru' ? 'Telegram подключён' : 'Telegram connected'}
                </span>
                <span style={{
                  padding: '2px 7px', borderRadius: '6px',
                  background: 'rgba(0,200,120,0.12)', color: '#00c878',
                  fontSize: '10px', fontWeight: 700, fontFamily: 'monospace',
                }}>{status.user.chat_id}</span>
              </div>
              <div style={{ fontSize: '11px', marginTop: '4px', color: 'rgba(255,255,255,0.4)' }}>
                {lang === 'ru'
                  ? 'Бот сообщит когда спамер попадёт в очередь твоих каналов'
                  : 'Bot alerts when spammer enters queue of your channels'}
              </div>
            </div>
            <button onClick={toggle} disabled={saving}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '8px 14px', borderRadius: '10px', cursor: saving ? 'default' : 'pointer',
                background: status.user.enabled ? 'rgba(0,200,120,0.12)' : 'rgba(255,255,255,0.025)',
                color: status.user.enabled ? '#00c878' : 'rgba(255,255,255,0.5)',
                border: 'none', outline: 'none', fontSize: '12px', fontWeight: 700,
                opacity: saving ? 0.5 : 1,
              }}>
              {status.user.enabled ? <Check size={12} /> : <BellOff size={12} />}
              {status.user.enabled ? 'ON' : 'OFF'}
            </button>
          </div>

          <div style={{ padding: '14px 0', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button onClick={test} disabled={saving}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '8px 14px', borderRadius: '10px', cursor: saving ? 'default' : 'pointer',
                background: testSent ? 'rgba(0,200,120,0.12)' : 'rgba(126,170,255,0.1)',
                color: testSent ? '#00c878' : '#7eaaff',
                border: 'none', outline: 'none', fontSize: '12px', fontWeight: 600,
              }}>
              {testSent ? <Check size={12} /> : <Send size={12} />}
              {testSent
                ? (lang === 'ru' ? 'Отправлено' : 'Sent')
                : (lang === 'ru' ? 'Отправить тестовое' : 'Send test')}
            </button>
            <button onClick={disconnect} disabled={saving}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '8px 14px', borderRadius: '10px', cursor: saving ? 'default' : 'pointer',
                background: 'rgba(240,71,71,0.08)', color: '#ff7070',
                border: 'none', outline: 'none', fontSize: '12px', fontWeight: 600,
              }}>
              <X size={12} />
              {lang === 'ru' ? 'Отключить' : 'Disconnect'}
            </button>
          </div>

          <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', lineHeight: 1.6 }}>
            {lang === 'ru'
              ? <>В Telegram доступно: <code>/stats /recent /on /off /mute /ban /help</code></>
              : <>In Telegram: <code>/stats /recent /on /off /mute /ban /help</code></>}
          </div>
        </>
      )}
    </div>
  );
}
