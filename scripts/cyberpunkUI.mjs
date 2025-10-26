/**
 * Cyberpunk UI for Scrap Processing
 * Makes the terminal look SUPER dope with visualizations and scrolling info
 */

import chalk from 'chalk';

// Cyberpunk color palette
const cyber = {
  pink: chalk.hex('#FF006E'),
  cyan: chalk.hex('#00F5FF'),
  purple: chalk.hex('#8338EC'),
  yellow: chalk.hex('#FFBE0B'),
  green: chalk.hex('#3A86FF'),
  red: chalk.hex('#FB5607'),
  gray: chalk.hex('#555555'),
  white: chalk.hex('#FFFFFF'),

  // Gradient effects
  glow: (text) => chalk.hex('#00F5FF').bold(text),
  neon: (text) => chalk.hex('#FF006E').bold(text),
  matrix: (text) => chalk.hex('#00FF41')(text),
};

// Box drawing characters
const box = {
  tl: '╔',
  tr: '╗',
  bl: '╚',
  br: '╝',
  h: '═',
  v: '║',
  lt: '╠',
  rt: '╣',
  tt: '╦',
  bt: '╩',
  cross: '╬',
};

// ASCII art header
export function showHeader() {
  const header = `
${cyber.cyan('╔═══════════════════════════════════════════════════════════════════╗')}
${cyber.cyan('║')}  ${cyber.neon('███████╗ ██████╗██████╗  █████╗ ██████╗ ██████╗  ██████╗  ██████╗')}  ${cyber.cyan('║')}
${cyber.cyan('║')}  ${cyber.neon('██╔════╝██╔════╝██╔══██╗██╔══██╗██╔══██╗██╔══██╗██╔═══██╗██╔═══██╗')} ${cyber.cyan('║')}
${cyber.cyan('║')}  ${cyber.neon('███████╗██║     ██████╔╝███████║██████╔╝██████╔╝██║   ██║██║   ██║')} ${cyber.cyan('║')}
${cyber.cyan('║')}  ${cyber.neon('╚════██║██║     ██╔══██╗██╔══██║██╔═══╝ ██╔══██╗██║   ██║██║   ██║')} ${cyber.cyan('║')}
${cyber.cyan('║')}  ${cyber.neon('███████║╚██████╗██║  ██║██║  ██║██║     ██████╔╝╚██████╔╝╚██████╔╝')} ${cyber.cyan('║')}
${cyber.cyan('║')}  ${cyber.neon('╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═════╝  ╚═════╝  ╚═════╝')}  ${cyber.cyan('║')}
${cyber.cyan('╠═══════════════════════════════════════════════════════════════════╣')}
${cyber.cyan('║')}              ${cyber.purple('A I   P R O C E S S I N G   S Y S T E M')}                ${cyber.cyan('║')}
${cyber.cyan('╚═══════════════════════════════════════════════════════════════════╝')}
  `;
  console.log(header);
}

// Live stats display
export class LiveStats {
  constructor() {
    this.processed = 0;
    this.success = 0;
    this.failed = 0;
    this.totalTokens = 0;
    this.totalCost = 0;
    this.startTime = Date.now();
  }

  update(data) {
    Object.assign(this, data);
  }

  show() {
    const runtime = ((Date.now() - this.startTime) / 1000).toFixed(1);
    const rate = (this.processed / (runtime / 60)).toFixed(1);

    console.log(cyber.cyan('\n╔════════════════════ LIVE STATS ════════════════════╗'));
    console.log(cyber.cyan('║') + `  ${cyber.matrix('PROCESSED:')} ${cyber.white(this.processed.toString().padEnd(8))} │ ${cyber.matrix('SUCCESS:')} ${cyber.green(this.success.toString().padEnd(8))} │ ${cyber.matrix('FAILED:')} ${cyber.red(this.failed.toString().padEnd(5))}  ` + cyber.cyan('║'));
    console.log(cyber.cyan('║') + `  ${cyber.matrix('TOKENS:')}    ${cyber.yellow(this.totalTokens.toLocaleString().padEnd(8))} │ ${cyber.matrix('COST:')}    ${cyber.yellow('$' + this.totalCost.toFixed(3).padEnd(7))} │ ${cyber.matrix('RATE:')} ${cyber.purple(rate + '/min'.padEnd(5))}  ` + cyber.cyan('║'));
    console.log(cyber.cyan('║') + `  ${cyber.matrix('RUNTIME:')}   ${cyber.white(runtime + 's'.padEnd(45))}  ` + cyber.cyan('║'));
    console.log(cyber.cyan('╚════════════════════════════════════════════════════╝'));
  }
}

