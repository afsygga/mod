import React from 'react';
import { Send, Youtube, Twitch } from 'lucide-react';

export function Footer() {
  return (
    <footer style={{
      marginTop: '60px',
      padding: '24px 20px 18px',
      borderTop: '1px solid rgba(255,255,255,0.04)',
      background: 'rgba(5,5,8,0.4)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
    }}>
      <div style={{
        maxWidth: '600px', margin: '0 auto',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
      }}>
        {/* Logo + brand */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          marginBottom: '14px',
        }}>
          <img src="/lightning.gif" alt=""
            style={{ width: '24px', height: '24px', objectFit: 'contain' }} />
          <span style={{
            fontWeight: 800, fontSize: '17px', color: '#ffc800',
            letterSpacing: '-0.005em',
            textShadow: '0 0 18px rgba(255,200,0,0.25)',
          }}>afsyg.gay</span>
        </div>

        {/* Links row — all together */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '14px',
          marginBottom: '12px',
        }}>
          <a href="https://t.me/afsqq" target="_blank" rel="noopener noreferrer"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '5px 11px', borderRadius: '8px',
              background: 'rgba(255,255,255,0.025)',
              color: 'rgba(255,255,255,0.72)',
              textDecoration: 'none', fontSize: '11px', fontWeight: 500,
              transition: 'background 0.18s, color 0.18s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
              e.currentTarget.style.color = 'rgba(255,255,255,0.95)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.025)';
              e.currentTarget.style.color = 'rgba(255,255,255,0.72)';
            }}>
            <Send size={11} />
            t.me/afsqq
          </a>
          <div style={{ width: '1px', height: '14px', background: 'rgba(255,255,255,0.06)' }} />
          <SocialLink href="https://youtube.com/@afsqq" Icon={Youtube} label="YouTube" />
          <SocialLink href="https://twitch.tv/afsqq" Icon={Twitch} label="Twitch" />
        </div>

        {/* Copyright */}
        <div style={{
          fontSize: '10px', color: 'rgba(255,255,255,0.22)',
          letterSpacing: '0.04em',
        }}>
          © 2026 aFsQQ
        </div>
      </div>
    </footer>
  );
}

function SocialLink({ href, Icon, label }: { href: string; Icon: any; label: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      title={label}
      style={{
        width: '26px', height: '26px', borderRadius: '7px',
        background: 'rgba(255,255,255,0.025)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'rgba(255,255,255,0.5)',
        transition: 'background 0.18s, color 0.18s, transform 0.18s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'rgba(255,200,0,0.08)';
        e.currentTarget.style.color = '#ffc800';
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.025)';
        e.currentTarget.style.color = 'rgba(255,255,255,0.5)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}>
      <Icon size={12} />
    </a>
  );
}
