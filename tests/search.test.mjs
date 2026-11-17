import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = ts.transpileModule(readFileSync(new URL('../src/lib/search.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { productSearch, aliases, normalize } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

const p = (name, localName, category, cut = '', available = true) => ({ name, localName, category, cut, available });
const catalogue = [
  p('White Pomfret', 'White Pomfret / Tella  Chanduva', 'sea fish', 'Rich in high-quality protein.'),
  p('Black Pomfret', 'Black Pomfret/Nalla Chanduva', 'sea fish', 'Tender white flesh.'),
  p('King Fish / Vanjaram', 'King Fish/seer Fish/vanjaram/konem/surmai', 'sea fish', 'Also known as Seer Fish.'),
  p('Chicken Leg Boneless', '', 'chicken', 'Need it cut differently?'),
  p('Chicken Wings', '', 'chicken', ''),
  p('Mutton Keema', 'Hand made Desi Goat Meat', 'mutton', 'Freshly minced.'),
  p('Free Range Brown Eggs', '', 'eggs', ''),
  p('Blue Crab', 'Blue Crabs/jeela Peetalu', 'crabs & lobsters', '', false),
];
const search = productSearch(catalogue);
const names = q => search(q).map(x => x.name);

test('normalizes case, accents and punctuation', () => { assert.equal(normalize('  Tiger Prawns (Big)!  '), 'tiger prawns big'); assert.equal(normalize('Crème'), 'creme'); });
test('splits local and alias names on "/"', () => assert.deepEqual(aliases(catalogue[2]), ['King Fish', 'Vanjaram', 'seer Fish', 'vanjaram', 'konem', 'surmai']));
test('name', () => assert.deepEqual(names('pomfret').sort(), ['Black Pomfret', 'White Pomfret']));
test('local name', () => { assert.deepEqual(names('vanjaram'), ['King Fish / Vanjaram']); assert.deepEqual(names('chanduva').length, 2); assert.deepEqual(names('surmai'), ['King Fish / Vanjaram']); });
test('partial word', () => { assert.deepEqual(names('chick').sort(), ['Chicken Leg Boneless', 'Chicken Wings']); assert.ok(names('pom').includes('White Pomfret')); });
test('typos', () => { assert.equal(names('pomfert').length, 2); assert.deepEqual(names('vanjeram'), ['King Fish / Vanjaram']); assert.equal(names('chiken').length, 2); });
test('run-together and plural', () => { assert.deepEqual(names('kingfish'), ['King Fish / Vanjaram']); assert.deepEqual(names('egg'), ['Free Range Brown Eggs']); });
test('category and description', () => { assert.deepEqual(names('lobster'), ['Blue Crab']); assert.deepEqual(names('goat'), ['Mutton Keema']); assert.deepEqual(names('protein'), ['White Pomfret']); });
test('every word must match; filler words are ignored', () => { assert.deepEqual(names('white pomfret')[0], 'White Pomfret'); assert.equal(names('fresh pomfret').length, 2); assert.deepEqual(names('chicken wings'), ['Chicken Wings']); });
test('no match and empty query', () => { assert.deepEqual(names('xyzzy'), []); assert.deepEqual(names('   '), []); });
