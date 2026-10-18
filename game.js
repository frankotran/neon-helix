'use strict';
/* ============================================================
   NEON HELIX v1 — helix-drop + color-match arcade
   $0 challenge #4. Zero assets: procedural neon + WebAudio.
   Ad architecture: Ads.* has ADMOB swap points; web build
   simulates placements so every flow is testable.
   ============================================================ */

const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const norm = a => { a %= TAU; if (a > Math.PI) a -= TAU; if (a < -Math.PI) a += TAU; return a; };
const fmtTime = s => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const angDist = (a, b) => Math.abs(norm(a - b));
const inArc = (ang, a0, a1) => { // is ang inside [a0,a1] going CCW (all normalized)
  ang = norm(ang); a0 = norm(a0); a1 = norm(a1);
  if (a0 <= a1) return ang >= a0 && ang <= a1;
  return ang >= a0 || ang <= a1;
};

/* ---------------- Audio (procedural WebAudio) ---------------- */
const Sfx = {
  ctx: null, master: null, muted: false, padTimer: 0,
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
    } catch (e) { /* no audio */ }
  },
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.5; },
  tone(freq, dur, type, vol, slideTo) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol || 0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  },
  noise(dur, vol) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = this.ctx.createBufferSource(); s.buffer = buf;
    const g = this.ctx.createGain(); g.gain.value = vol || 0.4;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t);
  },
  bounce(streak) { this.tone(280 + Math.min(streak, 12) * 35, 0.09, 'sine', 0.3); },
  coin() { this.tone(950, 0.07, 'sine', 0.22); setTimeout(() => this.tone(1420, 0.1, 'sine', 0.22), 60); },
  repaint() { this.tone(420, 0.18, 'sawtooth', 0.12, 980); },
  perfect() { [660, 880, 1320].forEach((f, i) => setTimeout(() => this.tone(f, 0.09, 'triangle', 0.2), i * 55)); },
  shatter() { this.noise(0.35, 0.5); this.tone(160, 0.3, 'square', 0.25, 50); },
  win() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.16, 'triangle', 0.25), i * 110)); },
  click() { this.tone(700, 0.05, 'square', 0.12); },
  revive() { this.tone(300, 0.4, 'sine', 0.25, 900); },
  fever() { [523, 659, 784, 1046, 1318].forEach((f, i) => setTimeout(() => this.tone(f, 0.14, 'square', 0.16), i * 70)); },
  power() { this.tone(500, 0.12, 'triangle', 0.2, 1500); setTimeout(() => this.tone(750, 0.12, 'triangle', 0.2, 2000), 90); },
  pad() { // soft ambient chord, called periodically
    if (!this.ctx || this.muted) return;
    [110, 138.6, 164.8].forEach(f => this.tone(f, 3.2, 'sine', 0.035));
  }
};

/* ---------------- Save ---------------- */
const SAVE_KEY = 'neonhelix_save_v1';
const Save = {
  data: null,
  defaults() {
    return {
      coins: 0, unlocked: 1,
      best: { endless: 0, rush: 0, sudden: 0, dual: 0, levels: {} },
      bestRows: { endless: 0, sudden: 0, dual: 0, daily: {} }, // ghost markers
      balls: { owned: ['orb'], sel: 'orb' },
      trails: { owned: ['none'], sel: 'none' },
      themes: { owned: ['midnight'], sel: 'midnight' },
      muted: false, runs: 0,
      missions: null, // 3 active: [{id, progress}]
      daily: { last: '', streak: 0, best: {}, plays: 0 }, // best: {YYYY-MM-DD: score}
      // v7
      login: { last: '', streak: 0, claimed: '', freeze: 0, frozenDays: [] },
      xp: 0, coinsEarned: 0,
      trophies: [], // trophy ids
      boost: null, // pending rewarded run starter: 'shield' | 'magnet'
      symbols: false, // color-blind symbol mode
      shieldSaves: 0,
      // v8
      stats: null, // {runs, rows, perfects, repaints, playTime, fevers}
      // v9
      skipTokens: 0 // consumable 👻 skip tokens
    };
  },
  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      this.data = raw ? Object.assign(this.defaults(), JSON.parse(raw)) : this.defaults();
    } catch (e) { this.data = this.defaults(); }
    return this.data;
  },
  save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.data)); } catch (e) {} }
};

