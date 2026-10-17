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
      best: { endless: 0, rush: 0, levels: {} },
      balls: { owned: ['orb'], sel: 'orb' },
      trails: { owned: ['none'], sel: 'none' },
      themes: { owned: ['midnight'], sel: 'midnight' },
      muted: false, runs: 0
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
    // placement: 'revive' | 'coins2x' | 'skin'
    // ADMOB: AdMob.showRewardedAd({placement}).then(r => cb(r.earned)).catch(() => cb(false))
    const returnTo = placement === 'coins2x' ? 'leveldone' : placement === 'skin' ? 'shop' : null;
    showAdCard(true, returnTo, cb);
  }
};

/* ---------------- Shop catalog ---------------- */
const PALETTE = [
  { name: 'cyan', main: '#00f0ff', dim: 'rgba(0,240,255,.25)' },
  { name: 'magenta', main: '#ff2fd6', dim: 'rgba(255,47,214,.25)' },
  { name: 'gold', main: '#ffd23f', dim: 'rgba(255,210,63,.25)' }
];
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
  { id: 'rainbow', name: 'Rainbow', price: 900 }
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
function genLevel(n) {
  const rows = [], gates = [], coins = [];
  let gapC = rand(0, TAU);

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
        gapC = norm(gapC + rand(-1.2, 1.2));
        if (k === 0) firstGap = gapC;
        rows.push({ y: i * PHYS.rowSpacing, gapC, gapH, color: s.color, reds: [] });
        if (Math.random() < 0.4) coins.push({ y: i * PHYS.rowSpacing + PHYS.rowSpacing / 2, localA: norm(gapC + rand(-0.5, 0.5)), taken: false });
      }
      if (s.color !== -1 && i - s.len > 0) {
        gates.push({ y: (i - s.len) * PHYS.rowSpacing - PHYS.rowSpacing / 2, localA: firstGap, color: s.color, taken: false, warned: false });
      }
    }
    const last = rows[rows.length - 1];
    last.gapH = Math.PI * 0.92; last.color = -1; // finish row
    return { rows, gates, coins, count: rows.length };
  }

  const count = 16 + n * 4;
  const gapH = Math.max(0.30, 0.58 - n * 0.022);
  const colors = n === 2 ? [0, 1] : [0, 1, 2];
  let color = colors[0];
  let runLeft = randi(3, 5);
  const redP = n < 3 ? 0 : Math.min(0.55, 0.12 + n * 0.04);

  for (let i = 0; i < count; i++) {
    const isLast = i === count - 1;
    gapC = norm(gapC + rand(-1.2, 1.2));
    // color runs with repaint gates between them
    if (n > 1 && !isLast) {
      runLeft--;
      if (runLeft <= 0) {
        const next = colors[randi(0, colors.length - 1)];
        if (next !== color || colors.length === 1) {
          const nc = next === color ? (color + 1) % colors.length : next;
          gates.push({ y: i * PHYS.rowSpacing - PHYS.rowSpacing / 2, localA: gapC, color: nc, taken: false });
          color = nc;
        }
        runLeft = randi(3, 6);
      }
    }
    const rowColor = isLast ? -1 : color; // final row: neutral, huge gap = finish
    const row = {
      y: i * PHYS.rowSpacing,
      gapC, gapH: isLast ? Math.PI * 0.92 : gapH,
      color: rowColor, reds: []
    };
    if (!isLast && Math.random() < redP) {
      const rh = rand(0.28, 0.5);
      const rc = norm(gapC + Math.PI + rand(-0.9, 0.9));
      if (angDist(rc, gapC) > gapH + rh + 0.25) row.reds.push({ a0: rc - rh, a1: rc + rh });
    }
    rows.push(row);
    if (!isLast && Math.random() < 0.4) {
      coins.push({ y: i * PHYS.rowSpacing + PHYS.rowSpacing / 2, localA: norm(gapC + rand(-0.5, 0.5)), taken: false });
    }
  }
  return { rows, gates, coins, count };
}

