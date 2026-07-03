export interface SpamAnalysis {
  score: number;
  reasons: string[];
  similarityPct: number;
}

interface MessageRecord {
  text: string;
  ts: number;
  // Derived forms are computed once at insert: every later analyze() compares
  // against this record, and re-normalizing the whole history per message is
  // what used to make floods CPU-bound
  norm: string;
  aggr: string;
  counts: Map<string, number>;
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

function tokenCounts(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) || 0) + 1);
  return counts;
}

function cosineFromCounts(ca: Map<string, number>, cb: Map<string, number>): number {
  let dot = 0, sa = 0, sb = 0;
  for (const [w, v] of ca) {
    sa += v * v;
    const vb = cb.get(w);
    if (vb) dot += v * vb;
  }
  for (const v of cb.values()) sb += v * v;
  if (!sa || !sb) return 0;
  return dot / (Math.sqrt(sa) * Math.sqrt(sb));
}

function cosineSimilarity(a: string, b: string): number {
  return cosineFromCounts(tokenCounts(tokenize(a)), tokenCounts(tokenize(b)));
}

// Levenshtein distance — two rolling rows instead of a full matrix,
// analyze() calls this against every history entry so allocation matters
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      if (ca === b.charCodeAt(j - 1)) curr[j] = prev[j - 1];
      else curr[j] = 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    const tmp = prev; prev = curr; curr = tmp;
  }
  return prev[n];
}

// Edit-distance ratio: 1.0 = identical, 0 = completely different
// Falls back to raw text when normalized is empty (e.g. emoji-only messages)
function editRatio(a: string, b: string): number {
  return editRatioFromNorm(normalize(a), normalize(b), a, b);
}

