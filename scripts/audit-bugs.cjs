// Scans worker.js for common bug classes we've hit before.
// Run: node scripts/audit-bugs.cjs
//
// This is a one-off audit tool, not part of CI. Finds:
//   - async functions called without await
//   - UPDATE placeholders vs bind() arg count
//   - mutator handlers missing the `request` arg (breaks activity attribution)

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'worker', 'worker.js'), 'utf8');

function lineOf(i) { return src.slice(0, i).split('\n').length; }

console.log('=== Async-without-await check ===');
const asyncFns = [];
for (const m of src.matchAll(/async function (\w+)/g)) asyncFns.push(m[1]);

let asyncIssues = 0;
for (const fn of asyncFns) {
  const re = new RegExp(String.raw`(?<![.\w])` + fn + String.raw`\s*\(`, 'g');
  let match;
  while ((match = re.exec(src)) !== null) {
    const lookback = src.slice(Math.max(0, match.index - 60), match.index);
    const hasAwait  = /\bawait\s*$/.test(lookback);
    const hasReturn = /\breturn\s*$/.test(lookback);
    // Short-circuit pattern: `return deny(req, perm) || handler(req)` —
    // the async call's promise becomes the expression value and is returned.
    // Treat `||` / `&&` immediately preceding the call as equivalent to return.
    const isShortCircuit = /(\|\||&&)\s*$/.test(lookback);
    const isDef     = /\basync\s+function\s+$/.test(lookback);
    const isArrow   = /=>\s*$/.test(lookback);
    const inBatch   = /\.batch\s*\(\s*\[/.test(lookback); // Promise.all/batch contexts
    const inPromise = /Promise\.(all|allSettled|race)\s*\(\s*\[/.test(lookback);
    if (hasAwait || hasReturn || isShortCircuit || isDef || isArrow || inBatch || inPromise) continue;

    const snippet = src.slice(match.index - 15, match.index + fn.length + 40).replace(/\s+/g, ' ').trim();
    console.log(`  line ${lineOf(match.index)}  ${fn}  → ${snippet}`);
    asyncIssues++;
  }
}
if (!asyncIssues) console.log('  (none)');

console.log('\n=== UPDATE placeholder vs bind count ===');
// Find `UPDATE ... SET ... WHERE ...` blocks followed by .bind(...).run()
const updateBlocks = [];
const re = /env\.DB\.prepare\s*\(\s*`([^`]*?UPDATE[^`]+?)`\s*\)\s*\.bind\s*\(/gis;
let m;
while ((m = re.exec(src)) !== null) {
  const sqlBlock = m[1];
  if (!/\bUPDATE\s+\w+\s+SET\b/i.test(sqlBlock)) continue;

  // Find end of bind() — count parens from the .bind( position
  let i = m.index + m[0].length, depth = 1;
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (depth === 0) break;
    i++;
  }
  const bindArgs = src.slice(m.index + m[0].length, i);

  // Count top-level commas in bind args
  let d = 0, commas = 0;
  for (const c of bindArgs) {
    if (c === '(' || c === '[' || c === '{') d++;
    else if (c === ')' || c === ']' || c === '}') d--;
    else if (c === ',' && d === 0) commas++;
  }
  const bindCount = bindArgs.trim() ? commas + 1 : 0;
  const placeholders = (sqlBlock.match(/\?/g) || []).length;
  const tableMatch = sqlBlock.match(/UPDATE\s+(\w+)/i);
  const table = tableMatch ? tableMatch[1] : '?';

  const status = bindCount === placeholders ? 'OK' : 'MISMATCH';
  if (status === 'MISMATCH') {
    console.log(`  ${status}  line ${lineOf(m.index)}  UPDATE ${table}  placeholders=${placeholders}  binds=${bindCount}`);
  }
}

console.log('\n=== Mutator handlers missing `request` / `user` propagation ===');
const mutators = ['createAsset','updateAsset','deleteAsset','purgeAsset','checkoutAsset','checkinAsset','addMaintenance','createPerson','updatePerson','deletePerson','createLocation','updateLocation','deleteLocation','createCategory','updateCategory','deleteCategory'];
for (const h of mutators) {
  const def = src.match(new RegExp(String.raw`async function ` + h + String.raw`\s*\(([^)]+)\)`));
  if (!def) continue;
  const params = def[1];
  if (!params.includes('request')) {
    console.log(`  ${h}(${params}) — no request arg, cannot attribute activity to user`);
  }
}

console.log('\n=== .bind() with hand-counted vs promised count (INSERT) ===');
// We already audited INSERTs once; repeat to be safe
const insertRe = /INSERT INTO (\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/gs;
let im;
while ((im = insertRe.exec(src)) !== null) {
  const table = im[1];
  const ncols = im[2].split(',').filter(s => s.trim()).length;
  const nvals = im[3].split(',').filter(s => s.trim()).length;
  if (ncols !== nvals) {
    console.log(`  MISMATCH  line ${lineOf(im.index)}  ${table}  cols=${ncols}  values=${nvals}`);
  }
}
console.log('  (INSERTs: audit complete, report above if any)');
