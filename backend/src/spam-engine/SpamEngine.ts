export interface SpamAnalysis {
  score: number;
  reasons: string[];
  similarityPct: number;
}

interface MessageRecord {
  text: string;
  ts: number;
}

interface UserProfile {
  username: string;
  history: MessageRecord[];
}

export interface SpamEngineSettings {
  detectThreshold: number;
  autoMuteThreshold: number;
  similarityThreshold: number;
  burstLimit: number;
  memWindowSeconds: number;
  linkDetection: boolean;
  /**
   * Минимальное количество одинаковых/похожих сообщений до начала реакции.
   */
  triggerAfterN: number;
  /**
   * Список фраз/слов которые НЕ считаются спамом.
   * Сообщение из этих слов (или содержащее их в основном) пропускается.
   */
  whitelistPhrases: string[];
  /** Включить агрессивную нормализацию для anti-evasion */
  antiEvasion: boolean;
}

export const defaultSettings: SpamEngineSettings = {
  detectThreshold: 70,
  autoMuteThreshold: 90,
  similarityThreshold: 75,
  burstLimit: 6,
  memWindowSeconds: 120,
  linkDetection: true,
  triggerAfterN: 1,
  whitelistPhrases: [],
  antiEvasion: true,
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-zа-яё0-9\s]/gi, '').replace(/\s+/g, ' ').trim();
}

/**
 * Aggressive normalization to defeat evasion tricks:
 * 1. Replace leet-speak (3→e, 1→i, 0→o, 4→a, 5→s, 7→t, $→s, @→a)
 * 2. Convert visually similar latin↔cyrillic characters to one form
 * 3. Collapse spaces between letters ("р е к л а м а" → "реклама")
 * 4. Remove non-letter chars (punctuation, emojis, zero-width spaces)
 */
function normalizeAggressive(text: string): string {
  let s = text.toLowerCase();

  // Leet speak substitutions
  const leet: Record<string, string> = {
    '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g',
    '$': 's', '@': 'a', '!': 'i', '|': 'i',
  };
  s = s.split('').map(c => leet[c] || c).join('');

  // Latin → Cyrillic mapping for visually identical letters
  // (handles "vavchеr" where е is cyrillic but rest is latin)
  const latToCyr: Record<string, string> = {
    'a': 'а', 'b': 'в', 'c': 'с', 'e': 'е', 'h': 'н', 'k': 'к',
    'm': 'м', 'o': 'о', 'p': 'р', 't': 'т', 'x': 'х', 'y': 'у',
  };
  // Apply only when message is predominantly cyrillic (heuristic: at least one cyr letter)
  if (/[а-яё]/.test(s)) {
    s = s.split('').map(c => latToCyr[c] || c).join('');
  }

  // Remove zero-width and invisible characters
  s = s.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '');

  // Collapse "р е к л а м а" → "реклама" — single letters separated by spaces/dots
  // If 3+ consecutive single letters separated by separators, join them
  s = s.replace(/(\b[a-zа-яё]\b[\s.\-_*~]+){2,}[a-zа-яё]\b/gi, (match) => {
    return match.replace(/[\s.\-_*~]+/g, '');
  });

  // Remove non-letter (keep letters, digits, spaces)
  s = s.replace(/[^a-zа-яё0-9\s]/gi, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function tokenize(text: string): string[] {
  return normalize(text).split(' ').filter(Boolean);
}

function cosineSimilarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  const allWords = [...new Set([...ta, ...tb])];
  const va = allWords.map(w => ta.filter(x => x === w).length);
  const vb = allWords.map(w => tb.filter(x => x === w).length);
  const dot = va.reduce((s, v, i) => s + v * vb[i], 0);
  const ma = Math.sqrt(va.reduce((s, v) => s + v * v, 0));
  const mb = Math.sqrt(vb.reduce((s, v) => s + v * v, 0));
  if (!ma || !mb) return 0;
  return dot / (ma * mb);
}

// Levenshtein distance
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i-1] === b[j-1]) dp[i][j] = dp[i-1][j-1];
      else dp[i][j] = 1 + Math.min(dp[i-1][j-1], dp[i-1][j], dp[i][j-1]);
    }
  }
  return dp[m][n];
}

// Edit-distance ratio: 1.0 = identical, 0 = completely different
// Falls back to raw text when normalized is empty (e.g. emoji-only messages)
function editRatio(a: string, b: string): number {
  let na = normalize(a);
  let nb = normalize(b);
  if (!na && !nb) {
    // Both messages normalized to empty — compare raw (handles emoji spam)
    na = a.trim();
    nb = b.trim();
  }
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  const maxLen = Math.max(na.length, nb.length);
  const dist = levenshtein(na, nb);
  return 1 - (dist / maxLen);
}

