import { readFileSync, writeFileSync } from 'node:fs';
const source = readFileSync('ReadPrompt.txt', 'utf8');
let category;
const products = [];
for (const line of source.split(/\r?\n/)) {
  if (['EGGS','SEAFOOD','FRESH WATER'].includes(line)) category = line;
  const match = line.match(/^- (.+) \u2014 \u20b9(\d+)\/(.+)$/u);
  if (!match) continue;
  const [, name, rupees, unit] = match;
  const basis = unit.startsWith('tray') ? 'TRAY' : unit.includes('NET') ? 'NET_WEIGHT' : 'RAW_WEIGHT';
  products.push({ key: name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/-$/,''), category, name, pricePaise: Number(rupees)*100, pricingBasis: basis, priceUnit: unit, unitGrams: basis==='TRAY'?null:basis==='NET_WEIGHT'?500:1000, unitsPerTray: basis==='TRAY'?30:null, sizeNote: name==='Rohu Big'?'1-1.5kg':null, image: null });
}
if (products.length !== 23 || new Set(products.map(p=>p.key)).size !== 23) throw new Error('Catalogue parsing failed');
const king=products.find(p=>p.name==='King Fish / Vanjaram');
if(king.pricePaise!==80000||king.unitGrams!==500||king.pricingBasis!=='NET_WEIGHT')throw new Error('King Fish price changed');
writeFileSync('config/approved-catalogue.json',JSON.stringify({source:'User-approved ReadPrompt.txt catalogue, 2026-09-28',currency:'INR',cutsWhereApplicable:['Fillet','Boneless Steak/Cubes','Butterfly','Finger Cut','Full Fish Grill/Baking Cut'],products},null,2)+'\n');
console.log('Preserved 23 approved products with exact price units; no database writes.');
