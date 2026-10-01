// Run after npm run build. Uses an existing Chrome installation; no packages downloaded.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

import path from 'node:path';
import assert from 'node:assert/strict';
const browserPath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
if (!browserPath) throw new Error('An existing Chrome or Edge installation is required.');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'trait-admin-check-'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3217'], { stdio: 'ignore', windowsHide: true, env: { ...process.env, TRAIT_STAFF_ENABLED:'true', SUPABASE_URL:'https://trait-test.invalid', SUPABASE_PUBLISHABLE_KEY:'isolated-test-key', TRAIT_STORE_ID:'00000000-0000-4000-8000-000000000001', TRAIT_RATE_LIMIT_REST_URL:'https://trait-limit.invalid', TRAIT_RATE_LIMIT_REST_TOKEN:'isolated-test-token', NODE_OPTIONS:'--import=./tests/live-fixture-preload.mjs' } });
const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9237', '--user-data-dir=' + path.join(temporary, 'profile'), 'about:blank'], { stdio: 'ignore', windowsHide: true, env: { ...process.env, TRAIT_STAFF_ENABLED:'true', SUPABASE_URL:'https://trait-test.invalid', SUPABASE_PUBLISHABLE_KEY:'isolated-test-key', TRAIT_STORE_ID:'00000000-0000-4000-8000-000000000001', TRAIT_RATE_LIMIT_REST_URL:'https://trait-limit.invalid', TRAIT_RATE_LIMIT_REST_TOKEN:'isolated-test-token', NODE_OPTIONS:'--import=./tests/live-fixture-preload.mjs' } });
let socket;
(async () => {
  try {
    let tab;
    for (let i = 0; i < 50; i++) {
      try { await fetch('http://127.0.0.1:3217'); tab = await (await fetch('http://127.0.0.1:9237/json/new?about:blank', { method: 'PUT' })).json(); break; }
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
    const navigate = async route => { await send('Page.navigate', { url: 'http://127.0.0.1:3217' + route }); await until('document.readyState === "complete"'); await pause(400); };
    const snapshot = async name => { const result = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70, captureBeyondViewport: false }); fs.writeFileSync(path.join(temporary, name + '.jpg'), Buffer.from(result.data, 'base64')); };
    await send('Page.enable'); await send('Runtime.enable');await send('Network.enable');
    for(const width of [390,1440]){
      await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
      for(const role of ['ADMIN','OWNER','EMPLOYEE']){
        await send('Network.setCookie',{name:'trait_staff_access',value:'fixture-'+role,url:'http://127.0.0.1:3217/admin',path:'/admin',httpOnly:true,sameSite:'Strict'});
        const allowed=role==='ADMIN'?['dashboard','orders','catalogue','categories','prices','employees','payments','reports','settings']:role==='OWNER'?['dashboard','orders','prices','employees','payments','reports','settings']:['dashboard','orders'];
        allowed.push('offers');
        for(const section of allowed){
          await navigate('/admin/'+role.toLowerCase()+'/'+section);
          await until('!!document.querySelector(".admin-live")');
          assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'staff '+role+' '+section+' '+width);
          if(section==='offers'){
            assert.ok(await evaluate('document.body.textContent.includes("Fresh test offer")'));
            if(role==='EMPLOYEE')assert.equal(await evaluate('document.querySelectorAll("input[name=title]").length'),0);
            else {
              await evaluate('document.querySelectorAll("details").forEach(d=>d.open=true)');
              assert.equal(await evaluate('document.querySelectorAll("input[name=title]").length'),2);
              await snapshot('offers-'+role+'-'+width);
            }
          }
          if(role==='EMPLOYEE')assert.equal(await evaluate('document.querySelectorAll("nav a[href*=prices],nav a[href*=employees],nav a[href*=reports],nav a[href*=settings]").length'),0);
          if(role==='OWNER')assert.equal(await evaluate('document.querySelectorAll("nav a[href*=catalogue],nav a[href*=categories]").length'),0);
        }
        if(role!=='ADMIN'){
          await navigate('/admin/'+role.toLowerCase()+'/catalogue');
          assert.equal(await evaluate('document.querySelectorAll(".admin-live").length'),0);
        }
        await navigate('/admin/'+role.toLowerCase()+'/orders');await snapshot('live-'+role+'-'+width);
        console.log('PASS authenticated '+role+' pages and role navigation at '+width+'px using isolated RPC fixtures');
      }
      await send('Network.clearBrowserCookies');
      await navigate('/admin/recovery');await until('!!document.querySelector("input[name=password]")');
      assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
    }
    assert.deepEqual(errors,[]);console.log('Screenshots: '+temporary);await send('Browser.close');
  }catch(error){console.error(error);process.exitCode=1;}
  finally{if(socket)socket.close();browser.kill();server.kill();}
})();
