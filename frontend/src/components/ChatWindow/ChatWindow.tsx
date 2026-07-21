import React, { useEffect, useRef } from 'react';
import { ChatMessage } from '../../types';
import { getInitials, formatTime } from '../../utils/colors';
import { Lang } from '../../utils/i18n';
import { ChatterName } from '../common/ChatterName';

interface Props {
  messages: ChatMessage[];
  activeChannel: string;
  detectThreshold: number;
  lang: Lang;
}

const ROLE_STYLES: Record<string, { bg: string; color: string }> = {
  Mod:         { bg: 'rgba(0,200,120,0.15)',  color: '#00c878' },
  Sub:         { bg: 'rgba(140,80,255,0.15)', color: '#8c50ff' },
  VIP:         { bg: 'rgba(255,200,0,0.15)',  color: '#ffc800' },
  Broadcaster: { bg: 'rgba(240,71,71,0.15)',  color: '#f04747' },
};

export function ChatWindow({ messages, activeChannel, detectThreshold, lang }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  useEffect(() => {
    if (autoScrollRef.current) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    autoScrollRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 60;
  };

  const visible = activeChannel === 'all' ? messages : messages.filter(m => m.channel === activeChannel);

  return (
    <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-2 py-1">
      {visible.slice(-200).map(msg => {
        const isSpam = msg.score >= detectThreshold;
        const isSuspicious = msg.score >= 50 && !isSpam;
        const roleStyle = ROLE_STYLES[msg.role];
        return (
          <div key={msg.id}
            className="flex items-start gap-2 px-3 py-1.5 rounded-xl mb-0.5 transition-all group"
            style={{
              background: isSpam ? 'rgba(240,71,71,0.08)' : isSuspicious ? 'rgba(255,200,0,0.05)' : 'transparent',
              borderLeft: isSpam ? '2px solid rgba(240,71,71,0.5)' : isSuspicious ? '2px solid rgba(255,200,0,0.4)' : '2px solid transparent',
            }}>
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5"
              style={{ background: msg.color + '22', color: msg.color, border: `1px solid ${msg.color}33` }}>
              {getInitials(msg.username)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                {activeChannel === 'all' && (
                  <span className="text-xs px-1.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)' }}>{msg.channel}</span>
                )}
                <span className="text-xs font-semibold" style={{ color: msg.color }}><ChatterName channel={msg.channel} name={msg.username}>{msg.username}</ChatterName></span>
                {msg.role !== 'Viewer' && roleStyle && (
                  <span className="text-xs px-1.5 py-0 rounded-lg font-semibold" style={{ background: roleStyle.bg, color: roleStyle.color }}>{msg.role}</span>
                )}
                <span className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>{formatTime(msg.ts)}</span>
                {msg.score > 30 && (
                  <span className="text-xs px-1 rounded font-bold" style={{
                    background: isSpam ? 'rgba(240,71,71,0.2)' : 'rgba(255,200,0,0.15)',
                    color: isSpam ? '#f04747' : '#ffc800'
                  }}>{msg.score}</span>
                )}
              </div>
              <div className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.85)' }}>{msg.message}</div>
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