/* ---------------- Seeded RNG (Daily Drop: same tower for everyone) ---------------- */
let SRNG = null; // when set, sr()/sri()/srp() draw from it instead of Math.random
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const sr = (a, b) => SRNG ? SRNG() * (b - a) + a : rand(a, b);
const sri = (a, b) => Math.floor(sr(a, b + 1));
const srp = p => (SRNG ? SRNG() : Math.random()) < p;
const dayStr = (d) => { d = d || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

/* ---------------- Missions ---------------- */
const MISSIONS = [
  { id: 'perfect8', desc: 'Thread 8 PERFECT gaps in one run', target: 8, reward: 60, ev: 'perfect' },
  { id: 'repaint5', desc: 'Repaint 5× in one run', target: 5, reward: 50, ev: 'repaint' },
  { id: 'coins30', desc: 'Collect 30 coins in one run', target: 30, reward: 70, ev: 'coin' },
  { id: 'rush1500', desc: 'Score 1,500 in one RUSH run', target: 1500, reward: 80, ev: 'score', mode: 'rush', max: true },
  { id: 'fever2', desc: 'Trigger FEVER twice in one run', target: 2, reward: 60, ev: 'fever' },
  { id: 'endless25', desc: 'Pass 25 rows in one ENDLESS run', target: 25, reward: 60, ev: 'row', mode: 'endless', max: true },
  { id: 'combo10', desc: 'Reach a x10 combo', target: 10, reward: 50, ev: 'combo', max: true },
  { id: 'shield1', desc: 'Grab a shield powerup', target: 1, reward: 40, ev: 'shield' },
  { id: 'daily3', desc: 'Play 3 Daily Drops', target: 3, reward: 100, ev: 'daily', cumul: true }
];
function missionDef(id) { return MISSIONS.find(d => d.id === id); }
function ensureMissions() {
  if (!Save.data.missions || !Array.isArray(Save.data.missions) || Save.data.missions.length !== 3) {
    const pool = MISSIONS.map(m => m.id);
    Save.data.missions = [];
    for (let i = 0; i < 3; i++) {
      const id = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      Save.data.missions.push({ id, progress: 0 });
    }
    Save.save();
  }
}
// ev: mission event name. val: for max-type, the running value. mode: override playMode check.
function missionEv(ev, val, mode) {
  ensureMissions();
  for (const m of Save.data.missions) {
    const def = missionDef(m.id);
    if (!def || def.ev !== ev) continue;
    if (def.mode && def.mode !== (mode || Game.playMode)) continue;
    let prog;
    if (def.cumul) { m.progress = Math.min(def.target, (m.progress || 0) + 1); prog = m.progress; }
    else {
      Game.mRun = Game.mRun || {};
      Game.mRun[m.id] = def.max ? Math.max(Game.mRun[m.id] || 0, val || 0) : (Game.mRun[m.id] || 0) + 1;
      prog = Game.mRun[m.id];
    }
    if (prog >= def.target && !m._awarded) {
      m._awarded = true;
      Save.data.coins += def.reward;
      Save.save();
      toast('🎯 MISSION: ' + def.desc + '  +' + def.reward + '🪙');
      Sfx.win();
      for (let i = 0; i < 40; i++) burst(rand(0, Game.W), rand(0, Game.H * 0.5), '#ffd700', 20);
      updateHUD();
      // deal a replacement mission
      setTimeout(() => {
        const active = new Set(Save.data.missions.map(x => x.id));
        const pool = MISSIONS.map(d => d.id).filter(id => !active.has(id));
        m.id = pool[Math.floor(Math.random() * pool.length)];
        m.progress = 0; m._awarded = false;
        Save.save();
        if (Game.mode === 'menu') refreshMenu();
      }, 2500);
    }
  }
}

/* ---------------- v8: zones / stats ---------------- */
const ZONES = [
  { name: 'NEON DEPTHS', tint: '#0a0a2e' },
  { name: 'ABYSS', tint: '#06303a' },
  { name: 'EMBER FIELDS', tint: '#3d1030' },
  { name: 'VOID', tint: '#1c0a24' }
];
function ensureStats() {
  if (!Save.data.stats) {
    Save.data.stats = { runs: 0, rows: 0, perfects: 0, repaints: 0, playTime: 0, fevers: 0 };
    Save.save();
  }
  return Save.data.stats;
}
function stat(k, n) {
  const s = ensureStats();
  s[k] = (s[k] || 0) + (n === undefined ? 1 : n);
}

/* ---------------- Haptics ---------------- */
function buzz(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }

/* ---------------- v7: ranks / trophies / login ---------------- */
const RANKS = [
  { xp: 0, name: 'ROOKIE' },
  { xp: 500, name: 'SPINNER' },
  { xp: 1500, name: 'THREADER' },
  { xp: 4000, name: 'NEON' },
  { xp: 9000, name: 'HELIX' },
  { xp: 20000, name: 'HELIX GOD' }
];
function rankFor(xp) {
  let r = 0;
  for (let i = 0; i < RANKS.length; i++) if (xp >= RANKS[i].xp) r = i;
  return r;
}
function addCoins(n) {
  Save.data.coins += n;
  Save.data.coinsEarned = (Save.data.coinsEarned || 0) + n;
  if (Save.data.coinsEarned >= 500) awardTrophy('coins500');
}
function awardXP(n) {
  const before = rankFor(Save.data.xp);
  Save.data.xp += n;
  Save.save();
  const after = rankFor(Save.data.xp);
  if (after > before) {
    addCoins(150);
    Save.save();
    toast('⬆ RANK UP: ' + RANKS[after].name + '!  +150🪙');
    Sfx.fever();
    buzz([40, 40, 80]);
    for (let i = 0; i < 60; i++) burst(rand(0, Game.W), rand(0, Game.H * 0.5), '#00f0ff', 24);
  }
}
const TROPHIES = [
  { id: 'firstblood', name: 'Shattered', desc: 'Die for the first time' },
  { id: 'fever1', name: 'Fever Pitch', desc: 'Trigger your first FEVER' },
  { id: 'perfect10', name: 'Thread Master', desc: '10 PERFECT gaps in one run' },
  { id: 'rows50', name: 'Deep Diver', desc: 'Pass 50 rows in one run' },
  { id: 'coins500', name: 'Tycoon', desc: 'Earn 500 coins total' },
  { id: 'repaint10', name: 'Chameleon', desc: 'Repaint 10× in one run' },
  { id: 'streak7', name: 'Devoted', desc: '7-day login streak' },
  { id: 'rival1', name: 'Giant Slayer', desc: 'Beat a rival' },
  { id: 'rush2000', name: 'Speed Demon', desc: 'Score 2,000 in one RUSH' },
  { id: 'daily5', name: 'Regular', desc: 'Play 5 Daily Drops' },
  { id: 'shield2', name: 'Untouchable', desc: 'Block 2 deaths with shields' },
  { id: 'level5', name: 'Climber', desc: 'Clear level 5' }
];
function awardTrophy(id) {
  if (Save.data.trophies.includes(id)) return;
  const t = TROPHIES.find(t => t.id === id);
  if (!t) return;
  Save.data.trophies.push(id);
  addCoins(30);
  Save.save();
  toast('🏆 ' + t.name + '!  +30🪙');
  Sfx.win();
  buzz([30, 30, 60]);
  for (let i = 0; i < 40; i++) burst(rand(0, Game.W), rand(0, Game.H * 0.4), '#ffd700', 20);
}
const LOGIN_REWARDS = [25, 40, 60, 90, 130, 170, 250];
function checkLogin() {
  const l = Save.data.login, today = dayStr();
  if (l.last === today) return false; // already handled today
  const yest = dayStr(new Date(Date.now() - 864e5));
  if (l.last !== yest && l.last !== '' && (l.freeze || 0) > 0) {
    // v9: ❄️ streak freeze — a banked freeze bridges the missed day(s)
    l.freeze--;
    l.frozenDays = l.frozenDays || [];
    l.frozenDays.push(yest);
    if (l.frozenDays.length > 7) l.frozenDays.shift();
    l.streak = l.streak + 1; // the streak survives; today counts onward
    if (l.streak > 7) l.streak = 1;
    l.last = today;
    Save.save();
    if (l.streak >= 7) awardTrophy('streak7');
    setTimeout(() => toast('❄️ Streak frozen! Day ' + Math.min(l.streak, 7) + ' preserved.'), 800);
    return true;
  }
  l.streak = (l.last === yest) ? l.streak + 1 : 1;
  if (l.streak > 7) l.streak = 1; // cycle restarts after day 7 claimed
  l.last = today;
  Save.save();
  if (l.streak >= 7) awardTrophy('streak7');
  return true; // show claim overlay
}
const FREEZE_PRICE = 150, FREEZE_MAX = 2;
function buyFreeze() {
  const l = Save.data.login;
  l.freeze = l.freeze || 0;
  if (l.freeze >= FREEZE_MAX) { toast('❄️ Freeze bank full (2 max)!'); return; }
  if (Save.data.coins < FREEZE_PRICE) { toast('Need ' + FREEZE_PRICE + '🪙 for a ❄️ freeze'); return; }
  Save.data.coins -= FREEZE_PRICE;
  l.freeze++;
  Save.save();
  Sfx.win();
  renderLogin(); refreshMenu();
  toast('❄️ Freeze banked! (' + l.freeze + '/' + FREEZE_MAX + ')');
}
function claimLogin() {
  const l = Save.data.login;
  if (l.claimed === dayStr()) return;
  l.claimed = dayStr();
  const reward = LOGIN_REWARDS[Math.min(l.streak, 7) - 1] || 25;
  addCoins(reward);
  let extra = '';
  if (l.streak >= 7) {
    const tr = Save.data.trails;
    if (!tr.owned.includes('ember')) { tr.owned.push('ember'); extra = ' + 🔥 Ember trail!'; }
    l.streak = 0; // restart cycle next visit
  }
  Save.save();
  toast('🎁 Day ' + Math.min(l.streak || 7, 7) + ': +' + reward + '🪙' + extra);
  Sfx.win();
}

/* ---------------- Ads ----------------
   ADMOB SWAP POINTS: in the Capacitor native build, replace the body of
   maybeInterstitial() with AdMob.showInterstitial() and rewarded() with
   AdMob.showRewardedAd(), keeping the same callbacks. Placement policy is
   documented in MONETIZATION.md and enforced here (frequency caps live in
   one place so policy changes don't touch game code). */
const Ads = {
  gameOvers: 0,
  lastInterstitialAt: 0,
  INTER_EVERY: 3,          // every 3rd game over
  INTER_MIN_GAP_MS: 45000, // at least 45s between interstitials
  maybeInterstitial(cb) {
    this.gameOvers++;
    const since = Date.now() - this.lastInterstitialAt;
    if (this.gameOvers % this.INTER_EVERY === 0 && since > this.INTER_MIN_GAP_MS) {
      this.lastInterstitialAt = Date.now();
      // ADMOB: AdMob.showInterstitial().then(cb).catch(cb)
      showAdCard(false, null, cb);
    } else cb();
  },
  rewarded(placement, cb) {
    // placement: 'revive' | 'coins2x' | 'skin' | 'boost'
    // ADMOB: AdMob.showRewardedAd({placement}).then(r => cb(r.earned)).catch(() => cb(false))
    const returnTo = placement === 'coins2x' ? 'leveldone' : placement === 'skin' ? 'shop' : placement === 'boost' ? 'menu' : null;
    showAdCard(true, returnTo, cb);
  }
};

/* ---------------- Shop catalog ---------------- */
const PALETTE = [
  { name: 'cyan', main: '#00f0ff', dim: 'rgba(0,240,255,.25)' },
  { name: 'magenta', main: '#ff2fd6', dim: 'rgba(255,47,214,.25)' },
  { name: 'gold', main: '#ffd23f', dim: 'rgba(255,210,63,.25)' }
];
const SYMBOLS = ['●', '▲', '■']; // color-blind shapes per color
const BALLS = [
  { id: 'orb', name: 'Neon Orb', price: 0 },
  { id: 'comet', name: 'Comet', price: 150 },
  { id: 'planet', name: 'Ringed', price: 300 },
  { id: 'ghost', name: 'Ghost', price: 300 },
  { id: 'nova', name: 'Nova', price: 500 },
  { id: 'yinyang', name: 'Yin Yang', price: 500 },
  { id: 'lava', name: 'Lava', price: 800 },
  { id: 'prism', name: 'Prism', price: 1200 }
];
const TRAILS = [
  { id: 'none', name: 'None', price: 0 },
  { id: 'sparkle', name: 'Sparkle', price: 100 },
  { id: 'bubbles', name: 'Bubbles', price: 200 },
  { id: 'stars', name: 'Stars', price: 350 },
  { id: 'lightning', name: 'Voltage', price: 600 },
  { id: 'rainbow', name: 'Rainbow', price: 900 },
  { id: 'ember', name: 'Ember', price: 0, exclusive: 'login7' } // 7-day login streak reward only
];
const THEMES = [
  { id: 'midnight', name: 'Midnight', price: 0, bg: ['#0a0a1f', '#160a2e'], grid: 'rgba(0,240,255,.06)', star: '#9df' },
  { id: 'sunset', name: 'Sunset', price: 250, bg: ['#1f0a1a', '#3d1030'], grid: 'rgba(255,120,80,.07)', star: '#fc9' },
  { id: 'abyss', name: 'Abyss', price: 400, bg: ['#02141a', '#06303a'], grid: 'rgba(0,255,200,.07)', star: '#afa' },
  { id: 'candy', name: 'Candy', price: 600, bg: ['#1c0a24', '#3a1040'], grid: 'rgba(255,80,200,.07)', star: '#faf' }
];

/* ---------------- Game state ---------------- */
const Game = {
  mode: 'menu',            // menu | playing | paused | dying | gameover | leveldone
  playMode: 'levels',      // levels | endless
  level: 1,
  rot: 0, rotVel: 0, keyDir: 0,
  ball: { y: 0, vy: 0, color: 0, r: 14 },
  rows: [], gates: [], coins: [],
  score: 0, streak: 0, coinsRun: 0, bestStreak: 0,
  rowIndex: 0,             // highest row passed
  camY: 0, shake: 0, timeScale: 1, slowT: 0,
  shield: 0, revived: false,
  eColor: 0, eRunLeft: 99,   // endless-mode color run tracking
  timeLeft: 0,               // rush mode countdown
  depth: 0,                  // endless/rush: deepest row depth generated
  particles: [], popups: [], stars: [],
  deathCause: '', newBest: false,
  // v6: addiction systems
  fever: 0, feverT: 0, feverFlash: 0,   // fever meter 0-100, active timer, trigger flash
  powerups: [],                          // in-world pickups {y, localA, kind, taken}
  puShield: false, puMagnet: 0, puStar: 0, // active powerup effects
  mRun: null,                            // per-run mission progress {missionId: n}
  rival: null,                           // {score, mode, beaten} from ?rival= link
  // v8
  runTime: 0,                            // deterministic per-run clock (drives gap drift)
  ghostY: 0, ghostPassed: false,         // ghost marker (best depth)
  zone: -1,                              // depth zone index
  puSlow: 0,                             // bullet-time pickup timer
  // v9
  ball2: null,                           // 👯 dual drop: second ball {color} (shares y/vy)
  pchain: 0,                             // 🔥 consecutive PERFECT passes
  chests: [],                            // 🎁 milestone chest pickups
  skipNext: false,                       // 👻 skip token armed: phase through next row
  W: 0, H: 0, R: 120, ballScreenY: 0,
  time: 0
};

const PHYS = {
  // Bounce apex (v^2/2g = 87px) must stay BELOW rowSpacing (112px): otherwise
  // the ball can rise past the row above it and re-trigger its gap for an
  // infinite score farm / softlock. One bounce threatens exactly one row down.
  G: 2800, bounceV: 700, rowSpacing: 112,
  rotSense: 0.011, maxRotVel: 9,
  gateHalf: 0.78, coinHalf: 0.5 // wide gates: missing a repaint should be rare, not the norm
};

/* ---------------- Level generation ----------------
   Fairness contract: consecutive gap centers differ by <= 1.5 rad (reachable
   during one bounce's airtime); red sectors never overlap a gap; a repaint
   gate always sits in the gap line before a color change. */
const PU_KINDS = ['shield', 'magnet', 'star', 'slow'];
function genLevel(n) {
  const rows = [], gates = [], coins = [], powerups = [];
  let gapC = sr(0, TAU);
  // occasional powerup floating in the gap between rows (never on the finish row)
  const maybePowerup = (y, gapCRef) => {
    if (srp(0.08)) powerups.push({ y, localA: norm(gapCRef + sr(-0.4, 0.4)), kind: PU_KINDS[sri(0, 3)], taken: false });
  };

  // Level 1 is a tutorial: every row is colored (no confusing neutrals) —
  // the ball starts cyan and so do the first rows, so "land on YOUR color"
  // is obvious from the first second. Gates teach repainting.
  if (n === 1) {
    const gapH = 0.55;
    const segs = [
      { color: 0, len: 6 },
      { color: 1, len: 4 },
      { color: 0, len: 2 }
    ];
    let i = 0;
    for (const s of segs) {
      let firstGap = gapC;
      for (let k = 0; k < s.len; k++, i++) {
        gapC = norm(gapC + sr(-1.2, 1.2));
        if (k === 0) firstGap = gapC;
        rows.push({ y: i * PHYS.rowSpacing, gapC, gapH, color: s.color, reds: [] });
        rows[rows.length - 1].golden = srp(0.06); // golden gap: 3x points
        rows[rows.length - 1].drift = 0; // tutorial: no drift
        rows[rows.length - 1].gapC0 = gapC; rows[rows.length - 1].driftT0 = 0;
        if (srp(0.4)) coins.push({ y: i * PHYS.rowSpacing + PHYS.rowSpacing / 2, localA: norm(gapC + sr(-0.5, 0.5)), taken: false });
        maybePowerup(i * PHYS.rowSpacing - PHYS.rowSpacing / 2, gapC);
      }
      if (s.color !== -1 && i - s.len > 0) {
        gates.push({ y: (i - s.len) * PHYS.rowSpacing - PHYS.rowSpacing / 2, localA: firstGap, color: s.color, taken: false, warned: false });
      }
    }
    const last = rows[rows.length - 1];
    last.gapH = Math.PI * 0.92; last.color = -1; // finish row
    return { rows, gates, coins, powerups, count: rows.length };
  }

  const count = 16 + n * 4;
  const gapH = Math.max(0.30, 0.58 - n * 0.022);
  const colors = n === 2 ? [0, 1] : [0, 1, 2];
  let color = colors[0];
  let runLeft = sri(3, 5);
  const redP = n < 3 ? 0 : Math.min(0.55, 0.12 + n * 0.04);

  for (let i = 0; i < count; i++) {
    const isLast = i === count - 1;
    let gated = false; // a repaint gate sits right above this row
    gapC = norm(gapC + sr(-1.2, 1.2));
    // color runs with repaint gates between them
    if (n > 1 && !isLast) {
      runLeft--;
      if (runLeft <= 0) {
        const next = colors[sri(0, colors.length - 1)];
        if (next !== color || colors.length === 1) {
          const nc = next === color ? (color + 1) % colors.length : next;
          gates.push({ y: i * PHYS.rowSpacing - PHYS.rowSpacing / 2, localA: gapC, color: nc, taken: false });
          color = nc;
          gated = true;
        }
        runLeft = sri(3, 6);
      }
    }
    const rowColor = isLast ? -1 : color; // final row: neutral, huge gap = finish
    const row = {
      y: i * PHYS.rowSpacing,
      gapC, gapH: isLast ? Math.PI * 0.92 : gapH,
      color: rowColor, reds: []
    };
    if (!isLast && srp(redP)) {
      const rh = sr(0.28, 0.5);
      const rc = norm(gapC + Math.PI + sr(-0.9, 0.9));
      if (angDist(rc, gapC) > gapH + rh + 0.25) row.reds.push({ a0: rc - rh, a1: rc + rh });
    }
    rows.push(row);
    row.golden = !isLast && srp(0.06); // golden gap: 3x points
    // v8: drifting gaps from level 4 — never on a gate row (the gate was aimed at the still gap)
    row.drift = (!isLast && !gated && n >= 4 && srp(0.25)) ? sr(0.25, 0.5) * (srp(0.5) ? 1 : -1) : 0;
    row.gapC0 = row.gapC; row.driftT0 = 0;
    if (!isLast && srp(0.4)) {
      coins.push({ y: i * PHYS.rowSpacing + PHYS.rowSpacing / 2, localA: norm(gapC + sr(-0.5, 0.5)), taken: false });
    }
    if (!isLast) maybePowerup(i * PHYS.rowSpacing - PHYS.rowSpacing / 2, gapC);
  }
  return { rows, gates, coins, powerups, count };
}

function endlessRow(depth, prevGapC) {
  const gapH = Math.max(0.26, 0.55 - depth * 0.004);
  const gapC = norm(prevGapC + sr(-1.2, 1.2));
  // Colors run in streaks with a repaint gate before every switch — same
  // fairness contract as levels. (Random per-row colors would be unavoidable
  // deaths, since there'd be no way to repaint in time.)
  let color;
  let gated = false;
  if (depth < 12) { color = 0; } // opening stretch matches the cyan ball — no grey confusion
  else {
    if (depth === 12) { Game.eColor = 0; Game.eRunLeft = sri(3, 5); }
    Game.eRunLeft--;
    if (Game.eRunLeft <= 0) {
      const nColors = depth < 30 ? 2 : 3;
      let nc = sri(0, nColors - 1);
      if (nc === Game.eColor) nc = (nc + 1) % nColors;
      Game.gates.push({ y: depth * PHYS.rowSpacing - PHYS.rowSpacing / 2, localA: gapC, color: nc, taken: false, warned: false });
      Game.eColor = nc;
      Game.eRunLeft = sri(3, 6);
      gated = true;
    }
    color = Game.eColor;
  }
  const row = { y: depth * PHYS.rowSpacing, gapC, gapH, color, reds: [] };
  row.golden = srp(0.06); // golden gap: 3x points
  // v8: drifting gaps in deep endless — never on a gate row
  row.drift = (!gated && depth >= 20 && srp(Math.min(0.35, 0.08 + depth * 0.004))) ? sr(0.25, 0.5) * (srp(0.5) ? 1 : -1) : 0;
  row.gapC0 = row.gapC; row.driftT0 = Game.runTime || 0;
  // v9: 🦎 chameleon rows — gap cycles color on a timer (not in dual; always eventually passable)
  row.cham = (!gated && depth >= 15 && Game.playMode !== 'dual' && srp(0.12));
  if (depth > 8 && srp(Math.min(0.5, 0.1 + depth * 0.006))) {
    const rh = sr(0.28, 0.5);
    const rc = norm(gapC + Math.PI + sr(-0.9, 0.9));
    if (angDist(rc, gapC) > gapH + rh + 0.25) row.reds.push({ a0: rc - rh, a1: rc + rh });
  }
  if (depth > 2 && srp(0.08)) {
    Game.powerups.push({ y: depth * PHYS.rowSpacing - PHYS.rowSpacing / 2, localA: norm(gapC + sr(-0.4, 0.4)), kind: PU_KINDS[sri(0, 3)], taken: false });
  }
  return row;
}

/* ---------------- Run control ---------------- */
function startRun(playMode, level) {
  Game.playMode = playMode;
  Game.level = level || 1;
  Game.mode = 'playing';
  Game.rot = 0; Game.rotVel = 0;
  Game.score = 0; Game.streak = 0; Game.coinsRun = 0; Game.bestStreak = 0;
  Game.shield = 0; Game.revived = false; Game.newBest = false;
  Game.particles = []; Game.popups = [];
  Game.timeScale = 1; Game.slowT = 0; Game.shake = 0;
  Game.eColor = 0; Game.eRunLeft = 99;
  // v6 state
  Game.fever = 0; Game.feverT = 0; Game.feverFlash = 0;
  Game.powerups = []; Game.puShield = false; Game.puMagnet = 0; Game.puStar = 0;
  Game.mRun = {};
  Game.tPerfect = 0; Game.tRepaint = 0; // per-run trophy counters
  // rewarded run-starter boost (earned from the menu)
  if (Save.data.boost === 'shield') { Game.puShield = true; setTimeout(() => toast('🛡 Shield armed for this run!'), 600); }
  else if (Save.data.boost === 'magnet') { Game.puMagnet = 8; setTimeout(() => toast('🧲 Magnet armed for this run!'), 600); }
  Save.data.boost = null;
  Game.timeLeft = playMode === 'rush' ? 60 : 0;
  // Daily Drop: seeded tower, same for everyone today; streak bookkeeping
  SRNG = null;
  if (playMode === 'daily') {
    SRNG = mulberry32(hashStr('neonhelix-daily-' + dayStr()));
    const d = Save.data.daily, today = dayStr();
    const yest = dayStr(new Date(Date.now() - 864e5));
    if (d.last !== today) {
      d.streak = (d.last === yest) ? d.streak + 1 : 1;
      d.last = today;
      Save.save();
    }
    missionEv('daily');
  Save.data.daily.plays++;
  if (Save.data.daily.plays >= 5) awardTrophy('daily5');
  Save.save();
  }
  const g = playMode === 'levels' ? genLevel(Game.level) : null;
  if (g) { Game.rows = g.rows; Game.gates = g.gates; Game.coins = g.coins; Game.powerups = g.powerups; }
  else {
    Game.rows = []; Game.gates = []; Game.coins = []; Game.powerups = [];
    let gc = sr(0, TAU);
    for (let i = 0; i < 14; i++) { const r = endlessRow(i, gc); gc = r.gapC; Game.rows.push(r); }
    Game.depth = 13;
  }
  if (playMode !== 'daily') SRNG = null; // daily keeps its seed for tower extension
  // v8: run clock, ghost marker, zones, stats
  Game.runTime = 0;
  Game.zone = -1;
  Game.ghostPassed = false;
  // v9: dual drop second ball, perfect-chain, chests, skip token
  Game.ball2 = playMode === 'dual' ? { color: 1 } : null;
  Game.pchain = 0;
  Game.chests = [];
  Game.skipNext = false;
  const br = Save.data.bestRows || { endless: 0, sudden: 0, dual: 0, daily: {} };
  Game.ghostY = playMode === 'endless' ? (br.endless || 0) * PHYS.rowSpacing
    : playMode === 'sudden' ? (br.sudden || 0) * PHYS.rowSpacing
    : playMode === 'dual' ? (br.dual || 0) * PHYS.rowSpacing
    : playMode === 'daily' ? ((br.daily || {})[dayStr()] || 0) * PHYS.rowSpacing : 0;
  stat('runs');
  Game.rowIndex = -1;
  const first = Game.rows[0];
  Game.ball.y = first.y - 160;
  Game.ball.vy = 0;
  Game.ball.color = first.color === -1 ? 0 : first.color;
  Game.camY = Game.ball.y - Game.ballScreenY;
  Save.data.runs++;
  Save.save();
  showScreen(null);
  hud(true);
  updateHUD();
}

function endRunDeath(cause) {
  if (Game.shield > 0 || Game.mode !== 'playing') return;
  // shield powerup: forgive one mistake instead of dying
  if (Game.puShield) {
    Game.puShield = false;
    Game.shield = 1.5;
    Game.ball.vy = -PHYS.bounceV;
    burst(Game.W / 2, Game.ballScreenY, '#7df9ff', 30);
    popup('SHIELD SAVED YOU!', '#7df9ff');
    Sfx.revive(); buzz(60);
    Save.data.shieldSaves = (Save.data.shieldSaves || 0) + 1;
    if (Save.data.shieldSaves >= 2) awardTrophy('shield2');
    Save.save();
    updateHUD();
    return;
  }
  Game.mode = 'dying';
  Game.deathCause = cause;
  Game.timeScale = 0.22; Game.slowT = 0.8;
  Game.shake = 14;
  burst(Game.W / 2, Game.ballScreenY, PALETTE[Game.ball.color].main, 46);
  Sfx.shatter();
  buzz([60, 40, 60]);
  awardTrophy('firstblood');
}

function finishDeath() {
  Game.mode = 'gameover';
  Game.timeScale = 1;
  const today = dayStr();
  const prev = Game.playMode === 'endless' ? Save.data.best.endless
    : Game.playMode === 'rush' ? Save.data.best.rush
    : Game.playMode === 'sudden' ? Save.data.best.sudden
    : Game.playMode === 'dual' ? Save.data.best.dual
    : Game.playMode === 'daily' ? (Save.data.daily.best[today] || 0)
    : (Save.data.best.levels[Game.level] || 0);
  Game.newBest = Game.score > prev;
  if (Game.newBest) {
    if (Game.playMode === 'endless') Save.data.best.endless = Game.score;
    else if (Game.playMode === 'rush') Save.data.best.rush = Game.score;
    else if (Game.playMode === 'sudden') Save.data.best.sudden = Game.score;
    else if (Game.playMode === 'dual') Save.data.best.dual = Game.score;
    else if (Game.playMode === 'daily') Save.data.daily.best[today] = Game.score;
    else Save.data.best.levels[Game.level] = Game.score;
  }
  // v8: best depth per mode feeds the ghost marker
  const rowsDone = Math.max(0, Game.rowIndex + 1);
  const br = Save.data.bestRows || (Save.data.bestRows = { endless: 0, sudden: 0, dual: 0, daily: {} });
  if (Game.playMode === 'endless' && rowsDone > (br.endless || 0)) br.endless = rowsDone;
  else if (Game.playMode === 'sudden' && rowsDone > (br.sudden || 0)) br.sudden = rowsDone;
  else if (Game.playMode === 'dual' && rowsDone > (br.dual || 0)) br.dual = rowsDone;
  else if (Game.playMode === 'daily') { br.daily = br.daily || {}; if (rowsDone > (br.daily[today] || 0)) br.daily[today] = rowsDone; }
  Save.data.coins += Game.coinsRun;
  Save.save();
  awardXP(Math.floor(Game.score / 10) + Math.max(0, Game.rowIndex + 1));
  // interstitial policy lives in Ads.maybeInterstitial
  Ads.maybeInterstitial(() => showGameOver());
}

function levelComplete() {
  if (Game.mode !== 'playing') return;
  Game.mode = 'leveldone';
  Sfx.win();
  const bonus = Game.level * 5;
  Game.coinsRun += bonus;
  Save.data.coins += Game.coinsRun;
  Save.data.unlocked = Math.max(Save.data.unlocked, Game.level + 1);
  const prev = Save.data.best.levels[Game.level] || 0;
  Game.newBest = Game.score > prev;
  if (Game.newBest) Save.data.best.levels[Game.level] = Game.score;
  Save.save();
  awardXP(Math.floor(Game.score / 10) + Game.level * 10);
  if (Game.level >= 5) awardTrophy('level5');
  for (let i = 0; i < 60; i++)
    burst(rand(0, Game.W), rand(0, Game.H * 0.6), PALETTE[randi(0, 2)].main, 30);
  showLevelDone(bonus);
}

function rushComplete() {
  if (Game.mode !== 'playing' || Game.playMode !== 'rush') return;
  Game.mode = 'leveldone';
  Sfx.win();
  const bonus = Math.floor(Game.score / 20) + Game.coinsRun;
  Game.coinsRun = bonus;
  Save.data.coins += bonus;
  const prev = Save.data.best.rush || 0;
  Game.newBest = Game.score > prev;
  if (Game.newBest) Save.data.best.rush = Game.score;
  Save.save();
  awardXP(Math.floor(Game.score / 10) + 20);
  if (Game.score >= 2000) awardTrophy('rush2000');
  for (let i = 0; i < 60; i++)
    burst(rand(0, Game.W), rand(0, Game.H * 0.6), PALETTE[randi(0, 2)].main, 30);
  showLevelDone(bonus);
}

function revive() {
  // rewarded placement 'revive' — one per run
  if (Game.revived) return;
  Ads.rewarded('revive', earned => {
    if (!earned) return;
    Game.revived = true;
    Game.mode = 'playing';
    const target = Game.rows[Math.max(0, Game.rowIndex)];
    Game.ball.y = target.y - 170;
    Game.ball.vy = 0;
    Game.shield = 3;
    Game.timeScale = 1;
    Sfx.revive();
    showScreen(null);
    toast('REVIVED — 3s shield!');
  });
}

/* ---------------- Physics update ---------------- */
function update(dt) {
  const G = Game;
  G.time += dt;

  if (G.mode === 'dying') {
    // freeze gameplay, let fx + slow-mo play out
    if (G.shake > 0) G.shake = Math.max(0, G.shake - dt * 30);
    if (G.slowT > 0) { G.slowT -= dt / Math.max(G.timeScale, 0.01); if (G.slowT <= 0) { G.timeScale = 1; finishDeath(); } }
    updateParticles(dt);
    updatePopups(dt);
    return;
  }

  // rotation input: drag inertia + keyboard
  if (G.keyDir !== 0) { G.rot += G.keyDir * 4.2 * dt; G.rotVel = G.keyDir * 4.2; }
  else if (!dragging) { G.rot += G.rotVel * dt; G.rotVel *= Math.pow(0.02, dt); if (Math.abs(G.rotVel) < 0.05) G.rotVel = 0; }
  G.rotVel = clamp(G.rotVel, -PHYS.maxRotVel, PHYS.maxRotVel);

  if (G.shield > 0) G.shield -= dt;
  // v6 timers
  if (G.puMagnet > 0) G.puMagnet -= dt;
  if (G.puStar > 0) G.puStar -= dt;
  if (G.feverFlash > 0) G.feverFlash = Math.max(0, G.feverFlash - dt * 2);
  if (G.feverT > 0) {
    G.feverT -= dt;
    if (G.feverT <= 0) { G.feverT = 0; G.fever = 0; toast('Fever over!'); }
  }

  const b = G.ball;
  const prevY = b.y;
  G.runTime += dt;
  // v8: drifting gaps ride the run clock (deterministic per run)
  for (const r of G.rows) if (r.drift) r.gapC = norm(r.gapC0 + r.drift * (G.runTime - (r.driftT0 || 0)));
  // v8: bullet-time pickup sustains gentle slow-mo
  if (G.puSlow > 0) {
    G.puSlow -= dt;
    if (G.slowT <= 0.05) { G.timeScale = 0.45; G.slowT = 0.12; }
  }
  // v8: depth zones + ghost marker (endless-like modes)
  if (G.playMode === 'endless' || G.playMode === 'daily' || G.playMode === 'sudden' || G.playMode === 'dual') {
    const z = Math.floor(b.y / (25 * PHYS.rowSpacing));
    if (z !== G.zone) {
      G.zone = z;
      if (z > 0) { popup('🌀 ' + ZONES[z % ZONES.length].name, '#b388ff'); Sfx.tone(300, 0.3, 'triangle', 0.15, 600); }
    }
    if (!G.ghostPassed && G.ghostY > 0 && b.y > G.ghostY) {
      G.ghostPassed = true;
      popup('👻 GHOST PASSED!', '#9df');
      burst(G.W / 2, G.ballScreenY, '#9df', 20);
    }
  }
  b.vy += PHYS.G * dt;
  b.vy = Math.min(b.vy, 2400);
  b.y += b.vy * dt;

  // endless/rush: extend tower ahead
  if (G.playMode !== 'levels') {
    let last = G.rows[G.rows.length - 1];
    while (last.y < b.y + G.H * 2.2) {
      G.depth++;
      const r = endlessRow(G.depth, last.gapC);
      G.rows.push(r); last = r;
      if (srp(0.35)) G.coins.push({ y: r.y - PHYS.rowSpacing / 2, localA: norm(r.gapC + sr(-0.5, 0.5)), taken: false });
    }
    // drop rows far behind to bound memory
    while (G.rows.length > 4 && G.rows[0].y < b.y - G.H) { G.rows.shift(); G.rowIndex--; }
    G.gates = G.gates.filter(gt => !gt.taken && gt.y > b.y - G.H);
    G.coins = G.coins.filter(c => !c.taken && c.y > b.y - G.H);
    G.powerups = G.powerups.filter(p => !p.taken && p.y > b.y - G.H);
    G.chests = G.chests.filter(ch => !ch.taken && ch.y > b.y - G.H); // v9
  }

  // platform crossings (falling only)
  if (b.vy > 0) {
    for (let i = 0; i < G.rows.length; i++) {
      const row = G.rows[i];
      if (prevY < row.y && b.y >= row.y) {
        onCrossRow(row, i);
        if (G.mode !== 'playing') break;
      }
    }
    // gates & coins crossed while falling (skip if died on a row this frame)
    if (G.mode === 'playing') {
    for (const gt of G.gates) {
      if (!gt.taken && prevY < gt.y && b.y >= gt.y) {
        if (angDist(0, norm(gt.localA + G.rot)) < PHYS.gateHalf) {
          gt.taken = true;
          // v9: 👯 dual drop repaints BOTH balls
          const needRepaint = b.color !== gt.color || (G.ball2 && G.ball2.color !== gt.color);
          if (needRepaint) {
            b.color = gt.color;
            if (G.ball2) G.ball2.color = gt.color;
            Sfx.repaint();
            burst(G.W / 2, G.ballScreenY, PALETTE[b.color].main, 22);
            popup('REPAINTED!', PALETTE[b.color].main);
            addFever(10);
            missionEv('repaint');
            Game.tRepaint++;
            if (Game.tRepaint >= 10) awardTrophy('repaint10');
            stat('repaints');
            updateHUD(); // refresh the "you are this color" chip immediately
          }
        }
      }
    }
    const coinReach = G.puMagnet > 0 ? 1.3 : PHYS.coinHalf; // magnet vacuums coins
    for (const c of G.coins) {
      if (!c.taken && prevY < c.y && b.y >= c.y) {
        if (angDist(0, norm(c.localA + G.rot)) < coinReach) {
          c.taken = true;
          const cm = pchainMult(); // v9: 🔥 perfect-chain multiplies coin drops
          G.coinsRun += cm;
          G.score += 25;
          if (cm > 1) popup('🔥 +' + cm + '🪙', '#ff9d00');
          addFever(2);
          Sfx.coin();
          burst(G.W / 2, G.ballScreenY, '#ffd700', 12);
          missionEv('coin');
          checkRival();
          updateHUD();
        }
      }
    }
    for (const p of G.powerups) {
      if (!p.taken && prevY < p.y && b.y >= p.y) {
        if (angDist(0, norm(p.localA + G.rot)) < 0.55) {
          p.taken = true;
          applyPowerup(p.kind);
        }
      }
    }
    // v9: 🎁 milestone chests
    for (const ch of G.chests) {
      if (!ch.taken && prevY < ch.y && b.y >= ch.y) {
        if (angDist(0, norm(ch.localA + G.rot)) < 0.6) {
          ch.taken = true;
          applyChest();
        }
      }
    }
    } // end if (playing)
  }

  // warn once when a repaint gate scrolls into view
  for (const gt of G.gates) {
    if (!gt.taken && !gt.warned) {
      const sy = gt.y - G.camY;
      if (sy > -40 && sy < G.H * 0.8) {
        gt.warned = true;
        if (b.color !== gt.color) {
          const c = PALETTE[gt.color];
          popup('REPAINT: ' + c.name.toUpperCase() + '!', c.main);
          Sfx.tone(520, 0.12, 'triangle', 0.18);
        }
      }
    }
  }

  // camera follows ball
  G.camY = b.y - G.ballScreenY;

  // fx
  if (G.shake > 0) G.shake = Math.max(0, G.shake - dt * 30);
  if (G.slowT > 0) { G.slowT -= dt / Math.max(G.timeScale, 0.01); if (G.slowT <= 0) { G.timeScale = 1; if (G.mode === 'dying') finishDeath(); } }
  updateParticles(dt);
  updatePopups(dt);
  Sfx.padTimer -= dt;
  if (Sfx.padTimer <= 0) { Sfx.pad(); Sfx.padTimer = 5; }
}

/* ---------------- v6: fever / powerups / rival ---------------- */
function addFever(n) {
  const G = Game;
  if (G.mode !== 'playing' || G.feverT > 0) return;
  G.fever = clamp(G.fever + n, 0, 100);
  if (G.fever >= 100) triggerFever();
}
function triggerFever() {
  const G = Game;
  G.feverT = 10;
  G.feverFlash = 1;
  popup('🔥 FEVER! 2× POINTS 🔥', '#ffd700');
  Sfx.fever();
  buzz(80);
  missionEv('fever');
  awardTrophy('fever1');
  stat('fevers');
  for (let i = 0; i < 40; i++) burst(rand(0, G.W), rand(0, G.H * 0.5), '#ffd700', 22);
}
function scoreMult() {
  let m = 1;
  if (Game.feverT > 0) m *= 2;
  if (Game.puStar > 0) m *= 2;
  return m;
}
const PU_META = {
  shield: { emoji: '🛡', name: 'SHIELD', color: '#7df9ff' },
  magnet: { emoji: '🧲', name: 'MAGNET', color: '#ff9d00' },
  star: { emoji: '⭐', name: '2× STAR', color: '#ffe45e' },
  slow: { emoji: '⏳', name: 'BULLET-TIME', color: '#b388ff' }
};
function applyPowerup(kind) {
  const G = Game, meta = PU_META[kind];
  Sfx.power();
  buzz(40);
  burst(G.W / 2, G.ballScreenY, meta.color, 26);
  if (kind === 'shield') {
    G.puShield = true;
    popup('🛡 SHIELD!', meta.color);
    toast('Shield: one mistake forgiven');
    missionEv('shield');
  } else if (kind === 'magnet') {
    G.puMagnet = 8;
    popup('🧲 MAGNET!', meta.color);
  } else if (kind === 'slow') {
    G.puSlow = 5;
    popup('⏳ BULLET-TIME!', meta.color);
  } else {
    G.puStar = 10;
    popup('⭐ 2× POINTS!', meta.color);
  }
  updateHUD();
}
function checkRival() {
  const rv = Game.rival;
  if (rv && !rv.beaten && rv.mode === Game.playMode && Game.score > rv.score) {
    rv.beaten = true;
    popup('🎯 RIVAL BEATEN!', '#ffd700');
    for (let i = 0; i < 60; i++) burst(rand(0, Game.W), rand(0, Game.H * 0.5), PALETTE[randi(0, 2)].main, 26);
    Sfx.win();
    buzz(80);
    toast('You beat the rival score of ' + rv.score + '!');
    awardTrophy('rival1');
  }
}

/* ---------------- v9: chameleon / perfect-chain / chests / dual / skip ---------------- */
// 🦎 chameleon color: 2.4s global cycle, 0.8s per color — slow enough to react,
// synced across rows so there is one rhythm to learn. Always eventually matches.
function chameleonColor() {
  return Math.floor(Game.runTime / 0.8) % 3;
}
// 🔥 perfect-chain coin multiplier: x2 at 3, x3 at 5, x5 at 8 (cap). Coins only, never score.
function pchainMult() {
  const c = Game.pchain || 0;
  return c >= 8 ? 5 : c >= 5 ? 3 : c >= 3 ? 2 : 1;
}
function spawnChest() {
  const G = Game;
  // a few rows ahead of the ball, at the front (easy to see and grab)
  G.chests.push({ y: G.ball.y + PHYS.rowSpacing * 4, localA: 0, taken: false });
  popup('🎁 MILESTONE CHEST AHEAD!', '#ffd700');
  Sfx.power();
}
function applyChest() {
  const G = Game;
  const burstCoins = 20;
  G.coinsRun += burstCoins;
  popup('🎁 +' + burstCoins + '🪙!', '#ffd700');
  Sfx.win();
  buzz([40, 40, 80]);
  for (let i = 0; i < 50; i++) burst(rand(0, G.W), rand(0, G.H * 0.5), '#ffd700', 24);
  // 10%: free random unowned shop skin
  if (Math.random() < 0.10) {
    const pool = [];
    for (const it of BALLS) if (!Save.data.balls.owned.includes(it.id)) pool.push(['balls', it]);
    for (const it of TRAILS) if (!Save.data.trails.owned.includes(it.id) && !it.exclusive) pool.push(['trails', it]);
    for (const it of THEMES) if (!Save.data.themes.owned.includes(it.id)) pool.push(['themes', it]);
    if (pool.length > 0) {
      const [key, it] = pool[Math.floor(Math.random() * pool.length)];
      Save.data[key].owned.push(it.id);
      Save.save();
      setTimeout(() => { toast('🎁 FREE SKIN: ' + it.name + '!'); Sfx.fever(); }, 900);
    } else {
      G.coinsRun += 50;
      setTimeout(() => toast('🎁 Jackpot +50🪙!'), 900);
    }
  }
  updateHUD();
}
function onCrossRow(row, i) {
  const G = Game, b = G.ball;
  // v9: 👻 skip token — phase through the next row untouched
  if (G.skipNext) {
    G.skipNext = false;
    G.streak = 0; G.pchain = 0;
    popup('👻 PHASED!', '#9df');
    burst(G.W / 2, row.y - G.camY, '#9df', 16);
    Sfx.tone(900, 0.2, 'sine', 0.15, 300);
    updateHUD();
    return;
  }
  // v9: 🦎 chameleon gap — passable only when the cycling color matches the ball.
  // Mistimed drops bounce off safely (no death); the cycle always comes around.
  if (row.cham && chameleonColor() !== b.color) {
    b.y = row.y; b.vy = -PHYS.bounceV;
    if (G.streak > 0) G.streak = 0;
    G.pchain = 0;
    popup('🦎 NOT YET!', '#7dff9d');
    Sfx.tone(220, 0.12, 'square', 0.12, 140);
    updateHUD();
    return;
  }
  const rel = angDist(0, norm(row.gapC + G.rot));
  // The golden finish ring (no game color) is the goal line: the ball always
  // drops through it — you can never get stuck bouncing on the finish.
  if (row.color === -1 || rel < row.gapH - 0.03) {
    // PASS THROUGH the gap
    G.streak++;
    G.bestStreak = Math.max(G.bestStreak, G.streak);
    let pts = 10 * G.streak;
    const perfect = rel < row.gapH * 0.35;
    if (perfect) {
      pts = Math.round(pts * 1.5);
      popup('PERFECT +' + pts, '#ffd700'); Sfx.perfect();
      addFever(34); missionEv('perfect'); buzz([15, 30, 15]);
      Game.tPerfect++;
      if (Game.tPerfect >= 10) awardTrophy('perfect10');
      stat('perfects');
      // v9: 🔥 perfect-chain builds on consecutive PERFECTs
      G.pchain = (G.pchain || 0) + 1;
      const pm = pchainMult();
      if (pm > 1) popup('🔥 CHAIN x' + pm + ' COINS!', '#ff9d00');
    } else {
      // v9: any non-PERFECT pass resets the perfect-chain
      G.pchain = 0;
      if (rel > row.gapH * 0.8) {
      pts += 15; popup('CLOSE! +' + pts, '#ff9d00');
      addFever(15);
      // near-miss slow-mo: savor the thread
      G.timeScale = 0.45; G.slowT = 0.35;
      buzz(20);
    } else {
      addFever(8);
      if (G.streak >= 3) popup('x' + G.streak + ' COMBO', '#ff2fd6');
    }
    }
    pts = Math.round(pts * scoreMult());
    if (row.golden) { // golden gap jackpot: 3x
      pts *= 3;
      popup('GOLDEN +' + pts, '#ffd700');
      Sfx.power();
      burst(G.W / 2, row.y - G.camY, '#ffd700', 24);
    }
    if (G.playMode === 'sudden') pts *= 3; // sudden death: triple stakes
    if (G.playMode === 'dual') pts *= 2; // v9: dual drop — two balls, double score
    G.score += pts;
    G.rowIndex = Math.max(G.rowIndex, i);
    stat('rows');
    Sfx.bounce(G.streak);
    buzz(10);
    burst(G.W / 2, row.y - G.camY, PALETTE[b.color].main, 8);
    missionEv('score', G.score);
    missionEv('row', G.rowIndex + 1);
    missionEv('combo', G.streak);
    if (G.rowIndex + 1 >= 50) awardTrophy('rows50');
    // v9: 🎁 milestone chest every 25 rows
    if ((G.rowIndex + 1) % 25 === 0) spawnChest();
    checkRival();
    updateHUD();
    if (G.playMode === 'levels' && i === G.rows.length - 1) levelComplete();
  } else {
    // LAND on the platform ring
    const localA = norm(0 - G.rot);
    for (const s of row.reds) {
      if (inArc(localA, s.a0, s.a1)) { endRunDeath('spikes'); return; }
    }
    // v9: 👯 dual drop — BOTH balls must match, or both shatter
    const b2ok = G.playMode !== 'dual' || row.color === -1 || row.color === G.ball2.color;
    if (row.color === -1 || row.color === b.color) {
      if (!b2ok) { endRunDeath('color'); return; }
      b.y = row.y; b.vy = -PHYS.bounceV;
      if (G.streak > 0) G.streak = 0;
      G.pchain = 0; // v9: landing resets perfect-chain
      addFever(-8); // bouncing without passing cools the meter
      Sfx.bounce(0);
      updateHUD();
    } else {
      endRunDeath('color');
    }
  }
}

/* ---------------- Particles & popups ---------------- */
function burst(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), sp = rand(60, 420);
    Game.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, life: rand(0.3, 0.9), max: 0.9, color, size: rand(2, 6) });
  }
}
function updateParticles(dt) {
  const ps = Game.particles;
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i];
    p.life -= dt; if (p.life <= 0) { ps.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 500 * dt;
  }
  if (ps.length > 400) ps.splice(0, ps.length - 400);
  // ball trail
  const tid = Save.data.trails.sel;
  if (Game.mode === 'playing' && tid !== 'none' && Math.random() < 0.7) {
    const cols = { sparkle: ['#fff', '#ffd700'], bubbles: ['#9df', '#0ff'], stars: ['#ffd700', '#fff'], lightning: ['#ff0', '#0ff'], rainbow: ['#f00', '#0f0', '#00f', '#ff0', '#f0f'], ember: ['#ff9d00', '#ff4400', '#ffdd55'] };
    const c = cols[tid] || ['#fff'];
    Game.particles.push({ x: Game.W / 2 + rand(-6, 6), y: Game.ballScreenY + rand(-6, 6), vx: rand(-30, 30), vy: rand(20, 90), life: 0.5, max: 0.5, color: c[randi(0, c.length - 1)], size: rand(2, 4) });
  }
}
function popup(text, color) {
  Game.popups.push({ x: Game.W / 2, y: Game.ballScreenY - 70, text, color: color || '#fff', life: 1.1 });
}
function updatePopups(dt) {
  const ps = Game.popups;
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i]; p.life -= dt; p.y -= 46 * dt;
    if (p.life <= 0) ps.splice(i, 1);
  }
}

