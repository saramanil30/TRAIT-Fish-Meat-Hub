import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/delivery-slots.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const slots = await import('data:text/javascript;base64,' + Buffer.from(output).toString('base64'));
const whatsappSource = readFileSync(new URL('../src/lib/whatsapp.ts', import.meta.url), 'utf8').replace('from "./format"', 'from "' + 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(readFileSync(new URL('../src/lib/format.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText).toString('base64') + '"');
const whatsapp = await import('data:text/javascript;base64,' + Buffer.from(ts.transpileModule(whatsappSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText).toString('base64'));

test('slot times read as India clock times', () => {
  assert.equal(slots.slotTime('07:00'), '7 am');
  assert.equal(slots.slotTime('16:30'), '4:30 pm');
  assert.equal(slots.slotTime('12:00'), '12 pm');
  assert.equal(slots.slotTime('00:15'), '12:15 am');
  assert.equal(slots.slotRange('07:00', '11:00'), '7–11 am');
  assert.equal(slots.slotRange('16:00', '20:00'), '4–8 pm');
  assert.equal(slots.slotRange('11:00', '14:00'), '11 am–2 pm');
});

test('slot days are relative to India today', () => {
  assert.equal(slots.istToday(Date.parse('2026-10-10T19:00:00Z')), '2026-10-11');
  assert.equal(slots.slotDayName('2026-10-10', '2026-10-10'), 'Today');
  assert.equal(slots.slotDayName('2026-10-11', '2026-10-10'), 'Tomorrow');
  assert.equal(slots.slotDayName('2026-10-12', '2026-10-10'), 'Mon');
  assert.match(slots.slotLabel({ date: '2026-10-12', name: 'Morning', startsAt: '07:00', endsAt: '11:00' }), /^Mon, 12 Oct · Morning, 7–11 am$/);
});

test('WhatsApp messages carry the slot', () => {
  const slot = 'Mon, 12 Oct · Morning, 7–11 am';
  assert.match(whatsapp.orderToShopMessage({ number: 'TFM-000001', items: [], totalPaise: 50000, pickup: false, slot }), /\nDelivery slot: Mon, 12 Oct · Morning, 7–11 am$/);
  assert.match(whatsapp.orderToShopMessage({ number: 'TFM-000001', items: [], pickup: true, slot }), /\nPickup slot: /);
  assert.match(whatsapp.customerStatusMessage({ number: 'TFM-000001', totalPaise: 50000, status: 'CONFIRMED', pickup: false, site: 'https://x', slot }), /is confirmed for Mon, 12 Oct · Morning, 7–11 am\./);
  assert.doesNotMatch(whatsapp.orderToShopMessage({ number: 'TFM-000001', items: [], pickup: true }), /slot/);
});
