/* =====================================================
   🃏 Poker Trainer — Texas Hold'em Learning App
   ===================================================== */

// ─── Constants ────────────────────────────────────────
const SUITS        = ['♠', '♥', '♦', '♣'];
const SUIT_COLORS  = { '♠': '#1a1a2e', '♥': '#e63946', '♦': '#e63946', '♣': '#1a1a2e' };
const SUIT_SYMBOLS = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };
const RANK_NAMES   = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const RANK_VALUES  = {2:2,3:3,4:4,5:5,6:6,7:7,8:8,9:9,10:10,'10':10,T:10,J:11,Q:12,K:13,A:14};

const HAND_NAMES = [
  'High Card','One Pair','Two Pair','Three of a Kind',
  'Straight','Flush','Full House','Four of a Kind',
  'Straight Flush','Royal Flush'
];

const STREET_NAMES = ['preflop','flop','turn','river','showdown'];

const STARTING_CHIPS = 1000;
const SMALL_BLIND = 5;
const BIG_BLIND   = 10;
const MC_ITERATIONS = 600;   // Monte Carlo equity iterations

// ─── Seedable RNG ─────────────────────────────────────
// A global random source used for the deck shuffle and the AI's randomised
// choices (bluffs, mistakes). Seeding it makes a whole hand reproducible, which
// powers "replay this hand" and the fixed teaching scenarios. The Monte Carlo
// equity estimator deliberately keeps using Math.random so estimates stay fresh.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RNG = {
  fn: Math.random,           // default: unseeded
  seeded: false,
  currentSeed: null,
  seed(n) { this.fn = mulberry32(n); this.seeded = true; this.currentSeed = n; },
  unseed() { this.fn = Math.random; this.seeded = false; this.currentSeed = null; },
  next() { return this.fn(); },
};

// ─── Card ─────────────────────────────────────────────
class Card {
  constructor(suit, rank) {
    this.suit = suit;       // '♠','♥','♦','♣'
    this.rank = rank;       // 2–14 (11=J,12=Q,13=K,14=A)
    this.name = RANK_NAMES[rank - 2];
  }
  get color() { return SUIT_COLORS[this.suit]; }
  get display() { return `${this.name}${this.suit}`; }
  get symbol() { return SUIT_SYMBOLS[this.suit]; }

  static fromString(s) {
    // e.g. "Ah" → Ace of hearts
    const rank = s.slice(0, -1);
    const suitChar = s.slice(-1);
    const suitMap = { 's':'♠','h':'♥','d':'♦','c':'♣' };
    const rankVal = RANK_VALUES[rank];
    if (!rankVal || !suitMap[suitChar]) return null;
    return new Card(suitMap[suitChar], rankVal);
  }
}

// ─── Deck ─────────────────────────────────────────────
class Deck {
  constructor() {
    this.cards = [];
    for (const suit of SUITS)
      for (let r = 2; r <= 14; r++)
        this.cards.push(new Card(suit, r));
  }
  shuffle() {
    // Uses the global seedable RNG so a seeded hand always deals identically.
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(RNG.next() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }
  deal() { return this.cards.pop(); }
}

// ─── Hand Evaluator ──────────────────────────────────
// Given up to 7 cards, find the best 5-card poker hand.
// Returns { rank: 0-9, rankName: string, score: number, kickers: [] }
const HandEval = {
  evaluate(cards) {
    if (cards.length < 5) return { rank: 0, rankName: 'Incomplete Hand', score: 0, kickers: [], bestCards: [] };
    const combos = this._combinations(cards, 5);
    let best = null, bestCards = null;
    for (const combo of combos) {
      const result = this._eval5(combo);
      if (!best || result.score > best.score || (result.score === best.score && this._cmpKickers(result.kickers, best.kickers) > 0)) {
        best = result;
        bestCards = combo;
      }
    }
    // Attach the actual 5 cards that make the hand (for showdown highlighting).
    best.bestCards = bestCards;
    return best;
  },

  _eval5(cards) {
    const ranks = cards.map(c => c.rank).sort((a,b) => b - a);
    const suits = cards.map(c => c.suit);
    const isFlush = suits.every(s => s === suits[0]);
    const isStraight = this._isStraight(ranks);
    const freq = this._frequencies(ranks);

    // For straights, use the straight's true high card. The wheel (A-2-3-4-5)
    // is a 5-high straight, so the Ace plays low and must NOT score as 14.
    const isWheel = isStraight && ranks[0] === 14 && ranks[1] === 5;
    const straightRanks = isWheel ? [5, 4, 3, 2, 1] : ranks;

    // Royal Flush
    if (isFlush && isStraight && ranks[0] === 14 && ranks[1] === 13)
      return this._result(9, 'Royal Flush', straightRanks);

    // Straight Flush
    if (isFlush && isStraight)
      return this._result(8, 'Straight Flush', straightRanks);

    // Four of a Kind
    if (freq[0].count === 4)
      return this._result(7, 'Four of a Kind', [freq[0].rank, ...freq.slice(1).map(f => f.rank)]);

    // Full House
    if (freq[0].count === 3 && freq[1].count === 2)
      return this._result(6, 'Full House', [freq[0].rank, freq[1].rank]);

    // Flush
    if (isFlush) return this._result(5, 'Flush', ranks);

    // Straight
    if (isStraight) return this._result(4, 'Straight', straightRanks);

    // Three of a Kind
    if (freq[0].count === 3)
      return this._result(3, 'Three of a Kind', [freq[0].rank, ...freq.slice(1).map(f => f.rank)]);

    // Two Pair
    if (freq[0].count === 2 && freq[1].count === 2)
      return this._result(2, 'Two Pair', [freq[0].rank, freq[1].rank, freq[2].rank]);

    // One Pair
    if (freq[0].count === 2)
      return this._result(1, 'One Pair', [freq[0].rank, ...freq.slice(1).map(f => f.rank)]);

    // High Card
    return this._result(0, 'High Card', ranks);
  },

  _isStraight(ranks) {
    // Check normal straight
    if (ranks[0] - ranks[4] === 4 && new Set(ranks).size === 5) return true;
    // Check A-2-3-4-5 (wheel): ranks would be 14,5,4,3,2
    if (ranks[0] === 14 && ranks[1] === 5 && ranks[2] === 4 && ranks[3] === 3 && ranks[4] === 2) return true;
    return false;
  },

  _frequencies(ranks) {
    const map = {};
    for (const r of ranks) map[r] = (map[r] || 0) + 1;
    return Object.entries(map)
      .map(([r, c]) => ({ rank: +r, count: c }))
      .sort((a, b) => b.count - a.count || b.rank - a.rank);
  },

  _result(rank, name, kickers) {
    // Score is rank * 10^10 + weighted kicker values for comparison
    let score = rank * 10000000000;
    for (let i = 0; i < kickers.length; i++)
      score += kickers[i] * Math.pow(13, 4 - i);
    return { rank, rankName: name, score, kickers };
  },

  _cmpKickers(a, b) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] !== b[i]) return a[i] - b[i];
    }
    return 0;
  },

  _combinations(arr, k) {
    if (k === 0) return [[]];
    if (arr.length === 0) return [];
    const [first, ...rest] = arr;
    const withFirst = this._combinations(rest, k - 1).map(c => [first, ...c]);
    const withoutFirst = this._combinations(rest, k);
    return [...withFirst, ...withoutFirst];
  }
};

// ─── Equity Calculator (Monte Carlo) ─────────────────
// `villainFilter(holeCards)` optionally restricts the opponent's hole cards to a
// range (see RANGES). When omitted, the opponent holds a uniformly random hand.
function calcEquity(myHole, community, iterations = MC_ITERATIONS, villainFilter = null) {
  const wins = { win: 0, lose: 0, tie: 0 };
  const knownCards = [...myHole, ...community];
  const knownKeys = new Set(knownCards.map(c => c.display));

  // Build the available deck ONCE (cards not already known), then sample from it
  // each iteration via a partial Fisher–Yates shuffle. Far cheaper than rebuilding
  // and filtering a 52-card deck every loop.
  const available = new Deck().cards.filter(c => !knownKeys.has(c.display));
  const n = available.length;
  const needed = 5 - community.length;

  let counted = 0;
  // Cap attempts so a tight range can't loop forever if few hands qualify.
  const maxAttempts = iterations * (villainFilter ? 40 : 1);

  for (let attempt = 0; counted < iterations && attempt < maxAttempts; attempt++) {
    // Partial shuffle: draw the cards we need to the front of `available`.
    const draw = 2 + needed;
    for (let i = 0; i < draw; i++) {
      const j = i + Math.floor(Math.random() * (n - i));
      const tmp = available[i]; available[i] = available[j]; available[j] = tmp;
    }

    const villanHole = [available[0], available[1]];

    // Reject samples whose villain hand falls outside the assumed range.
    if (villainFilter && !villainFilter(villanHole)) continue;

    const remCommunity = [...community];
    for (let j = 0; j < needed; j++) remCommunity.push(available[2 + j]);

    const myResult = HandEval.evaluate([...myHole, ...remCommunity]);
    const vilResult = HandEval.evaluate([...villanHole, ...remCommunity]);

    counted++;
    if (myResult.score > vilResult.score) wins.win++;
    else if (myResult.score < vilResult.score) wins.lose++;
    else wins.tie++;
  }

  const total = counted || 1;
  return {
    win:  (wins.win  / total * 100).toFixed(1),
    lose: (wins.lose / total * 100).toFixed(1),
    tie:  (wins.tie  / total * 100).toFixed(1),
    samples: counted,
  };
}

// ─── Villain Range Model ─────────────────────────────
// A pragmatic 3-tier preflop range used to make equity realistic instead of
// "vs a random hand". Each range is a predicate over the villain's 2 hole cards.
// This teaches range-vs-range thinking without a full combinatorial range engine.
const RANGES = {
  // Loose: plays almost anything — any pair, any two broadway, any suited,
  // any connector, any ace. ~55% of hands.
  loose: {
    label: 'loose',
    pct: 55,
    test(h) {
      const [a, b] = h, hi = Math.max(a.rank, b.rank), lo = Math.min(a.rank, b.rank);
      const suited = a.suit === b.suit, gap = hi - lo;
      if (a.rank === b.rank) return true;            // any pair
      if (hi >= 14) return true;                     // any ace
      if (hi >= 11 && lo >= 10) return true;         // two broadway
      if (suited) return true;                       // any suited
      if (gap <= 2) return true;                     // connectors / 1-gappers
      return hi >= 12;                               // any king/queen high
    },
  },
  // Standard: a reasonable TAG opening range — pairs, broadways,
  // suited aces/kings, decent suited connectors. ~25% of hands.
  standard: {
    label: 'standard',
    pct: 25,
    test(h) {
      const [a, b] = h, hi = Math.max(a.rank, b.rank), lo = Math.min(a.rank, b.rank);
      const suited = a.suit === b.suit, gap = hi - lo;
      if (a.rank === b.rank) return a.rank >= 5;     // 55+
      if (hi === 14 && (suited || lo >= 10)) return true; // AJo+ / any Ax suited-ish
      if (hi >= 12 && lo >= 11) return true;         // KQ, KJ, QJ
      if (suited && hi >= 12 && lo >= 9) return true;// suited broadway-ish
      if (suited && gap === 1 && lo >= 6) return true; // suited connectors 67s+
      return false;
    },
  },
  // Tight: a strong, value-heavy range — big pairs, AK/AQ, KQ. ~10% of hands.
  tight: {
    label: 'tight',
    pct: 10,
    test(h) {
      const [a, b] = h, hi = Math.max(a.rank, b.rank), lo = Math.min(a.rank, b.rank);
      if (a.rank === b.rank) return a.rank >= 9;     // 99+
      if (hi === 14 && lo >= 12) return true;        // AK, AQ
      if (hi === 13 && lo === 12) return true;       // KQ
      return false;
    },
  },
};

// Infer a villain range from their betting pressure on this street. More money in
// → a stronger assumed range. This is what makes equity respond to the opponent's
// actions rather than treating every villain as a random-hand robot.
function inferVillainRange(potBeforeBet, villainBet) {
  if (villainBet <= 0) return RANGES.loose;            // checked / limped: wide
  const ratio = villainBet / Math.max(1, potBeforeBet);
  if (ratio >= 0.6) return RANGES.tight;               // big bet: strong
  if (ratio >= 0.25) return RANGES.standard;           // standard bet
  return RANGES.loose;                                 // tiny bet / blind: wide
}

// ─── Equity caching & async (Web Worker) layer ───────
// A canonical key for a spot so identical lookups (from repeated render() calls
// or re-grading the same decision) reuse a result instead of re-simulating.
function equityKey(hole, community, rangeLabel) {
  const h = hole.map(c => c.display).sort().join('');
  const b = community.map(c => c.display).sort().join('');
  return `${h}|${b}|${rangeLabel || 'random'}`;
}

const EquityCache = {
  map: new Map(),
  max: 400,
  get(key) { return this.map.get(key); },
  set(key, val) {
    // Simple LRU-ish bound: drop the oldest entry when full.
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value);
    this.map.set(key, val);
  },
  clear() { this.map.clear(); },
};

// Memoized synchronous equity. Used by the AI and as the advisor's fallback when
// the worker hasn't produced a result yet. `rangeLabel` is part of the key.
function calcEquityCached(hole, community, iterations, rangeFilter, rangeLabel) {
  const key = equityKey(hole, community, rangeLabel);
  const hit = EquityCache.get(key);
  if (hit) return hit;
  const res = calcEquity(hole, community, iterations, rangeFilter);
  EquityCache.set(key, res);
  return res;
}

// Off-main-thread equity via a Web Worker built from a Blob (keeps the project a
// single static app — no extra files to serve). The worker re-implements the
// minimal evaluator + Monte Carlo loop. Results flow back into EquityCache and
// trigger a re-render so the live advisor sharpens without ever blocking input.
const EquityWorker = {
  worker: null,
  pending: new Set(),

  init() {
    if (this.worker || typeof Worker === 'undefined' || typeof Blob === 'undefined') return;
    try {
      const blob = new Blob([WORKER_SOURCE], { type: 'application/javascript' });
      this.worker = new Worker(URL.createObjectURL(blob));
      this.worker.onmessage = (e) => {
        const { key, result } = e.data;
        EquityCache.set(key, result);
        this.pending.delete(key);
        if (typeof render === 'function') render(); // refresh advisor with sharper number
      };
    } catch (_) { this.worker = null; }
  },

  // Request a higher-iteration equity estimate for a spot. Returns immediately;
  // the result lands in EquityCache later and prompts a re-render.
  request(hole, community, rangeLabel, iterations) {
    if (!this.worker) return;
    const key = equityKey(hole, community, rangeLabel);
    if (EquityCache.get(key) || this.pending.has(key)) return;
    this.pending.add(key);
    this.worker.postMessage({
      key, iterations, rangeLabel,
      hole: hole.map(c => c.display),
      community: community.map(c => c.display),
    });
  },
};

