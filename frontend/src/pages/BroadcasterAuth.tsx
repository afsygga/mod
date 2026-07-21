import React, { useEffect, useState } from 'react';
import { Twitch, Check, AlertTriangle, Gamepad2, ShieldCheck, RefreshCw, Lock } from 'lucide-react';
import { motion } from 'framer-motion';

// Человеческая расшифровка кодов ошибок broadcaster-callback
const ERROR_TEXT: Record<string, string> = {
  access_denied: 'Ты отменил авторизацию на Twitch. Если передумал — просто нажми кнопку ещё раз.',
  invalid_state: 'Ссылка авторизации устарела (она живёт 10 минут). Нажми кнопку ещё раз.',
  missing_scopes: 'Twitch не выдал нужные права. Попробуй ещё раз и подтверди все запрошенные разрешения.',
  token_exchange_failed: 'Не удалось обменять код авторизации на токен. Попробуй ещё раз.',
  incomplete_tokens: 'Twitch вернул неполный ответ. Попробуй ещё раз.',
  user_fetch_failed: 'Не удалось получить данные твоего аккаунта. Попробуй ещё раз.',
  no_user_data: 'Не удалось получить данные твоего аккаунта. Попробуй ещё раз.',
  persist_failed: 'Не удалось сохранить авторизацию. Попробуй ещё раз.',
  missing_code: 'Twitch не вернул код авторизации. Попробуй ещё раз.',
  not_configured: 'Сервис не настроен. Напиши админу.',
};

const CONNECT_URL = '/backend/api/twitch-oauth/broadcaster-connect';