// Detect repeating syllables/chars: кукуку, ааааа, lllll, hahaha
function hasRepetitivePattern(text: string): boolean {
  const t = text.toLowerCase().replace(/\s+/g, '');
  if (t.length < 3) return false;
  if (/(.)\1{2,}/.test(t)) return true;
  if (/(.{2})\1{1,}/.test(t)) return true;
  if (/(.{3})\1{1,}/.test(t)) return true;
  return false;
}

// Get character set — short messages with only 2-3 unique chars are usually spam
function uniqueChars(text: string): number {
  return new Set(normalize(text).replace(/\s/g, '')).size;
}

// Check if one string is contained/prefix of another (for variant detection)
function isContainsOrPrefix(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  return na.includes(nb) || nb.includes(na);
}

// Count messages in last N ms
function countInWindow(history: MessageRecord[], windowMs: number): number {
  const now = Date.now();
  return history.filter(m => now - m.ts < windowMs).length;
}

export class SpamEngine {
  private profiles: Map<string, UserProfile> = new Map();
  public settings: SpamEngineSettings;

  constructor(settings: Partial<SpamEngineSettings> = {}) {
    this.settings = { ...defaultSettings, ...settings };
  }

  updateSettings(settings: Partial<SpamEngineSettings>): void {
    this.settings = { ...this.settings, ...settings };
  }