// Source for the equity worker. Self-contained string so it can be turned into a
// Blob URL. Mirrors HandEval/calcEquity but trimmed to what the loop needs.
const WORKER_SOURCE = `
const RANK_VALUES = {2:2,3:3,4:4,5:5,6:6,7:7,8:8,9:9,10:10,'10':10,T:10,J:11,Q:12,K:13,A:14};
const SUITS = ['s','h','d','c'];
function parse(s){ const r = s.slice(0,-1), su = s.slice(-1); const map={'\u2660':'s','\u2665':'h','\u2666':'d','\u2663':'c'}; return { rank: RANK_VALUES[r], suit: map[su]||su }; }
function isStraight(ranks){ if(ranks[0]-ranks[4]===4 && new Set(ranks).size===5) return true; if(ranks[0]===14&&ranks[1]===5&&ranks[2]===4&&ranks[3]===3&&ranks[4]===2) return true; return false; }
function freq(ranks){ const m={}; for(const r of ranks) m[r]=(m[r]||0)+1; return Object.entries(m).map(([r,c])=>({rank:+r,count:c})).sort((a,b)=>b.count-a.count||b.rank-a.rank); }
function result(rank,kk){ let s=rank*1e10; for(let i=0;i<kk.length;i++) s+=kk[i]*Math.pow(13,4-i); return s; }
function eval5(cards){ const ranks=cards.map(c=>c.rank).sort((a,b)=>b-a); const suits=cards.map(c=>c.suit); const fl=suits.every(x=>x===suits[0]); const st=isStraight(ranks); const f=freq(ranks);
  const wheel = st && ranks[0]===14 && ranks[1]===5; const sr = wheel?[5,4,3,2,1]:ranks;
  if(fl&&st&&ranks[0]===14&&ranks[1]===13) return result(9,sr);
  if(fl&&st) return result(8,sr);
  if(f[0].count===4) return result(7,[f[0].rank,...f.slice(1).map(x=>x.rank)]);
  if(f[0].count===3&&f[1].count===2) return result(6,[f[0].rank,f[1].rank]);
  if(fl) return result(5,ranks);
  if(st) return result(4,sr);
  if(f[0].count===3) return result(3,[f[0].rank,...f.slice(1).map(x=>x.rank)]);
  if(f[0].count===2&&f[1].count===2) return result(2,[f[0].rank,f[1].rank,f[2].rank]);
  if(f[0].count===2) return result(1,[f[0].rank,...f.slice(1).map(x=>x.rank)]);
  return result(0,ranks);
}
function combos(arr,k){ if(k===0) return [[]]; if(arr.length===0) return []; const [h,...t]=arr; const w=combos(t,k-1).map(c=>[h,...c]); return [...w,...combos(t,k)]; }
function best(cards){ if(cards.length<5) return 0; let b=-1; for(const c of combos(cards,5)){ const s=eval5(c); if(s>b) b=s; } return b; }
function inRange(label,h){ const hi=Math.max(h[0].rank,h[1].rank),lo=Math.min(h[0].rank,h[1].rank),su=h[0].suit===h[1].suit,gap=hi-lo,pair=h[0].rank===h[1].rank;
  if(label==='tight'){ if(pair) return h[0].rank>=9; if(hi===14&&lo>=12) return true; if(hi===13&&lo===12) return true; return false; }
  if(label==='standard'){ if(pair) return h[0].rank>=5; if(hi===14&&(su||lo>=10)) return true; if(hi>=12&&lo>=11) return true; if(su&&hi>=12&&lo>=9) return true; if(su&&gap===1&&lo>=6) return true; return false; }
  if(label==='loose'){ if(pair) return true; if(hi>=14) return true; if(hi>=11&&lo>=10) return true; if(su) return true; if(gap<=2) return true; return hi>=12; }
  return true;
}
function fullDeck(){ const d=[]; for(const s of SUITS) for(let r=2;r<=14;r++) d.push({rank:r,suit:s}); return d; }
self.onmessage = function(e){
  const { key, iterations, rangeLabel, hole, community } = e.data;
  const myHole = hole.map(parse), board = community.map(parse);
  const knownK = new Set([...myHole,...board].map(c=>c.rank+c.suit));
  const avail = fullDeck().filter(c=>!knownK.has(c.rank+c.suit));
  const n = avail.length, needed = 5 - board.length;
  const useRange = rangeLabel && rangeLabel!=='random';
  let win=0,lose=0,tie=0,counted=0; const maxA = iterations*(useRange?40:1);
  for(let a=0; counted<iterations && a<maxA; a++){
    const draw = 2+needed;
    for(let i=0;i<draw;i++){ const j=i+Math.floor(Math.random()*(n-i)); const t=avail[i]; avail[i]=avail[j]; avail[j]=t; }
    const vh=[avail[0],avail[1]];
    if(useRange && !inRange(rangeLabel,vh)) continue;
    const rem=[...board]; for(let j=0;j<needed;j++) rem.push(avail[2+j]);
    const ms=best([...myHole,...rem]), vs=best([...vh,...rem]);
    counted++; if(ms>vs) win++; else if(ms<vs) lose++; else tie++;
  }
  const total = counted||1;
  self.postMessage({ key, result:{ win:(win/total*100).toFixed(1), lose:(lose/total*100).toFixed(1), tie:(tie/total*100).toFixed(1), samples:counted } });
};
`;

// ─── Outs Analyzer ───────────────────────────────────
// Accurately counts how many unseen cards improve the player's hand to a better
// rank, and classifies the principal draw. Teaches outs + the rule of 2 & 4.
function analyzeOuts(hole, community) {
  if (community.length < 3 || community.length >= 5) {
    return { outs: 0, draws: [], pctTurn: 0, pctRiver: 0 };
  }
  const known = [...hole, ...community];
  const knownKeys = new Set(known.map(c => c.display));
  const current = HandEval.evaluate(known);
  const remaining = new Deck().cards.filter(c => !knownKeys.has(c.display));

  // Identify the principal DRAW(s) and count only the cards that complete a draw
  // (a flush or a straight) — these are the clean, teachable "outs". We avoid
  // counting every rank-improving card (e.g. pairing a random overcard), which
  // overstates the count and the rule-of-2&4 estimate.
  const draws = [];
  const suitCounts = {};
  for (const c of [...hole, ...community]) suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1;
  const flushSuit = Object.keys(suitCounts).find(s => suitCounts[s] === 4);
  if (flushSuit) draws.push('flush draw');

  const ranks = [...new Set([...hole, ...community].map(c => c.rank))].sort((a, b) => a - b);
  const withAceLow = ranks.includes(14) ? [...new Set([1, ...ranks])].sort((a, b) => a - b) : ranks;
  let straightDraw = false;
  for (let lowEnd = 1; lowEnd <= 10; lowEnd++) {
    const window = [lowEnd, lowEnd + 1, lowEnd + 2, lowEnd + 3, lowEnd + 4];
    const have = window.filter(r => withAceLow.includes(r)).length;
    if (have === 4) straightDraw = true;
  }
  if (straightDraw) draws.push('straight draw');

  // Count the unique cards that complete one of the identified draws, and keep
  // the actual out cards so the UI can SHOW the learner exactly which cards help.
  let outs = 0;
  const outCards = [];
  if (draws.length) {
    const currentRanks = new Set([...hole, ...community].map(c => c.rank));
    for (const card of remaining) {
      let completes = false;
      // Flush: any remaining card of the 4-suit completes it.
      if (flushSuit && card.suit === flushSuit) completes = true;
      // Straight: a card whose rank fills a 4-to-a-straight window.
      if (!completes && straightDraw) {
        const testRanks = new Set(currentRanks);
        testRanks.add(card.rank);
        if (card.rank === 14) testRanks.add(1);
        for (let lowEnd = 1; lowEnd <= 10; lowEnd++) {
          const win = [lowEnd, lowEnd + 1, lowEnd + 2, lowEnd + 3, lowEnd + 4];
          if (win.every(r => testRanks.has(r))) { completes = true; break; }
        }
      }
      if (completes) { outs++; outCards.push(card); }
    }
  } else {
    // No clean draw: fall back to counting rank-improving cards (e.g. overcards
    // that could pair), but label it generically so it's not mistaken for a draw.
    for (const card of remaining) {
      if (HandEval.evaluate([...known, card]).rank > current.rank) { outs++; outCards.push(card); }
    }
  }

  // Rule of 2 & 4: ~2% per out per remaining street, ~4% with two streets to come.
  const streetsToCome = community.length === 3 ? 2 : 1;
  const pctRiver = Math.min(100, outs * 2 * streetsToCome);
  const pctTurn = Math.min(100, outs * 2);

  return { outs, draws, pctTurn, pctRiver, streetsToCome, outCards };
}

// ─── Combo describer (for the showdown breakdown) ────
// Given an evaluated hand plus the player's hole cards and the board, returns a
// human-readable description of the made hand and which of the 5 winning cards
// came from the hole vs the community.
const RANK_WORD = {
  2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight',
  9: 'Nine', 10: 'Ten', 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace', 1: 'Ace',
};
const SUIT_WORD = { '♠': 'spades', '♥': 'hearts', '♦': 'diamonds', '♣': 'clubs' };
const plural = (w) => (w === 'Six' ? 'Sixes' : w + 's');

function describeCombo(result, hole, board) {
  const cards = result.bestCards || [];
  const holeKeys = new Set(hole.map(c => c.display));
  // Counts of each rank among the 5 winning cards.
  const byRank = {};
  for (const c of cards) (byRank[c.rank] = byRank[c.rank] || []).push(c);
  const groups = Object.values(byRank).sort((a, b) => b.length - a.length || b[0].rank - a[0].rank);
  const topRank = cards.length ? Math.max(...cards.map(c => c.rank)) : 0;

  let detail = '';
  switch (result.rank) {
    case 9: detail = `Royal Flush in ${SUIT_WORD[cards[0]?.suit] || ''}`; break;
    case 8: detail = `Straight Flush, ${RANK_WORD[topRank]}-high`; break;
    case 7: detail = `Four ${plural(RANK_WORD[groups[0][0].rank])}`; break;
    case 6: detail = `Full House, ${plural(RANK_WORD[groups[0][0].rank])} full of ${plural(RANK_WORD[groups[1][0].rank])}`; break;
    case 5: detail = `Flush, ${RANK_WORD[topRank]}-high in ${SUIT_WORD[cards[0]?.suit] || ''}`; break;
    case 4: detail = `Straight, ${RANK_WORD[topRank]}-high`; break;
    case 3: detail = `Three ${plural(RANK_WORD[groups[0][0].rank])}`; break;
    case 2: detail = `Two Pair, ${plural(RANK_WORD[groups[0][0].rank])} and ${plural(RANK_WORD[groups[1][0].rank])}`; break;
    case 1: detail = `Pair of ${plural(RANK_WORD[groups[0][0].rank])}`; break;
    default: detail = `${RANK_WORD[topRank] || 'High'}-high`;
  }

  // Tag each winning card with its source.
  const tagged = cards.map(c => ({
    display: c.display, color: c.color,
    from: holeKeys.has(c.display) ? 'hole' : 'board',
  }));
  const fromHole = tagged.filter(c => c.from === 'hole').length;

  return {
    name: result.rankName,
    detail,
    cards: tagged,
    usesHoleCards: fromHole,
    // A short note on how the hand was made, e.g. "uses both your hole cards".
    sourceNote: fromHole === 2 ? 'uses both your hole cards'
      : fromHole === 1 ? 'uses one of your hole cards'
      : 'plays the board (none of your hole cards)',
  };
}

// ─── AI Opponent ──────────────────────────────────────
// Difficulty profiles tune iterations, decision margins and aggression.
const AI_PROFILES = {
  easy: {
    label: 'Easy',
    iterations: 150,
    callMargin: -0.12,   // calls loose (below correct pot odds)
    raiseEquity: 0.72,   // only raises with very strong equity
    bluffFreq: 0.04,
    aggression: 0.55,
    mistakeFreq: 0.18,   // chance of a deliberately suboptimal play
  },
  medium: {
    label: 'Medium',
    iterations: 280,
    callMargin: 0.0,
    raiseEquity: 0.60,
    bluffFreq: 0.10,
    aggression: 0.85,
    mistakeFreq: 0.06,
  },
  hard: {
    label: 'Hard',
    iterations: 420,
    callMargin: 0.04,    // disciplined: needs equity edge to call
    raiseEquity: 0.55,
    bluffFreq: 0.16,     // balanced semi-bluffing
    aggression: 1.0,
    mistakeFreq: 0.0,
    useRange: true,      // weight the player's hand to a range based on their bets
  },
};

const AI = {
  DECISIONS: ['fold','check','call','raise'],
  difficulty: 'medium',

  get profile() { return AI_PROFILES[this.difficulty] || AI_PROFILES.medium; },

  setDifficulty(level) {
    if (AI_PROFILES[level]) this.difficulty = level;
  },

  act(state) {
    const { pot, currentBet, community, aiHole, aiChips, aiBet, playerBet } = state;
    const aiNeeded = Math.max(0, currentBet - aiBet);
    const potOdds = aiNeeded === 0 ? 0 : aiNeeded / (pot + aiNeeded);
    const allCards = [...aiHole, ...community];
    const p = this.profile;

    // A skilled AI weights the player's hand to a range based on how much the
    // player has bet; easier AIs naively assume a random hand.
    let filter = null;
    if (p.useRange) {
      const playerInvested = Math.max(0, (playerBet || 0) - aiBet);
      const potBefore = pot - playerInvested;
      const range = inferVillainRange(potBefore, playerInvested);
      filter = (h) => range.test(h);
    }
    const equity = this._equity(aiHole, community, p.iterations, filter);

    let decision = (community.length === 0)
      ? this._preflopStrategy(aiHole, equity, aiNeeded, potOdds, pot, aiChips, aiBet)
      : this._postflopStrategy(equity, potOdds, pot, aiNeeded, aiChips, aiBet, allCards);

    // Occasional deliberate mistake on easier levels (adds exploitability).
    if (p.mistakeFreq > 0 && RNG.next() < p.mistakeFreq) {
      decision = this._mistake(decision, aiNeeded, aiChips, aiBet);
    }
    return decision;
  },

  _equity(hole, community, iterations, filter = null) {
    const e = calcEquity(hole, community, iterations, filter);
    // Count ties as half a win for decision purposes.
    return (parseFloat(e.win) + parseFloat(e.tie) / 2) / 100;
  },

  // Total bet (relative to aiBet) sized as a fraction of the pot, clamped to stack.
  _sizeBet(fraction, pot, aiChips, aiBet, currentBet) {
    const raw = Math.round((pot * fraction) / BIG_BLIND) * BIG_BLIND;
    const target = Math.max(currentBet + BIG_BLIND, currentBet + raw);
    const maxTotal = aiChips + aiBet;
    return Math.max(BIG_BLIND, Math.min(target, maxTotal));
  },

  _preflopStrategy(hole, equity, aiNeeded, potOdds, pot, aiChips, aiBet) {
    const strength = this._preflopStrength(hole);
    const p = this.profile;
    const currentBet = aiBet + aiNeeded;

    // Premium hands: raise for value.
    if (strength >= 8 || equity > 0.62) {
      const total = this._sizeBet(0.9 * p.aggression + 0.6, pot, aiChips, aiBet, currentBet);
      if (total > aiBet + aiNeeded) return { action: 'raise', amount: total };
      return { action: 'call', amount: Math.min(aiNeeded, aiChips) };
    }

    // Strong hands: raise if unopened, otherwise call.
    if (strength >= 6 || equity > 0.54) {
      if (aiNeeded === 0) {
        const total = this._sizeBet(0.6 * p.aggression, pot, aiChips, aiBet, currentBet);
        if (total > aiBet) return { action: 'raise', amount: total };
        return { action: 'check', amount: 0 };
      }
      if (equity > potOdds + p.callMargin) return { action: 'call', amount: Math.min(aiNeeded, aiChips) };
      return { action: 'fold', amount: 0 };
    }

    // Medium / speculative: continue cheaply or check.
    if (strength >= 4 || equity > potOdds + p.callMargin) {
      if (aiNeeded === 0) return { action: 'check', amount: 0 };
      if (aiNeeded <= BIG_BLIND * 3 && equity > potOdds + p.callMargin) {
        return { action: 'call', amount: Math.min(aiNeeded, aiChips) };
      }
      return { action: 'fold', amount: 0 };
    }

    // Weak: check when free, occasional steal-raise, else fold.
    if (aiNeeded === 0) {
      if (RNG.next() < p.bluffFreq) {
        const total = this._sizeBet(0.6, pot, aiChips, aiBet, currentBet);
        if (total > aiBet) return { action: 'raise', amount: total };
      }
      return { action: 'check', amount: 0 };
    }
    return { action: 'fold', amount: 0 };
  },

  _preflopStrength(hole) {
    const r1 = hole[0].rank, r2 = hole[1].rank;
    const suited = hole[0].suit === hole[1].suit;
    const pair = r1 === r2;
    const high = Math.max(r1, r2);
    const low = Math.min(r1, r2);
    const gap = high - low;

    let score = 0;
    if (pair) score = r1;
    if (high >= 12) score += 2;
    if (high >= 14 && low >= 11) score += 2;
    if (suited) score += 1;
    if (gap === 1) score += 1;
    if (gap === 2 && high >= 10) score += 0.5;
    if (pair && r1 >= 10) score += 2;
    return score;
  },

  _postflopStrategy(equity, potOdds, pot, aiNeeded, aiChips, aiBet, allCards) {
    const draws = this._countDraws(allCards);
    const strongDraw = draws >= 8;
    const p = this.profile;
    const currentBet = aiBet + aiNeeded;

    // Strong equity: bet/raise for value, sized by strength.
    if (equity >= p.raiseEquity) {
      const frac = (equity >= 0.85 ? 0.8 : 0.6) * p.aggression;
      const total = this._sizeBet(frac, pot, aiChips, aiBet, currentBet);
      if (total > aiBet + aiNeeded) return { action: 'raise', amount: total };
      if (aiNeeded === 0) return { action: 'check', amount: 0 };
      return { action: 'call', amount: Math.min(aiNeeded, aiChips) };
    }

    // Decent equity or strong draw: continue, semi-bluff sometimes.
    if (equity > potOdds + p.callMargin || strongDraw) {
      if (aiNeeded === 0) {
        if (strongDraw && RNG.next() < p.bluffFreq + 0.2) {
          const total = this._sizeBet(0.5 * p.aggression, pot, aiChips, aiBet, currentBet);
          if (total > aiBet) return { action: 'raise', amount: total };
        }
        return { action: 'check', amount: 0 };
      }
      if (equity > potOdds + p.callMargin) return { action: 'call', amount: Math.min(aiNeeded, aiChips) };
      // Drawing without price: semi-bluff or fold.
      if (strongDraw && RNG.next() < p.bluffFreq) {
        const total = this._sizeBet(0.6 * p.aggression, pot, aiChips, aiBet, currentBet);
        if (total > aiBet + aiNeeded) return { action: 'raise', amount: total };
      }
      return { action: 'fold', amount: 0 };
    }

    // Weak: check, occasional pure bluff, else fold.
    if (aiNeeded === 0) {
      if (RNG.next() < p.bluffFreq && aiChips > BIG_BLIND * 4) {
        const total = this._sizeBet(0.55, pot, aiChips, aiBet, currentBet);
        if (total > aiBet) return { action: 'raise', amount: total };
      }
      return { action: 'check', amount: 0 };
    }
    return { action: 'fold', amount: 0 };
  },

  // Turn a sound decision into a plausible blunder for easier difficulties.
  _mistake(decision, aiNeeded, aiChips, aiBet) {
    if (decision.action === 'fold' && aiNeeded > 0 && aiNeeded <= aiChips) {
      return { action: 'call', amount: Math.min(aiNeeded, aiChips) }; // loose call
    }
    if (decision.action === 'raise') {
      if (aiNeeded === 0) return { action: 'check', amount: 0 };       // misses value
      return { action: 'call', amount: Math.min(aiNeeded, aiChips) };
    }
    return decision;
  },

  _countDraws(cards) {
    // Simple draw counting: estimate how many outs for straight/flush
    const suits = {};
    const ranks = cards.map(c => c.rank);
    for (const c of cards) {
      suits[c.suit] = (suits[c.suit] || 0) + 1;
    }
    const flushDraw = Object.values(suits).some(v => v >= 4) ? 9 : 0;
    // Straight draw heuristic
    const sorted = [...new Set(ranks)].sort((a,b) => a-b);
    let straightOuts = 0;
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i+1] - sorted[i] <= 2) straightOuts += 4;
    }
    return flushDraw + straightOuts;
  }
};

