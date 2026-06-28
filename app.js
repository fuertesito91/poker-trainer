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
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
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
    if (cards.length < 5) return { rank: 0, rankName: 'Incomplete Hand', score: 0, kickers: [] };
    const combos = this._combinations(cards, 5);
    let best = null;
    for (const combo of combos) {
      const result = this._eval5(combo);
      if (!best || result.score > best.score || (result.score === best.score && this._cmpKickers(result.kickers, best.kickers) > 0))
        best = result;
    }
    return best;
  },

  _eval5(cards) {
    const ranks = cards.map(c => c.rank).sort((a,b) => b - a);
    const suits = cards.map(c => c.suit);
    const isFlush = suits.every(s => s === suits[0]);
    const isStraight = this._isStraight(ranks);
    const freq = this._frequencies(ranks);

    // Royal Flush
    if (isFlush && isStraight && ranks[0] === 14 && ranks[1] === 13)
      return this._result(9, 'Royal Flush', ranks);

    // Straight Flush
    if (isFlush && isStraight)
      return this._result(8, 'Straight Flush', ranks);

    // Four of a Kind
    if (freq[0].count === 4)
      return this._result(7, 'Four of a Kind', [freq[0].rank, ...freq.slice(1).map(f => f.rank)]);

    // Full House
    if (freq[0].count === 3 && freq[1].count === 2)
      return this._result(6, 'Full House', [freq[0].rank, freq[1].rank]);

    // Flush
    if (isFlush) return this._result(5, 'Flush', ranks);

    // Straight
    if (isStraight) return this._result(4, 'Straight', ranks);

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
function calcEquity(myHole, community, iterations = MC_ITERATIONS) {
  const wins = { win: 0, lose: 0, tie: 0 };
  const knownCards = [...myHole, ...community];
  const knownKeys = new Set(knownCards.map(c => c.display));

  for (let i = 0; i < iterations; i++) {
    const deck = new Deck();
    deck.cards = deck.cards.filter(c => !knownKeys.has(c.display));
    deck.shuffle();

    // Deal opponent hole cards
    const villanHole = [deck.deal(), deck.deal()];

    // Deal remaining community cards
    const remCommunity = [...community];
    const needed = 5 - community.length;
    for (let j = 0; j < needed; j++) remCommunity.push(deck.deal());

    const myResult = HandEval.evaluate([...myHole, ...remCommunity]);
    const vilResult = HandEval.evaluate([...villanHole, ...remCommunity]);

    if (myResult.score > vilResult.score) wins.win++;
    else if (myResult.score < vilResult.score) wins.lose++;
    else wins.tie++;
  }

  return {
    win:  (wins.win  / iterations * 100).toFixed(1),
    lose: (wins.lose / iterations * 100).toFixed(1),
    tie:  (wins.tie  / iterations * 100).toFixed(1),
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
    const { pot, currentBet, community, aiHole, aiChips, aiBet } = state;
    const aiNeeded = Math.max(0, currentBet - aiBet);
    const potOdds = aiNeeded === 0 ? 0 : aiNeeded / (pot + aiNeeded);
    const allCards = [...aiHole, ...community];
    const p = this.profile;

    // Equity vs a random villain hand on the current board.
    const equity = this._equity(aiHole, community, p.iterations);

    let decision = (community.length === 0)
      ? this._preflopStrategy(aiHole, equity, aiNeeded, potOdds, pot, aiChips, aiBet)
      : this._postflopStrategy(equity, potOdds, pot, aiNeeded, aiChips, aiBet, allCards);

    // Occasional deliberate mistake on easier levels (adds exploitability).
    if (p.mistakeFreq > 0 && Math.random() < p.mistakeFreq) {
      decision = this._mistake(decision, aiNeeded, aiChips, aiBet);
    }
    return decision;
  },

  _equity(hole, community, iterations) {
    const e = calcEquity(hole, community, iterations);
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
      if (Math.random() < p.bluffFreq) {
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
        if (strongDraw && Math.random() < p.bluffFreq + 0.2) {
          const total = this._sizeBet(0.5 * p.aggression, pot, aiChips, aiBet, currentBet);
          if (total > aiBet) return { action: 'raise', amount: total };
        }
        return { action: 'check', amount: 0 };
      }
      if (equity > potOdds + p.callMargin) return { action: 'call', amount: Math.min(aiNeeded, aiChips) };
      // Drawing without price: semi-bluff or fold.
      if (strongDraw && Math.random() < p.bluffFreq) {
        const total = this._sizeBet(0.6 * p.aggression, pot, aiChips, aiBet, currentBet);
        if (total > aiBet + aiNeeded) return { action: 'raise', amount: total };
      }
      return { action: 'fold', amount: 0 };
    }

    // Weak: check, occasional pure bluff, else fold.
    if (aiNeeded === 0) {
      if (Math.random() < p.bluffFreq && aiChips > BIG_BLIND * 4) {
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
// Returns { equity, potOddsPct, needed, recommend, color, rationale, handName }.
function getAdvice(g, iterations = 350) {
  if (g.playerHole.length < 2) return null;
  const result = HandEval.evaluate([...g.playerHole, ...g.community]);
  const eq = calcEquity(g.playerHole, g.community, iterations);
  const equity = parseFloat(eq.win) + parseFloat(eq.tie) / 2;
  const needed = Math.max(0, g.currentBet - g.playerBet);
  const potOddsPct = needed > 0 ? (needed / (g.pot + needed)) * 100 : 0;

  let recommend, color, rationale;
  if (needed === 0) {
    if (equity >= 60) {
      recommend = 'Bet / Raise'; color = 'green';
      rationale = `~${equity.toFixed(0)}% equity — bet for value.`;
    } else if (equity >= 40) {
      recommend = 'Check'; color = 'yellow';
      rationale = `~${equity.toFixed(0)}% equity — pot control, take a free card.`;
    } else {
      recommend = 'Check'; color = 'yellow';
      rationale = `~${equity.toFixed(0)}% equity — check; only bluff with a plan.`;
    }
  } else {
    if (equity >= potOddsPct * 1.6) {
      recommend = 'Raise'; color = 'green';
      rationale = `~${equity.toFixed(0)}% vs ${potOddsPct.toFixed(0)}% pot odds — raise for value.`;
    } else if (equity >= potOddsPct) {
      recommend = 'Call'; color = 'green';
      rationale = `~${equity.toFixed(0)}% equity beats ${potOddsPct.toFixed(0)}% pot odds — profitable call.`;
    } else if (equity >= potOddsPct * 0.75) {
      recommend = 'Fold / marginal call'; color = 'yellow';
      rationale = `~${equity.toFixed(0)}% vs ${potOddsPct.toFixed(0)}% pot odds — close; lean fold.`;
    } else {
      recommend = 'Fold'; color = 'red';
      rationale = `~${equity.toFixed(0)}% can't justify ${potOddsPct.toFixed(0)}% pot odds.`;
    }
  }

  return {
    equity, potOddsPct, needed,
    recommend, color, rationale,
    handName: result.rankName,
  };
}

// Grade the player's action against the EV recommendation (before state changes).
function evaluateDecision(g, action, amount) {
  const advice = getAdvice(g, 250);
  if (!advice) return null;
  const { equity, potOddsPct, needed } = advice;

  let verdict = 'ok', text = '';
  if (needed === 0) {
    if (action === 'fold') { verdict = 'bad'; text = 'Never fold when you can check for free.'; }
    else if (action === 'raise' && equity < 35) { verdict = 'warn'; text = `Betting with ~${equity.toFixed(0)}% — a thin bluff; have a plan.`; }
    else { verdict = 'good'; text = `Reasonable with ~${equity.toFixed(0)}% equity.`; }
  } else {
    const profitable = equity >= potOddsPct;
    if (action === 'fold') {
      if (profitable && equity >= potOddsPct * 1.2) { verdict = 'bad'; text = `Folded ~${equity.toFixed(0)}% equity vs ${potOddsPct.toFixed(0)}% pot odds — a call was +EV.`; }
      else { verdict = 'good'; text = `Disciplined fold (~${equity.toFixed(0)}% vs ${potOddsPct.toFixed(0)}% pot odds).`; }
    } else if (action === 'call') {
      if (profitable) { verdict = 'good'; text = `Good call — ~${equity.toFixed(0)}% beats ${potOddsPct.toFixed(0)}% pot odds.`; }
      else { verdict = 'bad'; text = `Called ~${equity.toFixed(0)}% equity vs ${potOddsPct.toFixed(0)}% pot odds — a fold was better.`; }
    } else if (action === 'raise') {
      if (equity >= potOddsPct * 1.4) { verdict = 'good'; text = `Strong raise — ~${equity.toFixed(0)}% equity.`; }
      else if (equity < potOddsPct * 0.8) { verdict = 'warn'; text = `Raising on ~${equity.toFixed(0)}% — a bluff; risky here.`; }
      else { verdict = 'ok'; text = `Aggressive line with ~${equity.toFixed(0)}% equity.`; }
    }
  }

  Stats.recordDecision(verdict, action, needed > 0);
  return { verdict, text };
}

// ─── Session Stats (persisted) ───────────────────────
const Stats = {
  data: { hands: 0, won: 0, vpip: 0, biggestPot: 0, decisions: 0, goodDecisions: 0 },

  load() {
    try {
      const raw = localStorage.getItem('poker-trainer-stats');
      if (raw) this.data = { ...this.data, ...JSON.parse(raw) };
    } catch (_) {}
  },
  save() {
    try { localStorage.setItem('poker-trainer-stats', JSON.stringify(this.data)); } catch (_) {}
  },
  reset() {
    this.data = { hands: 0, won: 0, vpip: 0, biggestPot: 0, decisions: 0, goodDecisions: 0 };
    this.save();
  },

  recordDecision(verdict, action, facingBet) {
    this.data.decisions++;
    if (verdict === 'good' || verdict === 'ok') this.data.goodDecisions++;
    // VPIP: voluntarily putting money in (call/raise, not a free check).
    if (facingBet && (action === 'call' || action === 'raise')) this._vpipThisHand = true;
    if (action === 'raise') this._vpipThisHand = true;
    this.save();
  },
  recordHand({ winner, pot }) {
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
    return { hands: d.hands, winRate, vpipPct, biggestPot: d.biggestPot, accuracy };
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

  startNewHand() {
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
    this.coach = evaluateDecision(this, action, amount); // coach BEFORE state changes
    this.waitingForAction = false;
    this.lastAction = { who: 'player', action, amount };
    this._applyTurn('player', action, amount);
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

    this.street = 'idle';
    this.waitingForAction = false;
    this.toAct = null;

    // Rotate button
    this.button = 1 - this.button;

    // Record hand
    this.handHistory.push({
      handNum: this.handNum,
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

function cardHTML(card, faceDown = false) {
  if (!card || faceDown) {
    return `<div class="card card-back"><span>🂠</span></div>`;
  }
  const color = card.color;
  return `<div class="card" style="color:${color}; border-color:${color};">
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
  document.getElementById('ai-cards').innerHTML =
    game.aiHole.map(c => cardHTML(c, !showAI)).join('') ||
    '<span class="empty-cards">—</span>';

  // Player cards
  document.getElementById('player-cards').innerHTML =
    game.playerHole.map(c => cardHTML(c)).join('') ||
    '<span class="empty-cards">—</span>';

  // Community cards
  const commHTML = game.community.map(c => cardHTML(c)).join('');
  const placeholderCount = 5 - game.community.length;
  const placeholders = Array(placeholderCount).fill('<div class="card card-placeholder"><span>?</span></div>').join('');
  document.getElementById('community-cards').innerHTML = commHTML + placeholders;

  // Chips
  document.getElementById('player-chips').textContent = `$${game.playerChips}`;
  document.getElementById('ai-chips').textContent = `$${game.aiChips}`;
  document.getElementById('pot-display').textContent = `Pot: $${game.pot}`;

  // Dealer button
  document.getElementById('dealer-indicator').textContent =
    game.button === 0 ? 'You are dealer' : 'AI is dealer';
}

function renderControls() {
  const container = document.getElementById('controls');
  const needed = game.currentBet - game.playerBet;
  const canCheck = needed === 0;

  if (game.street === 'idle' || game.street === 'gameover') {
    container.innerHTML = `
      <button id="btn-new-hand" class="btn btn-primary">${game.street === 'gameover' ? 'New Game' : 'New Hand'}</button>
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

  // Raise slider: values are TOTAL bet amounts
  const minRaiseTotal = Math.max(BIG_BLIND, game.currentBet + BIG_BLIND);
  const maxRaiseTotal = game.playerChips + game.playerBet;
  const defaultRaiseTotal = Math.min(minRaiseTotal + BIG_BLIND * 3, maxRaiseTotal);

  container.innerHTML = `
    <div class="controls-row">
      <button id="btn-fold" class="btn btn-danger">Fold</button>
      <button id="btn-check" class="btn btn-secondary" ${!canCheck ? 'disabled' : ''}>
        ${canCheck ? 'Check ✓' : 'Check'}
      </button>
      <button id="btn-call" class="btn btn-success">
        Call ${needed > 0 ? '$'+needed : ''}
      </button>
      <div class="raise-group">
        <input type="range" id="raise-slider" min="${minRaiseTotal}" max="${maxRaiseTotal}" value="${defaultRaiseTotal}" step="5">
        <span id="raise-amount">$${defaultRaiseTotal}</span>
        <button id="btn-raise" class="btn btn-warning">Raise to</button>
      </div>
    </div>
    <button id="btn-advice" class="btn btn-info">${adviceVisible ? '🙈 Hide Live Advice' : '💡 Show Live Advice'}</button>
  `;

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

  document.getElementById('btn-raise')?.addEventListener('click', () => {
    const amt = parseInt(document.getElementById('raise-slider').value);
    game.playerAction('raise', amt);
    render();
  });

  const slider = document.getElementById('raise-slider');
  const raiseLabel = document.getElementById('raise-amount');
  if (slider && raiseLabel) {
    slider.addEventListener('input', () => {
      raiseLabel.textContent = `$${slider.value}`;
    });
  }

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
    html += `<div class="coach coach-${game.coach.verdict}">${icon} ${game.coach.text}</div>`;
  }

  if (live) {
    const a = getAdvice(game);
    if (a) {
      const oddsText = a.needed > 0
        ? `Pot odds: ${a.potOddsPct.toFixed(0)}% (call $${a.needed})`
        : 'No bet to face';
      html += `
        <div class="advice advice-${a.color}">
          <div class="advice-head">🃏 ${a.handName} &nbsp;·&nbsp; Win ~${a.equity.toFixed(0)}% &nbsp;·&nbsp; ${oddsText}</div>
          <div class="advice-rec"><strong>Suggested: ${a.recommend}</strong></div>
          <div class="advice-why">${a.rationale}</div>
        </div>`;
    }
  }

  el.innerHTML = html;
  el.style.display = html ? 'block' : 'none';
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
        </div>
      </details>`;
  }).join('');
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
      const pName = game.lastShowdown.playerResult?.rankName || '?';
      const aName = game.lastShowdown.aiResult?.rankName || '?';
      const winnerName = game.lastShowdown.winner === 'player' ? 'You win!' :
                         game.lastShowdown.winner === 'ai' ? 'AI wins' : 'Split pot';
      showdown.innerHTML = `
        <div class="showdown-content">
          <p>Your hand: <strong>${pName}</strong> vs AI: <strong>${aName}</strong></p>
          <p class="winner">${winnerName} — Pot: $${game.lastShowdown.pot}</p>
        </div>
      `;
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

// ─── Init ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  Stats.load();

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
  render();
});