/* ---------------- Canvas & layout ---------------- */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let DPR = 1;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  Game.W = window.innerWidth; Game.H = window.innerHeight;
  canvas.width = Game.W * DPR; canvas.height = Game.H * DPR;
  canvas.style.width = Game.W + 'px'; canvas.style.height = Game.H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  Game.R = clamp(Math.min(Game.W, Game.H) * 0.30, 90, 170);
  Game.ballScreenY = Game.H * 0.36;
  initStars();
}
window.addEventListener('resize', resize);

function initStars() {
  Game.stars = [];
  for (let i = 0; i < 80; i++) Game.stars.push({ x: rand(0, Game.W), y: rand(0, Game.H), s: rand(0.6, 2.4), tw: rand(0, TAU) });
  Game.embers = [];
  for (let i = 0; i < 36; i++) Game.embers.push({ x: rand(0, Game.W), y: rand(0, Game.H), s: rand(1, 3), v: rand(12, 42) });
}

/* ---------------- Rendering ---------------- */
function theme() { return THEMES.find(t => t.id === Save.data.themes.sel) || THEMES[0]; }

function drawBackground() {
  const th = theme();
  const g = ctx.createLinearGradient(0, 0, 0, Game.H);
  g.addColorStop(0, th.bg[0]); g.addColorStop(1, th.bg[1]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, Game.W, Game.H);
  // parallax grid
  ctx.strokeStyle = th.grid; ctx.lineWidth = 1;
  const off = (Game.camY * 0.25) % 90;
  ctx.beginPath();
  for (let y = -90 + off; y < Game.H + 90; y += 90) { ctx.moveTo(0, y); ctx.lineTo(Game.W, y); }
  ctx.stroke();
  // stars
  for (const s of Game.stars) {
    const y = ((s.y - Game.camY * 0.08) % Game.H + Game.H) % Game.H;
    const a = 0.35 + 0.35 * Math.sin(Game.time * 2 + s.tw);
    ctx.globalAlpha = a; ctx.fillStyle = th.star;
    ctx.fillRect(s.x, y, s.s, s.s);
  }
  // slow rising embers for depth
  if (Game.embers) for (const e of Game.embers) {
    const y = (((e.y - Game.time * e.v) % (Game.H + 40)) + Game.H + 40) % (Game.H + 40) - 20;
    ctx.globalAlpha = 0.22; ctx.fillStyle = th.star;
    ctx.fillRect(e.x, y, e.s, e.s);
  }
  ctx.globalAlpha = 1;
}