// ─── Advisor: live, EV-based recommendation for the player ───
// Returns { equity, potOddsPct, needed, recommend, color, rationale, handName,
//           range, outs }. Equity is computed vs the villain's INFERRED RANGE
// (based on how much they've bet), not vs a random hand — so the advice reflects
// real poker reasoning.
function getAdvice(g, iterations = 350) {
  if (g.playerHole.length < 2) return null;
  const result = HandEval.evaluate([...g.playerHole, ...g.community]);
  const needed = Math.max(0, g.currentBet - g.playerBet);

  // Infer what the opponent's bet represents and weight equity to that range.
  const villainBet = Math.max(0, g.aiBet - g.playerBet);
  const potBefore = g.pot - villainBet;
  const range = inferVillainRange(potBefore, villainBet);

  // Memoized equity: identical spots (repeated renders, re-grading) reuse the
  // result. A Web Worker is asked for a higher-iteration estimate in the
  // background; when it returns it replaces this cached value and re-renders.
  const eq = calcEquityCached(g.playerHole, g.community, iterations, h => range.test(h), range.label);
  if (typeof EquityWorker !== 'undefined' && EquityWorker.worker) {
    EquityWorker.request(g.playerHole, g.community, range.label, MC_ITERATIONS * 2);
  }
  const equity = parseFloat(eq.win) + parseFloat(eq.tie) / 2;

  const potOddsPct = needed > 0 ? (needed / (g.pot + needed)) * 100 : 0;

  // Draw context: a strong draw justifies semi-bluffing and continuing.
  const outsInfo = analyzeOuts(g.playerHole, g.community);
  const strongDraw = outsInfo.outs >= 8;

  let recommend, color, rationale;
  if (needed === 0) {
    if (equity >= 60) {
      recommend = 'Bet / Raise'; color = 'green';
      rationale = `~${equity.toFixed(0)}% vs a ${range.label} range — bet for value.`;
    } else if (strongDraw) {
      recommend = 'Bet (semi-bluff)'; color = 'green';
      rationale = `Only ~${equity.toFixed(0)}% now, but ${outsInfo.outs} outs (~${outsInfo.pctRiver}% to improve) — betting adds fold equity.`;
    } else if (equity >= 40) {
      recommend = 'Check'; color = 'yellow';
      rationale = `~${equity.toFixed(0)}% vs a ${range.label} range — pot control, take a free card.`;
    } else {
      recommend = 'Check'; color = 'yellow';
      rationale = `~${equity.toFixed(0)}% vs a ${range.label} range — check; only bluff with a plan.`;
    }
  } else {
    if (equity >= potOddsPct * 1.6) {
      recommend = 'Raise'; color = 'green';
      rationale = `~${equity.toFixed(0)}% vs ${potOddsPct.toFixed(0)}% pot odds (${range.label} range) — raise for value.`;
    } else if (equity >= potOddsPct) {
      recommend = 'Call'; color = 'green';
      rationale = `~${equity.toFixed(0)}% beats ${potOddsPct.toFixed(0)}% pot odds vs a ${range.label} range — profitable call.`;
    } else if (strongDraw && equity >= potOddsPct * 0.7) {
      recommend = 'Call (draw)'; color = 'yellow';
      rationale = `${outsInfo.outs} outs (~${outsInfo.pctTurn}% next card); with implied odds this draw can continue.`;
    } else if (equity >= potOddsPct * 0.75) {
      recommend = 'Fold / marginal call'; color = 'yellow';
      rationale = `~${equity.toFixed(0)}% vs ${potOddsPct.toFixed(0)}% pot odds — close; lean fold.`;
    } else {
      recommend = 'Fold'; color = 'red';
      rationale = `~${equity.toFixed(0)}% can't justify ${potOddsPct.toFixed(0)}% pot odds vs a ${range.label} range.`;
    }
  }

  // Components behind the numbers, surfaced so the UI can explain HOW equity and
  // pot odds were derived and WHY they move as cards appear.
  const knownCount = g.playerHole.length + g.community.length;
  const unknownCount = 52 - knownCount;
  const cardsToCome = Math.max(0, 5 - g.community.length);
  const calc = {
    winPct: parseFloat(eq.win),
    tiePct: parseFloat(eq.tie),
    losePct: parseFloat(eq.lose),
    samples: eq.samples || 0,
    unknownCount,
    cardsToCome,
    rangeLabel: range.label,
    rangePct: range.pct,
    // Pot-odds arithmetic operands (for "X / (Y + X)").
    call: needed,
    potBeforeCall: g.pot,
  };

  return {
    equity, potOddsPct, needed,
    recommend, color, rationale,
    handName: result.rankName,
    range, outs: outsInfo,
    calc,
  };
}

// Grade the player's action against the EV recommendation (before state changes).
// Also classifies the mistake into a named "leak" so the stats panel can show
// the player exactly what kind of error they make most often.
function evaluateDecision(g, action, amount) {
  const advice = getAdvice(g, 250);
  if (!advice) return null;
  const { equity, potOddsPct, needed, outs } = advice;
  const strongDraw = outs && outs.outs >= 8;

  let verdict = 'ok', text = '', leak = null;
  if (needed === 0) {
    if (action === 'fold') { verdict = 'bad'; text = 'Never fold when you can check for free.'; leak = 'fold-free'; }
    else if (action === 'raise' && strongDraw && equity < 50) {
      verdict = 'good'; text = `Nice semi-bluff — ${outs.outs} outs (~${outs.pctRiver}% to improve) plus fold equity.`;
    }
    else if (action === 'raise' && equity < 35) { verdict = 'warn'; text = `Betting with ~${equity.toFixed(0)}% and no draw — a thin bluff; have a plan.`; leak = 'spew-bluff'; }
    else if (action === 'check' && equity >= 65) { verdict = 'warn'; text = `Checked ~${equity.toFixed(0)}% — you're missing value; bet it!`; leak = 'miss-value'; }
    else { verdict = 'good'; text = `Reasonable with ~${equity.toFixed(0)}% equity.`; }
  } else {
    const profitable = equity >= potOddsPct;
    if (action === 'fold') {
      if (profitable && equity >= potOddsPct * 1.2) { verdict = 'bad'; text = `Folded ~${equity.toFixed(0)}% equity vs ${potOddsPct.toFixed(0)}% pot odds — a call was +EV.`; leak = 'fold-equity'; }
      else if (strongDraw && equity >= potOddsPct * 0.7) { verdict = 'warn'; text = `Folded a ${outs.outs}-out draw — with implied odds a call was often worth it.`; leak = 'fold-draw'; }
      else { verdict = 'good'; text = `Disciplined fold (~${equity.toFixed(0)}% vs ${potOddsPct.toFixed(0)}% pot odds).`; }
    } else if (action === 'call') {
      if (profitable) { verdict = 'good'; text = `Good call — ~${equity.toFixed(0)}% beats ${potOddsPct.toFixed(0)}% pot odds.`; }
      else if (strongDraw && equity >= potOddsPct * 0.7) { verdict = 'ok'; text = `Drawing call — ${outs.outs} outs; justified by implied odds.`; }
      else { verdict = 'bad'; text = `Called ~${equity.toFixed(0)}% equity vs ${potOddsPct.toFixed(0)}% pot odds — a fold was better.`; leak = 'call-wide'; }
    } else if (action === 'raise') {
      if (equity >= potOddsPct * 1.4) { verdict = 'good'; text = `Strong raise — ~${equity.toFixed(0)}% equity.`; }
      else if (strongDraw) { verdict = 'good'; text = `Semi-bluff raise — ${outs.outs} outs gives equity when called plus fold equity.`; }
      else if (equity < potOddsPct * 0.8) { verdict = 'warn'; text = `Raising on ~${equity.toFixed(0)}% with no draw — a pure bluff; risky here.`; leak = 'spew-bluff'; }
      else { verdict = 'ok'; text = `Aggressive line with ~${equity.toFixed(0)}% equity.`; }
    }
  }

  Stats.recordDecision({ verdict, action, facingBet: needed > 0, street: g.street, leak });
  return { verdict, text };
}

// ─── Session Stats (persisted) ───────────────────────
// Tracks aggregate results plus a per-street breakdown and a tally of named
// "leaks" (recurring mistake types) so the UI can tell the learner *what* they
// are doing wrong, not just an overall accuracy number.
const LEAK_INFO = {
  'fold-equity': { label: 'Folding +EV hands', tip: 'You fold when a call is mathematically profitable. Compare equity to pot odds before folding.' },
  'fold-draw':   { label: 'Folding strong draws', tip: 'You fold good draws too readily. With 8+ outs and implied odds, continuing is often right.' },
  'call-wide':   { label: 'Calling too wide', tip: 'You call without the pot odds to justify it. Fold more when equity is below the price.' },
  'miss-value':  { label: 'Missing value bets', tip: 'You check strong hands instead of betting. When you\'re well ahead, bet for value.' },
  'spew-bluff':  { label: 'Spewing bluffs', tip: 'You bet/raise weak hands with no equity or draw. Bluff with a plan, not at random.' },
  'fold-free':   { label: 'Folding for free', tip: 'You fold when you could check at no cost. Never fold when checking is free.' },
};
const STREETS = ['preflop', 'flop', 'turn', 'river'];

const Stats = {
  _defaults() {
    const byStreet = {};
    for (const s of STREETS) byStreet[s] = { decisions: 0, good: 0 };
    const leaks = {};
    for (const k of Object.keys(LEAK_INFO)) leaks[k] = 0;
    return { hands: 0, won: 0, vpip: 0, biggestPot: 0, decisions: 0, goodDecisions: 0, byStreet, leaks };
  },

  load() {
    this.data = this._defaults();
    try {
      const raw = localStorage.getItem('poker-trainer-stats');
      if (raw) {
        const saved = JSON.parse(raw);
        // Merge carefully so older saves (without byStreet/leaks) still load.
        Object.assign(this.data, saved);
        this.data.byStreet = { ...this._defaults().byStreet, ...(saved.byStreet || {}) };
        this.data.leaks = { ...this._defaults().leaks, ...(saved.leaks || {}) };
      }
    } catch (_) {}
  },
  save() {
    try { localStorage.setItem('poker-trainer-stats', JSON.stringify(this.data)); } catch (_) {}
  },
  reset() {
    this.data = this._defaults();
    this.save();
  },

  recordDecision({ verdict, action, facingBet, street, leak }) {
    if (!this.data) this.load();
    this.data.decisions++;
    const good = verdict === 'good' || verdict === 'ok';
    if (good) this.data.goodDecisions++;

    // Per-street breakdown.
    const bucket = this.data.byStreet[street];
    if (bucket) { bucket.decisions++; if (good) bucket.good++; }

    // Leak tally.
    if (leak && this.data.leaks[leak] !== undefined) this.data.leaks[leak]++;

    // VPIP: voluntarily putting money in (call/raise, not a free check).
    if (facingBet && (action === 'call' || action === 'raise')) this._vpipThisHand = true;
    if (action === 'raise') this._vpipThisHand = true;
    this.save();
  },
  recordHand({ winner, pot }) {
    if (!this.data) this.load();
    this.data.hands++;
    if (winner === 'player') this.data.won++;
    if (pot > this.data.biggestPot) this.data.biggestPot = pot;
    if (this._vpipThisHand) this.data.vpip++;
    this._vpipThisHand = false;
    this.save();
  },

  summary() {
    const d = this.data;
    const winRate = d.hands ? Math.round((d.won / d.hands) * 100) : 0;
    const vpipPct = d.hands ? Math.round((d.vpip / d.hands) * 100) : 0;
    const accuracy = d.decisions ? Math.round((d.goodDecisions / d.decisions) * 100) : 0;
    const byStreet = STREETS.map(s => ({
      street: s,
      decisions: d.byStreet[s].decisions,
      accuracy: d.byStreet[s].decisions ? Math.round((d.byStreet[s].good / d.byStreet[s].decisions) * 100) : null,
    }));
    return { hands: d.hands, winRate, vpipPct, biggestPot: d.biggestPot, accuracy, byStreet };
  },

  // Return the top leaks (most frequent mistakes) for the "Your leaks" panel.
  topLeaks(limit = 3) {
    const d = this.data;
    return Object.entries(d.leaks)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([key, count]) => ({ key, count, ...LEAK_INFO[key] }));
  },
};

// ─── Game State Machine ──────────────────────────────
class PokerGame {
  constructor() {
    this.reset();
  }

  reset() {
    this.playerChips = STARTING_CHIPS;
    this.aiChips = STARTING_CHIPS;
    this.pot = 0;
    this.currentBet = 0;
    this.playerBet = 0;
    this.aiBet = 0;
    this.playerHole = [];
    this.aiHole = [];
    this.community = [];
    this.street = 'idle';
    this.lastAction = null;
    this.handHistory = [];
    this.button = 0; // 0 = player, 1 = AI
    this.deck = null;
    this.lastShowdown = null;
    this.waitingForAction = false;
    this.handNum = 0;
    this.toAct = null;        // 'player' | 'ai'
    this.acted = {};          // who has acted since last raise this round
    this.coach = null;        // last coaching verdict
    this.actionLog = [];      // per-action log for the current hand
  }

  // `opts.seed` makes the deal (and AI randomness) reproducible. `opts.button`
  // pins who is dealer (so a replayed hand keeps the same positions).
  startNewHand(opts = {}) {
    // Seed the RNG for this hand if requested; otherwise generate & record a seed
    // so any hand can be replayed exactly later.
    const seed = (opts.seed !== undefined && opts.seed !== null)
      ? (opts.seed >>> 0)
      : (Math.floor(Math.random() * 0xFFFFFFFF) >>> 0);
    this.handSeed = seed;
    RNG.seed(seed);

    if (opts.button !== undefined) this.button = opts.button;
    this.handButton = this.button; // remember for replay

    this.deck = new Deck();
    this.deck.shuffle();

    this.playerHole = [this.deck.deal(), this.deck.deal()];
    this.aiHole = [this.deck.deal(), this.deck.deal()];
    this.community = [];
    this.pot = 0;
    this.currentBet = 0;
    this.playerBet = 0;
    this.aiBet = 0;
    this.lastAction = null;
    this.lastShowdown = null;
    this.coach = null;
    this.handNum++;
    this.street = 'preflop';
    this.waitingForAction = false;
    this.acted = {};
    this.actionLog = [];

    // Post blinds. Button = small blind heads-up.
    if (this.button === 0) {
      this._postBlind('player', SMALL_BLIND);
      this._postBlind('ai', BIG_BLIND);
    } else {
      this._postBlind('ai', SMALL_BLIND);
      this._postBlind('player', BIG_BLIND);
    }

    // Pre-flop: the button (small blind) acts first.
    this.toAct = this.button === 0 ? 'player' : 'ai';
    this._giveTurn();
  }

