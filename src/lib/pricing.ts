import type { Product, SalePricing } from "../types/catalog";
import { formatMoney, formatWeight } from "./format";
export function isRaw(p: SalePricing) { return !p.pricingBasis || p.pricingBasis === 'RAW_WEIGHT'; }
export function quantityLabel(p: SalePricing) { return isRaw(p) ? 'Quantity (before cleaning)' : p.pricingBasis === 'NET_WEIGHT' ? 'NET weight' : p.pricingBasis === 'TRAY' ? 'Trays' : 'Units'; }
export function priceUnit(p: SalePricing) { return isRaw(p) ? 'kg' : p.pricingBasis === 'NET_WEIGHT' ? formatWeight(p.priceUnitGrams ?? 0)+' NET weight' : p.pricingBasis === 'TRAY' ? 'tray ('+p.unitsPerPack+' eggs)' : 'unit'; }
export function priceLabel(p: SalePricing & {pricePerKg: number}) { return formatMoney(p.pricePaise ?? Math.round(p.pricePerKg*100))+' / '+priceUnit(p); }
export function quantityOptions(p: Product) { return isRaw(p) ? p.selectableWeightsGrams : p.saleQuantities ?? []; }
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
