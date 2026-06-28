/* =====================================================
   Builder / Evaluator loop — configuration
   This toolkit is fully separate from the learning app
   and never runs as part of it. It iteratively proposes
   UX/UI improvements, gates them behind tests + a render
   check, and keeps only the ones an LLM judges better.
   ===================================================== */
const path = require('path');

const ROOT = path.join(__dirname, '..');          // the poker-trainer app root

module.exports = {
  ROOT,
  // Files the builder is allowed to edit. Anything else is off-limits.
  EDITABLE: ['app.js', 'index.html', 'style.css'],

  // How many build/evaluate iterations to run.
  ITERATIONS: parseInt(process.env.LOOP_ITERATIONS || '10', 10),

  // LLM (Anthropic). Key comes from the environment, never hard-coded.
  llm: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1',
    model: process.env.LOOP_MODEL || 'claude-sonnet-4-5',
    maxTokens: 4000,
  },

  // Static server used to render the app for screenshots.
  server: { port: parseInt(process.env.LOOP_PORT || '8011', 10) },

  // Headless Chrome.
  chrome: process.env.CHROME_PATH ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',

  // The command that must stay green for a change to be kept.
  testCommand: 'npm test',

  // Output locations (under loop/, gitignored except the report).
  workDir: path.join(__dirname, '.work'),         // throwaway copy of the app
  outDir: path.join(__dirname, 'runs'),           // screenshots + logs per run
  branchPrefix: 'loop/ux-run',                    // git branch for kept changes

  // Key UI states to capture as screenshots (driven via injected JS in the page).
  // Each is rendered against the working copy so the evaluator can compare.
  states: [
    {
      id: 'idle',
      label: 'Start screen (idle table)',
      setup: '',           // default render
      width: 1300, height: 900,
    },
    {
      id: 'flop-decision',
      label: 'Facing a bet on the flop with a flush draw + advisor',
      setup: `
        game.reset();
        game.playerHole = [Card.fromString('Ah'), Card.fromString('Kh')];
        game.aiHole = [Card.fromString('2c'), Card.fromString('3d')];
        game.community = [Card.fromString('Qh'), Card.fromString('7h'), Card.fromString('2s')];
        game.street='flop'; game.pot=100; game.currentBet=25; game.playerBet=0; game.aiBet=25;
        game.waitingForAction=true; game.toAct='player';
        adviceVisible=true; if (typeof oddsExplainerOpen!=='undefined') oddsExplainerOpen=true;
        render();
      `,
      width: 1300, height: 1280,
    },
    {
      id: 'showdown',
      label: 'Showdown with labeled winning hand',
      setup: `
        game.reset();
        game.playerHole=[Card.fromString('Ah'),Card.fromString('Kh')];
        game.aiHole=[Card.fromString('2c'),Card.fromString('3d')];
        game.community=[Card.fromString('Qh'),Card.fromString('Jh'),Card.fromString('Th'),Card.fromString('4s'),Card.fromString('9d')];
        const pr=HandEval.evaluate([...game.playerHole,...game.community]);
        const ar=HandEval.evaluate([...game.aiHole,...game.community]);
        game.lastShowdown={winner:'player',reason:pr.rankName+' beats '+ar.rankName,playerResult:pr,aiResult:ar,playerHole:[...game.playerHole],aiHole:[...game.aiHole],board:[...game.community],pot:200};
        game.pot=200; game.street='showdown';
        render();
      `,
      width: 1300, height: 1100,
    },
    {
      id: 'learn',
      label: 'Learn — a lesson with its concept and a drill',
      setup: `
        try { Lessons.completed = new Set(LESSONS.map(l=>l.id)); } catch(e){}
        Lessons.show();
        // Jump to a concept-rich lesson and start its drill.
        const idx = LESSONS.findIndex(l=>l.id==='odds-change');
        Lessons.goto(idx >= 0 ? idx : 0);
        Lessons.startDrill();
      `,
      width: 1300, height: 1000,
    },
    {
      id: 'coach',
      label: 'AI Coach chat panel mid-conversation',
      setup: `
        Coach.open = true;
        Coach.history = [
          { role:'user', content:'Why is calling correct here?' },
          { role:'assistant', content:'You have a flush draw with 9 outs — about 36% to hit by the river, and you can also win when an ace or king pairs. The pot lays you 4-to-1 (you only need 20%), so calling is clearly profitable. Compare your win % to the pot-odds % and call whenever it is higher.' },
          { role:'user', content:'How many outs is a straight draw?' },
          { role:'assistant', content:'An open-ended straight draw has 8 outs (two ranks, four of each). A gutshot has 4. Multiply by 4 on the flop to estimate your chance by the river.' }
        ];
        render(); renderCoach();
      `,
      width: 1300, height: 900,
    },
    {
      id: 'controls-stats',
      label: 'Betting controls + analysis/leaks + stats during a hand',
      setup: `
        game.reset();
        Stats.data.hands = 24; Stats.data.won = 13; Stats.data.decisions = 40; Stats.data.goodDecisions = 31;
        try { Stats.data.byStreet.flop = {decisions:12, good:7}; Stats.data.byStreet.turn = {decisions:9, good:5}; Stats.data.byStreet.river = {decisions:8, good:4}; Stats.data.byStreet.preflop = {decisions:11, good:9}; } catch(e){}
        try { Stats.data.leaks['call-wide']=5; Stats.data.leaks['fold-equity']=3; Stats.data.leaks['miss-value']=2; } catch(e){}
        game.playerHole=[Card.fromString('Js'),Card.fromString('Jd')];
        game.aiHole=[Card.fromString('5c'),Card.fromString('6d')];
        game.community=[Card.fromString('Jh'),Card.fromString('9d'),Card.fromString('4h')];
        game.street='flop'; game.pot=140; game.currentBet=40; game.playerBet=0; game.aiBet=40;
        game.waitingForAction=true; game.toAct='player'; adviceVisible=true;
        render();
        // Open the analysis panel so leaks/per-street stats are visible.
        document.querySelector('.analysis-wrap')?.setAttribute('open','');
      `,
      width: 1300, height: 1150,
    },
  ],
};