function drawColumn() {
  const cx = Game.W / 2, w = Game.R * 0.85;
  const g = ctx.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
  g.addColorStop(0, '#050510'); g.addColorStop(0.5, '#1c1c44'); g.addColorStop(1, '#050510');
  ctx.fillStyle = g;
  ctx.fillRect(cx - w / 2, -20, w, Game.H + 40);
  ctx.fillStyle = 'rgba(0,240,255,.08)';
  ctx.fillRect(cx - w / 2, -20, 3, Game.H + 40);
  ctx.fillRect(cx + w / 2 - 3, -20, 3, Game.H + 40);
  // slow energy band traveling up the column
  const bandY = Game.H + 200 - ((Game.time * 110) % (Game.H + 400));
  const eg = ctx.createLinearGradient(0, bandY - 80, 0, bandY + 80);
  eg.addColorStop(0, 'rgba(0,240,255,0)');
  eg.addColorStop(0.5, 'rgba(0,240,255,.10)');
  eg.addColorStop(1, 'rgba(0,240,255,0)');
  ctx.fillStyle = eg;
  ctx.fillRect(cx - w / 2, 0, w, Game.H);
}

// point on ring: theta=0 faces viewer (bottom of ellipse)
function ringPt(theta, sy) {
  return [Game.W / 2 + Game.R * Math.sin(theta), sy + Game.R * 0.34 * Math.cos(theta)];
}
function strokeArc(thA, thB, sy, color, width, glow) {
  const n = Math.max(3, Math.ceil(Math.abs(thB - thA) / 0.07));
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const t = thA + (thB - thA) * (i / n);
    const [x, y] = ringPt(t, sy);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.strokeStyle = color; ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.shadowBlur = glow || 0; ctx.shadowColor = color;
  ctx.stroke(); ctx.shadowBlur = 0;
}