  // Re-deal an exact hand (same cards, same positions) from a saved seed so the
  // learner can replay a spot and try a different line.
  replayHand(seed, button) {
    this.startNewHand({ seed, button });
  }

  _postBlind(who, amount) {
    if (who === 'player') {
      amount = Math.min(amount, this.playerChips);
      this.playerChips -= amount;
      this.playerBet += amount;
    } else {
      amount = Math.min(amount, this.aiChips);
      this.aiChips -= amount;
      this.aiBet += amount;
    }
    this.pot += amount;
    this.currentBet = Math.max(this.playerBet, this.aiBet);
  }

  // Hand the turn to whoever is `toAct`: prompt the player or run the AI.
  _giveTurn() {
    if (this.toAct === 'player') {
      this.waitingForAction = true;
    } else {
      this.waitingForAction = false;
      this._aiTurn();
    }
  }

  // Player makes an action
  playerAction(action, amount = 0) {
    if (!this.waitingForAction || this.toAct !== 'player') return;

    // Grade the action against engine math BEFORE state changes. Snapshot the
    // pre-action spot so an async LLM elaboration can reference it later.
    const snapshot = this._snapshot();
    this.coach = evaluateDecision(this, action, amount);

    // If an AI coach is configured, ask it to elaborate the template verdict
    // asynchronously. The deterministic verdict shows instantly; the richer
    // explanation streams in on the next render when it returns.
    if (this.coach && typeof Brain !== 'undefined' && Brain.isConfigured()) {
      this.coach.elaborating = true;
      const token = (this._coachToken = (this._coachToken || 0) + 1);
      Brain.explainDecision(snapshot, action, this.coach).then(res => {
        // Ignore if a newer action superseded this one.
        if (token !== this._coachToken || !this.coach) return;
        if (res.source === 'llm') this.coach.text = res.text;
        this.coach.elaborating = false;
        this.coach.source = res.source;
        render();
      });
    }

    this.waitingForAction = false;
    this.lastAction = { who: 'player', action, amount };
    this._applyTurn('player', action, amount);
  }

  // A lightweight clone of the fields getAdvice/buildGameContext read, so async
  // coaching reflects the spot AT THE MOMENT OF THE DECISION, not after.
  _snapshot() {
    return {
      street: this.street,
      playerHole: [...this.playerHole],
      aiHole: [...this.aiHole],
      community: [...this.community],
      pot: this.pot, currentBet: this.currentBet,
      playerBet: this.playerBet, aiBet: this.aiBet,
      playerChips: this.playerChips, aiChips: this.aiChips,
      button: this.button,
      actionLog: [...this.actionLog],
      lastShowdown: null,
    };
  }

  // Shared turn handler for both player and AI.
  _applyTurn(who, action, amount) {
    this._logAction(who, action, amount);

    if (action === 'fold') {
      this._executeAction(who, action, amount);
      this._endHand(who === 'player' ? 'ai' : 'player',
                    who === 'player' ? 'Player folded' : 'AI folded');
      render();
      return;
    }

    const wasRaise = action === 'raise';
    this._executeAction(who, action, amount);
    this.acted[who] = true;

    // A raise re-opens the action for the opponent.
    if (wasRaise) this.acted[who === 'player' ? 'ai' : 'player'] = false;

    if (this._roundClosed()) {
      this._advanceStreet();
    } else {
      this.toAct = who === 'player' ? 'ai' : 'player';
      this._giveTurn();
    }
  }

  // Record a human-readable action for the hand-history log.
  _logAction(who, action, amount) {
    let label = action;
    const myBet = who === 'player' ? this.playerBet : this.aiBet;
    const myChips = who === 'player' ? this.playerChips : this.aiChips;
    if (action === 'raise') {
      const total = Math.min(amount, myChips + myBet);
      label = `${this.currentBet === 0 ? 'bet $' + total : 'raise to $' + total}`;
    } else if (action === 'call') {
      const need = this.currentBet - myBet;
      label = need > 0 ? `call $${need}` : 'call';
    }
    this.actionLog.push({ who, street: this.street, text: label });
  }

  // The betting round ends when both have acted and bets match, or when a
  // player is all-in and the action has resolved (uncalled chips refunded later).
  _roundClosed() {
    const someoneAllIn = this.playerChips === 0 || this.aiChips === 0;
    const betsMatch = this.playerBet === this.aiBet;
    const bothActed = this.acted.player && this.acted.ai;
    if (betsMatch && bothActed) return true;
    // All-in: a player with 0 chips can't match a larger bet; once the other
    // has acted in response, the betting is over.
    if (someoneAllIn && bothActed) return true;
    return false;
  }

  // Heads-up has no side pots: refund any bet amount the opponent could not match.
  _returnUncalled() {
    if (this.playerBet > this.aiBet) {
      const refund = this.playerBet - this.aiBet;
      this.playerChips += refund;
      this.pot -= refund;
      this.playerBet = this.aiBet;
    } else if (this.aiBet > this.playerBet) {
      const refund = this.aiBet - this.playerBet;
      this.aiChips += refund;
      this.pot -= refund;
      this.aiBet = this.playerBet;
    }
  }

  _executeAction(who, action, amount) {
    if (action === 'fold') return;

    if (who === 'player') {
      if (action === 'check' || action === 'call') {
        const callAmt = Math.min(this.currentBet - this.playerBet, this.playerChips);
        this.playerChips -= callAmt;
        this.playerBet += callAmt;
        this.pot += callAmt;
      } else if (action === 'raise') {
        const maxTotal = this.playerChips + this.playerBet;
        const totalBet = Math.min(amount, maxTotal);
        const additional = totalBet - this.playerBet;
        this.playerChips -= additional;
        this.playerBet = totalBet;
        this.pot += additional;
        this.currentBet = this.playerBet;
      }
    } else {
      if (action === 'check' || action === 'call') {
        const callAmt = Math.min(this.currentBet - this.aiBet, this.aiChips);
        this.aiChips -= callAmt;
        this.aiBet += callAmt;
        this.pot += callAmt;
      } else if (action === 'raise') {
        const maxTotal = this.aiChips + this.aiBet;
        const totalBet = Math.min(amount, maxTotal);
        const additional = totalBet - this.aiBet;
        this.aiChips -= additional;
        this.aiBet = totalBet;
        this.pot += additional;
        this.currentBet = this.aiBet;
      }
    }
  }

  _aiTurn() {
    const state = {
      pot: this.pot, currentBet: this.currentBet,
      playerBet: this.playerBet, aiBet: this.aiBet,
      community: this.community, aiHole: this.aiHole,
      aiChips: this.aiChips, street: this.street
    };

    const decision = AI.act(state);

    // Normalize: can't check facing a bet; can't raise without chips.
    let { action, amount } = decision;
    const aiNeeded = this.currentBet - this.aiBet;
    if (action === 'check' && aiNeeded > 0) action = 'call';
    if (action === 'raise' && amount <= this.aiBet) {
      action = aiNeeded > 0 ? 'call' : 'check';
    }

    this.lastAction = { who: 'ai', action, amount };
    this._applyTurn('ai', action, amount);
  }

  _advanceStreet() {
    // Refund any uncalled bet from the round that just closed (heads-up: no side pots).
    this._returnUncalled();

    if (this.street === 'river') {
      this.street = 'showdown';
      this._showdown();
      return;
    }

    // Deal the next street.
    if (this.community.length === 0) {
      this.deck.deal();
      this.community.push(this.deck.deal(), this.deck.deal(), this.deck.deal());
      this.street = 'flop';
    } else if (this.community.length === 3) {
      this.deck.deal();
      this.community.push(this.deck.deal());
      this.street = 'turn';
    } else if (this.community.length === 4) {
      this.deck.deal();
      this.community.push(this.deck.deal());
      this.street = 'river';
    }

    this.currentBet = 0;
    this.playerBet = 0;
    this.aiBet = 0;
    this.acted = {};

    // If a player is all-in, run it out to showdown automatically.
    if (this.playerChips === 0 || this.aiChips === 0) {
      this._advanceStreet();
      return;
    }

    // Post-flop: the non-button (out of position) acts first.
    this.toAct = this.button === 0 ? 'ai' : 'player';
    this._giveTurn();
  }

  _showdown() {
    const playerResult = HandEval.evaluate([...this.playerHole, ...this.community]);
    const aiResult = HandEval.evaluate([...this.aiHole, ...this.community]);

    let winner, reason;
    if (playerResult.score > aiResult.score) {
      winner = 'player';
      reason = `${playerResult.rankName} beats ${aiResult.rankName}`;
    } else if (aiResult.score > playerResult.score) {
      winner = 'ai';
      reason = `${aiResult.rankName} beats ${playerResult.rankName}`;
    } else {
      winner = 'tie';
      reason = `Both have ${playerResult.rankName}`;
    }

    this.lastShowdown = {
      winner, reason,
      playerResult, aiResult,
      playerHole: [...this.playerHole],
      aiHole: [...this.aiHole],
      board: [...this.community],
      pot: this.pot
    };

    this._endHand(winner, reason);
  }

  _endHand(winner, reason) {
    const finalPot = this.pot;
    if (winner === 'player') {
      this.playerChips += this.pot;
    } else if (winner === 'ai') {
      this.aiChips += this.pot;
    } else {
      // Chop the pot
      this.playerChips += Math.floor(this.pot / 2);
      this.aiChips += Math.ceil(this.pot / 2);
    }

    Stats.recordHand({ winner, pot: finalPot });

    // If the hand reached a real showdown, stay on the 'showdown' street so the
    // labeled breakdown and highlighted winning cards remain visible until the
    // player starts the next hand. Fold-wins (no showdown) go straight to idle.
    this.street = this.lastShowdown ? 'showdown' : 'idle';
    this.waitingForAction = false;
    this.toAct = null;

    // Rotate button
    this.button = 1 - this.button;

    // Record hand
    this.handHistory.push({
      handNum: this.handNum,
      seed: this.handSeed,        // exact deal can be replayed from this
      button: this.handButton,
      playerHole: [...this.playerHole],
      aiHole: [...this.aiHole],
      community: [...this.community],
      winner, reason,
      pot: finalPot,
      actions: [...this.actionLog],
      sawShowdown: !!this.lastShowdown,
      playerResult: this.lastShowdown?.playerResult,
      aiResult: this.lastShowdown?.aiResult
    });

    if (this.playerChips <= 0 || this.aiChips <= 0) {
      this.street = 'gameover';
    }

    render();
  }

  getPotOdds() {
    if (this.currentBet === this.playerBet) {
      return { ratio: '∞', percent: 0, needed: 0 };
    }
    const needed = this.currentBet - this.playerBet;
    const ratio = (this.pot / needed).toFixed(1);
    const percent = ((needed / (this.pot + needed)) * 100).toFixed(1);
    return { ratio, percent: parseFloat(percent), needed };
  }

  getEquity() {
    if (this.playerHole.length === 0) return null;
    return calcEquity(this.playerHole, this.community);
  }
}

// ─── Lessons / Curriculum ────────────────────────────
// A structured, gated learning path. Each lesson has a concept explanation and
// an interactive drill that reuses the real engine (HandEval, analyzeOuts,
// pot-odds math) so the numbers a learner sees here match live play. Progress
// (completed lesson ids) persists in localStorage.
const C = (s) => Card.fromString(s); // shorthand for lesson fixtures

