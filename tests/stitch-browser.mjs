// Run after npm run build. Uses an existing Chrome installation; no packages downloaded.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

import path from 'node:path';
import assert from 'node:assert/strict';
const browserPath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
if (!browserPath) throw new Error('An existing Chrome or Edge installation is required.');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'trait-stitch-check-'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3215'], { stdio: 'ignore', windowsHide: true, env:{...process.env,SUPABASE_URL:'https://trait-test.invalid',SUPABASE_PUBLISHABLE_KEY:'isolated-test-key',TRAIT_STORE_ID:'00000000-0000-4000-8000-000000000001',TRAIT_RATE_LIMIT_REST_URL:'https://trait-limit.invalid',TRAIT_RATE_LIMIT_REST_TOKEN:'isolated-test-token',NODE_OPTIONS:'--import=./tests/live-fixture-preload.mjs'} });
const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9235', '--user-data-dir=' + path.join(temporary, 'profile'), 'about:blank'], { stdio: 'ignore', windowsHide: true });
let socket;
(async () => {
  try {
    let tab;
    for (let i = 0; i < 50; i++) {
      try { await fetch('http://127.0.0.1:3215'); tab = await (await fetch('http://127.0.0.1:9235/json/new?about:blank', { method: 'PUT' })).json(); break; }
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
    const navigate = async route => { await send('Page.navigate', { url: 'http://127.0.0.1:3215' + route }); await until('document.readyState === "complete"'); await pause(400); };
    const snapshot = async name => { const result = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70, captureBeyondViewport: false }); fs.writeFileSync(path.join(temporary, name + '.jpg'), Buffer.from(result.data, 'base64')); };
    await send('Page.enable'); await send('Runtime.enable');
    const seed = [
      { id: 'fish', productId: 'seer', preparationId: 'cleaned', rawWeightGrams: 1000, specialInstructions: 'Small pieces' },
      { id: 'chicken', productId: 'chicken', preparationId: 'curry-cut', rawWeightGrams: 500, specialInstructions: '' },
      { id: 'mutton', productId: 'mutton', preparationId: 'curry-cut', rawWeightGrams: 500, specialInstructions: '' },
    ];
    const seedCart = () => evaluate('sessionStorage.setItem("trait.preview-cart.v1",' + JSON.stringify(JSON.stringify({ version: 1, items: seed })) + ')');
    const layout = async label => {
      await evaluate('document.fonts.ready');
      const state = await evaluate(`(()=>({
        viewport:document.documentElement.clientWidth, page:document.documentElement.scrollWidth,
        clipped:[...document.querySelectorAll('button,input,select,.button')].filter(e=>e.getClientRects().length && !e.closest('.sr-only')).filter(e=>{const r=e.getBoundingClientRect();return r.left < -1 || r.right > innerWidth+1}).map(e=>e.outerHTML.slice(0,120)),
        small:[...document.querySelectorAll('.button,.add-button,.choice,.cart-item select,.checkout-fields input,.catalog-filters button')].filter(e=>e.getClientRects().length && e.getBoundingClientRect().height < 43).map(e=>e.outerHTML.slice(0,120))
      }))()`);
      assert.ok(state.page <= state.viewport, label + ' page overflow: '+JSON.stringify(state));
      assert.deepEqual(state.clipped, [], label + ' controls stay in viewport');
      assert.deepEqual(state.small, [], label + ' touch targets >=44px');
    };
    const fullSnapshot = async name => {
      await evaluate('window.scrollTo(0,0)');
      await pause(100);
      const metrics = await send('Page.getLayoutMetrics');
      const image = await send('Page.captureScreenshot', {format:'jpeg',quality:75,captureBeyondViewport:true,clip:{x:0,y:0,width:metrics.cssContentSize.width,height:metrics.cssContentSize.height,scale:1}});
      fs.writeFileSync(path.join(temporary,name+'.jpg'),Buffer.from(image.data,'base64'));
    };
    // Test the minimal live confirmation/tracking projection using isolated RPC fixtures.
    const receipt='/order-confirmation/'+'a'.repeat(64);
    const tracking='/track-order/'+'a'.repeat(64);
    for (const width of [320,390,768,1024,1440]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
      await navigate('/');
      assert.equal(await evaluate('document.querySelectorAll(".product-card").length'),8);
      for (const [index,count] of [[2,4],[3,2],[4,2],[1,8]]) {
        await click('.catalog-filters button:nth-child('+index+')');
        assert.equal(await evaluate('document.querySelectorAll(".product-card").length'),count,'Category filters '+width);
      }
      await layout('Home '+width);
      await evaluate('Promise.all([...document.images].map(image=>{image.loading="eager";return image.decode().catch(()=>null)}))');
      assert.equal(await evaluate('[...document.images].every(i=>i.complete && i.naturalWidth>0)'),true,'All local images load');
      assert.equal(await evaluate('(()=>{const family=getComputedStyle(document.querySelector(".hero h1")).fontFamily.split(",")[0];return family.includes("headingFont") && document.fonts.check("700 36px "+family)})()'),true,'Oswald heading loaded');
      await fullSnapshot('home-'+width);
      await click('button[aria-label="Choose Seer Fish"]'); await until('!!document.querySelector("dialog[open]")');
      await layout('Selection '+width); await snapshot('selection-'+width); await click('.close-button');
      await navigate('/search?q=Vanjaram');
      assert.equal(await evaluate('document.querySelectorAll(".product-card").length'),1);
      await click('.catalog-filters button:nth-child(3)');
      assert.equal(await evaluate('document.querySelectorAll(".product-card").length'),0,'Search respects category');
      await click('.catalog-filters button:first-child');
      assert.equal(await evaluate('document.querySelectorAll(".product-card").length'),1);
      await layout('Search '+width);
      await seedCart(); await navigate('/cart'); await until('document.querySelectorAll(".cart-item").length === 3');
      await layout('Cart '+width); await fullSnapshot('cart-'+width);
      await navigate('/checkout'); await until('!!document.querySelector("#checkout-name")');
      await layout('Checkout '+width); await fullSnapshot('checkout-'+width);
      await navigate(receipt); await until('document.querySelector("h1")?.textContent==="TFM-999001"');
      await layout('Receipt '+width); await fullSnapshot('receipt-'+width);
      await navigate(tracking); await until('document.querySelector("h1")?.textContent==="TFM-999001"');
      await layout('Tracking '+width); await fullSnapshot('tracking-'+width);
      console.log('PASS '+width+'px: homepage filters, category-aware search, local assets/fonts, modal, cart, checkout, receipt, tracking; no overflow/clipped controls; touch targets >=44px');
    }
    assert.deepEqual(errors, [], 'No uncaught browser exceptions');
    console.log('Screenshots: '+temporary);
    await send('Browser.close');
  } catch(error) { console.error(error); process.exitCode=1; }
  finally { if(socket) socket.close(); browser.kill(); server.kill(); }
})();