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
  ],
};