function drawRow(row) {
  const sy = row.y - Game.camY;
  if (sy < -80 || sy > Game.H + 80) return;
  const RING = Math.max(20, Game.R * 0.20);
  // Full 360° colored ring with the gap cut clean out, in WORLD angles
  // (theta = 0 faces the viewer). Lighting is fixed in world space — bright
  // front, dim back — so the tower reads as rotating under the light instead
  // of the shading spinning with your drag. The gap is the only opening.
  const gapW = norm(row.gapC + Game.rot); // gap center, world
  const gapH = row.gapH;
  // depth skirt
  ctx.globalAlpha = 0.5;
  strokeArc(-Math.PI / 2, Math.PI / 2, sy + RING * 0.55, '#020208', RING);
  ctx.globalAlpha = 1;
  // color -1 is the finish row: glowing golden goal ring, never a "grey" platform
  const base = row.color === -1 ? '#ffe9a3' : PALETTE[row.color].main;
  const dark = row.color === -1 ? 'rgba(255,233,163,.35)' : PALETTE[row.color].dim;
  // critical angles: gap edges + front/back lighting transitions
  const wpos = a => ((a % TAU) + TAU) % TAU;
  const crit = [...new Set([wpos(gapW - gapH), wpos(gapW + gapH), wpos(Math.PI / 2), wpos(-Math.PI / 2)])].sort((a, b) => a - b);
  for (let k = 0; k < crit.length; k++) {
    const a0 = crit[k], a1 = (k + 1 < crit.length) ? crit[k + 1] : crit[0] + TAU;
    if (a1 - a0 < 1e-4) continue;
    const midW = wpos((a0 + a1) / 2), mid = norm(midW);
    if (angDist(mid, gapW) < gapH - 1e-6) continue; // the gap: draw nothing
    const front = Math.abs(mid) < Math.PI / 2;
    strokeArc(a0, a1, sy, front ? base : dark, RING, front ? 12 : 0);
    if (row.golden && front) { // golden gap: pulsing gold shimmer on the solid arc
      const ga = 0.30 + 0.20 * Math.sin(Game.time * 6);
      strokeArc(a0, a1, sy, `rgba(255,215,0,${ga.toFixed(3)})`, RING * 0.5, 16);
    }
  }
  // v8: drifting gap motion trail — telegraphs which way the gap is moving
  if (row.drift) {
    const dir = row.drift > 0 ? 1 : -1;
    ctx.globalAlpha = 0.22;
    strokeArc(gapW - dir * 0.85, gapW - dir * 0.1, sy, base, RING * 0.55, 10);
    ctx.globalAlpha = 1;
  }
  // glowing caps on the gap edges so the opening reads at speed
  // (skipped on the near-full-circle finish ring)
  if (gapH < 1.2) for (const e of [gapW - gapH, gapW + gapH]) {
    const w = norm(e);
    const [gx, gy] = ringPt(w, sy);
    ctx.fillStyle = base; ctx.shadowBlur = 12; ctx.shadowColor = base;
    ctx.beginPath(); ctx.arc(gx, gy, 5, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
  }
  // v9: 🦎 chameleon — gap edges pulse with the cycling color (the timing signal)
  if (row.cham) {
    const cc = PALETTE[chameleonColor()].main;
    const pulse = 0.55 + 0.35 * Math.sin(Game.time * 8);
    ctx.globalAlpha = pulse;
    strokeArc(gapW - gapH - 0.14, gapW - gapH + 0.14, sy, cc, RING * 0.85, 18);
    strokeArc(gapW + gapH - 0.14, gapW + gapH + 0.14, sy, cc, RING * 0.85, 18);
    ctx.globalAlpha = 1;
  }
  // symbol mode: paint the color's shape on the ring (rotates with the tower)
  if (Save.data.symbols && row.color >= 0) {
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const la of [-0.75, 0, 0.75]) {
      const w = norm(la + Game.rot);
      if (Math.abs(w) > Math.PI / 2 - 0.15) continue; // front only
      if (angDist(w, gapW) < gapH + 0.1) continue; // not in the gap
      const [sx2, sy2] = ringPt(w, sy);
      ctx.fillText(SYMBOLS[row.color], sx2, sy2);
    }
  }
  // red spike sectors (front half only matters for landing, but draw all)
  for (const s of row.reds) {
    const a0 = s.a0 + Game.rot, a1 = s.a1 + Game.rot;
    strokeArc(a0, a1, sy, '#ff2244', RING, 16);
    // spike teeth
    const n = Math.max(2, Math.floor((a1 - a0) / 0.18));
    ctx.fillStyle = '#ff8095';
    for (let i = 0; i <= n; i++) {
      const t = a0 + (a1 - a0) * (i / n);
      const [x, y] = ringPt(t, sy);
      ctx.beginPath(); ctx.moveTo(x - 5, y - RING / 2); ctx.lineTo(x + 5, y - RING / 2); ctx.lineTo(x, y - RING / 2 - 12); ctx.fill();
    }
  }
}