const LESSONS = [
  {
    id: 'hand-rankings',
    title: 'Hand Rankings',
    concept: `Every poker hand is the best 5 cards you can make. From strongest to weakest:
<ol class="lesson-list">
  <li><b>Royal Flush</b> — A-K-Q-J-10, all one suit</li>
  <li><b>Straight Flush</b> — 5 in a row, all one suit</li>
  <li><b>Four of a Kind</b></li>
  <li><b>Full House</b> — three + a pair</li>
  <li><b>Flush</b> — 5 of one suit</li>
  <li><b>Straight</b> — 5 in a row, mixed suits</li>
  <li><b>Three of a Kind</b></li>
  <li><b>Two Pair</b></li>
  <li><b>One Pair</b></li>
  <li><b>High Card</b></li>
</ol>
Higher categories always beat lower ones. Within a category, the higher cards win (the "kicker").`,
    drill: () => {
      // Show two random made 5-card hands; ask which wins.
      const deck = new Deck(); deck.shuffle();
      const a = [deck.deal(), deck.deal(), deck.deal(), deck.deal(), deck.deal()];
      const b = [deck.deal(), deck.deal(), deck.deal(), deck.deal(), deck.deal()];
      const ra = HandEval.evaluate(a), rb = HandEval.evaluate(b);
      const correct = ra.score > rb.score ? 'A' : rb.score > ra.score ? 'B' : 'Tie';
      return {
        prompt: `Which hand wins?<br>
          <div class="drill-cards">Hand A: ${a.map(c => smallCardHTML(c)).join(' ')} <span class="drill-name">(${ra.rankName})</span></div>
          <div class="drill-cards">Hand B: ${b.map(c => smallCardHTML(c)).join(' ')} <span class="drill-name">(${rb.rankName})</span></div>`,
        options: ['A', 'B', 'Tie'],
        correct,
        explain: correct === 'Tie'
          ? `Both make ${ra.rankName} of equal strength — a split pot.`
          : `Hand ${correct} wins: ${(correct === 'A' ? ra : rb).rankName} beats ${(correct === 'A' ? rb : ra).rankName}.`,
      };
    },
  },
  {
    id: 'outs',
    title: 'Counting Outs',
    concept: `An <b>out</b> is any card left in the deck that improves your hand to a likely winner.
<ul class="lesson-list">
  <li><b>Flush draw</b> (4 of a suit): 9 outs — 13 of that suit minus the 4 you see.</li>
  <li><b>Open-ended straight draw</b> (e.g. 8-7-6-5): 8 outs — any of two ranks completes it.</li>
  <li><b>Gutshot</b> (one gap, e.g. 8-7-_-5-4): 4 outs.</li>
</ul>
Counting outs is the foundation of every odds decision that follows.`,
    drill: () => {
      // Deal a hand with a real draw and ask for the out count.
      let hole, board, info, tries = 0;
      do {
        const deck = new Deck(); deck.shuffle();
        hole = [deck.deal(), deck.deal()];
        board = [deck.deal(), deck.deal(), deck.deal()];
        info = analyzeOuts(hole, board);
        tries++;
      } while (info.draws.length === 0 && tries < 200);
      const outs = info.outs;
      // Offer plausible answers around the true count.
      const opts = Array.from(new Set([outs, Math.max(0, outs - 4), outs + 2, 4, 8, 9]))
        .slice(0, 4).sort((a, b) => a - b).map(String);
      if (!opts.includes(String(outs))) opts[0] = String(outs);
      return {
        prompt: `Your hand: ${hole.map(c => smallCardHTML(c)).join(' ')} &nbsp; Board: ${board.map(c => smallCardHTML(c)).join(' ')}<br>
          How many outs do you have${info.draws.length ? ` (${info.draws.join(' + ')})` : ''}?`,
        options: opts,
        correct: String(outs),
        explain: `You have <b>${outs} outs</b>. By the rule of 2 & 4 that's roughly ${info.pctTurn}% on the next card and ${info.pctRiver}% by the river.`,
      };
    },
  },
  {
    id: 'odds',
    title: 'Rule of 2 & 4',
    concept: `A fast way to turn outs into a winning percentage:
<ul class="lesson-list">
  <li><b>×2</b> per out for <b>one</b> card to come (flop→turn, or turn→river).</li>
  <li><b>×4</b> per out for <b>two</b> cards to come (flop→river), all-in.</li>
</ul>
Example: a flush draw = 9 outs. On the flop ≈ 9×4 = <b>36%</b> to hit by the river; with one card to come ≈ 9×2 = <b>18%</b>.`,
    drill: () => {
      const outs = [4, 6, 8, 9, 12, 15][Math.floor(Math.random() * 6)];
      const twoCards = Math.random() < 0.5;
      const pct = Math.min(100, outs * (twoCards ? 4 : 2));
      const opts = Array.from(new Set([pct, pct + 8, Math.max(0, pct - 8), outs * (twoCards ? 2 : 4)]))
        .slice(0, 4).map(v => `${v}%`);
      return {
        prompt: `You have <b>${outs} outs</b> with <b>${twoCards ? 'two cards' : 'one card'}</b> to come.<br>About what % to improve?`,
        options: opts,
        correct: `${pct}%`,
        explain: `${outs} outs × ${twoCards ? 4 : 2} = <b>~${pct}%</b>.`,
      };
    },
  },
  {
    id: 'pot-odds',
    title: 'Pot Odds',
    concept: `<b>Pot odds</b> tell you the price of a call. If the pot is $100 and you must call $50,
you're risking $50 to win $150, so you need to win <b>50 / (100+50) = 33%</b> of the time to break even.
<br><br>The rule: <b>call when your equity (chance to win) is greater than your pot-odds %.</b>
Compare the % to improve (from outs) against the pot-odds %.`,
    drill: () => {
      const pot = [60, 80, 100, 120, 150][Math.floor(Math.random() * 5)];
      const call = [20, 30, 40, 50, 60][Math.floor(Math.random() * 5)];
      const pct = Math.round((call / (pot + call)) * 100);
      const opts = Array.from(new Set([pct, pct + 7, Math.max(0, pct - 7), 50]))
        .slice(0, 4).map(v => `${v}%`);
      return {
        prompt: `Pot is <b>$${pot}</b>. You must call <b>$${call}</b>.<br>What pot-odds % do you need to break even?`,
        options: opts,
        correct: `${pct}%`,
        explain: `${call} / (${pot} + ${call}) = <b>${pct}%</b>. Call if your equity beats ${pct}%.`,
      };
    },
  },
  {
    id: 'decision',
    title: 'Putting It Together',
    concept: `Now combine the skills: count outs → convert to equity (rule of 2 & 4) →
compare with pot odds → decide.
<br><br>If equity > pot-odds %, calling is profitable (+EV). If it's lower, fold —
unless implied odds (future bets you can win) make up the difference.`,
    drill: () => {
      // Real draw + a betting price; ask call or fold.
      let hole, board, info, tries = 0;
      do {
        const deck = new Deck(); deck.shuffle();
        hole = [deck.deal(), deck.deal()];
        board = [deck.deal(), deck.deal(), deck.deal()];
        info = analyzeOuts(hole, board);
        tries++;
      } while (info.draws.length === 0 && tries < 200);
      const pot = [80, 100, 120][Math.floor(Math.random() * 3)];
      const call = [20, 30, 40, 60][Math.floor(Math.random() * 4)];
      const potOdds = Math.round((call / (pot + call)) * 100);
      const equity = info.pctRiver; // approximate with two-card equity
      const shouldCall = equity >= potOdds;
      return {
        prompt: `Your hand: ${hole.map(c => smallCardHTML(c)).join(' ')} &nbsp; Board: ${board.map(c => smallCardHTML(c)).join(' ')}<br>
          ${info.outs} outs (~${equity}% by river). Pot $${pot}, call $${call} (${potOdds}% pot odds). Call or fold?`,
        options: ['Call', 'Fold'],
        correct: shouldCall ? 'Call' : 'Fold',
        explain: shouldCall
          ? `<b>Call.</b> ~${equity}% equity beats ${potOdds}% pot odds — a profitable (+EV) call.`
          : `<b>Fold.</b> ~${equity}% equity can't justify ${potOdds}% pot odds (without strong implied odds).`,
      };
    },
  },
  {
    id: 'position',
    title: 'Position',
    concept: `Acting <b>last</b> is a huge advantage: you see what opponents do before you decide.
The player "in position" (acts last) can value-bet thinner, bluff more, and control the pot size.
<br><br>Play <b>more hands in position</b> and <b>tighten up out of position</b>. In this trainer,
the dealer button acts last after the flop — notice how much easier those decisions are.`,
    drill: () => ({
      prompt: `You're on the button (you act <b>last</b> after the flop) with a marginal hand. Compared to acting first, you should generally play…`,
      options: ['More hands', 'Fewer hands', 'Exactly the same'],
      correct: 'More hands',
      explain: `In position you act last with more information, so you can profitably play <b>more hands</b>.`,
    }),
  },
  {
    id: 'ranges',
    title: 'Thinking in Ranges',
    concept: `Strong players don't guess a single hand — they think about the opponent's whole <b>range</b>
of likely holdings, then narrow it by their actions:
<ul class="lesson-list">
  <li>A big bet/raise → a <b>tight</b>, strong range.</li>
  <li>A check or small bet → a <b>wide/loose</b> range.</li>
</ul>
Your equity should be measured against that range — not against a random hand. This trainer's live
advisor already does this: watch the "vs … range" label change with the AI's bet size.`,
    drill: () => {
      const cases = [
        { bet: 'shoves all-in on the river', answer: 'Tight (strong)' },
        { bet: 'makes a tiny min-bet', answer: 'Loose (wide)' },
        { bet: 'checks to you', answer: 'Loose (wide)' },
        { bet: 'bets the full pot', answer: 'Tight (strong)' },
      ];
      const c = cases[Math.floor(Math.random() * cases.length)];
      return {
        prompt: `The opponent ${c.bet}. Their range is most likely…`,
        options: ['Tight (strong)', 'Loose (wide)'],
        correct: c.answer,
        explain: `Bigger pressure → stronger, tighter range. A small bet or check → a wider, looser range.`,
      };
    },
  },
  {
    id: 'bet-sizing',
    title: 'Bet Sizing',
    concept: `<b>Why</b> you bet decides <b>how much</b>:
<ul class="lesson-list">
  <li><b>Value bet</b> (you're ahead): size to get called by worse — often 50–75% of the pot.</li>
  <li><b>Bluff</b>: bet enough that folding is tempting, but don't risk more than you must.</li>
  <li><b>Protection</b> on wet (draw-heavy) boards: bet bigger to charge draws.</li>
</ul>
Consistent sizing across value and bluffs makes you hard to read.`,
    drill: () => ({
      prompt: `You flop the nut flush on a board with two more cards of that suit (opponents may be drawing). You want to bet for value and protection. Best sizing?`,
      options: ['Check', 'Min-bet (10% pot)', '60–80% of the pot'],
      correct: '60–80% of the pot',
      explain: `A larger value bet (60–80%) charges draws to continue and builds the pot while you're ahead.`,
    }),
  },
];

const Lessons = {
  open: false,
  current: 0,
  activeDrill: null,
  drillAnswered: false,

  load() {
    try {
      this.completed = new Set(JSON.parse(localStorage.getItem('poker-trainer-lessons') || '[]'));
    } catch (_) { this.completed = new Set(); }
  },
  save() {
    try { localStorage.setItem('poker-trainer-lessons', JSON.stringify([...this.completed])); } catch (_) {}
  },
  isUnlocked(index) {
    // First lesson always open; each subsequent unlocks when the prior is complete.
    if (index === 0) return true;
    return this.completed.has(LESSONS[index - 1].id);
  },
  markComplete(id) { this.completed.add(id); this.save(); },

  show() { this.open = true; Scenarios.active = false; this.current = 0; this.activeDrill = null; this.drillAnswered = false; renderLessons(); },
  hide() { this.open = false; renderLessons(); },
  goto(index) {
    if (!this.isUnlocked(index)) return;
    this.current = index;
    this.activeDrill = null;
    this.drillAnswered = false;
    renderLessons();
  },
  startDrill() {
    this.activeDrill = LESSONS[this.current].drill();
    this.drillAnswered = false;
    renderLessons();
  },
  answerDrill(choice) {
    if (!this.activeDrill || this.drillAnswered) return;
    this.drillAnswered = true;
    this.activeDrill.chosen = choice;
    this.activeDrill.wasCorrect = choice === this.activeDrill.correct;
    if (this.activeDrill.wasCorrect) this.markComplete(LESSONS[this.current].id);
    renderLessons();
  },
};

// ─── Scenarios / Quiz mode ───────────────────────────
// Curated, fixed teaching spots. Each defines exact hole cards, board, and a
// betting context; the EV-correct answer is DERIVED from the same engine math
// the live game uses (analyzeOuts + equity vs the inferred range + pot odds),
// so the "right" answer always matches what the trainer teaches. Because the
// spot is fully specified, every player sees the identical, repeatable problem.
const SCENARIOS = [
  {
    id: 's-flush-draw-call',
    title: 'Flush draw, good price',
    hole: ['Ah', 'Kh'], board: ['Qh', '7h', '2c'],
    pot: 100, toCall: 25,
    teach: 'A nut flush draw getting a cheap price. Count outs, compare to pot odds.',
  },
  {
    id: 's-overpair-value',
    title: 'Overpair, bet for value',
    hole: ['As', 'Ad'], board: ['Kh', '8c', '3d'],
    pot: 60, toCall: 0,
    teach: 'You have a strong made hand and it is checked to you. Get value.',
  },
  {
    id: 's-weak-vs-bigbet',
    title: 'Weak hand vs a big bet',
    hole: ['7c', '2d'], board: ['Ah', 'Kd', 'Qs'],
    pot: 80, toCall: 70,
    teach: 'No pair, no draw, facing a big bet that screams strength. Fold and move on.',
  },
  {
    id: 's-oesd-bad-price',
    title: 'Straight draw, bad price',
    hole: ['9c', '8c'], board: ['7d', '6h', 'Ks'],
    pot: 40, toCall: 60,
    teach: 'An open-ender, but the bet is large relative to the pot. Weigh outs vs price.',
  },
  {
    id: 's-set-vs-draws',
    title: 'Set on a wet board',
    hole: ['9h', '9d'], board: ['9c', 'Th', 'Jh'],
    pot: 80, toCall: 0,
    teach: 'A monster, but the board is draw-heavy. Bet big to charge the draws.',
  },
  {
    id: 's-top-pair-vs-bet',
    title: 'Top pair facing pressure',
    hole: ['Ad', 'Jc'], board: ['Js', '9d', '4h'],
    pot: 100, toCall: 30,
    teach: 'Top pair, good kicker, a modest bet. Is your equity enough to continue?',
  },
];

const Scenarios = {
  active: false,
  index: 0,
  answered: false,
  chosen: null,

  load() {
    try { this.completed = new Set(JSON.parse(localStorage.getItem('poker-trainer-scenarios') || '[]')); }
    catch (_) { this.completed = new Set(); }
  },
  save() {
    try { localStorage.setItem('poker-trainer-scenarios', JSON.stringify([...this.completed])); } catch (_) {}
  },

  // Build a throwaway game-like object so we can reuse getAdvice's math exactly.
  _spotAdvice(sc) {
    const fake = {
      playerHole: sc.hole.map(Card.fromString),
      community: sc.board.map(Card.fromString),
      pot: sc.pot,
      currentBet: sc.toCall,   // amount player faces (playerBet treated as 0)
      playerBet: 0,
      aiBet: sc.toCall,        // villain has put in `toCall` more than us
    };
    return getAdvice(fake, MC_ITERATIONS); // higher iterations for a stable answer
  },

  // Map the advisor's recommendation to a discrete quiz answer.
  correctFor(sc) {
    const a = this._spotAdvice(sc);
    const rec = a.recommend.toLowerCase();
    if (sc.toCall === 0) {
      // Betting decision: bet (value or semi-bluff) vs check.
      return rec.includes('bet') || rec.includes('raise') ? 'Bet' : 'Check';
    }
    // Facing a bet: call/raise vs fold.
    if (rec.startsWith('fold')) return 'Fold';
    if (rec.includes('raise')) return 'Raise';
    return 'Call';
  },

  options(sc) {
    return sc.toCall === 0 ? ['Bet', 'Check'] : ['Fold', 'Call', 'Raise'];
  },

  show() { this.active = true; this.index = 0; this.answered = false; this.chosen = null; renderLessons(); },
  goto(i) {
    if (i < 0 || i >= SCENARIOS.length) return;
    this.index = i; this.answered = false; this.chosen = null; renderLessons();
  },
  answer(choice) {
    if (this.answered) return;
    this.answered = true;
    this.chosen = choice;
    const sc = SCENARIOS[this.index];
    this._correct = this.correctFor(sc);
    this._advice = this._spotAdvice(sc);
    if (choice === this._correct) { this.completed.add(sc.id); this.save(); }
    renderLessons();
  },
};

// ─── AI Coach Brain (configurable LLM) ───────────────
// A provider-agnostic "tutor brain" layered on top of the deterministic engine.
// CRITICAL design rule: the LLM never computes poker math. The engine's exact
// numbers (equity, pot odds, outs, range) are injected as authoritative context;
// the model's job is explanation, Socratic questioning, and adapting to the
// player's level. When no provider is configured (or it's offline), the app
// falls back to the built-in TemplateBrain, preserving full offline operation.

const HAND_HELP = {
  // Plain-language hand descriptors to enrich context for the model.
  0: 'no pair (high card)', 1: 'one pair', 2: 'two pair', 3: 'three of a kind',
  4: 'a straight', 5: 'a flush', 6: 'a full house', 7: 'four of a kind',
  8: 'a straight flush', 9: 'a royal flush',
};

// Serialize the ground truth of the current spot for the LLM. Everything the
// model needs to reason pedagogically — and nothing it must compute itself.
function buildGameContext(g, extra = {}) {
  const has2 = g.playerHole && g.playerHole.length === 2;
  const result = has2 ? HandEval.evaluate([...g.playerHole, ...g.community]) : null;
  const advice = has2 ? getAdvice(g, 250) : null;
  const needed = Math.max(0, (g.currentBet || 0) - (g.playerBet || 0));
  const position = g.button === 0 ? 'in position (dealer/button)' : 'out of position';

  return {
    street: g.street,
    yourHand: has2 ? g.playerHole.map(c => c.display) : [],
    handName: result ? result.rankName : '—',
    board: (g.community || []).map(c => c.display),
    pot: g.pot, toCall: needed,
    yourStack: g.playerChips, oppStack: g.aiChips,
    position,
    blinds: `${SMALL_BLIND}/${BIG_BLIND}`,
    // The anti-hallucination payload: authoritative engine numbers.
    engine: advice ? {
      equityPct: Math.round(advice.equity),
      potOddsPct: Math.round(advice.potOddsPct),
      outs: advice.outs ? advice.outs.outs : 0,
      draws: advice.outs ? advice.outs.draws : [],
      pctByRiver: advice.outs ? advice.outs.pctRiver : 0,
      villainRange: advice.range ? advice.range.label : null,
      recommendation: advice.recommend,
      rationale: advice.rationale,
    } : null,
    actionLog: (g.actionLog || []).map(a => `${a.who === 'player' ? 'You' : 'Opponent'} ${a.text} (${a.street})`),
    showdown: g.lastShowdown ? {
      winner: g.lastShowdown.winner,
      reason: g.lastShowdown.reason,
      oppHand: g.aiHole ? g.aiHole.map(c => c.display) : [],
    } : null,
    ...extra,
  };
}

// Render context as a compact, model-friendly block.
function contextToText(ctx) {
  const e = ctx.engine;
  const lines = [
    `Street: ${ctx.street}`,
    `Your hand: ${ctx.yourHand.join(' ') || '—'} (${ctx.handName})`,
    `Board: ${ctx.board.join(' ') || '(none yet)'}`,
    `Pot: $${ctx.pot}; To call: $${ctx.toCall}; Your stack: $${ctx.yourStack}; Opp stack: $${ctx.oppStack}`,
    `Position: ${ctx.position}; Blinds: ${ctx.blinds}`,
  ];
  if (e) {
    lines.push(
      `ENGINE (authoritative — do NOT recompute):`,
      `  win equity: ${e.equityPct}%`,
      `  pot odds: ${e.potOddsPct}%`,
      `  outs: ${e.outs}${e.draws.length ? ' (' + e.draws.join(', ') + ')' : ''}; ~${e.pctByRiver}% by river`,
      `  opponent's likely range: ${e.villainRange || 'unknown'}`,
      `  engine recommendation: ${e.recommendation} — ${e.rationale}`,
    );
  }
  if (ctx.actionLog && ctx.actionLog.length) lines.push(`Action so far: ${ctx.actionLog.join('; ')}`);
  if (ctx.showdown) {
    lines.push(`Showdown: ${ctx.showdown.winner} won — ${ctx.showdown.reason}; opponent had ${ctx.showdown.oppHand.join(' ')}`);
  }
  if (ctx.lastAction) lines.push(`The player just chose to: ${ctx.lastAction}`);
  if (ctx.verdict) lines.push(`Engine graded that action: ${ctx.verdict.verdict} — ${ctx.verdict.text}`);
  if (ctx.playerLeaks && ctx.playerLeaks.length) {
    lines.push(`Player's recurring leaks: ${ctx.playerLeaks.map(l => l.label).join(', ')}`);
  }
  return lines.join('\n');
}

