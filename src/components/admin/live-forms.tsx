"use client";
import { useActionState, type ReactNode } from "react";
import { signIn, saveDailyProduct, saveMaster, saveEmployeeAccess, saveStoreOperations, type ActionState } from "@/app/admin/actions";
import {priceUnit} from "@/lib/pricing";
import { money } from "@/lib/admin/presentation";
import { formatDateTimeIST } from "@/lib/format";
export function StaffLogin() {
 const [state,action,pending]=useActionState(signIn,{});
 return <form action={action}><fieldset disabled={pending}><label>Work email<input name="email" type="email" autoComplete="username" required maxLength={254}/></label><label>Password<input name="password" type="password" autoComplete="current-password" required maxLength={1024}/></label><button className="admin-button" type="submit">{pending?"Signing in…":"Sign in"}</button></fieldset>{state.error&&<p role="alert">{state.error}</p>}</form>;
}
export type DailyProduct={pricingBasis?:"RAW_WEIGHT"|"NET_WEIGHT"|"UNIT"|"TRAY";priceUnitGrams?:number|null;unitsPerPack?:number|null;id:string;name:string;category:string;pricePaise:number|null;available:boolean;version:number;updatedAt:string;stock?:number|null;stockVersion?:number;stockNeedsRecount?:boolean};
const weighed=(p:DailyProduct)=>p.pricingBasis!=="UNIT"&&p.pricingBasis!=="TRAY";
const stockUnit=(p:DailyProduct)=>weighed(p)?"kg":p.pricingBasis==="TRAY"?"trays":"units";
function DailyRow({product:p}:{product:DailyProduct}) {
 const [state,action,pending]=useActionState(saveDailyProduct,{});
 const formId="price-"+p.id;
 return <tr><td><strong>{p.name}</strong></td><td>{p.category}</td><td>{p.pricePaise===null?"Not set":money(p.pricePaise)} / {priceUnit(p)}</td><td><input form={formId} aria-label={"New price per "+priceUnit(p)+" for "+p.name} name="price" type="number" min="0.01" max="1000000" step="0.01" required defaultValue={p.pricePaise===null?"":p.pricePaise/100}/></td><td><select form={formId} aria-label={"Availability for "+p.name} name="available" defaultValue={String(p.available)}><option value="true">Available</option><option value="false">Sold Out</option></select>{p.available&&p.stock===0&&<p className="admin-muted">Shows Sold out: stock is 0</p>}</td><td><input form={formId} aria-label={"Stock today in "+stockUnit(p)+" for "+p.name} name="stock" type="number" min="0" step={weighed(p)?"0.001":"1"} inputMode={weighed(p)?"decimal":"numeric"} placeholder="Unlimited" defaultValue={p.stock==null?"":weighed(p)?p.stock/1000:p.stock}/> {stockUnit(p)}{p.stockNeedsRecount&&<p role="alert">Unit changed: enter a new count.</p>}</td><td><time dateTime={p.updatedAt}>{formatDateTimeIST(p.updatedAt)}</time></td><td><form id={formId} action={action}><input type="hidden" name="id" value={p.id}/><input type="hidden" name="version" value={p.version}/><input type="hidden" name="stockVersion" value={p.stockVersion??0}/><input type="hidden" name="weighed" value={String(weighed(p))}/><button className="admin-button" disabled={pending}>{pending?"Saving…":"Save"}</button>{state.error&&<p role="alert">{state.error}</p>}{state.success&&<p role="status">{state.success}</p>}</form></td></tr>;
}
export function DailyProducts({products}:{products:DailyProduct[]}) {
 return <div className="admin-table-wrap"><table className="admin-table"><thead><tr>{["Product","Category","Current price / unit","New price / displayed unit","Availability","Stock today (blank = unlimited)","Last Updated","Action"].map(s=><th key={s}>{s}</th>)}</tr></thead><tbody>{products.map(p=><DailyRow key={p.id+":"+p.version+":"+p.stockVersion} product={p}/>)}</tbody></table>{!products.length&&<p>No existing products have been configured for this store.</p>}</div>;
}
export function MutationForm({kind,children}:{kind:"master"|"employee"|"settings";children:ReactNode}) {
 const handler=kind==="master"?saveMaster:kind==="employee"?saveEmployeeAccess:saveStoreOperations;
 const [state,action,pending]=useActionState<ActionState,FormData>(handler,{});
 return <form action={action} className="admin-live-form"><fieldset disabled={pending}>{children}<button className="admin-button">{pending?"Saving…":"Save"}</button></fieldset>{state.error&&<p role="alert">{state.error}</p>}{state.success&&<p role="status">{state.success}</p>}</form>;
}
