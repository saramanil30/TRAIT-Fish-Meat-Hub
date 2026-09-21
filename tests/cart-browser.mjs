// Run after npm run build. Uses an existing Chrome installation; no packages downloaded.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const browserPath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
if (!browserPath) throw new Error('An existing Chrome or Edge installation is required.');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'trait-cart-check-'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3213'], { stdio: 'ignore', windowsHide: true });
const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9233', '--user-data-dir=' + path.join(temporary, 'profile'), 'about:blank'], { stdio: 'ignore', windowsHide: true });
let socket;
(async () => {
  try {
    let tab;
    for (let i = 0; i < 50; i++) {
      try { await fetch('http://127.0.0.1:3213'); tab = await (await fetch('http://127.0.0.1:9233/json/new?about:blank', { method: 'PUT' })).json(); break; }
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
    const navigate = async route => { await send('Page.navigate', { url: 'http://127.0.0.1:3213' + route }); await until('document.readyState === "complete"'); await pause(400); };
    const snapshot = async name => { const result = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70, captureBeyondViewport: false }); fs.writeFileSync(path.join(temporary, name + '.jpg'), Buffer.from(result.data, 'base64')); };
    const key = async (key, code, windowsVirtualKeyCode, modifiers = 0) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, modifiers }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode, modifiers }); };
    await send('Page.enable'); await send('Runtime.enable');
    for (const width of (process.argv.includes('--layout-only') ? [] : [390, 1440])) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 850, deviceScaleFactor: 1, mobile: false });
      await navigate('/fish');
      await evaluate('sessionStorage.clear()');
      await navigate('/fish');
      assert.equal(await evaluate('document.querySelectorAll(".add-button:disabled").length'), 1, 'Sold-out Pomfret stays disabled');
      await click('button[aria-label="Choose Seer Fish"]');
      await until('!!document.querySelector("dialog[open]")');
      assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), 'Close product selection');
      assert.equal(await evaluate('document.querySelector("dialog").textContent.includes("Estimated cleaned weight")'), false, 'Whole has no cleaned estimate');
      await click('input[value="cleaned"]');
      for (const [weight, price, cleaned] of [[500, '490', '375 g'], [1000, '980', '750 g'], [1500, '1470', '1.125 kg'], [2000, '1960', '1.5 kg']]) {
        await click('input[value="' + weight + '"]');
        assert.equal(await evaluate('document.querySelector("[data-item-price]").textContent.replace(/[^0-9]/g, "")'), price);
        assert.equal(await evaluate('document.querySelector("dialog .weight-summary").textContent.includes(' + JSON.stringify('~' + cleaned) + ')'), true);
      }
      assert.equal(await evaluate('document.querySelector("dialog .weight-summary").textContent.includes("approximately 25%")'), true);
      assert.equal(await evaluate('document.querySelector("dialog .weight-summary").getBoundingClientRect().bottom <= document.querySelector("dialog button[type=submit]").getBoundingClientRect().bottom'), true);
      for (let i = 0; i < 20; i++) { await key('Tab', 'Tab', 9); assert.equal(await evaluate('document.querySelector("dialog").contains(document.activeElement)'), true, 'Tab remains in dialog'); }
      await key('Tab', 'Tab', 9, 8);
      assert.equal(await evaluate('document.querySelector("dialog").contains(document.activeElement)'), true);
      await key('Escape', 'Escape', 27);
      await until('!document.querySelector("dialog[open]")');
      assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), 'Choose Seer Fish');
      assert.equal(await evaluate('document.body.style.overflow'), '');
      await click('button[aria-label="Choose Seer Fish"]'); await until('!!document.querySelector("dialog[open]")');
      await click('input[value="cleaned"]'); await click('input[value="1000"]');
      await evaluate('(()=>{const element=document.querySelector("dialog textarea");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(element,"Small pieces <b>please</b>");element.dispatchEvent(new Event("input",{bubbles:true}));})()');
      await snapshot('selection-' + width);
      await evaluate('(()=>{const form=document.querySelector("dialog form");form.requestSubmit();form.requestSubmit();})()');
      await until('!document.querySelector("dialog[open]")');
      assert.equal(await evaluate('document.querySelector(".count").textContent'), '1', 'Rapid double submit adds once');
      await click('.cart-link'); await until('location.pathname === "/cart" && !!document.querySelector(".cart-item")');
      assert.equal(await evaluate('document.querySelector(".cart-instructions").textContent.includes("Small pieces <b>please</b>")'), true);
      assert.equal(await evaluate('!!document.querySelector(".cart-instructions b")'), false, 'Instructions rendered as text');
      await evaluate('(()=>{const s=document.querySelector(".cart-item select");s.value="2000";s.dispatchEvent(new Event("change",{bubbles:true}));})()');
      assert.equal(await evaluate('document.querySelector("[data-subtotal]").textContent.replace(/[^0-9]/g, "")'), '1960');
      assert.equal(await evaluate('document.querySelector(".cart-cleaned-column").textContent.includes("~1.5 kg")'), true);
      await click('button[aria-label="Edit Seer Fish selection"]'); await until('!!document.querySelector("dialog[open]")');
      await click('input[value="whole"]'); await click('dialog button[type="submit"]');
      assert.equal(await evaluate('!!document.querySelector(".cart-item .cart-cleaned-column")'), false);
      await navigate('/cart'); await until('!!document.querySelector(".cart-item")');
      assert.equal(await evaluate('document.querySelector("[data-subtotal]").textContent.replace(/[^0-9]/g, "")'), '1960', 'Reload keeps choices');
      await navigate('/chicken'); await click('button[aria-label="Choose Chicken Curry Cut"]'); await until('!!document.querySelector("dialog[open]")');
      assert.equal(await evaluate('document.querySelector("dialog").textContent.includes("Estimated cleaned weight")'), false, 'No unconfigured meat estimate');
      await click('dialog button[type="submit"]'); await click('.cart-link'); await until('document.querySelectorAll(".cart-item").length === 2');
      assert.equal(await evaluate('document.querySelector("[data-subtotal]").textContent.replace(/[^0-9]/g, "")'), '2100');
      assert.equal(await evaluate('document.querySelector(".mobile-nav").textContent.includes("Cart (2)")'), true);
      await snapshot('cart-' + width);
      assert.equal(await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true, 'No cart overflow');
      await click('button[aria-label="Remove Chicken Curry Cut"]');
      assert.equal(await evaluate('document.querySelectorAll(".cart-item").length'), 1);
      await click('.clear-cart'); await click('.clear-confirm .secondary');
      assert.equal(await evaluate('document.querySelectorAll(".cart-item").length'), 1, 'Cancel clear preserves items');
      await click('.clear-cart'); await click('.clear-confirm .primary');
      assert.equal(await evaluate('document.querySelectorAll(".cart-item").length'), 0);
      assert.equal(await evaluate('document.querySelector(".count").textContent'), '0');
      await navigate('/cart'); assert.equal(await evaluate('document.querySelectorAll(".cart-item").length'), 0, 'Clear persists');
      console.log('PASS ' + width + 'px: preparation, four prices/yields, focus trap/Escape, duplicate guard, notes, counts, update, edit, reload, remove, clear');
    }
    const choices = [
      { id: 'cleaned', productId: 'seer', preparationId: 'cleaned', rawWeightGrams: 1000, specialInstructions: '' },
      { id: 'whole', productId: 'seer', preparationId: 'whole', rawWeightGrams: 500, specialInstructions: '' },
      { id: 'chicken', productId: 'chicken', preparationId: 'curry-cut', rawWeightGrams: 500, specialInstructions: '' },
      { id: 'mutton', productId: 'mutton', preparationId: 'curry-cut', rawWeightGrams: 500, specialInstructions: '' },
      { id: 'prawns', productId: 'prawns', preparationId: 'cleaned', rawWeightGrams: 500, specialInstructions: '' },
      { id: 'weight', productId: 'seer', preparationId: 'cleaned', rawWeightGrams: 500, specialInstructions: '' },
      { id: 'notes', productId: 'seer', preparationId: 'cleaned', rawWeightGrams: 1000, specialInstructions: 'Small pieces' },
    ];
    for (const width of [320, 390, 768, 1024, 1440]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await navigate('/cart');
      await evaluate('sessionStorage.setItem("trait.preview-cart.v1", ' + JSON.stringify(JSON.stringify({ version: 1, items: [...choices, { ...choices[0], id: 'duplicate', specialInstructions: '  ' }] })) + ')');
      await navigate('/cart');
      await until('document.querySelectorAll(".cart-item").length === 7');
      assert.equal(await evaluate('document.querySelectorAll(".cart-cleaned-column").length'), 3, 'Only configured loss selections show a cleaned field');
      for (const id of ['whole', 'chicken', 'mutton', 'prawns']) {
        assert.equal(await evaluate('document.querySelector("[aria-labelledby=cart-name-' + id + ']").textContent.toLowerCase().includes("after cleaning")'), false, id + ' has no cleaning placeholder');
      }
      assert.equal(await evaluate('document.querySelector("[data-subtotal]").textContent.replace(/[^0-9]/g, "")'), '3845');
      const button = await evaluate('(()=>{const e=document.querySelector(".cart-title a");const s=getComputedStyle(e);return {text:e.textContent,color:s.color,border:s.borderTopColor,style:s.borderTopStyle,width:s.borderTopWidth,background:s.backgroundColor}})()');
      assert.equal(button.text, 'Continue shopping');
      assert.equal(button.color, 'rgb(217, 0, 0)');
      assert.equal(button.border, button.color);
      assert.equal(button.style, 'solid');
      assert.equal(button.width, '1px');
      assert.notEqual(button.background, button.color);
      assert.equal(await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true, 'No cart overflow at ' + width);
      await snapshot('final-cart-' + width);
      await navigate('/fish');
      await click('button[aria-label="Choose Seer Fish"]');
      await click('dialog button[type="submit"]');
      await until('document.querySelector("dialog [role=alert]")?.textContent === "This selection is already in your cart."');
      assert.equal(await evaluate('document.querySelector(".count").textContent'), '7');
      await click('.close-button');
      await navigate('/cart');
      await click('[aria-labelledby="cart-name-cleaned"] button[aria-label="Edit Seer Fish selection"]');
      await click('input[value="whole"]'); await click('input[value="500"]');
      await click('dialog button[type="submit"]');
      await until('document.querySelector("dialog [role=alert]")?.textContent === "This selection is already in your cart."');
      await click('.close-button');
      await evaluate('(()=>{const s=document.querySelector("#weight-weight");s.value="1000";s.dispatchEvent(new Event("change",{bubbles:true}));})()');
      await until('document.querySelector(".cart-page > [role=alert]")?.textContent === "This selection is already in your cart."');
      assert.equal(await evaluate('document.querySelector("#weight-weight").value'), '500');
      const saved = await evaluate('JSON.parse(sessionStorage.getItem("trait.preview-cart.v1")).items');
      assert.deepEqual(saved.filter(item => item.id !== 'duplicate'), choices, 'Rejected add and edits leave stored choices unchanged');
      assert.equal(await evaluate('document.querySelector("[data-subtotal]").textContent.replace(/[^0-9]/g, "")'), '3845');
      console.log('PASS final cart ' + width + 'px: cleaning visibility, duplicate restore/add/edit, separate choices, totals, red outline, overflow');
    }
    for (const [width, height] of [[320, 640], [768, 1024], [844, 390]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await navigate('/fish'); await click('button[aria-label="Choose Seer Fish"]'); await until('!!document.querySelector("dialog[open]")'); await click('input[value="cleaned"]');
      const dimensions = await evaluate('(()=>{const d=document.querySelector("dialog");const r=d.getBoundingClientRect();return {width:r.width,height:r.height,scroll:d.scrollWidth,client:d.clientWidth}})()');
      await snapshot('selection-' + width + '-' + height);
      assert.ok(dimensions.width <= width && dimensions.height <= height && dimensions.scroll <= dimensions.client + 1, JSON.stringify(dimensions));
      await click('.close-button'); console.log('PASS drawer dimensions ' + width + 'x' + height);
    }
    assert.deepEqual(errors, [], 'No uncaught browser exceptions');
    console.log('Screenshots: ' + temporary);
    await send('Browser.close');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { if (socket) socket.close(); browser.kill(); server.kill(); }
})();