// Same as editRatio but takes pre-computed normalized forms
function editRatioFromNorm(na: string, nb: string, a: string, b: string): number {
  if (!na && !nb) {
    // Both messages normalized to empty — compare raw (handles emoji spam)
    na = a.trim();
    nb = b.trim();
  }
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  // Levenshtein is O(len²); wall-of-text spam is identical in its first
  // hundred chars anyway, so cap the compared length
  if (na.length > 120) na = na.slice(0, 120);
  if (nb.length > 120) nb = nb.slice(0, 120);
  if (na === nb) return 1;
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

    // Prune by time, then cap by count: every rule compares against the whole
    // history, so an unbounded flood makes analyze() O(n²) and stalls the event
    // loop for every channel. 50 messages inside the window is already a flood
    // the burst rules catch on their own.
    profile.history = profile.history.filter(m => now - m.ts < memWindowMs);
    const msgBasicNorm = normalize(message);
    const cur: MessageRecord = {
      text: message,
      ts: now,
      norm: msgBasicNorm,
      aggr: normalizeAggressive(message),
      counts: tokenCounts(msgBasicNorm.split(' ').filter(Boolean)),
    };
    profile.history.push(cur);
    if (profile.history.length > 50) {
      profile.history.splice(0, profile.history.length - 50);
    }

    // === WHITELIST CHECK ===
    // If message is dominated by whitelisted phrases/emotes, skip entirely —
    // UNLESS the user is clearly flooding (3+ msgs in 10s): flooding a
    // whitelisted emote is still spam.
    const floodNow = countInWindow(profile.history, 10_000) >= 3;
    if (this.settings.whitelistPhrases.length > 0 && !floodNow) {
      const msgNorm = msgBasicNorm;
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
    const prevRecs = profile.history.slice(0, -1); // all except current
    const recent = profile.history.map(m => m.text);
    const normalizedMsg = this.settings.antiEvasion ? cur.aggr : cur.norm;
    const msgLen = normalizedMsg.length;
    const previousMessages = prevRecs.map(r => r.text);

    // Rules receive raw strings, so bridge them back to the cached record
    // forms; the fallback branches cover strings that aren't history entries
    const normCache = new Map<string, string>();
    const countsCache = new Map<string, Map<string, number>>();
    for (const r of prevRecs) {
      normCache.set(r.text, r.norm);
      countsCache.set(r.text, r.counts);
    }
    const basicNorm = (m: string): string => {
      let v = normCache.get(m);
      if (v === undefined) { v = normalize(m); normCache.set(m, v); }
      return v;
    };

    // Several rules compare the current message against the same history
    // entries — memoize the expensive pairwise metrics for this call
    const editMemo = new Map<string, number>();
    const editVs = (m: string): number => {
      let v = editMemo.get(m);
      if (v === undefined) {
        v = editRatioFromNorm(basicNorm(m), msgBasicNorm, m, message);
        editMemo.set(m, v);
      }
      return v;
    };
    const cosMemo = new Map<string, number>();
    const cosVs = (m: string): number => {
      let v = cosMemo.get(m);
      if (v === undefined) {
        let c = countsCache.get(m);
        if (!c) { c = tokenCounts(tokenize(m)); countsCache.set(m, c); }
        v = cosineFromCounts(c, cur.counts);
        cosMemo.set(m, v);
      }
      return v;
    };

    // === ANTI-EVASION DETECTION ===
    // If aggressive normalization differs significantly from basic normalization,
    // user is likely trying to evade detection
    if (this.settings.antiEvasion) {
      const basic = cur.norm;
      const aggressive = cur.aggr;
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
        const nm = basicNorm(m);
        if (nm.length > 8) return false;
        // Identical
        if (nm === normalizedMsg) return true;
        // Strong containment (one fully inside the other) — for кук / кукук
        if (nm.length >= 2 && normalizedMsg.length >= 2) {
          if (nm.includes(normalizedMsg) || normalizedMsg.includes(nm)) return true;
        }
        // High edit-similarity (≥0.7 for short strings = nearly identical)
        return editVs(m) >= 0.7;
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
      const nm = basicNorm(m);
      // Only count containment if both are reasonably similar in size
      const containsBoth = !!nm && !!msgBasicNorm &&
        (nm.includes(msgBasicNorm) || msgBasicNorm.includes(nm)) &&
        Math.min(nm.length, normalizedMsg.length) >= 3 &&
        Math.abs(nm.length - normalizedMsg.length) <= Math.max(nm.length, normalizedMsg.length) * 0.5;
      return containsBoth || editVs(m) >= variantThreshold;
    }).length;
    if (variantMatches >= 3) { score += 50; reasons.push('repeated variants'); }
    else if (variantMatches >= 2) { score += 30; reasons.push('similar variants'); }
    // Only flag single variant match if it's a clear pattern (longer messages)
    else if (variantMatches >= 1 && msgLen >= 8) { score += 20; reasons.push('similar to previous'); }

    // 4. EXACT DUPLICATES — fallback to raw text comparison for emoji-only msgs
    const exactDups = previousMessages.filter(m => {
      const nm = basicNorm(m);
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
      const emojiOnlyPrev = previousMessages.filter(m => !basicNorm(m));
      if (emojiOnlyPrev.length >= 3) { score += 60; reasons.push('emoji flood'); }
      else if (emojiOnlyPrev.length >= 2) { score += 40; reasons.push('emoji flood'); }
      else if (emojiOnlyPrev.length >= 1) {
        // Also check similarity for single previous
        const similar = emojiOnlyPrev.filter(m => editVs(m) >= 0.4).length;
        if (similar >= 1) { score += 30; reasons.push('emoji repeat'); }
      }
    }

    // 4d. ROTATION PATTERN — A→B→A→B bot cycling between messages
    if (normalizedMsg && previousMessages.length >= 2) {
      const histNorms = prevRecs.map(r => this.settings.antiEvasion ? r.aggr : r.norm);
      const matchIdxs = histNorms.reduce<number[]>((acc, nm, i) => {
        if (nm === normalizedMsg || editVs(previousMessages[i]) >= 0.8) acc.push(i);
        return acc;
      }, []);
      if (matchIdxs.length >= 1) {
        // Check that there's at least one DIFFERENT message between the first match and now
        const firstMatch = matchIdxs[0];
        const normEditMemo = new Map<string, number>();
        const hasDifferentBetween = histNorms.slice(firstMatch + 1).some(nm => {
          if (nm === normalizedMsg || nm.length === 0) return false;
          let v = normEditMemo.get(nm);
          // Both strings are already normalized — pass them through directly
          if (v === undefined) { v = editRatioFromNorm(nm, normalizedMsg, nm, normalizedMsg); normEditMemo.set(nm, v); }
          return v < 0.7;
        });
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
      if (!/^[A-Za-zА-Яа-яЁё0-9 ]+$/.test(trimmed)) return false;
      return trimmed.split(/\s+/).every(w =>
        /^[A-Z][a-zA-Z0-9]+$/.test(w) ||                          // PogChamp, KEKW
        /^[A-Z0-9]{2,}$/.test(w) ||                               // LUL, OMEGALUL
        /^[А-ЯЁ]{2,}$/.test(w) ||                                 // ЧСВ (кириллица капс)
        (/^[a-z][a-zA-Z0-9]{2,}$/.test(w) && /[A-Z]/.test(w))   // stintikGlasses, liliyaPog
      );
    };
    if (isEmoteOnly(message)) {
      const emoteRepeats = previousMessages.filter(m => isEmoteOnly(m) && editVs(m) >= 0.6).length;
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
    let similarCount = 0; // how many previous messages are similar to current
    for (const prev of previousMessages) {
      const sim = cosVs(prev);
      if (sim > maxSim) maxSim = sim;
      if (sim >= 0.5) similarCount++;
    }
    const simPct = Math.round(maxSim * 100);
    if (simPct >= this.settings.similarityThreshold && previousMessages.length > 0) {
      score += 25;
      reasons.push(`similarity ${simPct}%`);
    } else if (simPct >= 60 && previousMessages.length > 0) {
      score += 10;
      reasons.push(`partial similarity ${simPct}%`);
    }
    // Multiple previous messages on the same topic = stronger spam signal
    if (similarCount >= 2) { score += 30; reasons.push('repeated topic'); }
    else if (similarCount >= 1 && previousMessages.length >= 2) { score += 15; reasons.push('repeated topic'); }

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
    // before any score is returned. Repeat matching must be as broad as the
    // scoring itself — "LUL x3" vs "LUL x9" is the same phrase repeated even
    // though edit distance is low.
    if (this.settings.triggerAfterN > 1) {
      const repeatCount = previousMessages.filter(m => {
        if (basicNorm(m) === normalizedMsg) return true;
        if (editVs(m) >= 0.6) return true;
        if (cosVs(m) >= 0.6) return true;
        return false;
      }).length + 1; // +1 for the current message

      // Hard flood bypasses the gate entirely
      if (repeatCount < this.settings.triggerAfterN && !floodNow) {
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
