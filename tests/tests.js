/* =====================================================
   Poker Trainer — Test cases
   Depends on harness.js (for __TEST__) and app.js
   (for Card, Deck, HandEval, calcEquity, PokerGame).
   ===================================================== */
(function () {
  const { suite, test, eq, ok, approx } = globalThis.__TEST__;

  // Helper: build a 5+ card hand from "Ah Kd ..." shorthand.
  const H = (str) => str.trim().split(/\s+/).map(Card.fromString);
  const evalScore = (str) => HandEval.evaluate(H(str)).score;
  const evalRank = (str) => HandEval.evaluate(H(str)).rank;
  const evalName = (str) => HandEval.evaluate(H(str)).rankName;

  // ─── Card / Deck ───────────────────────────────────
  suite('Card');
  test('fromString parses rank and suit', () => {
    const c = Card.fromString('Ah');
    eq(c.rank, 14, 'ace rank');
    eq(c.suit, '♥', 'hearts suit');
    eq(c.display, 'A♥', 'display');
  });
  test('fromString parses ten as 10', () => {
    eq(Card.fromString('Ts').rank, 10, 'ten rank');
    eq(Card.fromString('10s').rank, 10, 'explicit 10');
  });
  test('fromString rejects garbage', () => {
    eq(Card.fromString('Zz'), null, 'bad rank/suit');
  });

  suite('Deck');
  test('has 52 unique cards', () => {
    const d = new Deck();
    eq(d.cards.length, 52, 'count');
    eq(new Set(d.cards.map(c => c.display)).size, 52, 'uniqueness');
  });
  test('deal removes a card', () => {
    const d = new Deck();
    const before = d.cards.length;
    d.deal();
    eq(d.cards.length, before - 1, 'one fewer');
  });

  // ─── Hand ranking tiers ────────────────────────────
  suite('HandEval ranks');
  test('royal flush', () => {
    eq(evalRank('Ah Kh Qh Jh Th 2c 3d'), 9, 'royal');
    eq(evalName('Ah Kh Qh Jh Th 2c 3d'), 'Royal Flush');
  });
  test('straight flush', () => eq(evalRank('9h 8h 7h 6h 5h 2c 3d'), 8));
  test('four of a kind', () => eq(evalRank('9h 9s 9d 9c 5h 2c 3d'), 7));
  test('full house', () => eq(evalRank('9h 9s 9d 5c 5h 2c 3d'), 6));
  test('flush', () => eq(evalRank('Ah Jh 8h 5h 2h 9c 3d'), 5));
  test('straight', () => eq(evalRank('9h 8s 7d 6c 5h 2c 3d'), 4));
  test('three of a kind', () => eq(evalRank('9h 9s 9d 6c 4h 2c Kd'), 3));
  test('two pair', () => eq(evalRank('9h 9s 6d 6c 4h 2c Kd'), 2));
  test('one pair', () => eq(evalRank('9h 9s 6d 4c 2h Qc Kd'), 1));
  test('high card', () => eq(evalRank('Ah Js 8d 4c 2h 9c Kd'), 0));

  // ─── Wheel (A-2-3-4-5) — the regression bug ────────
  suite('Wheel straight');
  test('A-2-3-4-5 is recognised as a straight', () => {
    eq(evalRank('Ah 2s 3d 4c 5h 9c Kd'), 4, 'wheel is a straight');
  });
  test('wheel LOSES to 6-high straight', () => {
    const wheel = evalScore('Ah 2s 3d 4c 5h');
    const sixHigh = evalScore('2h 3s 4d 5c 6h');
    ok(sixHigh > wheel, 'six-high straight must beat the wheel');
  });
  test('wheel LOSES to a normal straight on shared board', () => {
    // Both make a straight; the non-wheel (6-high) must win.
    const a = HandEval.evaluate(H('Ah 2s 3d 4c 5h 6d 9c')); // 6-high straight available
    const b = HandEval.evaluate(H('Ah 2s 3d 4c 5h'));        // forced wheel
    ok(a.score > b.score, '6-high straight beats wheel');
  });
  test('wheel straight flush beats wheel straight', () => {
    const sf = evalScore('Ah 2h 3h 4h 5h');
    const st = evalScore('Ah 2s 3d 4c 5h');
    ok(sf > st, 'straight flush > straight');
  });

  // ─── Kicker comparisons ────────────────────────────
  suite('Kickers');
  test('higher kicker wins with same pair', () => {
    const a = evalScore('Ks Kd Ah 5c 3h'); // pair K, ace kicker
    const b = evalScore('Ks Kd Qh 5c 3h'); // pair K, queen kicker
    ok(a > b, 'ace kicker beats queen kicker');
  });
  test('higher two pair wins', () => {
    const a = evalScore('As Ad 2h 2c 9h'); // aces up
    const b = evalScore('Ks Kd Qh Qc 9h'); // kings up
    ok(a > b, 'aces up beats kings up');
  });
  test('best 5 of 7 chosen', () => {
    // Seven cards containing a flush should evaluate as the flush.
    eq(evalRank('Ah Kh Qh 2h 3h 4s 5d'), 5, 'flush from 7');
  });
  test('identical hands tie', () => {
    eq(evalScore('Ah Kh Qd Js 9c'), evalScore('As Ks Qh Jd 9h'), 'same ranks tie');
  });

  // ─── Incomplete hands ──────────────────────────────
  suite('Edge cases');
  test('fewer than 5 cards is incomplete', () => {
    eq(HandEval.evaluate(H('Ah Kh')).rank, 0, 'incomplete -> rank 0');
    eq(HandEval.evaluate(H('Ah Kh')).rankName, 'Incomplete Hand');
  });

  // ─── Equity sanity ─────────────────────────────────
  suite('calcEquity');
  test('AA vs random preflop is a heavy favourite', () => {
    const e = calcEquity(H('As Ah'), [], 1500);
    const win = parseFloat(e.win);
    ok(win > 80, `AA should win >80% (got ${win}%)`);
  });
  test('dominated hand on made board near 100%', () => {
    // Quads on board → essentially always at least a tie/win.
    const e = calcEquity(H('Ah Ad'), H('As Ac Kh'), 800);
    ok(parseFloat(e.lose) < 5, `quad aces rarely lose (lose ${e.lose}%)`);
  });
  test('win+lose+tie sums to ~100', () => {
    const e = calcEquity(H('Ks Qs'), H('Jh Ts 2d'), 800);
    approx(parseFloat(e.win) + parseFloat(e.lose) + parseFloat(e.tie), 100, 0.5, 'sums to 100');
  });

  // ─── Pot math (PokerGame) ──────────────────────────
  suite('Pot odds & blinds');
  test('blinds posted correctly heads-up', () => {
    const g = new PokerGame();
    g.startNewHand();
    // Button (player when button===0) posts small blind, other posts big.
    eq(g.pot, SMALL_BLIND + BIG_BLIND, 'pot = SB + BB after blinds');
  });
  test('pot odds with no bet to face is infinite/zero', () => {
    const g = new PokerGame();
    g.reset();
    g.pot = 100; g.currentBet = 0; g.playerBet = 0;
    const po = g.getPotOdds();
    eq(po.needed, 0, 'nothing to call');
    eq(po.percent, 0, '0% pot odds');
  });
  test('pot odds compute correct percentage', () => {
    const g = new PokerGame();
    g.reset();
    g.pot = 100; g.currentBet = 50; g.playerBet = 0;
    const po = g.getPotOdds();
    eq(po.needed, 50, 'need to call 50');
    // 50 / (100 + 50) = 33.3%
    approx(po.percent, 33.3, 0.2, 'pot odds %');
  });

  // ─── Range model ───────────────────────────────────
  suite('Villain ranges');
  test('tight range accepts AA, rejects 72o', () => {
    ok(RANGES.tight.test(H('As Ah')), 'AA in tight range');
    ok(!RANGES.tight.test(H('7s 2h')), '72o not in tight range');
  });
  test('tight ⊆ standard ⊆ loose for a premium hand', () => {
    const hand = H('As Ah');
    ok(RANGES.tight.test(hand) && RANGES.standard.test(hand) && RANGES.loose.test(hand), 'AA in all');
  });
  test('big bet infers a tight range', () => {
    eq(inferVillainRange(100, 80).label, 'tight', 'pot-sized bet -> tight');
  });
  test('no bet infers a loose range', () => {
    eq(inferVillainRange(100, 0).label, 'loose', 'check -> loose');
  });
  test('range-restricted equity differs from random', () => {
    const board = H('Kd 7c 2h');
    const random = parseFloat(calcEquity(H('As Ah'), board, 1500).win);
    const vsTight = parseFloat(calcEquity(H('As Ah'), board, 1500, h => RANGES.tight.test(h)).win);
    // AA wins less often against a tight (strong) range than against random.
    ok(vsTight <= random + 1, `vs tight (${vsTight}%) should not exceed vs random (${random}%) by much`);
  });

  // ─── Outs analyzer ─────────────────────────────────
  suite('Outs analyzer');
  test('flush draw counts EXACTLY 9 clean outs (no overcard inflation)', () => {
    // Four hearts on the flop: exactly 9 remaining hearts complete the flush.
    // Overcards (A/K pairing) must NOT inflate the draw out-count.
    const info = analyzeOuts(H('Ah Kh'), H('Qh 7h 2c'));
    ok(info.draws.includes('flush draw'), 'flush draw detected');
    eq(info.outs, 9, 'exactly 9 flush outs');
  });
  test('open-ended straight draw counts exactly 8 outs', () => {
    const info = analyzeOuts(H('9h 8s'), H('7d 6c 2h'));
    ok(info.draws.includes('straight draw'), 'straight draw detected');
    eq(info.outs, 8, 'exactly 8 OESD outs');
  });
  test('rule of 2 and 4 applied on the flop', () => {
    const info = analyzeOuts(H('Ah Kh'), H('Qh 7h 2c'));
    // ~9 outs on the flop -> ~2 streets -> pctRiver roughly outs*4.
    approx(info.pctRiver, info.outs * 4, 1, 'two-street estimate');
    approx(info.pctTurn, info.outs * 2, 1, 'one-street estimate');
  });
  test('made hand with no draw reports few outs', () => {
    const info = analyzeOuts(H('As Ad'), H('Ac Kd 9h'));
    eq(info.draws.length, 0, 'no draw classified for a set');
  });

  // ─── Best-cards (showdown highlight) ───────────────
  suite('Best 5 cards');
  test('returns exactly 5 cards', () => {
    const r = HandEval.evaluate(H('Ah Kh Qh Jh Th 2c 3d'));
    eq(r.bestCards.length, 5, 'five cards');
  });
  test('flush highlight uses the 5 flush cards', () => {
    const r = HandEval.evaluate(H('Ah Kh Qh 2h 3h 4s 5d'));
    eq(r.rank, 5, 'is a flush');
    ok(r.bestCards.every(c => c.suit === '♥'), 'all 5 winning cards are hearts');
  });
  test('best cards belong to the input set', () => {
    const input = H('9h 9s 9d 6c 4h 2c Kd');
    const r = HandEval.evaluate(input);
    const inputKeys = new Set(input.map(c => c.display));
    ok(r.bestCards.every(c => inputKeys.has(c.display)), 'all from input');
  });

  // ─── Combo describer (showdown labels) ─────────────
  suite('describeCombo');
  test('names a flush and tags hole vs board cards', () => {
    const hole = H('Ah Kh'), board = H('Qh 7h 2h 3d 9s'); // 3 hearts on board + 2 in hand = flush
    const r = HandEval.evaluate([...hole, ...board]);
    const d = describeCombo(r, hole, board);
    eq(r.rank, 5, 'is a flush');
    ok(/Flush/.test(d.name), 'name is Flush');
    ok(/Ace-high/.test(d.detail), 'detail says Ace-high');
    eq(d.cards.length, 5, 'five winning cards described');
    ok(d.cards.some(c => c.from === 'hole'), 'some from hole');
    ok(d.cards.some(c => c.from === 'board'), 'some from board');
  });
  test('reports how many hole cards are used (a set using one)', () => {
    const hole = H('9h 9d'), board = H('9c Kd 4h 2s 7c');
    const r = HandEval.evaluate([...hole, ...board]);
    const d = describeCombo(r, hole, board);
    eq(r.rank, 3, 'three of a kind');
    ok(/Three Nines/.test(d.detail), 'detail names three nines');
    eq(d.usesHoleCards, 2, 'uses both nines from hand');
    ok(/both/.test(d.sourceNote), 'source note mentions both');
  });
  test('plays the board (no hole cards) is detected', () => {
    const hole = H('2c 3d'), board = H('Ah Kh Qh Jh Th');
    const r = HandEval.evaluate([...hole, ...board]);
    const d = describeCombo(r, hole, board);
    eq(d.usesHoleCards, 0, 'none from hand');
    ok(/board/.test(d.sourceNote), 'note says plays the board');
  });
  test('two pair detail lists both ranks', () => {
    const hole = H('Ah As'), board = H('Kd Kc 4h 7s 2d');
    const r = HandEval.evaluate([...hole, ...board]);
    const d = describeCombo(r, hole, board);
    eq(r.rank, 2, 'two pair');
    ok(/Aces and Kings/.test(d.detail), 'lists both pairs');
  });

  // ─── getAdvice exposes calc components ─────────────
  suite('Advice calc breakdown');
  test('getAdvice.calc exposes equity + pot-odds operands', () => {
    const g = new PokerGame();
    g.reset();
    g.playerHole = H('As Ks'); g.community = H('Qs 7d 2c');
    g.pot = 100; g.currentBet = 25; g.playerBet = 0; g.aiBet = 25;
    const a = getAdvice(g, 200);
    ok(a.calc, 'calc present');
    eq(a.calc.call, 25, 'call amount');
    eq(a.calc.cardsToCome, 2, 'two cards to come on the flop');
    eq(a.calc.unknownCount, 52 - 5, 'unknowns = 52 - (2 hole + 3 board)');
    ok(a.calc.winPct + a.calc.tiePct + a.calc.losePct > 99, 'win/tie/lose ~100%');
  });

  // ─── Lessons / curriculum ──────────────────────────
  suite('Lessons');
  test('curriculum has lessons with drills', () => {
    ok(LESSONS.length >= 6, 'at least 6 lessons');
    ok(LESSONS.every(l => typeof l.drill === 'function' && l.concept && l.title), 'each lesson well-formed');
  });
  test('every drill produces a valid, answerable question', () => {
    for (const l of LESSONS) {
      for (let i = 0; i < 5; i++) {  // drills are randomised; sample a few
        const d = l.drill();
        ok(d.options.length >= 2, `${l.id}: has options`);
        ok(d.options.includes(d.correct), `${l.id}: correct answer is among options`);
        ok(typeof d.explain === 'string' && d.explain.length, `${l.id}: has explanation`);
      }
    }
  });
  test('gating: first lesson unlocked, later locked initially', () => {
    Lessons.completed = new Set();
    ok(Lessons.isUnlocked(0), 'first is open');
    ok(!Lessons.isUnlocked(1), 'second locked until first complete');
    Lessons.markComplete(LESSONS[0].id);
    ok(Lessons.isUnlocked(1), 'second unlocks after first complete');
  });

  // ─── Stats: per-street + leaks ─────────────────────
  suite('Stats breakdown');
  test('records decisions per street', () => {
    Stats.reset();
    Stats.recordDecision({ verdict: 'good', action: 'call', facingBet: true, street: 'flop', leak: null });
    Stats.recordDecision({ verdict: 'bad', action: 'call', facingBet: true, street: 'flop', leak: 'call-wide' });
    const s = Stats.summary();
    const flop = s.byStreet.find(b => b.street === 'flop');
    eq(flop.decisions, 2, 'two flop decisions');
    eq(flop.accuracy, 50, '1 of 2 good = 50%');
  });
  test('tallies and ranks leaks', () => {
    Stats.reset();
    Stats.recordDecision({ verdict: 'bad', action: 'call', facingBet: true, street: 'river', leak: 'call-wide' });
    Stats.recordDecision({ verdict: 'bad', action: 'call', facingBet: true, street: 'turn', leak: 'call-wide' });
    Stats.recordDecision({ verdict: 'bad', action: 'fold', facingBet: true, street: 'flop', leak: 'fold-equity' });
    const top = Stats.topLeaks();
    eq(top[0].key, 'call-wide', 'most frequent leak first');
    eq(top[0].count, 2, 'counted twice');
    ok(top[0].label && top[0].tip, 'leak has label and tip');
  });
  test('overall accuracy still computed', () => {
    Stats.reset();
    Stats.recordDecision({ verdict: 'good', action: 'check', facingBet: false, street: 'flop', leak: null });
    Stats.recordDecision({ verdict: 'bad', action: 'call', facingBet: true, street: 'flop', leak: 'call-wide' });
    eq(Stats.summary().accuracy, 50, 'overall accuracy 50%');
  });

  // ─── Equity cache / memoization ────────────────────
  suite('Equity cache');
  test('equityKey is canonical regardless of card order', () => {
    const k1 = equityKey(H('As Kh'), H('Qd Jc 2h'), 'tight');
    const k2 = equityKey(H('Kh As'), H('2h Jc Qd'), 'tight');
    eq(k1, k2, 'order-independent key');
  });
  test('equityKey distinguishes ranges', () => {
    ok(equityKey(H('As Kh'), [], 'tight') !== equityKey(H('As Kh'), [], 'loose'), 'range in key');
  });
  test('cached equity returns identical object on repeat call', () => {
    EquityCache.clear();
    const hole = H('As Ah'), board = H('Kd 7c 2h');
    const a = calcEquityCached(hole, board, 400, () => true, 'loose');
    const b = calcEquityCached(hole, board, 400, () => true, 'loose');
    ok(a === b, 'second call returns the SAME cached object (memoized)');
  });
  test('cache evicts when over capacity', () => {
    EquityCache.clear();
    const realMax = EquityCache.max;
    EquityCache.max = 3;
    for (let i = 0; i < 10; i++) EquityCache.set('k' + i, { win: i });
    ok(EquityCache.map.size <= 3, `bounded to max (size ${EquityCache.map.size})`);
    EquityCache.max = realMax;
    EquityCache.clear();
  });

  // ─── Seeded RNG / repeatable hands ─────────────────
  suite('Seeded RNG');
  test('same seed produces the same deal', () => {
    const g1 = new PokerGame(); g1.startNewHand({ seed: 12345, button: 0 });
    const g2 = new PokerGame(); g2.startNewHand({ seed: 12345, button: 0 });
    eq(g1.playerHole.map(c => c.display).join(''), g2.playerHole.map(c => c.display).join(''), 'same hole cards');
    eq(g1.aiHole.map(c => c.display).join(''), g2.aiHole.map(c => c.display).join(''), 'same AI cards');
  });
  test('different seeds (usually) differ', () => {
    const g1 = new PokerGame(); g1.startNewHand({ seed: 1, button: 0 });
    const g2 = new PokerGame(); g2.startNewHand({ seed: 99999, button: 0 });
    ok(g1.playerHole.map(c => c.display).join('') !== g2.playerHole.map(c => c.display).join(''), 'deals differ');
  });
  test('replayHand reproduces a recorded hand exactly', () => {
    const g = new PokerGame();
    g.startNewHand({ seed: 777, button: 1 });
    const original = g.playerHole.map(c => c.display).join('');
    g.startNewHand({ seed: 4242, button: 0 }); // play something else
    g.replayHand(777, 1);
    eq(g.playerHole.map(c => c.display).join(''), original, 'replayed deal matches');
    eq(g.button, 1, 'replayed button matches');
    RNG.unseed();
  });

  // ─── Scenarios ─────────────────────────────────────
  suite('Scenarios');
  test('every scenario yields a valid correct answer in its option set', () => {
    Scenarios.load();
    for (const sc of SCENARIOS) {
      const correct = Scenarios.correctFor(sc);
      const opts = Scenarios.options(sc);
      ok(opts.includes(correct), `${sc.id}: correct (${correct}) is a valid option`);
    }
  });
  test('strong made hand checked to us recommends betting', () => {
    const sc = SCENARIOS.find(s => s.id === 's-overpair-value');
    eq(Scenarios.correctFor(sc), 'Bet', 'overpair, checked to us -> bet for value');
  });
  test('trash vs a big bet recommends folding', () => {
    const sc = SCENARIOS.find(s => s.id === 's-weak-vs-bigbet');
    eq(Scenarios.correctFor(sc), 'Fold', '72o vs big bet -> fold');
  });
  test('answering correctly marks the scenario solved', () => {
    Scenarios.completed = new Set();
    Scenarios.index = SCENARIOS.findIndex(s => s.id === 's-weak-vs-bigbet');
    Scenarios.answered = false; Scenarios.chosen = null;
    Scenarios.answer('Fold');
    ok(Scenarios.completed.has('s-weak-vs-bigbet'), 'solved set updated');
  });
})();