// Processing step visualizer
export class StepVisualizer {
  constructor(scrapTitle) {
    this.scrapTitle = scrapTitle;
    this.currentStep = 0;
    this.steps = [
      { name: 'FETCH', icon: '📡', color: cyber.cyan },
      { name: 'PARSE', icon: '🔍', color: cyber.purple },
      { name: 'SUMMARIZE', icon: '📝', color: cyber.yellow },
      { name: 'EXTRACT TAGS', icon: '🏷️', color: cyber.pink },
      { name: 'FIND RELATIONS', icon: '🔗', color: cyber.green },
      { name: 'EMBED', icon: '🧠', color: cyber.purple },
      { name: 'REASON', icon: '💭', color: cyber.cyan },
      { name: 'SAVE', icon: '💾', color: cyber.green },
    ];
  }

  showTitle() {
    const titleTruncated = this.scrapTitle.length > 50
      ? this.scrapTitle.substring(0, 47) + '...'
      : this.scrapTitle;

    console.log('\n' + cyber.neon('▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓'));
    console.log(cyber.white('► ') + cyber.glow(titleTruncated));
    console.log(cyber.neon('▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓\n'));
  }

  startStep(stepIndex) {
    this.currentStep = stepIndex;
    const step = this.steps[stepIndex];

    // Show progress bar
    const completed = '█'.repeat(stepIndex);
    const remaining = '░'.repeat(this.steps.length - stepIndex - 1);
    const current = '▶';

    console.log(
      cyber.gray('  [') +
      cyber.green(completed) +
      cyber.yellow(current) +
      cyber.gray(remaining) +
      cyber.gray(']') +
      '  ' +
      step.icon +
      '  ' +
      step.color(step.name)
    );
  }

  completeStep(stepIndex, result = '') {
    const step = this.steps[stepIndex];
    if (result) {
      console.log(cyber.gray('      └─ ') + cyber.white(result));
    }
  }
}

// Scrolling summary display
export function showSummary(summary, maxLines = 3) {
  const lines = summary.split('\n').filter(l => l.trim());
  const displayLines = lines.slice(0, maxLines);

  console.log(cyber.cyan('\n  ╭─ SUMMARY ') + cyber.gray('─'.repeat(50)));
  displayLines.forEach(line => {
    const truncated = line.length > 60 ? line.substring(0, 57) + '...' : line;
    console.log(cyber.gray('  │ ') + cyber.white(truncated));
  });
  if (lines.length > maxLines) {
    console.log(cyber.gray('  │ ') + cyber.gray(`... +${lines.length - maxLines} more lines`));
  }
  console.log(cyber.cyan('  ╰' + '─'.repeat(63)));
}

// Tag cloud visualizer
export function showTags(tags, conceptTags) {
  if (!tags?.length && !conceptTags?.length) return;

  console.log(cyber.cyan('\n  ╭─ TAGS ') + cyber.gray('─'.repeat(54)));

  if (tags?.length) {
    const tagString = tags.map(t => cyber.yellow('▪ ' + t)).join('  ');
    console.log(cyber.gray('  │ ') + tagString);
  }

  if (conceptTags?.length) {
    const conceptString = conceptTags.map(t => cyber.purple('◆ ' + t)).join('  ');
    console.log(cyber.gray('  │ ') + conceptString);
  }

  console.log(cyber.cyan('  ╰' + '─'.repeat(63)));
}

// Confidence meter
export function showConfidence(confidence) {
  if (!confidence) return;

  const bars = (score) => {
    const filled = Math.round(score * 10);
    const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
    const color = score > 0.8 ? cyber.green : score > 0.5 ? cyber.yellow : cyber.red;
    return color(bar) + cyber.gray(` ${(score * 100).toFixed(0)}%`);
  };

  console.log(cyber.cyan('\n  ╭─ CONFIDENCE ') + cyber.gray('─'.repeat(48)));
  console.log(cyber.gray('  │ ') + cyber.white('Summary:       ') + bars(confidence.summary));
  console.log(cyber.gray('  │ ') + cyber.white('Tags:          ') + bars(confidence.tags));
  console.log(cyber.gray('  │ ') + cyber.white('Relationships: ') + bars(confidence.relationships));
  console.log(cyber.cyan('  ╰' + '─'.repeat(63)));
}

// Error display
export function showError(error, context = '') {
  console.log(cyber.red('\n  ╭─ ERROR ') + cyber.gray('─'.repeat(53)));
  if (context) {
    console.log(cyber.gray('  │ ') + cyber.white(context));
  }
  console.log(cyber.gray('  │ ') + cyber.red('✖ ' + error.message));
  console.log(cyber.red('  ╰' + '─'.repeat(63)));
}

// Success banner
export function showSuccess() {
  console.log('\n' + cyber.green('  ✓✓✓ PROCESSING COMPLETE ✓✓✓'));
}

// Separator
export function separator() {
  console.log(cyber.gray('\n  ' + '─'.repeat(63)));
}