function endlessRow(depth, prevGapC) {
  const gapH = Math.max(0.26, 0.55 - depth * 0.004);
  const gapC = norm(prevGapC + rand(-1.2, 1.2));
  // Colors run in streaks with a repaint gate before every switch — same
  // fairness contract as levels. (Random per-row colors would be unavoidable
  // deaths, since there'd be no way to repaint in time.)
  let color;
  if (depth < 12) { color = 0; } // opening stretch matches the cyan ball — no grey confusion
  else {
    if (depth === 12) { Game.eColor = 0; Game.eRunLeft = randi(3, 5); }
    Game.eRunLeft--;
    if (Game.eRunLeft <= 0) {
      const nColors = depth < 30 ? 2 : 3;
      let nc = randi(0, nColors - 1);
      if (nc === Game.eColor) nc = (nc + 1) % nColors;
      Game.gates.push({ y: depth * PHYS.rowSpacing - PHYS.rowSpacing / 2, localA: gapC, color: nc, taken: false, warned: false });
      Game.eColor = nc;
      Game.eRunLeft = randi(3, 6);
    }
    color = Game.eColor;
  }
  const row = { y: depth * PHYS.rowSpacing, gapC, gapH, color, reds: [] };
  if (depth > 8 && Math.random() < Math.min(0.5, 0.1 + depth * 0.006)) {
    const rh = rand(0.28, 0.5);
    const rc = norm(gapC + Math.PI + rand(-0.9, 0.9));
    if (angDist(rc, gapC) > gapH + rh + 0.25) row.reds.push({ a0: rc - rh, a1: rc + rh });
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
  Game.timeLeft = playMode === 'rush' ? 60 : 0;
  const g = playMode === 'levels' ? genLevel(Game.level) : null;
  if (g) { Game.rows = g.rows; Game.gates = g.gates; Game.coins = g.coins; }
  else {
    Game.rows = []; Game.gates = []; Game.coins = [];
    let gc = rand(0, TAU);
    for (let i = 0; i < 14; i++) { const r = endlessRow(i, gc); gc = r.gapC; Game.rows.push(r); }
    Game.depth = 13;
  }
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
  Game.mode = 'dying';
  Game.deathCause = cause;
  Game.timeScale = 0.22; Game.slowT = 0.8;
  Game.shake = 14;
  burst(Game.W / 2, Game.ballScreenY, PALETTE[Game.ball.color].main, 46);
  Sfx.shatter();
}

function finishDeath() {
  Game.mode = 'gameover';
  Game.timeScale = 1;
  const prev = Game.playMode === 'endless' ? Save.data.best.endless
    : Game.playMode === 'rush' ? Save.data.best.rush
    : (Save.data.best.levels[Game.level] || 0);
  Game.newBest = Game.score > prev;
  if (Game.newBest) {
    if (Game.playMode === 'endless') Save.data.best.endless = Game.score;
    else if (Game.playMode === 'rush') Save.data.best.rush = Game.score;
    else Save.data.best.levels[Game.level] = Game.score;
  }
  Save.data.coins += Game.coinsRun;
  Save.save();
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

  const b = G.ball;
  const prevY = b.y;
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
      if (Math.random() < 0.35) G.coins.push({ y: r.y - PHYS.rowSpacing / 2, localA: norm(r.gapC + rand(-0.5, 0.5)), taken: false });
    }
    // drop rows far behind to bound memory
    while (G.rows.length > 4 && G.rows[0].y < b.y - G.H) { G.rows.shift(); G.rowIndex--; }
    G.gates = G.gates.filter(gt => !gt.taken && gt.y > b.y - G.H);
    G.coins = G.coins.filter(c => !c.taken && c.y > b.y - G.H);
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
          if (b.color !== gt.color) {
            b.color = gt.color;
            Sfx.repaint();
            burst(G.W / 2, G.ballScreenY, PALETTE[b.color].main, 22);
            popup('REPAINTED!', PALETTE[b.color].main);
            updateHUD(); // refresh the "you are this color" chip immediately
          }
        }
      }
    }
    for (const c of G.coins) {
      if (!c.taken && prevY < c.y && b.y >= c.y) {
        if (angDist(0, norm(c.localA + G.rot)) < PHYS.coinHalf) {
          c.taken = true;
          G.coinsRun++;
          G.score += 25;
          Sfx.coin();
          burst(G.W / 2, G.ballScreenY, '#ffd700', 12);
          updateHUD();
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

function onCrossRow(row, i) {
  const G = Game, b = G.ball;
  const rel = angDist(0, norm(row.gapC + G.rot));
  // The golden finish ring (no game color) is the goal line: the ball always
  // drops through it — you can never get stuck bouncing on the finish.
  if (row.color === -1 || rel < row.gapH - 0.03) {
    // PASS THROUGH the gap
    G.streak++;
    G.bestStreak = Math.max(G.bestStreak, G.streak);
    let pts = 10 * G.streak;
    const perfect = rel < row.gapH * 0.35;
    if (perfect) { pts = Math.round(pts * 1.5); popup('PERFECT +' + pts, '#ffd700'); Sfx.perfect(); }
    else if (rel > row.gapH * 0.8) { pts += 15; popup('CLOSE! +' + pts, '#ff9d00'); }
    else if (G.streak >= 3) popup('x' + G.streak + ' COMBO', '#ff2fd6');
    G.score += pts;
    G.rowIndex = Math.max(G.rowIndex, i);
    Sfx.bounce(G.streak);
    burst(G.W / 2, row.y - G.camY, PALETTE[b.color].main, 8);
    updateHUD();
    if (G.playMode === 'levels' && i === G.rows.length - 1) levelComplete();
  } else {
    // LAND on the platform ring
    const localA = norm(0 - G.rot);
    for (const s of row.reds) {
      if (inArc(localA, s.a0, s.a1)) { endRunDeath('spikes'); return; }
    }
    if (row.color === -1 || row.color === b.color) {
      b.y = row.y; b.vy = -PHYS.bounceV;
      if (G.streak > 0) G.streak = 0;
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
    const cols = { sparkle: ['#fff', '#ffd700'], bubbles: ['#9df', '#0ff'], stars: ['#ffd700', '#fff'], lightning: ['#ff0', '#0ff'], rainbow: ['#f00', '#0f0', '#00f', '#ff0', '#f0f'] };
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
  const gapA0 = row.gapC - row.gapH, gapA1 = row.gapC + row.gapH;
  // depth skirt
  ctx.globalAlpha = 0.5;
  strokeArc(-Math.PI / 2, Math.PI / 2, sy + RING * 0.55, '#020208', RING);
  ctx.globalAlpha = 1;
  // color -1 is the finish row: glowing golden goal ring, never a "grey" platform
  const base = row.color === -1 ? '#ffe9a3' : PALETTE[row.color].main;
  const dark = row.color === -1 ? 'rgba(255,233,163,.35)' : PALETTE[row.color].dim;
  // front half (-PI/2..PI/2), skipping the gap — walk segments
  const segs = [];
  let cur = -Math.PI / 2;
  const g0 = norm(gapA0), g1 = norm(gapA1);
  // gap may wrap; collect blocked intervals intersected with [-PI/2, PI/2]
  const blocked = [];
  const push = (a, b) => { if (b > -Math.PI / 2 && a < Math.PI / 2) blocked.push([Math.max(a, -Math.PI / 2), Math.min(b, Math.PI / 2)]); };
  if (g0 <= g1) push(g0, g1); else { push(g0, Math.PI); push(-Math.PI, g1); }
  blocked.sort((a, b) => a[0] - b[0]);
  for (const [b0, b1] of blocked) { if (b0 > cur) segs.push([cur, b0]); cur = Math.max(cur, b1); }
  if (cur < Math.PI / 2) segs.push([cur, Math.PI / 2]);
  // back half (dimmer)
  strokeArc(Math.PI / 2, Math.PI * 1.5, sy, dark, RING);
  // front segments (rotate with tower)
  for (const [a, b] of segs) strokeArc(a + Game.rot, b + Game.rot, sy, base, RING, 12);
  // glowing caps on the gap edges so the opening reads at speed
  // (skipped on the near-full-circle finish ring)
  if (row.gapH < 1.2) for (const e of [gapA0, gapA1]) {
    const w = norm(e + Game.rot);
    if (Math.abs(w) < Math.PI / 2 - 0.12) {
      const [gx, gy] = ringPt(w, sy);
      ctx.fillStyle = base; ctx.shadowBlur = 12; ctx.shadowColor = base;
      ctx.beginPath(); ctx.arc(gx, gy, 5, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
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
  ctx.fillText('◈ REPAINT ◈', x, y + 44);
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

function drawBall() {
  if (Game.mode === 'dying' || Game.mode === 'gameover') return;
  const x = Game.W / 2, y = Game.ballScreenY;
  const b = Game.ball, col = PALETTE[b.color];
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
  drawBall();
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
const screens = ['menu', 'levels', 'shop', 'howto', 'pause', 'gameover', 'leveldone', 'adcard'];
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
  $('hud-level').textContent = Game.playMode === 'endless' ? 'ENDLESS · ' + Math.max(0, Game.rowIndex + 1) + ' ROWS'
    : Game.playMode === 'rush' ? 'RUSH · ' + fmtTime(Game.timeLeft) : 'LEVEL ' + Game.level;
  $('coin-count').textContent = Save.data.coins;
  // "you are this color" chip — the core of the color mechanic, always visible
  const c = PALETTE[Game.ball.color];
  $('hud-cname').textContent = c.name.toUpperCase();
  $('hud-dot').style.background = c.main;
  $('hud-dot').style.boxShadow = '0 0 8px ' + c.main;
  $('hud-color').style.borderColor = c.main;
  const cb = $('combo-badge');
  if (Game.streak >= 3) { cb.textContent = 'x' + Game.streak + ' COMBO'; cb.classList.remove('hidden'); }
  else cb.classList.add('hidden');
}

function refreshMenu() {
  const best = Math.max(Save.data.best.endless, Save.data.best.rush || 0, ...Object.values(Save.data.best.levels), 0);
  $('menu-best').textContent = best;
  $('menu-coins').textContent = Save.data.coins;
}
function goMenu() {
  Game.mode = 'menu';
  hud(false);
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
    : (Save.data.best.levels[Game.level] || 0);
  $('go-best').textContent = best;
  $('go-coins').textContent = '+' + Game.coinsRun;
  $('go-newbest').classList.toggle('hidden', !Game.newBest);
  $('btn-revive').disabled = Game.revived;
  $('btn-revive').style.display = Game.revived ? 'none' : 'block';
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
function catalogFor(tab) {
  return tab === 'balls' ? { items: BALLS, key: 'balls' } : tab === 'trails' ? { items: TRAILS, key: 'trails' } : { items: THEMES, key: 'themes' };
}
function renderShop() {
  $('shop-coins').textContent = Save.data.coins;
  document.querySelectorAll('.shop-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === shopTab));
  const { items, key } = catalogFor(shopTab);
  const grid = $('shop-grid');
  grid.innerHTML = '';
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
    d.innerHTML = `${preview}<div class="name">${it.name}</div><div class="price">${owned ? (sel ? 'EQUIPPED' : 'TAP TO USE') : '🪙 ' + it.price}</div>`;
    d.onclick = () => {
      Sfx.click();
      if (st.owned.includes(it.id)) { st.sel = it.id; Save.save(); renderShop(); }
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
  $('btn-shop').onclick = () => { Sfx.click(); renderShop(); showScreen('shop'); };
  $('btn-how').onclick = () => { Sfx.click(); showScreen('howto'); };
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
    if (Game.playMode === 'rush' && Game.mode === 'playing') {
      Game.timeLeft -= rdt;
      const s = Math.ceil(Game.timeLeft);
      if (s !== Game._lastRushSec) { Game._lastRushSec = s; updateHUD(); }
      if (Game.timeLeft <= 0) rushComplete();
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
resize();
wire();
$('btn-mute').textContent = Save.data.muted ? '🔇' : '🔊';
refreshMenu();
showScreen('menu');
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
