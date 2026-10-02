import type { Product, SalePricing } from "../types/catalog";
import { formatMoney, formatWeight } from "./format";
export function isRaw(p: SalePricing) { return !p.pricingBasis || p.pricingBasis === 'RAW_WEIGHT'; }
export function quantityLabel(p: SalePricing) { return isRaw(p) ? 'Quantity (before cleaning)' : p.pricingBasis === 'NET_WEIGHT' ? 'NET weight' : p.pricingBasis === 'TRAY' ? 'Trays' : 'Units'; }
export function priceUnit(p: SalePricing) { return isRaw(p) ? 'kg' : p.pricingBasis === 'NET_WEIGHT' ? formatWeight(p.priceUnitGrams ?? 0)+' NET weight' : p.pricingBasis === 'TRAY' ? 'tray ('+p.unitsPerPack+' eggs)' : 'unit'; }
export function priceLabel(p: SalePricing & {pricePerKg: number}) { return formatMoney(p.pricePaise ?? Math.round(p.pricePerKg*100))+' / '+priceUnit(p); }
export function quantityOptions(p: Product) { return isRaw(p) ? p.selectableWeightsGrams : p.saleQuantities ?? []; }
/** Short card line without repeated words: "500 g · 1 kg (before cleaning)", "500 g · 1 kg (net)", "1 · 2 trays (30 eggs each)". */
export function cardQuantityLine(p: Product) {
 const q = quantityOptions(p);
 const plural = (one: string, many: string) => q.length === 1 && q[0] === 1 ? one : many;
 if (isRaw(p)) return q.map(formatWeight).join(' · ') + ' (before cleaning)';
 if (p.pricingBasis === 'NET_WEIGHT') return q.map(formatWeight).join(' · ') + ' (net)';
 if (p.pricingBasis === 'TRAY') return q.join(' · ') + ' ' + plural('tray', 'trays') + ' (' + p.unitsPerPack + ' eggs each)';
 return q.join(' · ') + ' ' + plural('unit', 'units');
}
export function quantityText(p: SalePricing, q: number) { return isRaw(p) ? formatWeight(q)+' raw' : p.pricingBasis === 'NET_WEIGHT' ? formatWeight(q)+' NET' : q+' '+(p.pricingBasis === 'TRAY' ? (q===1?'tray':'trays')+' ('+q*(p.unitsPerPack??0)+' eggs)' : (q===1?'unit':'units')); }
export function saleTotal(p: SalePricing & {pricePerKg:number}, q: number) {
 const price=p.pricePaise ?? Math.round(p.pricePerKg*100);
 if(!Number.isSafeInteger(q)||q<1||!Number.isSafeInteger(price)||price<1)throw new Error('Invalid quantity or price.');
 const denominator=isRaw(p)?1000:p.pricingBasis==='NET_WEIGHT'?p.priceUnitGrams:1;
 if(!denominator||!Number.isSafeInteger(denominator)||denominator<1)throw new Error('Invalid price unit.');
 const total=Math.round(price*q/denominator);
 if(!Number.isSafeInteger(total))throw new Error('Quantity too large.');
 return total;
}