const COACH_SYSTEM_PROMPT =
  `You are a friendly, concise Texas Hold'em poker coach helping a learner improve.\n` +
  `RULES:\n` +
  `- The ENGINE numbers provided are authoritative. NEVER recompute equity, outs, or pot odds; explain and use the given values.\n` +
  `- Teach the "why": connect the cards, the math, and the concept (pot odds, outs, position, ranges).\n` +
  `- Be brief (2-4 sentences unless asked for more). Encouraging, never condescending.\n` +
  `- Adapt to the player's level. If they have recurring leaks, gently reinforce the fix.\n` +
  `- You are a coach, not the opponent. Do not reveal the opponent's hidden cards unless they appear in a SHOWDOWN block.`;

// Provider configuration (persisted in localStorage).
const BrainConfig = {
  provider: 'none',          // 'none' | 'openai' | 'anthropic' | 'ollama'
  apiKey: '',
  model: '',
  baseUrl: '',               // for ollama / custom endpoints
  level: 'beginner',         // beginner | intermediate | advanced

  defaults: {
    openai:    { model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' },
    anthropic: { model: 'claude-3-5-haiku-latest', baseUrl: 'https://api.anthropic.com/v1' },
    ollama:    { model: 'llama3.1', baseUrl: 'http://localhost:11434' },
  },

  load() {
    try {
      const raw = localStorage.getItem('poker-trainer-brain');
      if (raw) Object.assign(this, JSON.parse(raw));
    } catch (_) {}
  },
  save() {
    try {
      localStorage.setItem('poker-trainer-brain', JSON.stringify({
        provider: this.provider, apiKey: this.apiKey, model: this.model,
        baseUrl: this.baseUrl, level: this.level,
      }));
    } catch (_) {}
  },
  modelFor()   { return this.model   || (this.defaults[this.provider]?.model   || ''); },
  baseUrlFor() { return this.baseUrl || (this.defaults[this.provider]?.baseUrl || ''); },
};

// Low-level provider adapters. All fetch-based (no SDKs) to keep the app
// dependency-free. Each takes {system, messages} and returns assistant text.
const Providers = {
  async openai({ system, messages }) {
    const res = await fetch(`${BrainConfig.baseUrlFor()}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${BrainConfig.apiKey}` },
      body: JSON.stringify({
        model: BrainConfig.modelFor(),
        messages: [{ role: 'system', content: system }, ...messages],
        temperature: 0.5, max_tokens: 400,
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
  },

  async anthropic({ system, messages }) {
    const res = await fetch(`${BrainConfig.baseUrlFor()}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': BrainConfig.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: BrainConfig.modelFor(),
        system,
        messages: messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
        max_tokens: 400,
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return (data.content || []).map(b => b.text || '').join('').trim();
  },

  async ollama({ system, messages }) {
    const res = await fetch(`${BrainConfig.baseUrlFor()}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: BrainConfig.modelFor(),
        messages: [{ role: 'system', content: system }, ...messages],
        stream: false,
      }),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.message?.content?.trim() || '';
  },
};

const Brain = {
  isConfigured() {
    if (BrainConfig.provider === 'none') return false;
    if (BrainConfig.provider === 'ollama') return true; // local, no key needed
    return !!BrainConfig.apiKey;
  },

  _system() {
    return COACH_SYSTEM_PROMPT.replace('{level}', BrainConfig.level)
      + `\n\nThe player is a ${BrainConfig.level}.`;
  },

  // Low-level call routing to the active provider.
  async _call(messages) {
    const fn = Providers[BrainConfig.provider];
    if (!fn) throw new Error('No provider configured');
    return fn({ system: this._system(), messages });
  },

  // Elaborate on a graded decision. Falls back to the template text on any error.
  async explainDecision(g, action, verdict) {
    const fallback = verdict ? verdict.text : '';
    if (!this.isConfigured()) return { text: fallback, source: 'template' };
    try {
      const ctx = buildGameContext(g, {
        lastAction: action,
        verdict,
        playerLeaks: Stats.topLeaks ? Stats.topLeaks(2) : [],
      });
      const user = `${contextToText(ctx)}\n\nIn 2-3 sentences, coach me on the action I just took. Explain why it was ${verdict.verdict}.`;
      const text = await this._call([{ role: 'user', content: user }]);
      return { text: text || fallback, source: text ? 'llm' : 'template' };
    } catch (e) {
      return { text: fallback, source: 'template', error: e.message };
    }
  },

  // Interactive chat grounded in the current spot.
  async chat(history, g) {
    if (!this.isConfigured()) throw new Error('No AI coach configured. Add a provider in Settings.');
    const ctx = buildGameContext(g, { playerLeaks: Stats.topLeaks ? Stats.topLeaks(2) : [] });
    // Prepend the live context to the latest user turn so the model is grounded.
    const messages = history.map((m, i) => {
      if (i === history.length - 1 && m.role === 'user') {
        return { role: 'user', content: `[Current spot]\n${contextToText(ctx)}\n\n[My question]\n${m.content}` };
      }
      return m;
    });
    return this._call(messages);
  },
};

// Chat panel controller.
const Coach = {
  open: true,      // dock visible by default (desktop); persisted in localStorage
  history: [],     // {role:'user'|'assistant', content}
  busy: false,
  error: null,

  load() {
    try {
      const v = localStorage.getItem('poker-trainer-coach-open');
      if (v !== null) this.open = v === '1';
    } catch (_) {}
  },
  _persist() { try { localStorage.setItem('poker-trainer-coach-open', this.open ? '1' : '0'); } catch (_) {} },

  show()   { this.open = true;  this.error = null; this._persist(); renderCoach(); },
  hide()   { this.open = false; this._persist(); renderCoach(); },        // minimise
  toggle() { this.open ? this.hide() : this.show(); },
  reset()  { this.history = []; this.error = null; renderCoach(); },

  async ask(text) {
    if (this.busy || !text.trim()) return;
    this.history.push({ role: 'user', content: text.trim() });
    this.busy = true; this.error = null; renderCoach();
    try {
      const reply = await Brain.chat(this.history, game);
      this.history.push({ role: 'assistant', content: reply });
    } catch (e) {
      this.error = e.message;
    } finally {
      this.busy = false; renderCoach();
    }
  },
};

// ─── UI Controller ───────────────────────────────────
const game = new PokerGame();
let adviceVisible = true;

function render() {
  renderTable();
  renderControls();
  renderInfo();
  renderAdvisor();
  renderStatus();
  renderStats();
  renderHistory();
}

function cardHTML(card, faceDown = false, highlight = false) {
  if (!card || faceDown) {
    return `<div class="card card-back"><span>🂠</span></div>`;
  }
  const color = card.color;
  const cls = highlight ? 'card card-winning' : 'card';
  return `<div class="${cls}" style="color:${color}; border-color:${color};">
    <span class="card-rank">${card.name}</span>
    <span class="card-suit">${card.suit}</span>
  </div>`;
}

function smallCardHTML(card) {
  if (!card) return '';
  return `<span class="mini-card" style="color:${card.color}">${card.display}</span>`;
}

function renderTable() {
  // AI cards
  const showAI = (game.street === 'showdown' || game.street === 'idle' || game.street === 'gameover');

  // At showdown, highlight the 5 cards that make the winner's hand.
  const sd = (game.street === 'showdown') ? game.lastShowdown : null;
  const winKeys = new Set();
  if (sd) {
    const res = sd.winner === 'ai' ? sd.aiResult
              : sd.winner === 'player' ? sd.playerResult
              : null; // split pot: don't single out one player's cards
    if (res && res.bestCards) res.bestCards.forEach(c => winKeys.add(c.display));
  }
  const isWin = (c) => winKeys.has(c.display);

  document.getElementById('ai-cards').innerHTML =
    game.aiHole.map(c => cardHTML(c, !showAI, showAI && isWin(c))).join('') ||
    '<span class="empty-cards">—</span>';

  // Player cards
  document.getElementById('player-cards').innerHTML =
    game.playerHole.map(c => cardHTML(c, false, isWin(c))).join('') ||
    '<span class="empty-cards">—</span>';

  // Community cards
  const commHTML = game.community.map(c => cardHTML(c, false, isWin(c))).join('');
  const placeholderCount = 5 - game.community.length;
  const placeholders = Array(placeholderCount).fill('<div class="card card-placeholder"><span>?</span></div>').join('');
  document.getElementById('community-cards').innerHTML = commHTML + placeholders;

  // Chips
  document.getElementById('player-chips').textContent = `$${game.playerChips}`;
  document.getElementById('ai-chips').textContent = `$${game.aiChips}`;
  document.getElementById('pot-display').textContent = `Pot: $${game.pot}`;

  // Per-player bet indicators: how much each has committed THIS round, plus the
  // action that produced it (bet / raise to / call / check). Cleared between
  // hands and when a betting round resets (bets return to 0).
  renderBetBadge('player', game.playerBet);
  renderBetBadge('ai', game.aiBet);

  // Dealer button
  document.getElementById('dealer-indicator').textContent =
    game.button === 0 ? 'You are dealer' : 'AI is dealer';
}

// Show a chip badge with the amount a player has in front of them this round and
// a short label for their latest action on the current street.
function renderBetBadge(who, betAmount) {
  const el = document.getElementById(`${who}-bet`);
  if (!el) return;

  const live = game.street === 'preflop' || game.street === 'flop'
            || game.street === 'turn' || game.street === 'river';

  if (!live) { el.hidden = true; return; }

  // Most recent action by this player on the current street.
  let actionText = '';
  for (let i = game.actionLog.length - 1; i >= 0; i--) {
    const a = game.actionLog[i];
    if (a.who === who && a.street === game.street) { actionText = a.text; break; }
  }

  // Derive a short verb from the logged action ("raise to $50" -> "raised",
  // "bet $10" -> "bet", "call $40" -> "called"). The amount is shown by the chip.
  let verb = '';
  if (/^raise/.test(actionText)) verb = 'raised';
  else if (/^bet/.test(actionText)) verb = 'bet';
  else if (/^call/.test(actionText)) verb = 'called';
  else if (actionText === 'check') verb = 'checked';

  // Show a badge when there's chips committed or a meaningful action to report.
  if (betAmount > 0) {
    el.hidden = false;
    el.className = 'player-bet has-bet';
    el.innerHTML = `🪙 $${betAmount}${verb ? ` <span class="bet-action">${verb}</span>` : ''}`;
  } else if (verb === 'checked') {
    el.hidden = false;
    el.className = 'player-bet';
    el.innerHTML = `<span class="bet-action">checked</span>`;
  } else {
    el.hidden = true;
  }
}

function renderControls() {
  const container = document.getElementById('controls');
  const needed = game.currentBet - game.playerBet;
  const canCheck = needed === 0;

  if (game.street === 'idle' || game.street === 'gameover' || game.street === 'showdown') {
    container.innerHTML = `
      <button id="btn-new-hand" class="btn btn-primary">${game.street === 'gameover' ? 'New Game' : 'Next Hand'}</button>
      <button id="btn-reset" class="btn btn-secondary">Reset Game</button>
    `;
    document.getElementById('btn-new-hand')?.addEventListener('click', () => {
      if (game.street === 'gameover') game.reset();
      game.startNewHand();
      render();
    });
    document.getElementById('btn-reset')?.addEventListener('click', () => {
      game.reset();
      render();
    });
    return;
  }

  if (!game.waitingForAction) {
    container.innerHTML = `<div class="thinking">AI is thinking...</div>`;
    return;
  }

  // Raise amounts are TOTAL bet amounts (relative to what the player already has
  // in front). Bound to a legal min raise and the player's stack (all-in).
  const minRaiseTotal = Math.max(BIG_BLIND, game.currentBet + BIG_BLIND);
  const maxRaiseTotal = game.playerChips + game.playerBet;
  const defaultRaiseTotal = Math.min(minRaiseTotal + BIG_BLIND * 3, maxRaiseTotal);

  // The action is a "bet" when nobody has bet yet this round, else a "raise".
  const raiseVerb = game.currentBet === 0 ? 'Bet' : 'Raise to';

  // Pot-relative quick sizes (total bet = current call + a fraction of the pot).
  // These are the standard shortcuts real players use, so typing is rarely needed.
  const potAfterCall = game.pot + needed;
  const sizeForFraction = (frac) => {
    const total = game.currentBet + needed + Math.round((potAfterCall * frac) / BIG_BLIND) * BIG_BLIND;
    return Math.max(minRaiseTotal, Math.min(total, maxRaiseTotal));
  };
  const quickSizes = [
    { label: '½ pot', val: sizeForFraction(0.5) },
    { label: '¾ pot', val: sizeForFraction(0.75) },
    { label: 'Pot',   val: sizeForFraction(1) },
    { label: 'All-in', val: maxRaiseTotal },
  ];
  // De-dupe sizes that collapse to the same value (e.g. short stacks).
  const seenVals = new Set();
  const quickButtons = quickSizes.filter(q => {
    if (seenVals.has(q.val) || q.val > maxRaiseTotal) return false;
    seenVals.add(q.val); return true;
  }).map(q => `<button class="chip-size" data-size="${q.val}">${q.label}</button>`).join('');

  container.innerHTML = `
    <div class="controls-row">
      <button id="btn-fold" class="btn btn-danger">Fold</button>
      <button id="btn-check" class="btn btn-secondary" ${!canCheck ? 'disabled' : ''}>
        ${canCheck ? 'Check ✓' : 'Check'}
      </button>
      <button id="btn-call" class="btn btn-success">
        ${needed > 0 ? `Call $${needed}` : 'Call'}
      </button>
      <div class="raise-group">
        <div class="raise-amount-field">
          <span class="raise-currency">$</span>
          <input type="number" id="raise-input" inputmode="numeric"
                 min="${minRaiseTotal}" max="${maxRaiseTotal}" step="${BIG_BLIND}"
                 value="${defaultRaiseTotal}" aria-label="Raise amount">
        </div>
        <button id="btn-raise" class="btn btn-warning">${raiseVerb}</button>
      </div>
    </div>
    <div class="quick-sizes">${quickButtons}<span class="raise-range">min $${minRaiseTotal} · max $${maxRaiseTotal}</span></div>
    <button id="btn-advice" class="btn btn-info">${adviceVisible ? '🙈 Hide Live Advice' : '💡 Show Live Advice'}</button>
  `;

  const raiseInput = document.getElementById('raise-input');
  // Clamp a typed/selected value into the legal [min, max] range, snapped to BB.
  const clampRaise = (v) => {
    let n = parseInt(v, 10);
    if (isNaN(n)) n = minRaiseTotal;
    n = Math.max(minRaiseTotal, Math.min(n, maxRaiseTotal));
    return n;
  };

  document.getElementById('btn-fold')?.addEventListener('click', () => {
    game.playerAction('fold');
    render();
  });

  document.getElementById('btn-check')?.addEventListener('click', () => {
    if (canCheck) {
      game.playerAction('check');
      render();
    }
  });

  document.getElementById('btn-call')?.addEventListener('click', () => {
    game.playerAction('call');
    render();
  });

  const submitRaise = () => {
    const amt = clampRaise(raiseInput?.value);
    game.playerAction('raise', amt);
    render();
  };
  document.getElementById('btn-raise')?.addEventListener('click', submitRaise);

  // Quick-size buttons fill the input (one click = exact pot-relative size).
  container.querySelectorAll('.chip-size').forEach(b =>
    b.addEventListener('click', () => { if (raiseInput) raiseInput.value = b.dataset.size; raiseInput?.focus(); }));

  // Enter submits the raise; clamp on blur so out-of-range values self-correct.
  raiseInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitRaise(); });
  raiseInput?.addEventListener('blur', () => { if (raiseInput) raiseInput.value = clampRaise(raiseInput.value); });

  document.getElementById('btn-advice')?.addEventListener('click', () => {
    adviceVisible = !adviceVisible;
    render();
  });
}

function renderInfo() {
  const equityContainer = document.getElementById('equity-display');
  const potOddsContainer = document.getElementById('potodds-display');
  const handNameContainer = document.getElementById('handname-display');

  if (game.playerHole.length > 0 && game.street !== 'idle' && game.street !== 'gameover') {
    // Hand name
    const allCards = [...game.playerHole, ...game.community];
    const result = HandEval.evaluate(allCards);
    handNameContainer.textContent = result.rankName;

    // Equity
    const equity = game.getEquity();
    if (equity) {
      equityContainer.innerHTML = `Win: ${equity.win}% / Tie: ${equity.tie}%`;
    }

    // Pot odds
    const po = game.getPotOdds();
    if (po.needed > 0) {
      potOddsContainer.innerHTML = `${po.ratio}:1 (${po.percent}%)`;
    } else {
      potOddsContainer.innerHTML = 'No bet to face';
    }
  } else {
    handNameContainer.textContent = '—';
    equityContainer.textContent = '—';
    potOddsContainer.textContent = '—';
  }
}

