import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function moduleUrl(relativePath) {
  const url = new URL(relativePath, import.meta.url);
  let output = ts.transpileModule(readFileSync(url, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  output = output.replace(/from "(\.\.?\/[^"\n]+)"/g, (_, dependency) => 'from "' + moduleUrl(new URL(dependency + '.ts', url).href) + '"');
  return 'data:text/javascript;base64,' + Buffer.from(output).toString('base64');
}
const { products } = await import(moduleUrl('../src/data/catalog.ts'));
const { createCartItem } = await import(moduleUrl('../src/lib/cart.ts'));
const { validateCheckout, normalizeMobile, orderTotals, createMockOrder, trackingSteps, statusLabel, EMPTY_CHECKOUT } = await import(moduleUrl('../src/lib/order.ts'));
const item = createCartItem(products.find(p => p.id === 'seer'), { preparationId: 'cleaned', rawWeightGrams: 1000, specialInstructions: 'Small pieces' }, 'fish');
const details = { ...EMPTY_CHECKOUT, name: ' Test Customer ', mobile: '+91 98765 43210', address: '12 Sample Road', locality: 'Sample Area', pincode: '600001', city: 'Test City', state: 'Test State' };
const identity = { number: 'TFM-000125', trackingToken: '2cac9340-67cd-423c-bc94-36b8dbad02c1', placedAt: '2026-09-22T00:00:00.000Z' };

test('home delivery requires customer and delivery details', () => {
  assert.deepEqual(Object.keys(validateCheckout(EMPTY_CHECKOUT)), ['name', 'mobile', 'address', 'locality', 'city', 'state', 'pincode']);
  assert.deepEqual(validateCheckout(details), {});
});
test('pickup requires mobile and accepts an optional name; hidden delivery details are excluded from the receipt', () => {
  const pickup = { ...EMPTY_CHECKOUT, name: 'Test Customer', mobile: '9876543210', deliveryMethod: 'pickup' };
  assert.deepEqual(validateCheckout(pickup), {});
  assert.deepEqual(validateCheckout({...pickup,name:""}), {});
  const order = createMockOrder([item], { ...details, deliveryMethod: 'pickup' }, identity);
  for (const field of ['address', 'locality', 'landmark', 'pincode']) assert.equal(order.customer[field], '');
  assert.equal(order.totals.deliveryChargePaise, 0);
});
test('Indian mobile validation accepts optional country code and rejects invalid input', () => {
  for (const mobile of ['9876543210', '+91 98765-43210', '919876543210']) {
    assert.equal(normalizeMobile(mobile), '9876543210');
    assert.equal(validateCheckout({ ...details, mobile }).mobile, undefined);
  }
  for (const mobile of ['1234567890', '987654321', '98765432101', '+1 9876543210', '98765abc10']) assert.ok(validateCheckout({ ...details, mobile }).mobile);
});
test('delivery pincode must be six digits and not begin with zero', () => {
  for (const pincode of ['000000', '60001', '6000011', 'ABCDEF', '']) assert.ok(validateCheckout({ ...details, pincode }).pincode);
});
test('invalid choices and overlong customer fields are rejected', () => {
  assert.ok(validateCheckout({ ...details, deliveryMethod: 'invalid' }).deliveryMethod);
  assert.ok(validateCheckout({ ...details, paymentMethod: 'card' }).paymentMethod);
  for (const [key, length] of [['name',81], ['address',301], ['locality',101], ['landmark',151]]) assert.ok(validateCheckout({ ...details, [key]: 'a'.repeat(length) })[key]);
});
test('raw weight subtotal and cleaning estimates are unchanged; mock fee is configurable', () => {
  assert.deepEqual(orderTotals([item], 'delivery'), { subtotalPaise: 98000, deliveryChargePaise: 4000, grandTotalPaise: 102000 });
  assert.equal(orderTotals([item], 'delivery', 2500).grandTotalPaise, 100500);
  assert.equal(item.estimatedCleanedWeightGrams, 750);
  assert.equal(orderTotals([item], 'pickup').grandTotalPaise, 98000);
  assert.equal(orderTotals([], 'delivery').grandTotalPaise, 0);
  assert.throws(() => orderTotals([item], 'delivery', -1));
});
test('empty cart and invalid details cannot create a mock order', () => {
  assert.throws(() => createMockOrder([], details, identity), /empty/);
  assert.throws(() => createMockOrder([item], EMPTY_CHECKOUT, identity), /details/);
});
test('local receipt snapshots cart selections and supports both payment preferences without processing', () => {
  for (const paymentMethod of ['cash', 'upi']) {
    const order = createMockOrder([item], { ...details, paymentMethod }, identity);
    assert.equal(order.mode, 'local-preview');
    assert.equal(order.status, 'PLACED');
    assert.equal(order.customer.name, 'Test Customer');
    assert.equal(order.customer.paymentMethod, paymentMethod);
    assert.equal(order.trackingToken, identity.trackingToken);
    assert.notEqual(order.items[0], item);
    assert.notEqual(order.items[0].preparation, item.preparation);
    assert.deepEqual(order.items[0], item);
  }
});
test('delivery and pickup timelines include appropriate fulfillment steps and cancellation', () => {
  assert.deepEqual(trackingSteps('delivery'), ['PLACED', 'CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED']);
  assert.deepEqual(trackingSteps('pickup'), ['PLACED', 'CONFIRMED', 'PREPARING', 'READY', 'DELIVERED']);
  assert.equal(statusLabel('DELIVERED', 'pickup'), 'Collected');
  assert.equal(statusLabel('CANCELLED', 'delivery'), 'Cancelled');
});