function drawGate(gt) {
  const sy = gt.y - Game.camY;
  if (sy < -60 || sy > Game.H + 60) return;
  const th = gt.localA + Game.rot;
  const [x, y] = ringPt(th, sy);
  const c = PALETTE[gt.color].main;
  const p = 1 + 0.14 * Math.sin(Game.time * 6);
  // vertical light beam so the gate is visible from far above
  ctx.globalAlpha = 0.16 + 0.06 * Math.sin(Game.time * 6);
  ctx.fillStyle = c;
  ctx.fillRect(x - 12, y - 110, 24, 220);
  ctx.globalAlpha = 1;
  const r = 30 * p;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(Math.PI / 4 + Game.time * 1.5);
  ctx.strokeStyle = c; ctx.lineWidth = 7; ctx.shadowBlur = 24; ctx.shadowColor = c;
  ctx.strokeRect(-r / 1.4, -r / 1.4, r * 1.43, r * 1.43);
  ctx.restore(); ctx.shadowBlur = 0;
  ctx.fillStyle = c; ctx.globalAlpha = 0.95;
  ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('◈ REPAINT' + (Save.data.symbols ? ' ' + SYMBOLS[gt.color] : '') + ' ◈', x, y + 44);
  ctx.globalAlpha = 1;
}

function drawCoin(c) {
  if (c.taken) return;
  const sy = c.y - Game.camY;
  if (sy < -40 || sy > Game.H + 40) return;
  const th = c.localA + Game.rot;
  const [x, y] = ringPt(th, sy);
  const sq = Math.abs(Math.cos(Game.time * 5));
  ctx.save();
  ctx.translate(x, y); ctx.scale(Math.max(0.25, sq), 1);
  ctx.fillStyle = '#ffd700'; ctx.shadowBlur = 14; ctx.shadowColor = '#ffd700';
  ctx.beginPath(); ctx.arc(0, 0, 11, 0, TAU); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#a86f00'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(0, 0, 11, 0, TAU); ctx.stroke();
  ctx.fillStyle = '#a86f00'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('$', 0, 1);
  ctx.restore();
}

function drawChest(ch) {
  if (ch.taken) return;
  const sy = ch.y - Game.camY;
  if (sy < -40 || sy > Game.H + 40) return;
  const th = ch.localA + Game.rot;
  const [x, y] = ringPt(th, sy);
  const bob = Math.sin(Game.time * 3 + ch.y) * 6;
  ctx.save();
  ctx.translate(x, y + bob);
  ctx.shadowBlur = 22; ctx.shadowColor = '#ffd700';
  ctx.fillStyle = 'rgba(20,12,2,.92)';
  ctx.beginPath(); ctx.arc(0, 0, 19, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(0, 0, 19, 0, TAU); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.font = '20px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('🎁', 0, 1);
  ctx.restore();
}

function drawPowerup(p) {
  if (p.taken) return;
  const sy = p.y - Game.camY;
  if (sy < -40 || sy > Game.H + 40) return;
  const th = p.localA + Game.rot;
  const [x, y] = ringPt(th, sy);
  const meta = PU_META[p.kind];
  const bob = Math.sin(Game.time * 4 + p.y) * 6;
  ctx.save();
  ctx.translate(x, y + bob);
  ctx.shadowBlur = 18; ctx.shadowColor = meta.color;
  ctx.fillStyle = 'rgba(5,5,20,.85)';
  ctx.beginPath(); ctx.arc(0, 0, 17, 0, TAU); ctx.fill();
  ctx.strokeStyle = meta.color; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(0, 0, 17, 0, TAU); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.font = '17px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(meta.emoji, 0, 1);
  ctx.restore();
}

function drawBall() {
  if (Game.mode === 'dying' || Game.mode === 'gameover') return;
  // v9: 👯 dual drop — draw both balls (mirrored offsets, shared y)
  if (Game.ball2) {
    drawOneBall(-20, Game.ball.color);
    drawOneBall(20, Game.ball2.color);
    return;
  }
  drawOneBall(0, Game.ball.color);
}
function drawOneBall(xOff, colorIdx) {
  const x = Game.W / 2 + xOff, y = Game.ballScreenY;
  const b = Game.ball, col = PALETTE[colorIdx];
  const squash = clamp(1 - Math.abs(b.vy) / 6000, 0.78, 1);
  const skin = Save.data.balls.sel;
  ctx.save();
  ctx.translate(x, y); ctx.scale(1 / squash, squash);
  ctx.shadowBlur = 22; ctx.shadowColor = col.main;
  const r = b.r;
  // saturated color with a small white hot core (reads clearly at phone size)
  const baseGrad = () => { const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.15, 0, 0, r); g.addColorStop(0, '#ffffff'); g.addColorStop(0.32, col.main); g.addColorStop(1, col.main); return g; };
  ctx.fillStyle = baseGrad();
  const drawCore = (alpha) => { ctx.globalAlpha = alpha; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; };
  switch (skin) {
    case 'comet':
      ctx.fillStyle = col.main; ctx.globalAlpha = 0.55;
      ctx.beginPath(); ctx.moveTo(-r * 0.6, -r * 2.6); ctx.lineTo(r * 0.6, -r * 2.6); ctx.lineTo(0, -r * 0.6); ctx.fill();
      ctx.globalAlpha = 1; drawCore(1); break;
    case 'planet':
      drawCore(1);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.ellipse(0, 0, r * 1.7, r * 0.55, -0.4, 0, TAU); ctx.stroke();
      break;
    case 'ghost': drawCore(0.5); break;
    case 'nova':
      drawCore(1);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
      for (let i = 0; i < 8; i++) {
        const a = Game.time * 2 + i * TAU / 8;
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 1.1, Math.sin(a) * r * 1.1);
        ctx.lineTo(Math.cos(a) * r * 1.7, Math.sin(a) * r * 1.7); ctx.stroke();
      }
      break;
    case 'yinyang':
      ctx.fillStyle = col.main; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
      ctx.fillStyle = '#0a0a1a'; ctx.beginPath(); ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2); ctx.fill();
      ctx.fillStyle = col.main; ctx.beginPath(); ctx.arc(0, -r / 2, r * 0.28, 0, TAU); ctx.fill();
      ctx.fillStyle = '#0a0a1a'; ctx.beginPath(); ctx.arc(0, r / 2, r * 0.28, 0, TAU); ctx.fill();
      break;
    case 'lava':
      ctx.fillStyle = baseGrad('#ffdd55', '#ff4400'); ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#5a1500'; ctx.lineWidth = 2;
      for (let i = 0; i < 4; i++) { const a = i * 1.7 + 0.5; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); ctx.stroke(); }
      break;
    case 'prism': {
      const hue = (Game.time * 140) % 360;
      ctx.fillStyle = baseGrad('#ffffff', `hsl(${hue},100%,60%)`);
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
      break;
    }
    default: drawCore(1);
  }
  // crisp color ring so the ball's color reads at a glance on small screens
  ctx.strokeStyle = col.main; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, 0, r + 2, 0, TAU); ctx.stroke();
  // soft pulsing halo
  ctx.globalAlpha = 0.22 + 0.08 * Math.sin(Game.time * 5);
  ctx.strokeStyle = col.main; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, r + 9, 0, TAU); ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore(); ctx.shadowBlur = 0;
  if (Game.shield > 0) {
    ctx.strokeStyle = `rgba(0,255,255,${0.4 + 0.4 * Math.sin(Game.time * 10)})`;
    ctx.lineWidth = 3; ctx.setLineDash([10, 8]);
    ctx.beginPath(); ctx.arc(x, y, r + 12, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
  }
  // shield powerup: solid cyan hex ring while armed
  if (Game.puShield && Game.mode === 'playing') {
    ctx.strokeStyle = `rgba(125,249,255,${0.65 + 0.3 * Math.sin(Game.time * 6)})`;
    ctx.lineWidth = 3.5; ctx.shadowBlur = 14; ctx.shadowColor = '#7df9ff';
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      const a = i / 6 * TAU + Game.time * 0.8;
      const px = x + Math.cos(a) * (r + 16), py = y + Math.sin(a) * (r + 16);
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke(); ctx.shadowBlur = 0;
  }
}

function render() {
  const G = Game;
  let sx = 0, sy = 0;
  if (G.shake > 0) { sx = rand(-G.shake, G.shake); sy = rand(-G.shake, G.shake); }
  ctx.save();
  ctx.translate(sx, sy);
  drawBackground();
  drawColumn();
  const rows = G.rows.slice().sort((a, b) => a.y - b.y); // far (top) first
  for (const r of rows) drawRow(r);
  for (const gt of G.gates) drawGate(gt);
  for (const c of G.coins) drawCoin(c);
  for (const p of G.powerups) drawPowerup(p);
  for (const ch of G.chests) drawChest(ch); // v9 🎁
  // v8: ghost marker — your best depth, chase it
  if ((G.playMode === 'endless' || G.playMode === 'daily' || G.playMode === 'sudden' || G.playMode === 'dual') && G.ghostY > 0) {
    const gy = G.ghostY - G.camY;
    if (gy > -20 && gy < G.H + 20) {
      ctx.save();
      ctx.strokeStyle = 'rgba(153,221,255,.7)'; ctx.lineWidth = 2; ctx.setLineDash([12, 10]);
      ctx.shadowBlur = 10; ctx.shadowColor = '#9df';
      ctx.beginPath(); ctx.moveTo(20, gy); ctx.lineTo(G.W - 20, gy); ctx.stroke();
      ctx.setLineDash([]); ctx.shadowBlur = 0;
      ctx.fillStyle = '#9df'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'left';
      ctx.fillText('👻 BEST', 24, gy - 8);
      ctx.restore();
    }
  }
  // v8: depth zone tint wash
  if (G.playMode !== 'levels' && G.zone > 0) {
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = ZONES[G.zone % ZONES.length].tint;
    ctx.fillRect(0, 0, G.W, G.H);
    ctx.globalAlpha = 1;
  }
  drawBall();
  // fever gold vignette while active
  if (G.feverT > 0) {
    const vg = ctx.createRadialGradient(G.W / 2, G.H / 2, G.H * 0.25, G.W / 2, G.H / 2, G.H * 0.75);
    const a = 0.22 + 0.08 * Math.sin(G.time * 8);
    vg.addColorStop(0, 'rgba(255,215,0,0)');
    vg.addColorStop(1, `rgba(255,180,0,${a})`);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, G.W, G.H);
  }
  // gold flash on fever trigger
  if (G.feverFlash > 0) {
    ctx.fillStyle = `rgba(255,215,0,${G.feverFlash * 0.25})`;
    ctx.fillRect(0, 0, G.W, G.H);
  }
  // particles
  for (const p of G.particles) {
    ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
  // popups
  ctx.textAlign = 'center';
  for (const p of G.popups) {
    ctx.globalAlpha = clamp(p.life, 0, 1);
    ctx.font = '800 20px sans-serif';
    ctx.fillStyle = p.color; ctx.shadowBlur = 10; ctx.shadowColor = p.color;
    ctx.fillText(p.text, p.x, p.y);
  }
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  ctx.restore();
}

/* ---------------- Input ---------------- */
let dragging = false, lastX = 0, lastT = 0;
canvas.addEventListener('pointerdown', e => {
  Sfx.init();
  if (Sfx.ctx && Sfx.ctx.state === 'suspended') Sfx.ctx.resume();
  if (Game.mode === 'playing') { dragging = true; lastX = e.clientX; lastT = performance.now(); Game.rotVel = 0; }
});
window.addEventListener('pointermove', e => {
  if (!dragging || Game.mode !== 'playing') return;
  const now = performance.now();
  const dx = e.clientX - lastX;
  const dth = dx * PHYS.rotSense;
  Game.rot += dth;
  const dt = Math.max((now - lastT) / 1000, 0.008);
  Game.rotVel = clamp(lerp(Game.rotVel, dth / dt, 0.5), -PHYS.maxRotVel, PHYS.maxRotVel);
  lastX = e.clientX; lastT = now;
});
window.addEventListener('pointerup', () => { dragging = false; Game.rotVel = 0; });
window.addEventListener('pointercancel', () => { dragging = false; Game.rotVel = 0; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft') Game.keyDir = -1;
  if (e.key === 'ArrowRight') Game.keyDir = 1;
  if (e.key === 'Escape' && Game.mode === 'playing') pauseGame();
});
window.addEventListener('keyup', e => {
  if ((e.key === 'ArrowLeft' && Game.keyDir === -1) || (e.key === 'ArrowRight' && Game.keyDir === 1)) { Game.keyDir = 0; Game.rotVel = 0; }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && Game.mode === 'playing') pauseGame();
});