// Expandable explanation of HOW the live numbers are computed and WHY they move
// as the board develops. Turns the advisor from a black box into a teaching tool.
// Teach the player to estimate the odds THEMSELVES — the same way a real player
// does at the table — rather than just quoting the engine's number. The engine's
// Monte-Carlo figure is shown only as a reality-check against the player's own
// hand-doable estimate (count outs → rule of 2 & 4 → compare to pot odds).
function oddsExplainerHTML(a) {
  const c = a.calc;
  if (!c) return '';
  const outs = a.outs || {};
  const hasDraw = outs.outs > 0 && outs.draws && outs.draws.length > 0;
  const multiplier = c.cardsToCome >= 2 ? 4 : 2;
  const cardsWord = c.cardsToCome >= 2 ? 'two cards (turn + river)' : 'one card';

  let steps = '';

  if (hasDraw) {
    // Show the actual out cards so "outs" become concrete, not abstract.
    const outChips = (outs.outCards || []).map(card =>
      `<span class="out-card" style="color:${card.color}; border-color:${card.color}">${card.display}</span>`
    ).join('');
    const handEstimate = Math.min(100, outs.outs * multiplier);

    steps = `
      <ol class="odds-steps">
        <li><b>Spot your draw.</b> You're drawing to a <b>${outs.draws.join(' + ')}</b>.</li>
        <li><b>Count your outs</b> — the unseen cards that complete it. Here there are <b>${outs.outs}</b>:
            <div class="out-cards">${outChips}</div></li>
        <li><b>Rule of 2 &amp; 4</b> (the shortcut pros use in their head): multiply outs by
            <b>${multiplier}</b> for ${cardsWord}.<br>
            <span class="odds-math">${outs.outs} outs × ${multiplier} = <b>~${handEstimate}%</b></span>
            chance to <b>hit your draw</b> by the river.</li>
        <li><b>That's your draw's odds.</b> The engine's <b>~${Math.round(a.equity)}%</b> is your <em>total</em>
            win chance — usually a bit higher, because you can also win when your draw misses (e.g. your
            ace or king pairs). Your ~${handEstimate}% is the part you can compute by hand, and it's what
            you compare to the price below.</li>
      </ol>`;
  } else {
    // Made hand / no clean draw: explain equity in terms a human can reason about.
    steps = `
      <ol class="odds-steps">
        <li><b>No drawing hand here</b>, so there are no clean "outs" to count.</li>
        <li><b>Judge it by strength &amp; the board.</b> Your equity (<b>~${Math.round(a.equity)}%</b>) is how
            often you'd win if all cards came — estimated by comparing your hand to the cards the opponent
            is likely holding (their <b>${c.rangeLabel}</b> range).</li>
        <li><b>Rule of thumb:</b> a strong made hand wants to bet for value; a weak one wants to keep the pot
            small. The exact % only matters when you're <em>facing a bet</em> (see pot odds below).</li>
      </ol>`;
  }

  // Pot odds — the second human-doable calculation, with the decision rule.
  let potOddsBlock;
  if (c.call > 0) {
    const breakEvenOuts = hasDraw ? Math.ceil((a.potOddsPct / multiplier)) : null;
    const outsRule = hasDraw
      ? ` In outs terms: you'd need about <b>${breakEvenOuts} outs</b> to break even — you have <b>${outs.outs}</b>, so calling is ${outs.outs >= breakEvenOuts ? '<b>profitable ✅</b>' : '<b>not worth it ❌</b>'}.`
      : '';
    potOddsBlock =
      `<p class="odds-potodds"><b>Now the price — pot odds.</b> You must call <b>$${c.call}</b> to win a
       <b>$${c.potBeforeCall}</b> pot. Your break-even % = call ÷ (pot + call):<br>
       <span class="odds-math">${c.call} ÷ (${c.potBeforeCall} + ${c.call}) = <b>${Math.round(a.potOddsPct)}%</b></span><br>
       <b>The rule:</b> call when your win % beats this number (${Math.round(a.equity)}% vs ${Math.round(a.potOddsPct)}%).${outsRule}</p>`;
  } else {
    potOddsBlock = `<p class="odds-potodds"><b>No price to pay</b> — there's no bet to call, so you can see the next card for free. Drawing hands love a free card.</p>`;
  }

  // Why the number moves as cards appear — the intuition.
  let whyBlock;
  if (c.cardsToCome > 0) {
    whyBlock = `<p class="odds-why"><b>Why it moves:</b> with <b>${c.cardsToCome} card${c.cardsToCome > 1 ? 's' : ''} still to come</b>, the outcome isn't decided. Each board card either <b>hits your outs</b> (equity jumps up) or <b>misses</b> (it slips), and there are fewer unknowns left — so the estimate sharpens toward 0% or 100%.</p>`;
  } else {
    whyBlock = `<p class="odds-why"><b>It's final now:</b> all five board cards are out, so there's nothing left to draw — the win % is no longer an estimate.</p>`;
  }

  const openAttr = oddsExplainerOpen ? ' open' : '';
  return `
    <details class="odds-explainer" id="odds-explainer"${openAttr}>
      <summary>🎓 How to work out these odds yourself</summary>
      <div class="odds-explainer-body">
        ${steps}
        ${potOddsBlock}
        ${whyBlock}
        <p class="odds-footer">Practice this and you'll read odds at a real table with no app — that's the whole point.</p>
      </div>
    </details>`;
}
let oddsExplainerOpen = false;

function renderAdvisor() {
  const el = document.getElementById('advisor-area');
  if (!el) return;

  const live = adviceVisible
    && game.waitingForAction
    && game.toAct === 'player'
    && game.playerHole.length === 2;

  let html = '';

  // Post-action coaching (persists until next action).
  if (game.coach && game.coach.text) {
    const icon = { good: '✅', ok: '👍', warn: '⚠️', bad: '❌' }[game.coach.verdict] || '•';
    const badge = game.coach.source === 'llm' ? ' <span class="coach-badge">AI coach</span>' : '';
    const thinking = game.coach.elaborating ? ' <span class="coach-thinking">· coach is elaborating…</span>' : '';
    html += `<div class="coach coach-${game.coach.verdict}">${icon} ${game.coach.text}${badge}${thinking}</div>`;
  }

  if (live) {
    const a = getAdvice(game);
    if (a) {
      const oddsText = a.needed > 0
        ? `Pot odds: ${a.potOddsPct.toFixed(0)}% (call $${a.needed})`
        : 'No bet to face';
      const rangeText = a.range ? ` &nbsp;·&nbsp; vs <b>${a.range.label}</b> range (~${a.range.pct}%)` : '';

      // Outs line: teach the rule of 2 & 4 whenever a real draw exists.
      let outsHTML = '';
      if (a.outs && a.outs.outs > 0 && a.outs.draws.length) {
        const drawText = a.outs.draws.join(' + ');
        outsHTML = `<div class="advice-outs">🎯 ${a.outs.outs} outs (${drawText}) — rule of 2 &amp; 4: ~${a.outs.pctTurn}% next card, ~${a.outs.pctRiver}% by the river.</div>`;
      }

      html += `
        <div class="advice advice-${a.color}">
          <div class="advice-head">🃏 ${a.handName} &nbsp;·&nbsp; Win ~${a.equity.toFixed(0)}% &nbsp;·&nbsp; ${oddsText}${rangeText}</div>
          <div class="advice-rec"><strong>Suggested: ${a.recommend}</strong></div>
          <div class="advice-why">${a.rationale}</div>
          ${outsHTML}
          ${oddsExplainerHTML(a)}
        </div>`;
    }
  }

  el.innerHTML = html;
  el.style.display = html ? 'block' : 'none';

  // Keep the explainer's open/closed state across re-renders (the advisor
  // re-renders often as the equity worker returns sharper numbers).
  const exp = document.getElementById('odds-explainer');
  if (exp) exp.addEventListener('toggle', () => { oddsExplainerOpen = exp.open; });
}

function renderStats() {
  const el = document.getElementById('stats-area');
  if (!el) return;
  const s = Stats.summary();
  el.innerHTML = `
    <span><b>${s.hands}</b> hands</span>
    <span>Win <b>${s.winRate}%</b></span>
    <span>VPIP <b>${s.vpipPct}%</b></span>
    <span>Accuracy <b>${s.accuracy}%</b></span>
    <span>Biggest pot <b>$${s.biggestPot}</b></span>
  `;
  renderLeaks(s);
}

// Per-street accuracy + the "Your leaks" coaching panel.
function renderLeaks(summary) {
  const el = document.getElementById('leaks-area');
  if (!el) return;

  const s = summary || Stats.summary();

  // Per-street accuracy bars (only streets where decisions were made).
  const streetRows = s.byStreet
    .filter(b => b.decisions > 0)
    .map(b => {
      const acc = b.accuracy;
      const cls = acc >= 80 ? 'good' : acc >= 55 ? 'mid' : 'low';
      return `
        <div class="street-stat">
          <span class="street-name">${b.street}</span>
          <span class="street-bar"><span class="street-fill ${cls}" style="width:${acc}%"></span></span>
          <span class="street-pct">${acc}% <small>(${b.decisions})</small></span>
        </div>`;
    }).join('');

  const leaks = Stats.topLeaks(3);
  let leaksHTML = '';
  if (leaks.length) {
    leaksHTML = `
      <div class="leaks-title">⚠️ Your top leaks</div>
      ${leaks.map(l => `
        <div class="leak">
          <div class="leak-head"><b>${l.label}</b> <span class="leak-count">×${l.count}</span></div>
          <div class="leak-tip">${l.tip}</div>
        </div>`).join('')}`;
  } else if (s.hands > 0) {
    leaksHTML = `<div class="leaks-clean">✅ No recurring leaks detected yet — keep playing for deeper analysis.</div>`;
  }

  const html = (streetRows ? `<div class="street-stats">${streetRows}</div>` : '') + leaksHTML;
  el.innerHTML = html;
  el.style.display = html ? 'block' : 'none';
}

function cardsText(cards) {
  if (!cards || !cards.length) return '—';
  return cards.map(c => `<span class="mini-card" style="color:${c.color}">${c.display}</span>`).join(' ');
}

function renderHistory() {
  const el = document.getElementById('history-area');
  if (!el) return;

  const hands = game.handHistory;
  if (!hands.length) {
    el.innerHTML = '<div class="history-empty">No hands played yet.</div>';
    return;
  }

  // Most recent first, cap to last 20 for performance.
  const recent = hands.slice(-20).reverse();
  el.innerHTML = recent.map(h => {
    const winLabel = h.winner === 'player' ? 'You won'
                   : h.winner === 'ai' ? 'AI won' : 'Split';
    const winClass = h.winner === 'player' ? 'win-you'
                   : h.winner === 'ai' ? 'win-ai' : 'win-tie';

    const grouped = {};
    for (const a of h.actions) {
      (grouped[a.street] = grouped[a.street] || []).push(
        `${a.who === 'player' ? 'You' : 'AI'} ${a.text}`
      );
    }
    const order = ['preflop','flop','turn','river'];
    const actionLines = order
      .filter(s => grouped[s])
      .map(s => `<div class="hist-street"><span class="hist-st-name">${s}:</span> ${grouped[s].join(', ')}</div>`)
      .join('');

    const aiCards = h.sawShowdown ? cardsText(h.aiHole) : '<span class="hist-muck">mucked</span>';

    return `
      <details class="hist-item">
        <summary>
          <span class="hist-num">#${h.handNum}</span>
          <span class="hist-cards">${cardsText(h.playerHole)}</span>
          <span class="hist-result ${winClass}">${winLabel} $${h.pot}</span>
        </summary>
        <div class="hist-body">
          <div class="hist-row">Board: ${cardsText(h.community)}</div>
          <div class="hist-row">AI: ${aiCards}${h.reason ? ` — <em>${h.reason}</em>` : ''}</div>
          ${actionLines}
          ${h.seed !== undefined ? `<button class="hist-replay" data-seed="${h.seed}" data-button="${h.button}">🔁 Replay this hand</button>` : ''}
        </div>
      </details>`;
  }).join('');

  // Delegated replay handler: re-deal the exact same cards to try a new line.
  el.querySelectorAll('.hist-replay').forEach(b =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (game.street !== 'idle' && game.street !== 'gameover') {
        if (!confirm('Abandon the current hand and replay this one?')) return;
      }
      game.replayHand(parseInt(b.dataset.seed), parseInt(b.dataset.button));
      render();
    }));
}

// Build the labeled showdown breakdown: each player's named combo, the exact 5
// cards that make it (tagged as coming from the hole or the board), and a clear
// winner banner.
function comboCardsHTML(combo) {
  return combo.cards.map(c =>
    `<span class="sd-card sd-card-${c.from}" style="color:${c.color}; border-color:${c.color}">${c.display}</span>`
  ).join('');
}

function showdownHTML(sd) {
  const pCombo = describeCombo(sd.playerResult, sd.playerHole, sd.board);
  const aCombo = describeCombo(sd.aiResult, sd.aiHole, sd.board);
  const winnerBanner = sd.winner === 'player' ? '🎉 You win!'
    : sd.winner === 'ai' ? 'AI wins'
    : '🤝 Split pot';

  const playerRow = (label, combo, isWinner) => `
    <div class="sd-row ${isWinner ? 'sd-winner' : 'sd-loser'}">
      <div class="sd-row-head">
        <span class="sd-who">${label}</span>
        ${isWinner ? '<span class="sd-tag-win">WINNER</span>' : ''}
      </div>
      <div class="sd-combo-name">${combo.name} <span class="sd-combo-detail">— ${combo.detail}</span></div>
      <div class="sd-cards">${comboCardsHTML(combo)}</div>
      <div class="sd-source">${combo.sourceNote}</div>
    </div>`;

  return `
    <div class="showdown-content">
      <div class="sd-banner">${winnerBanner} <span class="sd-pot">Pot: $${sd.pot}</span></div>
      ${playerRow('🧑 You', pCombo, sd.winner === 'player')}
      ${playerRow('🤖 AI', aCombo, sd.winner === 'ai')}
      <div class="sd-legend">
        <span><span class="sd-key sd-key-hole"></span> from your hand</span>
        <span><span class="sd-key sd-key-board"></span> from the board</span>
      </div>
    </div>`;
}

function renderStatus() {
  const status = document.getElementById('status-area');
  const showdown = document.getElementById('showdown-area');

  if (game.street === 'idle') {
    status.textContent = game.handNum > 0
      ? `Hand #${game.handNum} complete. Click "New Hand".`
      : 'Welcome! Click "New Hand" to start playing.';
    showdown.style.display = 'none';
  } else if (game.street === 'gameover') {
    const winner = game.playerChips > game.aiChips ? '🎉 You won!' : '😵 AI won!';
    status.innerHTML = `Game Over! ${winner} Final: You $${game.playerChips} vs AI $${game.aiChips}`;
    showdown.style.display = 'none';
  } else if (game.street === 'showdown') {
    if (game.lastShowdown) {
      showdown.innerHTML = showdownHTML(game.lastShowdown);
      showdown.style.display = 'block';
    }
    status.textContent = 'Showdown!';
  } else if (game.lastAction) {
    const who = game.lastAction.who === 'player' ? 'You' : 'AI';
    const what = game.lastAction.action;
    const amt = game.lastAction.amount > 0 ? ` $${game.lastAction.amount}` : '';
    status.textContent = `${who} ${what}${amt}`;
    showdown.style.display = 'none';
  }
}

// ─── Lessons rendering ───────────────────────────────
// Tab selector shared by Lessons and Scenarios views.
function lessonTabsHTML() {
  return `
    <div class="lesson-tabs">
      <button class="lesson-tab ${!Scenarios.active ? 'active' : ''}" data-mode="lessons">🎓 Lessons</button>
      <button class="lesson-tab ${Scenarios.active ? 'active' : ''}" data-mode="scenarios">🎯 Scenarios</button>
    </div>`;
}

function wireLessonTabs(body) {
  body.querySelectorAll('[data-mode]').forEach(b =>
    b.addEventListener('click', () => {
      if (b.dataset.mode === 'scenarios') Scenarios.show();
      else { Scenarios.active = false; renderLessons(); }
    }));
}

