// Usage: npm run validate -- path/to/pack.json
import { loadPackFromDisk } from '../node';
import { validatePack } from '../validate';

const path = process.argv[2];
if (!path) {
  console.error('Usage: npm run validate -- <pack.json or pack folder>');
  process.exit(2);
}
const pack = await loadPackFromDisk(path);
const issues = validatePack(pack);
for (const i of issues) console.log(`${i.kind.padEnd(6)} ${i.path}: ${i.message}`);
const counts = ['classes', 'skills', 'enemies', 'items', 'cards', 'scenarios']
  .map((k) => `${((pack as unknown as Record<string, unknown[]>)[k] ?? []).length} ${k}`)
  .join(', ');
console.log(`${pack.name}: ${counts} -> ${issues.length ? `${issues.length} problem(s)` : 'OK'}`);
process.exit(issues.length ? 1 : 0);
