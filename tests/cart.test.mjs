import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
// Use the installed TypeScript compiler for these pure, type-import-only modules.
// This keeps test module semantics explicit without changing the application's package type.
async function loadTypeScript(relativePath) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const result = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputText).toString('base64'));
}
const { products } = await loadTypeScript('../src/data/catalog.ts');
const { calculateLineTotalPaise, estimateCleanedWeightGrams, createCartItem, cartReducer, cartSubtotalPaise, restoreCart, serializeCart } = await loadTypeScript('../src/lib/cart.ts');
const seer = products.find(p => p.id === 'seer');
const chicken = products.find(p => p.id === 'chicken');
const selection = (rawWeightGrams = 1000, preparationId = 'cleaned', specialInstructions = '') => ({ rawWeightGrams, preparationId, specialInstructions });
for (const [weight, price, estimate] of [[500, 49000, 375], [1000, 98000, 750], [1500, 147000, 1125], [2000, 196000, 1500]]) {
  test(weight + ' g uses raw weight for price and configured cleaning loss for yield', () => {
    const item = createCartItem(seer, selection(weight), 'one');
    assert.equal(item.lineTotalPaise, price);
    assert.equal(item.estimatedCleanedWeightGrams, estimate);
    assert.equal(calculateLineTotalPaise(980, weight), price);
  });
}
test('cleaning loss is configurable and whole has no cleaned estimate', () => {
  assert.equal(createCartItem({ ...seer, cleaningLossPercent: 17 }, selection(), 'x').estimatedCleanedWeightGrams, 830);
  assert.equal(createCartItem(seer, selection(1000, 'whole'), 'x').estimatedCleanedWeightGrams, undefined);
  assert.equal(createCartItem(chicken, selection(1000, 'skinless'), 'x').estimatedCleanedWeightGrams, undefined);
  assert.equal(estimateCleanedWeightGrams(1000, undefined), undefined);
  assert.equal(estimateCleanedWeightGrams(1000, 0), 1000);
});
test('preparation never changes the raw-weight price', () => {
  for (const preparation of seer.preparationOptions) assert.equal(createCartItem(seer, selection(1000, preparation.id), 'x').lineTotalPaise, 98000);
});
test('all available products support all four mock weights', () => {
  for (const product of products.filter(p => p.available)) for (const weight of [500, 1000, 1500, 2000]) {
    const item = createCartItem(product, selection(weight, product.preparationOptions[0].id), 'x');
    assert.equal(item.lineTotalPaise, Math.round(product.pricePerKg * 100 * weight / 1000));
  }
});
test('reject invalid weights, preparations, unavailable products and long instructions', () => {
  for (const weight of [0, -1, 750, NaN, Infinity]) assert.throws(() => createCartItem(seer, selection(weight), 'x'));
  assert.throws(() => createCartItem(seer, selection(1000, 'boneless'), 'x'));
  assert.throws(() => createCartItem({ ...seer, available: false }, selection(), 'x'));
  assert.throws(() => createCartItem(seer, selection(1000, 'cleaned', 'x'.repeat(301)), 'x'));
  assert.throws(() => estimateCleanedWeightGrams(1000, 100));
  assert.throws(() => calculateLineTotalPaise(-1, 1000));
});
test('paise precision and future gram increments do not round to whole rupees', () => {
  assert.equal(calculateLineTotalPaise(299, 750), 22425);
});
test('add, duplicate guard, update, subtotal, remove and clear', () => {
  const fish = createCartItem(seer, selection(), 'fish');
  const meat = createCartItem(chicken, selection(500, 'skinless', 'Small pieces'), 'meat');
  let cart = cartReducer([], { type: 'add', item: fish });
  assert.throws(() => cartReducer(cart, { type: 'add', item: fish }), { message: 'This selection is already in your cart.' });
  assert.equal(cart.length, 1);
  cart = cartReducer(cart, { type: 'add', item: meat });
  assert.equal(cartSubtotalPaise(cart), 112000);
  cart = cartReducer(cart, { type: 'update', item: createCartItem(seer, selection(2000, 'fry-cut'), 'fish') });
  assert.equal(cart[0].estimatedCleanedWeightGrams, 1500);
  assert.equal(cartSubtotalPaise(cart), 210000);
  cart = cartReducer(cart, { type: 'remove', id: 'fish' });
  assert.equal(cart[0].specialInstructions, 'Small pieces');
  assert.equal(cartSubtotalPaise(cart), 14000);
  assert.deepEqual(cartReducer(cart, { type: 'clear' }), []);
});
test('tab storage round trip keeps choices and recalculates current mock prices', () => {
  const item = createCartItem(seer, selection(1000, 'cleaned', 'Small pieces'), 'x');
  const saved = serializeCart([item]);
  assert.ok(!saved.includes('lineTotalPaise'));
  assert.deepEqual(restoreCart(saved, products), [item]);
  const updated = products.map(p => p.id === 'seer' ? { ...p, pricePerKg: 1000 } : p);
  assert.equal(restoreCart(saved, updated)[0].lineTotalPaise, 100000);
  assert.deepEqual(restoreCart(saved, products.map(p => ({ ...p, available: false }))), []);
  assert.deepEqual(restoreCart('{broken', products), []);
  assert.deepEqual(restoreCart(JSON.stringify({ version: 1, items: [{ ...item, rawWeightGrams: -1000 }] }), products), []);
});

