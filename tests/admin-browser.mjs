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
        if(role!=='EMPLOYEE')allowed.push('offers');
        for(const section of allowed){
          await navigate('/admin/'+role.toLowerCase()+'/'+section);
          await until('!!document.querySelector(".admin-live")').catch(async e=>{throw new Error(role+" "+section+": "+(await evaluate("document.body.innerText.slice(0,300)")));});
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
          if(role==='EMPLOYEE')assert.equal(await evaluate('document.querySelectorAll("nav[aria-label^=Staff] a[href*=prices],nav[aria-label^=Staff] a[href*=employees],nav[aria-label^=Staff] a[href*=reports],nav[aria-label^=Staff] a[href*=settings]").length'),0);
          if(role==='OWNER')assert.equal(await evaluate('document.querySelectorAll("nav[aria-label^=Staff] a[href*=catalogue],nav[aria-label^=Staff] a[href*=categories]").length'),0);
        }
        if(role!=='ADMIN'){
          await navigate('/admin/'+role.toLowerCase()+'/catalogue');
          assert.equal(await evaluate('document.querySelectorAll(".admin-live").length'),0);
        }
        // Dashboard: everyone gets "Needs action" and slots; only ADMIN/OWNER see money.
        await navigate('/admin/'+role.toLowerCase()+'/dashboard'+(role==='EMPLOYEE'?'':'?period=7d'));
        assert.ok(await evaluate('document.querySelector(".dash").textContent.includes("Needs action")&&document.querySelectorAll(".dash-table tbody tr").length===3'),'dashboard basics '+role);
        assert.equal(await evaluate('/₹|Revenue|Average order|Top products|Latest orders/.test(document.querySelector(".dash").textContent)'),role!=='EMPLOYEE','dashboard money visibility '+role);
        if(role!=='EMPLOYEE')assert.equal(await evaluate('document.querySelector(".dash-periods [aria-current=page]").textContent'),'7 days');
        assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'dashboard overflow '+role+' '+width);
        const fullHeight=await evaluate('document.documentElement.scrollHeight');
        await send('Emulation.setDeviceMetricsOverride',{width,height:fullHeight,deviceScaleFactor:1,mobile:false});await snapshot('dashboard-'+role+'-'+width);
        await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
        await navigate(await evaluate('document.querySelector(".dash-status a[href*=\'status=CONFIRMED\']").getAttribute("href")'));
        assert.ok(await evaluate('document.querySelector(".ord-filter")?.textContent.includes("Confirmed")&&document.querySelectorAll(".ord-row").length===1'),'filtered orders '+role);
        // Reports (ADMIN/OWNER): presets, custom range, daily bars, every tab, and the Excel export of the current view.
        const reports='/admin/'+role.toLowerCase()+'/reports';
        if(role==='EMPLOYEE'){
         assert.equal(await evaluate('fetch("/admin/report-export?range=today").then(r=>r.status)'),403,'employee export blocked');
        } else {
         await navigate(reports+'?range=month');
         assert.equal(await evaluate('document.querySelector(".rep-ranges [aria-current=page]").textContent'),'This month');
         assert.equal(await evaluate('document.querySelectorAll(".rep-cards>div").length'),6);
         assert.ok(await evaluate('!/UTC|T00:00|Z\\b/.test(document.querySelector(".rep").innerText)'),'no UTC/ISO text '+role);
         await navigate(reports+'?range=custom&from=2026-09-01&until=2026-09-30&tab=products');
         assert.equal(await evaluate('document.querySelectorAll(".rep-chart").length'),2);
         assert.equal(await evaluate('document.querySelectorAll(".rep-chart:first-of-type .rep-bar").length'),30,'one bar per day, inclusive');
         assert.equal(await evaluate('document.querySelector(".rep-heading").textContent.includes("1 Sept 2026 – 30 Sept 2026")||document.querySelector(".rep-heading").textContent.includes("1 Sep 2026 – 30 Sep 2026")'),true);
         assert.equal(await evaluate('document.querySelector("input[name=from]").value'),'2026-09-01');
         for(const t of ['products','categories','payments','fulfilment','coupons','cancellations','cash']){
          await navigate(reports+'?range=custom&from=2026-09-01&until=2026-09-30&tab='+t);
          assert.ok(await evaluate('document.querySelectorAll(".rep-table tbody tr").length>0'),'tab '+t+' '+role);
          assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'reports overflow '+t+' '+width);
          if(t==='products'||t==='cash'){
           const h=await evaluate('document.documentElement.scrollHeight');
           await send('Emulation.setDeviceMetricsOverride',{width,height:h,deviceScaleFactor:1,mobile:false});await snapshot('reports-'+t+'-'+role+'-'+width);
           await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
          }
         }
         assert.equal(await evaluate('document.querySelectorAll(".rep>.rep-table").length'),2,'cash by day and by staff');
         const exported=await evaluate('fetch(document.querySelector(".rep-export").getAttribute("href")).then(async r=>({status:r.status,type:r.headers.get("content-type"),name:r.headers.get("content-disposition"),bytes:Array.from(new Uint8Array(await r.arrayBuffer()))}))');
         assert.equal(exported.status,200);assert.match(exported.type,/spreadsheetml/);assert.match(exported.name,/trait-report-2026-09-01-to-2026-09-30-cash\.xlsx/);
         assert.deepEqual(exported.bytes.slice(0,2),[0x50,0x4b]);
         if(width===1440&&role==='ADMIN')fs.writeFileSync(path.join(temporary,'export.xlsx'),Buffer.from(exported.bytes));
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
