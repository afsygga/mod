import React, { useEffect } from 'react';
import { motion } from 'framer-motion';

interface Props {
  onComplete: () => void;
  userName?: string;
}

export function SuccessAnimation({ onComplete, userName }: Props) {
  useEffect(() => {
    const t = setTimeout(onComplete, 1700);
    return () => clearTimeout(t);
  }, [onComplete]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'radial-gradient(ellipse at center, rgba(0,200,120,0.06) 0%, rgba(5,5,8,0.95) 60%)',
        backdropFilter: 'blur(20px)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: '20px',
      }}>

      {/* Circle with check */}
      <motion.div
        initial={{ scale: 0, rotate: -90 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 220, damping: 18, delay: 0.1 }}
        style={{
          position: 'relative',
          width: '120px', height: '120px', borderRadius: '50%',
          background: 'rgba(0,200,120,0.08)',
          border: '2px solid rgba(0,200,120,0.4)',
          boxShadow: '0 0 60px rgba(0,200,120,0.3), inset 0 0 30px rgba(0,200,120,0.1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
        <svg width="70" height="70" viewBox="0 0 70 70" fill="none">
          <motion.path
            d="M16 36 L29 49 L54 22"
            stroke="#00c878"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 0.45, ease: [0.4, 0, 0.2, 1], delay: 0.35 }}
            style={{ filter: 'drop-shadow(0 0 6px rgba(0,200,120,0.6))' }}
          />
        </svg>

        {/* Yellow lightning accent — brand colour ring */}
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: [0.8, 1.3, 1.6], opacity: [0, 0.5, 0] }}
          transition={{ duration: 1, delay: 0.3 }}
          style={{
            position: 'absolute', inset: '-6px', borderRadius: '50%',
            border: '2px solid rgba(255,200,0,0.5)',
          }} />
      </motion.div>

      {/* Welcome text */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.6 }}
        style={{ textAlign: 'center' }}>
        <div style={{
          fontSize: '20px', fontWeight: 700,
          color: '#ffc800', letterSpacing: '-0.005em',
          textShadow: '0 0 24px rgba(255,200,0,0.4)',
          marginBottom: '6px',
        }}>
          Добро пожаловать{userName ? `, ${userName}` : ''}
        </div>
        <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
          afsyg.gay
        </div>
      </motion.div>
    </motion.div>
  );
}