function renderLessons() {
  const overlay = document.getElementById('lesson-overlay');
  if (!overlay) return;

  if (!Lessons.open) {
    overlay.hidden = true;
    return;
  }
  overlay.hidden = false;

  if (Scenarios.active) { renderScenarios(); return; }

  const lesson = LESSONS[Lessons.current];
  const titleEl = document.getElementById('lesson-title');
  const body = document.getElementById('lesson-body');
  const foot = document.getElementById('lesson-foot');

  const doneCount = Lessons.completed.size;
  titleEl.innerHTML = `🎓 ${lesson.title} <span class="lesson-progress">(${doneCount}/${LESSONS.length} complete)</span>`;

  // Lesson navigation rail.
  const rail = LESSONS.map((l, i) => {
    const unlocked = Lessons.isUnlocked(i);
    const done = Lessons.completed.has(l.id);
    const cls = ['lesson-pill', i === Lessons.current ? 'active' : '', done ? 'done' : '', !unlocked ? 'locked' : ''].join(' ');
    const icon = done ? '✓' : !unlocked ? '🔒' : (i + 1);
    return `<button class="${cls}" data-lesson="${i}" ${!unlocked ? 'disabled' : ''}>${icon} ${l.title}</button>`;
  }).join('');

  // Drill block.
  let drillHTML = '';
  const d = Lessons.activeDrill;
  if (!d) {
    drillHTML = `<button id="lesson-start-drill" class="btn btn-primary lesson-drill-btn">Try a drill →</button>`;
  } else {
    const opts = d.options.map(o => {
      let cls = 'drill-opt';
      if (Lessons.drillAnswered) {
        if (o === d.correct) cls += ' correct';
        else if (o === d.chosen) cls += ' wrong';
      }
      return `<button class="${cls}" data-choice="${o}" ${Lessons.drillAnswered ? 'disabled' : ''}>${o}</button>`;
    }).join('');
    let result = '';
    if (Lessons.drillAnswered) {
      const ok = d.wasCorrect;
      result = `<div class="drill-result ${ok ? 'ok' : 'no'}">
          ${ok ? '✅ Correct!' : '❌ Not quite.'} ${d.explain}
        </div>
        <button id="lesson-next-drill" class="btn btn-secondary lesson-drill-btn">Another drill</button>`;
    }
    drillHTML = `
      <div class="drill">
        <div class="drill-prompt">${d.prompt}</div>
        <div class="drill-opts">${opts}</div>
        ${result}
      </div>`;
  }

  body.innerHTML = `
    ${lessonTabsHTML()}
    <div class="lesson-rail">${rail}</div>
    <div class="lesson-concept">${lesson.concept}</div>
    <div class="lesson-drill-wrap">${drillHTML}</div>
  `;

  // Footer: prev / next navigation.
  const prevDisabled = Lessons.current === 0 ? 'disabled' : '';
  const isLast = Lessons.current === LESSONS.length - 1;
  const nextUnlocked = !isLast && Lessons.isUnlocked(Lessons.current + 1);
  const nextHint = (!isLast && !nextUnlocked) ? '<span class="lesson-hint">Pass the drill to unlock the next lesson</span>' : '';
  foot.innerHTML = `
    <button id="lesson-prev" class="btn btn-secondary" ${prevDisabled}>← Prev</button>
    ${nextHint}
    <button id="lesson-next" class="btn btn-primary" ${(isLast || !nextUnlocked) ? 'disabled' : ''}>Next →</button>
  `;

  // Wire up handlers (fresh each render).
  wireLessonTabs(body);
  body.querySelectorAll('[data-lesson]').forEach(b =>
    b.addEventListener('click', () => Lessons.goto(parseInt(b.dataset.lesson))));
  document.getElementById('lesson-start-drill')?.addEventListener('click', () => Lessons.startDrill());
  document.getElementById('lesson-next-drill')?.addEventListener('click', () => Lessons.startDrill());
  body.querySelectorAll('[data-choice]').forEach(b =>
    b.addEventListener('click', () => Lessons.answerDrill(b.dataset.choice)));
  document.getElementById('lesson-prev')?.addEventListener('click', () => Lessons.goto(Lessons.current - 1));
  document.getElementById('lesson-next')?.addEventListener('click', () => Lessons.goto(Lessons.current + 1));
}

// Scenarios / quiz view (rendered inside the same overlay).
function renderScenarios() {
  const titleEl = document.getElementById('lesson-title');
  const body = document.getElementById('lesson-body');
  const foot = document.getElementById('lesson-foot');

  const sc = SCENARIOS[Scenarios.index];
  const done = Scenarios.completed.size;
  titleEl.innerHTML = `🎯 Scenarios <span class="lesson-progress">(${done}/${SCENARIOS.length} solved)</span>`;

  const rail = SCENARIOS.map((s, i) => {
    const solved = Scenarios.completed.has(s.id);
    const cls = ['lesson-pill', i === Scenarios.index ? 'active' : '', solved ? 'done' : ''].join(' ');
    return `<button class="${cls}" data-scenario="${i}">${solved ? '✓' : (i + 1)} ${s.title}</button>`;
  }).join('');

  const holeC = sc.hole.map(Card.fromString);
  const boardC = sc.board.map(Card.fromString);
  const contextLine = sc.toCall === 0
    ? `Pot <b>$${sc.pot}</b>. It's checked to you.`
    : `Pot <b>$${sc.pot}</b>. Opponent bets — <b>$${sc.toCall}</b> to call.`;

  const opts = Scenarios.options(sc).map(o => {
    let cls = 'drill-opt';
    if (Scenarios.answered) {
      if (o === Scenarios._correct) cls += ' correct';
      else if (o === Scenarios.chosen) cls += ' wrong';
    }
    return `<button class="${cls}" data-sc-choice="${o}" ${Scenarios.answered ? 'disabled' : ''}>${o}</button>`;
  }).join('');

  let result = '';
  if (Scenarios.answered) {
    const ok = Scenarios.chosen === Scenarios._correct;
    const a = Scenarios._advice;
    const oddsTxt = sc.toCall > 0 ? ` vs ${a.potOddsPct.toFixed(0)}% pot odds` : '';
    const outsTxt = (a.outs && a.outs.outs > 0) ? ` You hold ${a.outs.outs} outs (~${a.outs.pctRiver}% by the river).` : '';
    result = `
      <div class="drill-result ${ok ? 'ok' : 'no'}">
        ${ok ? '✅ Correct!' : `❌ Best play was <b>${Scenarios._correct}</b>.`}
        ~${a.equity.toFixed(0)}% equity vs a ${a.range.label} range${oddsTxt}.${outsTxt}
        <div class="scenario-why">${a.rationale}</div>
      </div>`;
  }

  body.innerHTML = `
    ${lessonTabsHTML()}
    <div class="lesson-rail">${rail}</div>
    <div class="scenario">
      <div class="scenario-teach">${sc.teach}</div>
      <div class="scenario-cards">
        <div class="scenario-row"><span class="scenario-lbl">Your hand</span> ${holeC.map(c => cardHTML(c)).join('')}</div>
        <div class="scenario-row"><span class="scenario-lbl">Board</span> ${boardC.map(c => cardHTML(c)).join('')}</div>
      </div>
      <div class="scenario-context">${contextLine}</div>
      <div class="drill-opts">${opts}</div>
      ${result}
    </div>`;

  foot.innerHTML = `
    <button id="sc-prev" class="btn btn-secondary" ${Scenarios.index === 0 ? 'disabled' : ''}>← Prev</button>
    <span class="lesson-hint">Same spot every time — drill it until it's automatic</span>
    <button id="sc-next" class="btn btn-primary" ${Scenarios.index === SCENARIOS.length - 1 ? 'disabled' : ''}>Next →</button>
  `;

  wireLessonTabs(body);
  body.querySelectorAll('[data-scenario]').forEach(b =>
    b.addEventListener('click', () => Scenarios.goto(parseInt(b.dataset.scenario))));
  body.querySelectorAll('[data-sc-choice]').forEach(b =>
    b.addEventListener('click', () => Scenarios.answer(b.dataset.scChoice)));
  document.getElementById('sc-prev')?.addEventListener('click', () => Scenarios.goto(Scenarios.index - 1));
  document.getElementById('sc-next')?.addEventListener('click', () => Scenarios.goto(Scenarios.index + 1));
}

// ─── AI Coach chat rendering ─────────────────────────
function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderCoach() {
  const dock = document.getElementById('coach-dock');
  const launcher = document.getElementById('coach-launcher');
  // Reflect open/minimised state on the shell so layout adjusts, and toggle the
  // floating launcher that reopens a minimised dock.
  if (typeof document.body?.classList?.toggle === 'function') {
    document.body.classList.toggle('coach-collapsed', !Coach.open);
  }
  if (dock) dock.hidden = !Coach.open;
  if (launcher) launcher.hidden = Coach.open;
  if (!Coach.open) return;

  const msgs = document.getElementById('coach-messages');
  const input = document.getElementById('coach-input');
  const send = document.getElementById('coach-send');
  if (!msgs) return;

  let html = '';
  if (!Brain.isConfigured()) {
    html += `<div class="coach-msg coach-msg-system">No AI coach configured yet. Open ⚙️ Settings to add a provider (OpenAI, Anthropic, or local Ollama). Until then, the built-in tips still work during play.</div>`;
  } else if (!Coach.history.length) {
    html += `<div class="coach-msg coach-msg-system">Ask me anything about the hand on the table — e.g. <i>"what beats me here?"</i>, <i>"why is this a call?"</i>, or <i>"how should I size my bet?"</i></div>`;
  }
  for (const m of Coach.history) {
    html += `<div class="coach-msg coach-msg-${m.role}">${escapeHTML(m.content).replace(/\n/g, '<br>')}</div>`;
  }
  if (Coach.busy) html += `<div class="coach-msg coach-msg-assistant coach-typing">●●●</div>`;
  if (Coach.error) html += `<div class="coach-msg coach-msg-error">⚠️ ${escapeHTML(Coach.error)}</div>`;
  msgs.innerHTML = html;
  msgs.scrollTop = msgs.scrollHeight;

  if (input) input.disabled = Coach.busy;
  if (send) send.disabled = Coach.busy;
}

// ─── Settings rendering ──────────────────────────────
function renderSettings() {
  const overlay = document.getElementById('settings-overlay');
  if (!overlay) return;
  overlay.hidden = !Settings.open;
  if (!Settings.open) return;

  const body = document.getElementById('settings-body');
  const p = BrainConfig.provider;
  const needsKey = p === 'openai' || p === 'anthropic';

  body.innerHTML = `
    <div class="settings-field">
      <label>AI coach provider</label>
      <select id="set-provider">
        <option value="none" ${p === 'none' ? 'selected' : ''}>None (built-in tips only)</option>
        <option value="openai" ${p === 'openai' ? 'selected' : ''}>OpenAI (or compatible)</option>
        <option value="anthropic" ${p === 'anthropic' ? 'selected' : ''}>Anthropic (Claude)</option>
        <option value="ollama" ${p === 'ollama' ? 'selected' : ''}>Ollama (local, no key)</option>
      </select>
    </div>
    ${needsKey ? `
    <div class="settings-field">
      <label>API key</label>
      <input id="set-key" type="password" value="${escapeHTML(BrainConfig.apiKey)}" placeholder="sk-…" autocomplete="off">
      <div class="settings-warn">⚠️ Stored in your browser (localStorage) and sent directly to the provider. Use only on your own device — not for shared/hosted deployments.</div>
    </div>` : ''}
    ${p !== 'none' ? `
    <div class="settings-field">
      <label>Model</label>
      <input id="set-model" type="text" value="${escapeHTML(BrainConfig.model)}" placeholder="${BrainConfig.defaults[p]?.model || ''}">
    </div>
    <div class="settings-field">
      <label>Base URL (optional)</label>
      <input id="set-baseurl" type="text" value="${escapeHTML(BrainConfig.baseUrl)}" placeholder="${BrainConfig.defaults[p]?.baseUrl || ''}">
    </div>` : ''}
    <div class="settings-field">
      <label>Your level (tunes coaching depth)</label>
      <select id="set-level">
        <option value="beginner" ${BrainConfig.level === 'beginner' ? 'selected' : ''}>Beginner</option>
        <option value="intermediate" ${BrainConfig.level === 'intermediate' ? 'selected' : ''}>Intermediate</option>
        <option value="advanced" ${BrainConfig.level === 'advanced' ? 'selected' : ''}>Advanced</option>
      </select>
    </div>
    <div class="settings-actions">
      <button id="set-test" class="btn btn-secondary" ${p === 'none' ? 'disabled' : ''}>Test connection</button>
      <button id="set-save" class="btn btn-primary">Save</button>
    </div>
    <div id="set-status" class="settings-status"></div>
  `;

  // Live-update provider to re-render conditional fields.
  document.getElementById('set-provider')?.addEventListener('change', (e) => {
    BrainConfig.provider = e.target.value;
    BrainConfig.model = ''; BrainConfig.baseUrl = ''; // reset to defaults for new provider
    renderSettings();
  });
  document.getElementById('set-save')?.addEventListener('click', () => {
    BrainConfig.apiKey = document.getElementById('set-key')?.value ?? BrainConfig.apiKey;
    BrainConfig.model = document.getElementById('set-model')?.value ?? '';
    BrainConfig.baseUrl = document.getElementById('set-baseurl')?.value ?? '';
    BrainConfig.level = document.getElementById('set-level')?.value ?? 'beginner';
    BrainConfig.save();
    const st = document.getElementById('set-status');
    if (st) { st.textContent = '✅ Saved.'; st.className = 'settings-status ok'; }
    render();
  });
  document.getElementById('set-test')?.addEventListener('click', async () => {
    const st = document.getElementById('set-status');
    // Persist current field values before testing.
    BrainConfig.apiKey = document.getElementById('set-key')?.value ?? BrainConfig.apiKey;
    BrainConfig.model = document.getElementById('set-model')?.value ?? '';
    BrainConfig.baseUrl = document.getElementById('set-baseurl')?.value ?? '';
    if (st) { st.textContent = '⏳ Testing…'; st.className = 'settings-status'; }
    try {
      const reply = await Brain._call([{ role: 'user', content: 'Reply with the single word: ready' }]);
      if (st) { st.textContent = `✅ Connected. Model said: "${reply.slice(0, 40)}"`; st.className = 'settings-status ok'; }
    } catch (e) {
      if (st) { st.textContent = `❌ ${e.message}`; st.className = 'settings-status err'; }
    }
  });
}

const Settings = {
  open: false,
  show() { this.open = true; renderSettings(); },
  hide() { this.open = false; renderSettings(); },
};

// ─── Init ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  Stats.load();
  Lessons.load();
  Scenarios.load();
  BrainConfig.load();
  Coach.load();
  EquityWorker.init();   // spin up the off-thread equity worker (no-op if unsupported)

  // Restore saved difficulty.
  const savedDiff = localStorage.getItem('poker-trainer-difficulty');
  if (savedDiff) AI.setDifficulty(savedDiff);
  const diffSelect = document.getElementById('difficulty');
  if (diffSelect) {
    diffSelect.value = AI.difficulty;
    diffSelect.addEventListener('change', () => {
      AI.setDifficulty(diffSelect.value);
      localStorage.setItem('poker-trainer-difficulty', diffSelect.value);
    });
  }

  // Reset session stats.
  document.getElementById('btn-reset-stats')?.addEventListener('click', () => {
    Stats.reset();
    render();
  });

  // Theme toggle
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    document.body.classList.toggle('dark-theme');
  });

  // Lessons overlay.
  document.getElementById('btn-learn')?.addEventListener('click', () => Lessons.show());
  document.getElementById('lesson-close')?.addEventListener('click', () => Lessons.hide());
  document.getElementById('lesson-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'lesson-overlay') Lessons.hide(); // click backdrop to close
  });

  // AI Coach dock. The header button toggles it; the ▸ minimises it; a floating
  // launcher reopens it. The dock stays docked beside the table (no modal).
  document.getElementById('btn-coach')?.addEventListener('click', () => Coach.toggle());
  document.getElementById('coach-min')?.addEventListener('click', () => Coach.hide());
  document.getElementById('coach-launcher')?.addEventListener('click', () => Coach.show());
  document.getElementById('coach-reset')?.addEventListener('click', () => Coach.reset());
  const coachInput = document.getElementById('coach-input');
  const coachSend = document.getElementById('coach-send');
  const submitCoach = () => {
    const v = coachInput?.value || '';
    if (coachInput) coachInput.value = '';
    Coach.ask(v);
  };
  coachSend?.addEventListener('click', submitCoach);
  coachInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitCoach(); });

  // Settings.
  document.getElementById('btn-settings')?.addEventListener('click', () => Settings.show());
  document.getElementById('settings-close')?.addEventListener('click', () => Settings.hide());
  document.getElementById('settings-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'settings-overlay') Settings.hide();
  });

  // Global escape closes whichever modal overlay is open (the coach dock is not
  // modal, so Escape leaves it alone).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (Settings.open) Settings.hide();
    else if (Lessons.open) Lessons.hide();
  });

  render();
  renderCoach();  // sync the persistent dock to its saved open/minimised state
});