/* ---------------- UI ---------------- */
const $ = id => document.getElementById(id);
const screens = ['menu', 'levels', 'shop', 'howto', 'pause', 'gameover', 'leveldone', 'adcard', 'trophies', 'login', 'stats'];
function showScreen(id) {
  for (const s of screens) $(s).classList.toggle('hidden', s !== id);
}
function hud(on) { $('hud').classList.toggle('hidden', !on); }
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(t._tm);
  t._tm = setTimeout(() => t.classList.add('hidden'), 1700);
}
function updateHUD() {
  $('hud-score').textContent = Game.score;
  const rows = Math.max(0, Game.rowIndex + 1) + ' ROWS';
  $('hud-level').textContent = Game.playMode === 'endless' ? 'ENDLESS · ' + rows
    : Game.playMode === 'rush' ? 'RUSH · ' + fmtTime(Game.timeLeft)
    : Game.playMode === 'sudden' ? '💀 SUDDEN · ' + rows
    : Game.playMode === 'dual' ? '👯 DUAL · ' + rows
    : Game.playMode === 'daily' ? '📅 DAILY · ' + rows + ' · 🔥' + Save.data.daily.streak
    : 'LEVEL ' + Game.level;
  $('coin-count').textContent = Save.data.coins;
  // "you are this color" chip — the core of the color mechanic, always visible
  // v9: 👯 dual drop shows BOTH ball colors
  const c = PALETTE[Game.ball.color];
  if (Game.ball2) {
    const c2 = PALETTE[Game.ball2.color];
    $('hud-cname').textContent = c.name.toUpperCase() + ' + ' + c2.name.toUpperCase();
    $('hud-dot').style.background = 'linear-gradient(90deg,' + c.main + ',' + c2.main + ')';
    $('hud-dot').style.boxShadow = '0 0 8px ' + c.main;
  } else {
    $('hud-cname').textContent = (Save.data.symbols ? SYMBOLS[Game.ball.color] + ' ' : '') + c.name.toUpperCase();
    $('hud-dot').style.background = c.main;
    $('hud-dot').style.boxShadow = '0 0 8px ' + c.main;
  }
  $('hud-color').style.borderColor = c.main;
  const cb = $('combo-badge');
  if (Game.streak >= 3) { cb.textContent = 'x' + Game.streak + ' COMBO'; cb.classList.remove('hidden'); }
  else cb.classList.add('hidden');
  // v9: 🔥 perfect-chain badge
  const chb = $('chain-badge');
  if (chb) {
    if ((Game.pchain || 0) >= 2) {
      const pm = pchainMult();
      chb.textContent = '🔥 ' + Game.pchain + ' CHAIN' + (pm > 1 ? ' · x' + pm + '🪙' : '');
      chb.classList.remove('hidden');
    } else chb.classList.add('hidden');
  }
  // v9: 👻 skip token button
  const sk = $('btn-skip');
  if (sk) {
    const n = Save.data.skipTokens || 0;
    sk.innerHTML = '👻' + (n > 0 ? '<span class="sk-n">' + n + '</span>' : '');
    sk.classList.toggle('active', !!Game.skipNext);
    sk.style.display = Game.mode === 'playing' ? '' : 'none';
  }
}
function useSkipToken() {
  if (Game.mode !== 'playing' || Game.skipNext) return;
  if ((Save.data.skipTokens || 0) <= 0) { toast('No 👻 skip tokens — grab one in the SHOP!'); return; }
  Save.data.skipTokens--;
  Save.save();
  Game.skipNext = true;
  Sfx.power();
  toast('👻 Skip armed — phasing through the next row!');
  updateHUD();
}

function refreshMenu() {
  const best = Math.max(Save.data.best.endless, Save.data.best.rush || 0, Save.data.best.sudden || 0, Save.data.best.dual || 0, ...Object.values(Save.data.best.levels), ...Object.values(Save.data.daily.best), 0);
  $('menu-best').textContent = best;
  $('menu-coins').textContent = Save.data.coins;
  // daily button sub: streak + today's best
  const d = Save.data.daily, today = dayStr();
  $('daily-sub').textContent = d.streak > 0 ? `🔥${d.streak} day streak · best today ${d.best[today] || 0}` : 'same tower for everyone · new every day';
  // missions panel
  ensureMissions();
  const mp = $('missions');
  mp.innerHTML = '<div class="missions-title">🎯 MISSIONS</div>' + Save.data.missions.map(m => {
    const def = missionDef(m.id);
    if (!def) return '';
    const pct = Math.min(100, Math.round((m.progress || 0) / def.target * 100));
    return `<div class="mission"><div class="mission-desc">${def.desc}</div>` +
      `<div class="mission-bar"><div style="width:${pct}%"></div></div>` +
      `<div class="mission-reward">+${def.reward}🪙</div></div>`;
  }).join('');
  // rival banner
  const rb = $('rival-banner');
  if (Game.rival && !Game.rival._dismissed) {
    rb.classList.remove('hidden');
    $('rival-text').textContent = `🎯 RIVAL ${Game.rival.score.toLocaleString()} (${Game.rival.mode.toUpperCase()}) — beat it!`;
  } else rb.classList.add('hidden');
  // v7: rank + trophies + symbols + boosts
  const ri = rankFor(Save.data.xp);
  $('rank-badge').textContent = '⬆ ' + RANKS[ri].name + ' · ' + Save.data.xp + ' XP';
  const next = RANKS[ri + 1];
  $('rank-fill').style.width = next ? Math.min(100, Math.round(Save.data.xp / next.xp * 100)) + '%' : '100%';
  $('trophy-count').textContent = Save.data.trophies.length + '/' + TROPHIES.length;
  $('symbols-state').textContent = Save.data.symbols ? 'ON' : 'OFF';
  $('btn-boost-shield').textContent = Save.data.boost === 'shield' ? '🛡 ARMED ✓' : '🛡 BOOST 📺';
  $('btn-boost-magnet').textContent = Save.data.boost === 'magnet' ? '🧲 ARMED ✓' : '🧲 BOOST 📺';
}

function renderTrophies() {
  $('trophy-list').innerHTML = TROPHIES.map(t => {
    const got = Save.data.trophies.includes(t.id);
    return `<div class="trophy ${got ? 'got' : ''}"><div class="t-emoji">${got ? '🏆' : '🔒'}</div>` +
      `<div><div class="t-name">${t.name}</div><div class="t-desc">${t.desc} · +30🪙</div></div></div>`;
  }).join('');
}

function fmtPlayTime(s) {
  s = Math.floor(s || 0);
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
  return h > 0 ? h + 'h ' + m + 'm' : m + 'm';
}
function renderStats() {
  const s = ensureStats();
  const rows = [
    ['Runs played', s.runs],
    ['Rows threaded', (s.rows || 0).toLocaleString()],
    ['PERFECT gaps', (s.perfects || 0).toLocaleString()],
    ['Repaints', (s.repaints || 0).toLocaleString()],
    ['FEVERS triggered', s.fevers || 0],
    ['Time played', fmtPlayTime(s.playTime)],
    ['Player XP', (Save.data.xp || 0).toLocaleString()],
    ['Trophies', Save.data.trophies.length + '/' + TROPHIES.length]
  ];
  $('stats-list').innerHTML = rows.map(([k, v]) =>
    `<div class="stat-row"><span>${k}</span><b>${v}</b></div>`).join('');
}

function renderLogin() {
  const l = Save.data.login;
  l.freeze = l.freeze || 0;
  $('login-day').textContent = Math.min(l.streak, 7);
  $('login-grid').innerHTML = LOGIN_REWARDS.map((r, i) => {
    const day = i + 1;
    const cls = day < l.streak ? 'done' : day === l.streak ? 'today' : '';
    return `<div class="login-cell ${cls}"><div class="d">DAY ${day}</div><div class="r">${day === 7 ? r + '🪙<br>🔥' : r + '🪙'}</div></div>`;
  }).join('');
  // v9: ❄️ streak freeze
  const fr = $('login-freeze-row');
  if (fr) {
    fr.innerHTML = `<div class="freeze-info">❄️ Freezes banked: <b>${l.freeze}/${FREEZE_MAX}</b> <span class="freeze-sub">protects your streak if you miss a day</span></div>` +
      `<button id="btn-freeze-buy" class="small-btn" ${l.freeze >= FREEZE_MAX ? 'disabled' : ''}>❄️ BANK FREEZE · ${FREEZE_PRICE}🪙</button>`;
    const bb = $('btn-freeze-buy');
    if (bb) bb.onclick = () => { Sfx.click(); buyFreeze(); };
  }
}

function armBoost(kind) {
  Sfx.click();
  if (Save.data.boost === kind) { toast('Already armed for your next run!'); return; }
  Ads.rewarded('boost', earned => {
    if (earned) {
      Save.data.boost = kind; Save.save();
      refreshMenu();
      toast((kind === 'shield' ? '🛡 Shield' : '🧲 Magnet') + ' armed for your next run!');
    }
  });
}
function goMenu() {
  Game.mode = 'menu';
  hud(false);
  Save.save(); // flush playTime + stats
  refreshMenu();
  showScreen('menu');
}

function showGameOver() {
  $('go-title').textContent = Game.deathCause === 'spikes' ? 'SKEWERED' : 'SHATTERED';
  $('go-cause').textContent = Game.deathCause === 'spikes'
    ? 'Red sectors are spikes — steer clear of them.'
    : 'Wrong color! Fly through the glowing ring to repaint first.';
  $('go-score').textContent = Game.score;
  const best = Game.playMode === 'endless' ? Save.data.best.endless
    : Game.playMode === 'rush' ? Save.data.best.rush
    : Game.playMode === 'sudden' ? Save.data.best.sudden
    : Game.playMode === 'daily' ? (Save.data.daily.best[dayStr()] || 0)
    : (Save.data.best.levels[Game.level] || 0);
  $('go-best').textContent = best;
  $('go-mode').textContent = Game.playMode === 'daily' ? '📅 DAILY · 🔥' + Save.data.daily.streak + ' DAY STREAK'
    : Game.playMode === 'sudden' ? '💀 SUDDEN DEATH · 3× SCORE'
    : Game.playMode === 'dual' ? '👯 DUAL DROP · 2× SCORE' : '';
  $('go-coins').textContent = '+' + Game.coinsRun;
  $('go-newbest').classList.toggle('hidden', !Game.newBest);
  // sudden death: no revive, ever
  const noRevive = Game.revived || Game.playMode === 'sudden';
  $('btn-revive').disabled = noRevive;
  $('btn-revive').style.display = noRevive ? 'none' : 'block';
  hud(false);
  showScreen('gameover');
}

function showLevelDone(bonus) {
  $('ld-score').textContent = Game.score;
  $('ld-bonus').textContent = '+' + Game.coinsRun + ' 🪙';
  $('btn-double').disabled = false;
  $('btn-double').style.display = 'block';
  const h2 = document.querySelector('#leveldone h2');
  const nx = $('btn-next');
  if (Game.playMode === 'rush') {
    h2.textContent = "TIME'S UP!";
    nx.innerHTML = '↻ RUSH AGAIN';
    nx.onclick = () => { Sfx.click(); startRun('rush'); };
  } else {
    h2.textContent = 'LEVEL CLEAR!';
    nx.innerHTML = 'NEXT LEVEL →';
    nx.onclick = () => { Sfx.click(); startRun('levels', Game.level + 1); };
  }
  hud(false);
  showScreen('leveldone');
}

/* simulated ad card — stands in for AdMob in the web build */
let adTimer = null;
function showAdCard(rewarded, returnTo, cb) {
  showScreen('adcard');
  const cd = $('ad-countdown'), close = $('ad-close');
  close.classList.add('hidden');
  let t = rewarded ? 3 : 2;
  const finish = (earned) => {
    clearInterval(adTimer); adTimer = null;
    showScreen(returnTo || null);
    cb(earned);
  };
  window.NH._adFinish = finish;
  cd.textContent = rewarded ? `Reward in ${t}…` : `Closing in ${t}…`;
  adTimer = setInterval(() => {
    t--;
    if (t <= 0) {
      clearInterval(adTimer); adTimer = null;
      if (rewarded) { cd.textContent = 'Done!'; close.classList.remove('hidden'); close.onclick = () => { Sfx.click(); finish(true); }; }
      else finish(true);
    } else cd.textContent = rewarded ? `Reward in ${t}…` : `Closing in ${t}…`;
  }, 1000);
}

