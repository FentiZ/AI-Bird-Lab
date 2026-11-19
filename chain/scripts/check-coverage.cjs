// Fail CI if the real BirdSubscription.sol falls below 90% Solidity coverage.
const fs = require('node:fs');
const path = require('node:path');

const ratio = (hit, total) => total === 0 ? 100 : (100 * hit / total);
const score = values => ratio(values.filter(v => Number(v) > 0).length, values.length);

function collect(report) {
  const selected = Object.entries(report).filter(([name]) => path.basename(name) === 'BirdSubscription.sol');
  if (!selected.length) throw new Error('BirdSubscription.sol is missing from coverage.json');
  const counts = { statements: [], branches: [], functions: [], lines: [] };
  for (const [, data] of selected) {
    for (const num of Object.values(data.s || {})) counts.statements.push(num);
    for (const num of Object.values(data.f || {})) counts.functions.push(num);
    for (const branch of Object.values(data.b || {})) counts.branches.push(...branch);
    if (data.l) {
      for (const num of Object.values(data.l)) counts.lines.push(num);
    } else {
      const perLine = new Map();
      for (const [id, location] of Object.entries(data.statementMap || {})) {
        const line = location.start.line;
        perLine.set(line, Math.max(perLine.get(line) || 0, Number((data.s || {})[id] || 0)));
      }
      counts.lines.push(...perLine.values());
    }
  }
  return Object.fromEntries(Object.entries(counts).map(([metric, values]) => [metric, score(values)]));
}

function check(report, threshold = 90) {
  const result = collect(report);
  for (const [name, value] of Object.entries(result)) console.log(`Solidity ${name}: ${value.toFixed(2)}%`);
  const failed = Object.entries(result).filter(([, percentage]) => percentage < threshold);
  if (failed.length) throw new Error(`Solidity coverage below ${threshold}%: ${failed.map(([name]) => name).join(', ')}`);
  return result;
}

if (require.main === module) {
  const filename = path.join(__dirname, '..', 'coverage.json');
  if (!fs.existsSync(filename)) {
    throw new Error('No chain/coverage.json — run: npx hardhat coverage --testfiles test/BirdSubscription.test.js');
  }
  check(JSON.parse(fs.readFileSync(filename, 'utf8')));
}
module.exports = { collect, check, ratio };