export default function BroadcasterAuth() {
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [login, setLogin] = useState('');
  const [errCode, setErrCode] = useState('');
  const [errScopes, setErrScopes] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('success')) {
      setStatus('success');
      setLogin(params.get('login') || '');
      window.history.replaceState({}, '', '/broadcaster');
    } else if (params.get('error')) {
      setStatus('error');
      setErrCode(params.get('error') || 'unknown');
      setErrScopes(params.get('scopes') || '');
      window.history.replaceState({}, '', '/broadcaster');
    }
  }, []);

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#050508', padding: '20px',
    }}>
      <motion.div
        initial={{ scale: 0.96, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        style={{
          width: '100%', maxWidth: '440px', padding: '32px', borderRadius: '20px',
          background: 'rgba(20,20,26,0.66)', border: '1px solid rgba(255,255,255,0.07)',
        }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '22px' }}>
          <div style={{
            width: '44px', height: '44px', borderRadius: '12px',
            background: 'rgba(145,70,255,0.15)', border: '1px solid rgba(145,70,255,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a070ff',
          }}>
            <Twitch size={20} />
          </div>
          <div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: 'rgba(255,255,255,0.95)' }}>
              Подключение стримера
            </div>
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)' }}>
              afsyg.gay — система модерации
            </div>
          </div>
        </div>

        {status === 'idle' && (
          <>
            <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.65)', lineHeight: 1.6, marginBottom: '18px' }}>
              Эта страница — для <b style={{ color: 'rgba(255,255,255,0.85)' }}>владельца канала</b>.
              Один вход через Twitch, и модераторы смогут менять категорию стрима
              командой <Code>!g</Code> прямо из чата.
            </p>

            <div style={{
              padding: '14px 16px', borderRadius: '12px', marginBottom: '14px',
              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
            }}>
              <Row icon={<Gamepad2 size={14} style={{ color: '#a070ff' }} />}>
                Бот сможет менять <b>категорию канала</b> по команде модератора
              </Row>
              <Row icon={<ShieldCheck size={14} style={{ color: '#00c878' }} />}>
                Видит только список модераторов — <b>ничего больше</b>
              </Row>
              <Row icon={<RefreshCw size={14} style={{ color: '#ffc800' }} />}>
                Один раз и навсегда: доступ продлевается автоматически
              </Row>
              <Row icon={<Lock size={14} style={{ color: 'rgba(255,255,255,0.45)' }} />} last>
                Нет доступа к паролю, стриму, чату от твоего имени или доходам
              </Row>
            </div>

            <a href={CONNECT_URL} style={{ textDecoration: 'none', display: 'block' }}>
              <button style={btnPurple}>
                <Twitch size={16} />
                Войти через Twitch
              </button>
            </a>

            <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', marginTop: '12px', textAlign: 'center' }}>
              Отозвать доступ можно в любой момент: Twitch → Настройки → Подключения
            </p>
          </>
        )}

        {status === 'success' && (
          <>
            <div style={{
              padding: '16px', borderRadius: '12px', marginBottom: '16px',
              background: 'rgba(0,200,120,0.08)', border: '1px solid rgba(0,200,120,0.2)',
              display: 'flex', alignItems: 'center', gap: '12px',
            }}>
              <Check size={18} style={{ color: '#00c878', flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#00c878' }}>Готово — бот подключен!</div>
                <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginTop: '2px' }}>
                  Канал: <span style={{ color: '#a070ff', fontWeight: 600 }}>{login}</span>
                </div>
              </div>
            </div>

            <div style={{
              padding: '14px 16px', borderRadius: '12px',
              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
            }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: 'rgba(255,255,255,0.8)', marginBottom: '10px' }}>
                Команды в чате (для модераторов):
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', fontSize: '12px', color: 'rgba(255,255,255,0.55)' }}>
                <div><Code>!g Rust</Code> — любая категория (поиск по названию)</div>
                <div><Code>!j</Code> — Just Chatting</div>
                <div><Code>!cs</Code> — Counter-Strike</div>
                <div><Code>!dota</Code> — Dota 2</div>
              </div>
            </div>

            <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', marginTop: '14px', lineHeight: 1.55, textAlign: 'center' }}>
              Больше ничего делать не нужно — доступ продлевается автоматически.
              Эту вкладку можно закрыть.
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <div style={{
              padding: '16px', borderRadius: '12px', marginBottom: '14px',
              background: 'rgba(240,71,71,0.08)', border: '1px solid rgba(240,71,71,0.2)',
              display: 'flex', alignItems: 'flex-start', gap: '12px',
            }}>
              <AlertTriangle size={18} style={{ color: '#ff7070', flexShrink: 0, marginTop: '1px' }} />
              <div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#ff7070' }}>Не получилось</div>
                <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.55)', marginTop: '4px', lineHeight: 1.55 }}>
                  {ERROR_TEXT[errCode] || `Неизвестная ошибка: ${errCode}`}
                  {errCode === 'missing_scopes' && errScopes && (
                    <div style={{ marginTop: '6px', fontFamily: 'monospace', fontSize: '11px', color: 'rgba(255,255,255,0.35)' }}>
                      не хватает: {errScopes}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <a href={CONNECT_URL} style={{ textDecoration: 'none', display: 'block' }}>
              <button style={btnPurple}>
                <Twitch size={16} />
                Попробовать ещё раз
              </button>
            </a>
          </>
        )}
      </motion.div>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontFamily: 'monospace', color: '#c49dff', background: 'rgba(145,70,255,0.12)',
      padding: '1px 6px', borderRadius: '5px', fontSize: '12px',
    }}>{children}</span>
  );
}

function Row({ icon, children, last }: { icon: React.ReactNode; children: React.ReactNode; last?: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: '10px',
      padding: last ? '7px 0 0' : '7px 0',
      borderBottom: last ? 'none' : '1px solid rgba(255,255,255,0.04)',
      fontSize: '12px', color: 'rgba(255,255,255,0.6)', lineHeight: 1.5,
    }}>
      <span style={{ flexShrink: 0, marginTop: '1px' }}>{icon}</span>
      <span>{children}</span>
    </div>
  );
}

const btnPurple: React.CSSProperties = {
  width: '100%', padding: '14px 18px', borderRadius: '12px', cursor: 'pointer',
  background: 'rgba(145,70,255,0.18)', border: '1px solid rgba(145,70,255,0.35)',
  color: '#c49dff', fontSize: '14px', fontWeight: 700,
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
};