/* ---------------- Level select ---------------- */
function renderLevels() {
  const grid = $('level-grid');
  grid.innerHTML = '';
  const N = Math.max(20, Save.data.unlocked + 4);
  for (let i = 1; i <= N; i++) {
    const b = document.createElement('button');
    b.className = 'level-cell' + (i > Save.data.unlocked ? ' locked' : '');
    b.textContent = i;
    if (i <= Save.data.unlocked) b.onclick = () => { Sfx.click(); startRun('levels', i); };
    grid.appendChild(b);
  }
}

/* ---------------- Shop ---------------- */
let shopTab = 'balls';
const SKIP_PRICE = 200;
const ITEMS = [
  { id: 'skip', name: 'Skip Token', emoji: '👻', price: SKIP_PRICE, desc: 'Phase through the next row untouched' }
];
function catalogFor(tab) {
  return tab === 'balls' ? { items: BALLS, key: 'balls' } : tab === 'trails' ? { items: TRAILS, key: 'trails' } : tab === 'items' ? { items: ITEMS, key: 'items' } : { items: THEMES, key: 'themes' };
}
function renderShop() {
  $('shop-coins').textContent = Save.data.coins;
  document.querySelectorAll('.shop-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === shopTab));
  const { items, key } = catalogFor(shopTab);
  const grid = $('shop-grid');
  grid.innerHTML = '';
  // v9: 👻 consumables tab — skip tokens (stackable, not equip)
  if (key === 'items') {
    const n = Save.data.skipTokens || 0;
    for (const it of items) {
      const d = document.createElement('div');
      d.className = 'shop-item owned';
      d.innerHTML = `<div class="preview"><div style="font-size:26px">${it.emoji}</div></div>` +
        `<div class="name">${it.name}</div><div class="price">OWNED: ${n}</div>` +
        `<div class="item-desc">${it.desc}</div>` +
        `<button class="small-btn buy-btn">BUY · 🪙${it.price}</button>`;
      d.querySelector('.buy-btn').onclick = (e) => {
        e.stopPropagation(); Sfx.click();
        if (Save.data.coins < it.price) { toast('Not enough coins!'); return; }
        Save.data.coins -= it.price;
        Save.data.skipTokens = (Save.data.skipTokens || 0) + 1;
        Save.save();
        Sfx.win();
        renderShop(); refreshMenu();
        toast('👻 Skip token bought! (' + Save.data.skipTokens + ' owned)');
      };
      grid.appendChild(d);
    }
    return;
  }
  const st = Save.data[key];
  for (const it of items) {
    const owned = st.owned.includes(it.id);
    const sel = st.sel === it.id;
    const d = document.createElement('div');
    d.className = 'shop-item' + (sel ? ' selected' : '') + (owned ? ' owned' : '');
    let preview = '';
    if (shopTab === 'balls') preview = `<div class="preview"><div style="width:30px;height:30px;border-radius:50%;background:radial-gradient(circle at 35% 35%, #fff, ${PALETTE[0].main});box-shadow:0 0 12px ${PALETTE[0].main}"></div></div>`;
    else if (shopTab === 'trails') preview = `<div class="preview"><div style="color:#ffd700;font-size:22px">${it.id === 'none' ? '—' : '✦✦✦'}</div></div>`;
    else { const th = THEMES.find(t => t.id === it.id); preview = `<div class="preview"><div style="width:44px;height:30px;border-radius:8px;background:linear-gradient(160deg,${th.bg[0]},${th.bg[1]});border:1px solid #fff3"></div></div>`; }
    d.innerHTML = `${preview}<div class="name">${it.name}</div><div class="price">${owned ? (sel ? 'EQUIPPED' : 'TAP TO USE') : it.exclusive ? '🔥 DAY 7 LOGIN' : '🪙 ' + it.price}</div>`;
    d.onclick = () => {
      Sfx.click();
      if (st.owned.includes(it.id)) { st.sel = it.id; Save.save(); renderShop(); }
      else if (it.exclusive) { toast('Earn this with a 7-day login streak!'); }
      else if (Save.data.coins >= it.price) {
        Save.data.coins -= it.price; st.owned.push(it.id); st.sel = it.id; Save.save();
        renderShop(); refreshMenu(); toast(it.name + ' unlocked!');
      } else {
        // rewarded placement 'skin': watch ad to earn coins toward it
        toast('Not enough coins — watch an ad for +50?');
        Ads.rewarded('skin', earned => {
          if (earned) { Save.data.coins += 50; Save.save(); renderShop(); refreshMenu(); toast('+50 coins!'); }
        });
      }
    };
    grid.appendChild(d);
  }
}

/* ---------------- Pause ---------------- */
function pauseGame() {
  if (Game.mode !== 'playing') return;
  Game.mode = 'paused';
  showScreen('pause');
}

/* ---------------- Wiring ---------------- */
function wire() {
  $('btn-levels').onclick = () => { Sfx.init(); Sfx.click(); renderLevels(); showScreen('levels'); };
  $('btn-endless').onclick = () => { Sfx.init(); Sfx.click(); startRun('endless'); };
  $('btn-rush').onclick = () => { Sfx.init(); Sfx.click(); startRun('rush'); };
  $('btn-sudden').onclick = () => { Sfx.init(); Sfx.click(); startRun('sudden'); };
  $('btn-dual').onclick = () => { Sfx.init(); Sfx.click(); startRun('dual'); };
  $('btn-daily').onclick = () => { Sfx.init(); Sfx.click(); startRun('daily'); };
  $('btn-skip').onclick = () => { Sfx.click(); useSkipToken(); };
  $('btn-stats').onclick = () => { Sfx.click(); renderStats(); showScreen('stats'); };
  $('btn-stats-back').onclick = () => { Sfx.click(); goMenu(); };
  $('rival-dismiss').onclick = (e) => { e.stopPropagation(); Sfx.click(); Game.rival._dismissed = true; refreshMenu(); };
  $('btn-share').onclick = () => {
    Sfx.click();
    const url = location.origin + location.pathname + '?rival=' + Game.score + '&rmode=' + Game.playMode;
    const done = () => toast('🔗 Rival link copied — send it!');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done).catch(() => toast(url));
    else toast(url);
  };
  $('btn-shop').onclick = () => { Sfx.click(); renderShop(); showScreen('shop'); };
  $('btn-how').onclick = () => { Sfx.click(); showScreen('howto'); };
  $('btn-trophies').onclick = () => { Sfx.click(); renderTrophies(); showScreen('trophies'); };
  $('btn-trophies-back').onclick = () => { Sfx.click(); goMenu(); };
  $('btn-symbols').onclick = () => {
    Sfx.click();
    Save.data.symbols = !Save.data.symbols; Save.save();
    refreshMenu();
    toast('Symbol mode ' + (Save.data.symbols ? 'ON ●▲■' : 'OFF'));
  };
  $('btn-boost-shield').onclick = () => armBoost('shield');
  $('btn-boost-magnet').onclick = () => armBoost('magnet');
  $('btn-login-claim').onclick = () => { Sfx.click(); claimLogin(); refreshMenu(); showScreen('menu'); };
  $('btn-how-back').onclick = () => { Sfx.click(); goMenu(); };
  $('btn-levels-back').onclick = () => { Sfx.click(); goMenu(); };
  $('btn-shop-back').onclick = () => { Sfx.click(); goMenu(); };
  document.querySelectorAll('.shop-tab').forEach(t => t.onclick = () => { Sfx.click(); shopTab = t.dataset.tab; renderShop(); });

  $('btn-pause').onclick = () => { Sfx.click(); pauseGame(); };
  $('btn-mute').onclick = () => {
    Sfx.init(); Sfx.click();
    Save.data.muted = !Save.data.muted; Save.save();
    Sfx.setMuted(Save.data.muted);
    $('btn-mute').textContent = Save.data.muted ? '🔇' : '🔊';
  };
  $('btn-resume').onclick = () => { Sfx.click(); Game.mode = 'playing'; showScreen(null); };
  $('btn-restart').onclick = () => { Sfx.click(); startRun(Game.playMode, Game.level); };
  $('btn-quit').onclick = () => { Sfx.click(); goMenu(); };

  $('btn-retry').onclick = () => { Sfx.click(); startRun(Game.playMode, Game.level); };
  $('btn-go-menu').onclick = () => { Sfx.click(); goMenu(); };
  $('btn-revive').onclick = () => { Sfx.click(); revive(); };

  $('btn-ld-menu').onclick = () => { Sfx.click(); goMenu(); };
  $('btn-double').onclick = () => {
    Sfx.click();
    Ads.rewarded('coins2x', earned => {
      if (earned) {
        const extra = Game.coinsRun;
        Game.coinsRun += extra; Save.data.coins += extra; Save.save();
        $('ld-bonus').textContent = '+' + Game.coinsRun + ' 🪙';
        $('btn-double').disabled = true; $('btn-double').style.display = 'none';
        toast('Coins doubled!');
      }
    });
  };
}

/* ---------------- Main loop ---------------- */
let lastFrame = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const rdt = clamp((now - lastFrame) / 1000, 0, 0.05);
  lastFrame = now;
  if (Game.mode === 'playing' || Game.mode === 'dying') {
    update(rdt * Game.timeScale);
    if (Game.mode === 'playing') stat('playTime', rdt); // career clock (saved on menu/death)
    if (Game.playMode === 'rush' && Game.mode === 'playing') {
      Game.timeLeft -= rdt;
      const s = Math.ceil(Game.timeLeft);
      if (s !== Game._lastRushSec) { Game._lastRushSec = s; updateHUD(); }
      if (Game.timeLeft <= 0) rushComplete();
    }
    // fever meter + powerup timers refresh (cheap DOM writes, only while playing)
    if (Game.mode === 'playing') {
      const fw = $('fever-fill');
      if (fw) {
        const pct = Game.feverT > 0 ? (Game.feverT / 10 * 100) : Game.fever;
        fw.style.width = pct + '%';
        fw.classList.toggle('active', Game.feverT > 0);
        $('fever-label').textContent = Game.feverT > 0 ? 'FEVER ' + Math.ceil(Game.feverT) + 's' : 'FEVER';
      }
      const pi = $('pu-icons');
      if (pi) {
        let html = '';
        if (Game.puShield) html += '<span title="Shield">🛡</span>';
        if (Game.puMagnet > 0) html += '<span>🧲' + Math.ceil(Game.puMagnet) + '</span>';
        if (Game.puStar > 0) html += '<span>⭐' + Math.ceil(Game.puStar) + '</span>';
        if (Game.puSlow > 0) html += '<span>⏳' + Math.ceil(Game.puSlow) + '</span>';
        if (html !== pi._last) { pi.innerHTML = html; pi._last = html; }
      }
    }
  } else if (Game.mode === 'menu') {
    Game.time += rdt;
    Game.rot += rdt * 0.5; // attract-mode spin
    updateParticles(rdt);
  }
  render();
}

/* ---------------- Boot ---------------- */
Save.load();
Sfx.muted = !!Save.data.muted;
// rival challenge link: ?rival=5200&rmode=endless
try {
  const q = new URLSearchParams(location.search);
  const r = parseInt(q.get('rival'), 10);
  if (r > 0) Game.rival = { score: r, mode: q.get('rmode') || 'endless', beaten: false };
} catch (e) {}
resize();
wire();
$('btn-mute').textContent = Save.data.muted ? '🔇' : '🔊';
refreshMenu();
showScreen('menu');
// v7: daily login reward (once per day, on boot)
if (checkLogin()) { renderLogin(); showScreen('login'); }
hud(false);
// attract-mode backdrop: a few demo rows behind the menu
(function demoRows() {
  const g = genLevel(1);
  Game.rows = g.rows.slice(0, 8);
  Game.ball.y = -400; Game.camY = Game.ball.y - Game.ballScreenY;
})();
requestAnimationFrame(loop);

/* ---------------- Debug API (used by headless QA; harmless in prod) ---------------- */
window.NH = {
  v: 1,
  game: Game, save: Save, ads: Ads,
  state: () => Game.mode,
  start: (m, l) => startRun(m || 'levels', l || 1),
  setRot: r => { Game.rot = r; },
  rot: () => Game.rot,
  setBallColor: c => { Game.ball.color = c; },
  score: () => Game.score,
  skipAd: () => { if (window.NH._adFinish) window.NH._adFinish(true); },
  _adFinish: null
};