const duplicateMessage = { message: 'This selection is already in your cart.' };

test('identical add with a different id and trimmed instructions rejects without changing the existing item', () => {
  const item = Object.freeze(createCartItem(seer, selection(1000, 'cleaned', 'Small pieces'), 'original'));
  const cart = Object.freeze([item]);
  const duplicate = { ...item, id: 'duplicate', specialInstructions: '  Small pieces \n' };
  assert.throws(() => cartReducer(cart, { type: 'add', item: duplicate }), duplicateMessage);
  assert.deepEqual(cart, [item]);
  assert.equal(cart[0].rawWeightGrams, 1000);
  assert.equal(cartSubtotalPaise(cart), 98000);
});

for (const [difference, choice] of [
  ['preparation', selection(1000, 'whole')],
  ['weight', selection(500)],
  ['instructions', selection(1000, 'cleaned', 'Small pieces')],
]) {
  test('different ' + difference + ' remains a separate selection on add, restore and edit', () => {
    const original = createCartItem(seer, selection(), 'original');
    const other = createCartItem(seer, choice, 'other');
    const cart = cartReducer([original], { type: 'add', item: other });
    assert.deepEqual(cart, [original, other]);
    assert.deepEqual(restoreCart(serializeCart(cart), products), cart);
    const beforeEdit = createCartItem(seer, selection(2000, 'fry-cut'), 'other');
    assert.deepEqual(cartReducer([original, beforeEdit], { type: 'update', item: other }), cart);
  });
}

test('different products remain separate even with matching selection fields', () => {
  const original = createCartItem(seer, selection(), 'original');
  const other = createCartItem({ ...seer, id: 'another-product' }, selection(), 'other');
  assert.deepEqual(cartReducer([original], { type: 'add', item: other }), [original, other]);
});

test('restore discards identical selections with different ids and keeps the first valid row', () => {
  const original = createCartItem(seer, selection(), 'original');
  const duplicate = { ...original, id: 'duplicate', specialInstructions: '  \n ' };
  assert.deepEqual(restoreCart(serializeCart([original, duplicate, original]), products), [original]);
});

test('edit collision rejects without changing either row or subtotal; editing itself is allowed', () => {
  const original = Object.freeze(createCartItem(seer, selection(1000, 'cleaned', 'Small pieces'), 'original'));
  const other = Object.freeze(createCartItem(seer, selection(500), 'other'));
  const cart = Object.freeze([original, other]);
  const collision = { ...original, id: other.id, specialInstructions: ' Small pieces ' };
  assert.throws(() => cartReducer(cart, { type: 'update', item: collision }), duplicateMessage);
  assert.deepEqual(cart, [original, other]);
  assert.equal(cartSubtotalPaise(cart), 147000);
  assert.deepEqual(cartReducer(cart, { type: 'update', item: original }), cart);
});
