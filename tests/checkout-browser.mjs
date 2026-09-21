// Run after npm run build. Uses an existing Chrome installation; no packages downloaded.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const browserPath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
if (!browserPath) throw new Error('An existing Chrome or Edge installation is required.');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'trait-checkout-check-'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3214'], { stdio: 'ignore', windowsHide: true });
const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9234', '--user-data-dir=' + path.join(temporary, 'profile'), 'about:blank'], { stdio: 'ignore', windowsHide: true });
let socket;
(async () => {
  try {
    let tab;
    for (let i = 0; i < 50; i++) {
      try { await fetch('http://127.0.0.1:3214'); tab = await (await fetch('http://127.0.0.1:9234/json/new?about:blank', { method: 'PUT' })).json(); break; }
      catch { await pause(200); }
    }
    assert.ok(tab, 'Production server and browser started');
    socket = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let id = 0;
    const pending = new Map();
    const errors = [];
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
      if (pending.has(message.id)) { const job = pending.get(message.id); pending.delete(message.id); if (message.error) job.reject(new Error(message.error.message)); else job.resolve(message.result); }
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); socket.send(JSON.stringify({ id: key, method, params })); });
    const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'Browser expression failed'); return result.result.value; };
    const until = async expression => { for (let i = 0; i < 60; i++) { if (await evaluate(expression)) return; await pause(100); } throw new Error('Timed out: ' + expression); };
    const click = async selector => { await until('!!document.querySelector(' + JSON.stringify(selector) + ')'); await evaluate('(()=>{const element=document.querySelector(' + JSON.stringify(selector) + ');element.focus();element.click();})()'); };
    const navigate = async route => { await send('Page.navigate', { url: 'http://127.0.0.1:3214' + route }); await until('document.readyState === "complete"'); await pause(400); };
    const snapshot = async name => { const result = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70, captureBeyondViewport: false }); fs.writeFileSync(path.join(temporary, name + '.jpg'), Buffer.from(result.data, 'base64')); };
    await send('Page.enable'); await send('Runtime.enable');
    const seed = [
      { id: 'fish', productId: 'seer', preparationId: 'cleaned', rawWeightGrams: 1000, specialInstructions: 'Small pieces' },
      { id: 'chicken', productId: 'chicken', preparationId: 'curry-cut', rawWeightGrams: 500, specialInstructions: '' },
    ];
    const fill = async (selector, value) => {
      await evaluate('(()=>{const e=document.querySelector(' + JSON.stringify(selector) + ');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,' + JSON.stringify(value) + ');e.dispatchEvent(new Event("input",{bubbles:true}));})()');
    };
    const select = async (selector, value) => {
      await evaluate('(()=>{const e=document.querySelector(' + JSON.stringify(selector) + ');e.value=' + JSON.stringify(value) + ';e.dispatchEvent(new Event("change",{bubbles:true}));})()');
    };
    const noOverflow = async label => assert.equal(await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true, label + ' has no page overflow');
    for (const width of [390, 1440]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await navigate('/checkout'); await evaluate('sessionStorage.clear()'); await navigate('/checkout');
      await until('document.querySelector("h1")?.textContent === "Your cart is empty"');
      assert.equal(await evaluate('!!document.querySelector(".checkout-submit")'), false, 'Empty checkout cannot submit');
      await evaluate('sessionStorage.setItem("trait.preview-cart.v1",' + JSON.stringify(JSON.stringify({ version: 1, items: seed })) + ')');
      await navigate('/cart'); await click('.cart-checkout');
      await until('!!document.querySelector("#checkout-name")');
      assert.equal(await evaluate('document.querySelector("[data-order-total]").textContent.replace(/[^0-9]/g, "")'), '1160');
      assert.equal(await evaluate('document.querySelectorAll(".order-cleaned").length'), 1);
      await click('.checkout-submit');
      await until('document.activeElement.id === "checkout-name"');
      assert.equal(await evaluate('document.querySelectorAll("input[aria-invalid=true]").length'), 5);
      await fill('#checkout-name', 'Sample Customer'); await fill('#checkout-mobile', '123');
      await fill('#checkout-address', '12 Sample Road'); await fill('#checkout-locality', 'Sample Area'); await fill('#checkout-pincode', '000000');
      await click('.checkout-submit');
      await until('document.activeElement.id === "checkout-mobile"');
      assert.equal(await evaluate('document.querySelector("#checkout-pincode").getAttribute("aria-invalid")'), 'true');
      await fill('#checkout-mobile', '+91 98765 43210'); await fill('#checkout-pincode', '600001');
      await click('input[value=pickup]');
      assert.equal(await evaluate('!!document.querySelector("#checkout-address")'), false);
      assert.equal(await evaluate('document.querySelector("[data-order-total]").textContent.replace(/[^0-9]/g, "")'), '1120');
      await click('input[value=delivery]');
      assert.equal(await evaluate('document.querySelector("#checkout-address").value'), '12 Sample Road');
      await click('input[value=upi]');
      await click('.back-link'); await until('location.pathname === "/cart"'); await click('.cart-checkout');
      await until('!!document.querySelector("#checkout-name")');
      assert.equal(await evaluate('document.querySelector("#checkout-name").value'), 'Sample Customer', 'Back to cart preserves entered details');
      await noOverflow('Checkout ' + width); await snapshot('checkout-' + width);
      await click('.checkout-submit'); await until('document.querySelector("h1").textContent === "Review your order"');
      assert.equal(await evaluate('document.activeElement.tagName'), 'H1', 'Review receives keyboard focus');
      assert.equal(await evaluate('document.querySelector(".customer-details").textContent.includes("UPI")'), true);
      await click('.checkout-form .plain-button'); await until('!!document.querySelector("#checkout-name")');
      assert.equal(await evaluate('document.querySelector("#checkout-pincode").value'), '600001');
      await click('.checkout-submit');
      await evaluate('(()=>{const f=document.querySelector(".checkout-form");f.requestSubmit();f.requestSubmit();})()');
      await until('location.pathname.startsWith("/order-confirmation/") && !!document.querySelector(".receipt-number")');
      const receiptPath = await evaluate('location.pathname');
      const token = receiptPath.split('/').pop();
      assert.match(token, /^[0-9a-f-]{36}$/);
      assert.match(await evaluate('document.querySelector(".receipt-number").textContent'), /^TFM-\d{6}/);
      assert.equal(await evaluate('document.querySelector(".count").textContent'), '0');
      assert.equal(await evaluate('JSON.parse(sessionStorage.getItem("trait.mock-order.v1")).trackingToken'), token);
      await noOverflow('Receipt ' + width); await snapshot('receipt-' + width);
      await navigate(receiptPath); await until('!!document.querySelector(".receipt-number")');
      assert.equal(await evaluate('document.querySelector("[data-order-total]").textContent.replace(/[^0-9]/g, "")'), '1160', 'Receipt survives reload');
      await click('.order-actions .primary'); await until('!!document.querySelector(".tracking-timeline")');
      assert.equal(await evaluate('document.querySelectorAll(".tracking-timeline li").length'), 6);
      for (const status of ['PLACED', 'CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED']) {
        await select('#demo-status', status);
        assert.equal(await evaluate('!!document.querySelector(".tracking-timeline")'), status !== 'CANCELLED');
      }
      assert.equal(await evaluate('JSON.parse(sessionStorage.getItem("trait.mock-order.v1")).status'), 'PLACED', 'Demo controls do not mutate local order');
      await select('#demo-status', 'PREPARING'); await noOverflow('Tracking ' + width); await snapshot('tracking-' + width);
      await navigate('/track-order/not-a-valid-token');
      assert.equal(await evaluate('document.querySelector("h1").textContent'), 'Tracking preview unavailable');
      assert.equal(await evaluate('document.body.textContent.includes("Sample Customer")'), false);
      // A second order exercises pickup/cash, with no hidden address required.
      await evaluate('sessionStorage.setItem("trait.preview-cart.v1",' + JSON.stringify(JSON.stringify({ version: 1, items: seed })) + ')');
      await navigate('/checkout'); await until('!!document.querySelector("#checkout-name")');
      await click('input[value=pickup]'); await fill('#checkout-name', 'Pickup Customer'); await fill('#checkout-mobile', '9876543210');
      await click('.checkout-submit'); await until('document.querySelector("h1").textContent === "Review your order"'); await click('.checkout-submit');
      await until('location.pathname.startsWith("/order-confirmation/") && !!document.querySelector(".receipt-number")');
      assert.equal(await evaluate('document.querySelector("[data-order-total]").textContent.replace(/[^0-9]/g, "")'), '1120');
      assert.equal(await evaluate('JSON.parse(sessionStorage.getItem("trait.mock-order.v1")).customer.address'), '');
      assert.equal(await evaluate('document.querySelector(".customer-details").textContent.includes("Cash")'), true);
      await click('.order-actions .primary'); await until('!!document.querySelector(".tracking-timeline")');
      assert.equal(await evaluate('document.querySelectorAll(".tracking-timeline li").length'), 5);
      assert.equal(await evaluate('document.querySelector(".tracking-timeline").textContent.includes("Out for delivery")'), false);
      await select('#demo-status', 'DELIVERED');
      assert.equal(await evaluate('document.querySelector(".tracking-current h2").textContent'), 'Collected');
      console.log('PASS checkout ' + width + 'px: empty guard, validation/focus, delivery/pickup, UPI/cash, draft preservation, raw totals, single placement, receipt reload, token lookup, all statuses');
    }
    for (const width of [320, 768, 1024]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await evaluate('sessionStorage.setItem("trait.preview-cart.v1",' + JSON.stringify(JSON.stringify({ version: 1, items: seed })) + ')');
      await navigate('/checkout'); await until('!!document.querySelector("#checkout-name")');
      await noOverflow('Checkout ' + width); await snapshot('checkout-' + width);
    }
    // Corrupt local receipts and unavailable browser storage must remain usable.
    await evaluate('sessionStorage.setItem("trait.mock-order.v1", "{broken")');
    await navigate('/track-order');
    assert.equal(await evaluate('document.querySelector(".receipt-number").textContent.includes("Sample order")'), true);
    await select('#demo-method', 'pickup'); await select('#demo-status', 'CANCELLED');
    assert.equal(await evaluate('document.querySelector(".tracking-current h2").textContent'), 'Cancelled');
    await evaluate('sessionStorage.setItem("trait.preview-cart.v1",' + JSON.stringify(JSON.stringify({ version: 1, items: seed })) + ')');
    const blocked = await send('Page.addScriptToEvaluateOnNewDocument', { source: `
      const originalGet = Storage.prototype.getItem;
      const originalSet = Storage.prototype.setItem;
      Storage.prototype.getItem = function(key) { if (key === 'trait.mock-order.v1') throw new Error('Storage blocked'); return originalGet.call(this, key); };
      Storage.prototype.setItem = function(key, value) { if (key === 'trait.mock-order.v1') throw new Error('Storage blocked'); return originalSet.call(this, key, value); };
    ` });
    await navigate('/checkout'); await until('!!document.querySelector("#checkout-name")');
    await click('input[value=pickup]'); await fill('#checkout-name', 'Sample Pickup'); await fill('#checkout-mobile', '9876543210');
    await click('.checkout-submit'); await until('document.querySelector("h1").textContent === "Review your order"'); await click('.checkout-submit');
    await until('location.pathname.startsWith("/order-confirmation/") && !!document.querySelector(".receipt-number")');
    const memoryReceipt = await evaluate('location.pathname');
    await click('.order-actions .primary'); await until('!!document.querySelector(".tracking-timeline")');
    await navigate(memoryReceipt);
    assert.equal(await evaluate('document.querySelector("h1").textContent'), 'Order preview unavailable', 'Blocked storage falls back to in-memory receipt only');
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: blocked.identifier });
    console.log('PASS corrupt storage, sample cancellation, blocked-storage placement/tracking fallback');
    assert.deepEqual(errors, [], 'No uncaught browser exceptions');
    console.log('Screenshots: ' + temporary);
    await send('Browser.close');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { if (socket) socket.close(); browser.kill(); server.kill(); }
})();