  analyze(username: string, message: string): SpamAnalysis {
    const now = Date.now();
    const memWindowMs = this.settings.memWindowSeconds * 1000;

    if (!this.profiles.has(username)) {
      this.profiles.set(username, { username, history: [] });
    }
    const profile = this.profiles.get(username)!;

    // Prune
    profile.history = profile.history.filter(m => now - m.ts < memWindowMs);
    profile.history.push({ text: message, ts: now });

    // === WHITELIST CHECK ===
    // If message is dominated by whitelisted phrases/emotes, skip entirely
    if (this.settings.whitelistPhrases.length > 0) {
      const msgNorm = normalize(message);
      const msgLower = message.toLowerCase();
      for (const phrase of this.settings.whitelistPhrases) {
        const p = phrase.toLowerCase().trim();
        if (!p) continue;
        // Exact match
        if (msgNorm === normalize(phrase)) {
          return { score: 0, reasons: [], similarityPct: 0 };
        }
        // Message is the phrase repeated (kreygasm kreygasm kreygasm)
        const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (msgLower.replace(new RegExp(escaped, 'g'), '').trim() === '') {
          return { score: 0, reasons: [], similarityPct: 0 };
        }
      }
    }

    let score = 0;
    const reasons: string[] = [];
    const recent = profile.history.map(m => m.text);
    // Pick normalization: aggressive if anti-evasion enabled
    const normalizeFn = this.settings.antiEvasion ? normalizeAggressive : normalize;
    const normalizedMsg = normalizeFn(message);
    const msgLen = normalizedMsg.length;
    const previousMessages = recent.slice(0, -1); // all except current

    // === ANTI-EVASION DETECTION ===
    // If aggressive normalization differs significantly from basic normalization,
    // user is likely trying to evade detection
    if (this.settings.antiEvasion) {
      const basic = normalize(message);
      const aggressive = normalizeAggressive(message);
      // If aggressive collapsed a lot of structure (e.g. spaced letters)
      if (basic.length > 0 && aggressive.length > 0 && aggressive.length < basic.length * 0.7) {
        score += 25;
        reasons.push('evasion attempt');
      }
      // Detect leet-speak / mixed scripts indicators
      const mixedScript = /[a-z]/i.test(message) && /[а-яё]/i.test(message);
      const hasLeet = /[0134578$@]/.test(message) && /[a-zа-я]/i.test(message);
      if (mixedScript && message.length > 8 && /sk1n|skin|cs2|free|promo|подарок|halyava|халява/i.test(aggressive)) {
        score += 20;
        reasons.push('mixed script promo');
      } else if (hasLeet && message.length > 10) {
        score += 10;
        reasons.push('leet speak');
      }
    }

    // 1. FAST BURST — aggressive on short windows
    const last5s = countInWindow(profile.history, 5_000);
    const last10s = countInWindow(profile.history, 10_000);
    const last30s = countInWindow(profile.history, 30_000);

    if (last5s >= 3) { score += 50; reasons.push(`${last5s} msgs in 5s`); }
    else if (last5s >= 2) { score += 30; reasons.push(`${last5s} msgs in 5s`); }
    else if (last10s >= 4) { score += 35; reasons.push(`${last10s} msgs in 10s`); }
    else if (last10s >= 3) { score += 20; reasons.push(`${last10s} msgs in 10s`); }
    else if (last30s >= 5) { score += 15; reasons.push(`${last30s} msgs in 30s`); }

    // 2. SHORT REPEATED MESSAGES — only flag if pattern is clear
    // Single short words like "да", "нет", "ок" are fine — only flag genuine spam patterns
    if (msgLen > 0 && msgLen <= 6 && previousMessages.length > 0) {
      // Look for actually similar short messages (not just any short message)
      const verySimilarShorts = previousMessages.filter(m => {
        const nm = normalize(m);
        if (nm.length > 8) return false;
        // Identical
        if (nm === normalizedMsg) return true;
        // Strong containment (one fully inside the other) — for кук / кукук
        if (nm.length >= 2 && normalizedMsg.length >= 2) {
          if (nm.includes(normalizedMsg) || normalizedMsg.includes(nm)) return true;
        }
        // High edit-similarity (≥0.7 for short strings = nearly identical)
        return editRatio(m, message) >= 0.7;
      });

      if (verySimilarShorts.length >= 2) {
        score += 45;
        reasons.push('repeated short spam');
      } else if (verySimilarShorts.length >= 1) {
        score += 30;
        reasons.push('short repeat');
      }

      // Only flag low character diversity if message itself looks like spam
      // (repetitive chars like "ааа", "кукуку") AND combined with similar repeats
      const uniq = uniqueChars(message);
      if (uniq <= 2 && msgLen >= 3 && verySimilarShorts.length >= 1) {
        score += 20;
        reasons.push('low character diversity');
      }
    }

    // 3. VARIANT SIMILARITY — кукуку / кукукук / куку
    // Higher threshold for short messages to avoid false positives on normal words
    const variantThreshold = msgLen <= 6 ? 0.8 : 0.6;
    const variantMatches = previousMessages.filter(m => {
      const nm = normalize(m);
      // Only count containment if both are reasonably similar in size
      const containsBoth = isContainsOrPrefix(m, message) &&
        Math.min(nm.length, normalizedMsg.length) >= 3 &&
        Math.abs(nm.length - normalizedMsg.length) <= Math.max(nm.length, normalizedMsg.length) * 0.5;
      return containsBoth || editRatio(m, message) >= variantThreshold;
    }).length;
    if (variantMatches >= 3) { score += 50; reasons.push('repeated variants'); }
    else if (variantMatches >= 2) { score += 30; reasons.push('similar variants'); }
    // Only flag single variant match if it's a clear pattern (longer messages)
    else if (variantMatches >= 1 && msgLen >= 8) { score += 20; reasons.push('similar to previous'); }

    // 4. EXACT DUPLICATES — fallback to raw text comparison for emoji-only msgs
    const exactDups = previousMessages.filter(m => {
      const nm = normalize(m);
      if (normalizedMsg) {
        return nm === normalizedMsg;
      }
      // Current msg has no alphanumerics → must be emoji/symbol-only.
      // Match by raw text similarity instead.
      if (nm) return false;
      return m.trim() === message.trim();
    }).length;
    if (exactDups >= 2) { score += 50; reasons.push('repeated message'); }
    else if (exactDups >= 1) { score += 30; reasons.push('duplicate detected'); }

    // 4b. EMOJI/SYMBOL FLOOD — detect repeating emoji spam even if not exact
    if (!normalizedMsg && message.trim().length > 0) {
      // Count ALL emoji-only messages from this user regardless of which emoji
      const emojiOnlyPrev = previousMessages.filter(m => !normalize(m));
      if (emojiOnlyPrev.length >= 3) { score += 60; reasons.push('emoji flood'); }
      else if (emojiOnlyPrev.length >= 2) { score += 40; reasons.push('emoji flood'); }
      else if (emojiOnlyPrev.length >= 1) {
        // Also check similarity for single previous
        const similar = emojiOnlyPrev.filter(m => editRatio(m, message) >= 0.4).length;
        if (similar >= 1) { score += 30; reasons.push('emoji repeat'); }
      }
    }

    // 4d. ROTATION PATTERN — A→B→A→B bot cycling between messages
    if (normalizedMsg && previousMessages.length >= 2) {
      const histNorms = previousMessages.map(m => normalizeFn(m));
      const matchIdxs = histNorms.reduce<number[]>((acc, nm, i) => {
        if (nm === normalizedMsg || editRatio(previousMessages[i], message) >= 0.8) acc.push(i);
        return acc;
      }, []);
      if (matchIdxs.length >= 1) {
        // Check that there's at least one DIFFERENT message between the first match and now
        const firstMatch = matchIdxs[0];
        const hasDifferentBetween = histNorms.slice(firstMatch + 1).some(
          nm => nm !== normalizedMsg && nm.length > 0 && editRatio(nm, normalizedMsg) < 0.7
        );
        if (hasDifferentBetween) {
          score += matchIdxs.length >= 2 ? 50 : 35;
          reasons.push('rotation pattern');
        }
      }
    }

    // 4c. EMOTE FLOOD — detect Twitch emote spam (words like CamelCase/CAPS tokens, no punctuation)
    // Custom 7TV/BTTV/FFZ emotes are plain text tokens that survive normalize(), so they
    // won't be caught by the emoji path above. We detect them separately.
    const isEmoteOnly = (msg: string) => {
      const trimmed = msg.trim();
      if (!trimmed) return false;
      // Safe regex — no nested quantifiers, no catastrophic backtracking
      if (!/^[A-Za-zА-Яа-яЁё0-9 ]+$/.test(trimmed)) return false;
      return trimmed.split(/\s+/).every(w => /^[A-Z][a-zA-Z0-9]+$/.test(w) || /^[A-Z0-9]{2,}$/.test(w));
    };
    if (isEmoteOnly(message)) {
      const emoteRepeats = previousMessages.filter(m => isEmoteOnly(m) && editRatio(m, message) >= 0.6).length;
      if (emoteRepeats >= 2) { score += 50; reasons.push('emote flood'); }
      else if (emoteRepeats >= 1) { score += 30; reasons.push('emote repeat'); }
    }

    // 5. REGEX — repetitive syllables/chars
    if (hasRepetitivePattern(message)) {
      score += 25;
      reasons.push('repetitive pattern');
      const repetitiveCount = previousMessages.filter(m => hasRepetitivePattern(m)).length;
      if (repetitiveCount >= 2) { score += 20; reasons.push('pattern spam'); }
      else if (repetitiveCount >= 1) { score += 10; }
    }

    // 6. COSINE SIMILARITY
    let maxSim = 0;
    for (const prev of previousMessages) {
      const sim = cosineSimilarity(message, prev);
      if (sim > maxSim) maxSim = sim;
    }
    const simPct = Math.round(maxSim * 100);
    if (simPct >= this.settings.similarityThreshold && previousMessages.length > 0) {
      score += 25;
      reasons.push(`similarity ${simPct}%`);
    } else if (simPct >= 60 && previousMessages.length > 0) {
      score += 10;
      reasons.push(`partial similarity ${simPct}%`);
    }

    // 7. GENERAL BURST (memory window)
    if (recent.length >= this.settings.burstLimit) { score += 20; reasons.push('burst activity'); }

    // 8. PROMOTIONAL INTENT
    const promoWords = ['канал','channel','стрим','stream','подпишись','subscribe','заходи','follow','twitch.tv','смотри','watch','фолловбек','followback'];
    const msgLow = message.toLowerCase();
    const promoCount = promoWords.filter(w => msgLow.includes(w)).length;
    if (promoCount >= 3) { score += 30; reasons.push('promotional intent'); }
    else if (promoCount >= 2) { score += 15; reasons.push('possible promo'); }

    // 9. LINK DETECTION — http://, https://, www., и TLD без протокола (.com, .ru, .net и др.)
    if (this.settings.linkDetection) {
      const linkRegex = /(https?:\/\/|www\.|[\wа-я-]+\.(com|ru|net|org|tv|io|gg|co|app|me|dev|xyz|info|biz|live|link|ly|to|de|ua|by|kz|fr|uk|it|jp|cn|in|onl|club|store|shop|art|news|site|tech))/i;
      if (linkRegex.test(message)) {
        score += 20;
        reasons.push('link detected');
      }
    }

    // 10. ALL-CAPS spam
    const letters = message.replace(/[^a-zа-яё]/gi, '');
    if (letters.length >= 5 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) {
      score += 10;
      reasons.push('all caps');
    }

    // Deduplicate reasons
    const uniqueReasons = [...new Set(reasons)];

    score = Math.min(100, Math.max(0, Math.round(score)));

    // === TRIGGER AFTER N === 
    // If triggerAfterN > 1, require at least N similar messages from this user
    // before any score is returned. This prevents reacting on 1st/2nd repeat.
    if (this.settings.triggerAfterN > 1) {
      const repeatCount = previousMessages.filter(m => {
        // Identical or very similar
        if (normalize(m) === normalizedMsg) return true;
        return editRatio(m, message) >= 0.7;
      }).length + 1; // +1 for the current message

      if (repeatCount < this.settings.triggerAfterN) {
        // Not enough repeats yet — suppress detection
        return { score: 0, reasons: [], similarityPct: simPct };
      }
    }

    return { score, reasons: uniqueReasons, similarityPct: simPct };
  }

  clearUser(username: string): void {
    this.profiles.delete(username);
  }

  clearAll(): void {
    this.profiles.clear();
  }
}
