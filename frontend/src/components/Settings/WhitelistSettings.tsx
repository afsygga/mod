import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Tv2 } from 'lucide-react';
import { Channel } from '../../types';
import { api } from '../../hooks/useApi';
import { Lang } from '../../utils/i18n';

interface WLItem { id: number; phrase: string; created_at: string; }

interface Props {
  channels: Channel[];
  lang: Lang;
}

export function WhitelistSettings({ channels, lang }: Props) {
  const [activeChannel, setActiveChannel] = useState<string | null>(channels[0]?.name || null);
  const [items, setItems] = useState<WLItem[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const load = (ch: string) => {
    setLoading(true);
    api.get<WLItem[]>(`/api/whitelist/${ch}`).then(setItems).catch(() => setItems([])).finally(() => setLoading(false));
  };

  useEffect(() => {
    if (activeChannel) load(activeChannel);
  }, [activeChannel]);

  const add = async () => {
    if (!activeChannel || !input.trim()) return;
    await api.post(`/api/whitelist/${activeChannel}`, { phrase: input.trim() }).catch(console.error);
    setInput('');
    load(activeChannel);
  };

  const del = async (id: number) => {
    if (!activeChannel) return;
    await api.delete(`/api/whitelist/${activeChannel}/${id}`).catch(console.error);
    load(activeChannel);
  };

  if (channels.length === 0) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: '12px' }}>
        {lang === 'ru' ? 'Добавьте каналы чтобы настраивать whitelist' : 'Add channels to configure whitelist'}
      </div>
    );
  }

  return (
    <div style={{ padding: '6px 0' }}>
      {/* Channel picker */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', paddingBottom: '14px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        {channels.map(ch => {
          const active = activeChannel === ch.name;
          return (
            <button key={ch.name} onClick={() => setActiveChannel(ch.name)} style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              padding: '6px 11px', borderRadius: '8px', cursor: 'pointer',
              fontSize: '12px', fontWeight: 600,
              background: active ? 'rgba(255,200,0,0.12)' : 'rgba(255,255,255,0.025)',
              color: active ? '#ffc800' : 'rgba(255,255,255,0.55)',
              border: 'none', outline: 'none',
            }}>
              <Tv2 size={10} />
              {ch.name}
            </button>
          );
        })}
      </div>

      {/* Add input */}
      <div style={{ padding: '14px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && add()}
            placeholder={lang === 'ru' ? 'Например: kreygasm или "сегодня стрим"' : 'e.g. kreygasm or "let\'s go"'}
            style={{
              flex: 1, padding: '9px 14px', borderRadius: '10px',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.9)', fontSize: '12px', outline: 'none',
            }} />
          <button onClick={add} disabled={!input.trim() || !activeChannel} style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            padding: '9px 14px', borderRadius: '10px',
            background: 'rgba(255,200,0,0.15)', color: '#ffc800',
            border: 'none', outline: 'none', cursor: 'pointer',
            fontSize: '12px', fontWeight: 600,
            opacity: !input.trim() || !activeChannel ? 0.5 : 1,
          }}>
            <Plus size={12} />{lang === 'ru' ? 'Добавить' : 'Add'}
          </button>
        </div>
        <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', marginTop: '6px' }}>
          {lang === 'ru'
            ? 'Сообщения состоящие из этих фраз НЕ будут флагаться как спам, даже при повторах.'
            : 'Messages made up of these phrases WILL NOT be flagged as spam, even repeated.'}
        </div>
      </div>

      {/* List */}
      <div style={{ paddingTop: '12px' }}>
        {loading ? (
          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '12px', padding: '10px 0' }}>
            {lang === 'ru' ? 'Загрузка...' : 'Loading...'}
          </div>
        ) : items.length === 0 ? (
          <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: '12px', padding: '12px 0', textAlign: 'center' }}>
            {lang === 'ru' ? 'Whitelist пуст' : 'Whitelist empty'}
          </div>
        ) : items.map(item => (
          <div key={item.id} style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.03)',
          }}>
            <div style={{ flex: 1, fontSize: '12px', color: 'rgba(255,255,255,0.85)', fontFamily: 'monospace' }}>
              "{item.phrase}"
            </div>
            <button onClick={() => del(item.id)} style={{
              padding: '5px 8px', borderRadius: '6px', cursor: 'pointer',
              background: 'rgba(240,71,71,0.06)', color: '#ff7070', border: 'none',
              display: 'flex', alignItems: 'center',
            }}>
              <Trash2 size={11} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
