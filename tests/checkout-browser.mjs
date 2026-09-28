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
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3214'], { stdio: 'ignore', windowsHide: true, env: { ...process.env, SUPABASE_URL:'https://trait-test.invalid', SUPABASE_PUBLISHABLE_KEY:'isolated-test-key', TRAIT_STORE_ID:'00000000-0000-4000-8000-000000000001', TRAIT_RATE_LIMIT_REST_URL:'https://trait-limit.invalid', TRAIT_RATE_LIMIT_REST_TOKEN:'isolated-test-token', NODE_OPTIONS:'--import=./tests/live-fixture-preload.mjs' } });
const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9234', '--user-data-dir=' + path.join(temporary, 'profile'), 'about:blank'], { stdio: 'ignore', windowsHide: true, env: { ...process.env, SUPABASE_URL:'https://trait-test.invalid', SUPABASE_PUBLISHABLE_KEY:'isolated-test-key', TRAIT_STORE_ID:'00000000-0000-4000-8000-000000000001', TRAIT_RATE_LIMIT_REST_URL:'https://trait-limit.invalid', TRAIT_RATE_LIMIT_REST_TOKEN:'isolated-test-token', NODE_OPTIONS:'--import=./tests/live-fixture-preload.mjs' } });
let socket;
(async () => {
  try {
    let tab;
    for (let i = 0; i < 50; i++) {
      try { await fetch('http://127.0.0.1:3214'); tab = await (await fetch('http://127.0.0.1:9234/json/new?about:blank', { method: 'PUT' })).json(); break; }
      catch { await pause(200); }
    }
    assert.ok(tab, 'Production server and browser started');
    const protectedResponse=await fetch('http://127.0.0.1:3214/track-order/not-a-token');
    assert.equal(protectedResponse.headers.get('referrer-policy'),'no-referrer');
    assert.equal(protectedResponse.headers.get('x-frame-options'),'DENY');
    assert.ok(protectedResponse.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
    assert.ok(protectedResponse.headers.get('cache-control').includes('no-store'));
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
    const seed=[{id:'test-fish',productId:'seer',preparationId:'cleaned',rawWeightGrams:1000,specialInstructions:'Test only'}];
    const fill=async(selector,value)=>evaluate('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,'+JSON.stringify(value)+');e.dispatchEvent(new Event("input",{bubbles:true}));})()');
    for(const width of [390,768,1440]){
      await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
      for(const route of ['/','/search','/fish','/chicken','/mutton','/admin','/track-order','/contact','/delivery-areas']){
        await navigate(route);
        assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),route+' '+width+' no overflow');
        assert.equal(await evaluate('document.body.textContent.includes("TFM-000125")'),false);
      }
      await navigate('/');
      assert.equal(await evaluate('document.querySelector(".footer-staff-link")?.getAttribute("href")'),'/admin');
      await click('.footer-staff-link');await until('location.pathname==="/admin" && document.querySelector("h2")?.textContent==="Staff sign in"');
      await navigate('/checkout');await evaluate('sessionStorage.clear()');await navigate('/checkout');
      await until('document.querySelector("h1")?.textContent==="Your cart is empty"');
      await evaluate('sessionStorage.setItem("trait.preview-cart.v1",'+JSON.stringify(JSON.stringify({version:1,items:seed}))+')');
      await navigate('/checkout');await until('!!document.querySelector("#checkout-name")');
      await click('.checkout-submit');await until('document.activeElement.id==="checkout-name"');
      await fill('#checkout-name','Isolated Test');await fill('#checkout-mobile','9876543210');await click('input[value=pickup]');
      assert.equal(await evaluate('!!document.querySelector("#checkout-address")'),false);
      await click('input[value=upi]');await click('.checkout-submit');
      await until('document.querySelector(".checkout-form [role=alert]")?.textContent.includes("Unable to quote")');
      assert.equal(await evaluate('location.pathname'),'/checkout','No mock order fallback without database connection');
      assert.equal(await evaluate('sessionStorage.getItem("trait.mock-order.v1")'),null);
      assert.equal(await evaluate('JSON.parse(sessionStorage.getItem("trait.preview-cart.v1")).items.length'),1);
      await snapshot('live-checkout-'+width);
      await navigate('/track-order/not-a-token');
      assert.equal(await evaluate('document.querySelector("h1").textContent'),'Order unavailable');
      assert.equal(await evaluate('document.body.textContent.includes("9876543210")'),false);
      for(const role of ['admin','owner','employee']){
        await navigate('/admin/'+role+'/orders');
        await until('location.pathname==="/admin/login"');
        assert.equal(await evaluate('document.querySelectorAll(".admin-table").length'),0);
        await navigate('/admin/preview/'+role+'/orders');
        assert.equal(await evaluate('document.querySelectorAll(".admin-table").length'),0);
      }
      console.log('PASS live storefront/checkout/tracking/protected routes '+width+'px; missing backend fails closed');
    }
    assert.deepEqual(errors,[]);
    console.log('Screenshots: '+temporary);
    await send('Browser.close');
  }catch(error){console.error(error);process.exitCode=1;}
  finally{if(socket)socket.close();browser.kill();server.kill();}
})();
