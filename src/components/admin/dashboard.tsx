import Link from "next/link";
import { staffRpc, type StaffContext } from "@/lib/admin/server";
import { formatDateTimeIST, formatMoney, formatWeight } from "@/lib/format";
import { AutoRefresh } from "./auto-refresh";
import { badge, statusText } from "./operations";
type Totals={orders:number;revenuePaise:number;averagePaise:number;collectedPaise:number;cashCollectedPaise:number;pendingPaise:number};
type Slot={slot:"MORNING"|"AFTERNOON"|"EVENING";delivery:number;pickup:number;open:number};
type Dashboard={needsAction:Record<string,number>;slots:Slot[];summary?:{current:Totals;previous:Totals};
 lowStock?:{name:string;onHand:number;measure:"GRAMS"|"PACKS";pricingBasis:string}[];topProducts?:{name:string;orders:number;revenuePaise:number}[];
 recentOrders?:{id:string;order_number:string;status:string;fulfillment_method:string;total_paise:number;created_at:string;customer:string|null}[]};
export const dashboardPeriods=["today","yesterday","7d","30d"] as const;
type Period=typeof dashboardPeriods[number];
const periodText:Record<Period,{label:string;versus:string}>={today:{label:"Today",versus:"vs same time yesterday"},yesterday:{label:"Yesterday",versus:"vs the day before"},"7d":{label:"7 days",versus:"vs previous 7 days"},"30d":{label:"30 days",versus:"vs previous 30 days"}};
const openStatuses=["PLACED","CONFIRMED","PREPARING","READY","OUT_FOR_DELIVERY"];
const slotText:Record<Slot["slot"],string>={MORNING:"Morning · before 12 pm",AFTERNOON:"Afternoon · 12–4 pm",EVENING:"Evening · after 4 pm"};
const stockText=(s:NonNullable<Dashboard["lowStock"]>[number])=>s.onHand===0?"Sold out":s.measure==="GRAMS"?formatWeight(s.onHand)+" left":s.onHand+" "+(s.pricingBasis==="TRAY"?"tray":"unit")+(s.onHand===1?"":"s")+" left";
/** "▲ 12%" against the previous period; pending money going up is bad, so its colours flip. */
function Change({now,before,inverse=false}:{now:number;before:number;inverse?:boolean}){
 if(now===before)return <small className="dash-change">No change</small>;
 if(!before)return <small className="dash-change">New</small>;
 const pct=Math.round((now-before)/before*100),up=now>before;
 return <small className={"dash-change "+(up!==inverse?"is-good":"is-bad")}>{up?"▲":"▼"} {Math.abs(pct)}%</small>;
}
export async function StaffDashboard({token,context,store,period:requested}:{token:string;context:StaffContext;store?:string;period?:string}){
 if(!store)return <p>No accessible stores.</p>;
 const period:Period=dashboardPeriods.includes(requested as Period)?requested as Period:"today";
 const base="/admin/"+context.role.toLowerCase();
 const ordersLink=(extra="")=>base+"/orders?store="+store+extra;
 let d:Dashboard;
 try {d=await staffRpc<Dashboard>(token,"admin_dashboard",{target_store:store,period});}
 catch {return <><AutoRefresh/><p role="alert">The dashboard is unavailable right now. It refreshes every minute; <Link href={ordersLink()}>open Orders</Link> meanwhile.</p></>;}
 const money=!!d.summary;
 const waiting=openStatuses.reduce((sum,s)=>sum+Number(d.needsAction[s]??0),0);
 const cur=d.summary?.current,prev=d.summary?.previous;
 const cards=cur&&prev?[
  {label:"Orders",value:String(cur.orders),now:cur.orders,before:prev.orders},
  {label:"Revenue",value:formatMoney(Number(cur.revenuePaise)),now:Number(cur.revenuePaise),before:Number(prev.revenuePaise),note:"Excludes cancelled"},
  {label:"Average order",value:formatMoney(Number(cur.averagePaise)),now:Number(cur.averagePaise),before:Number(prev.averagePaise)},
  {label:"Collected",value:formatMoney(Number(cur.collectedPaise)),now:Number(cur.collectedPaise),before:Number(prev.collectedPaise),note:"Cash "+formatMoney(Number(cur.cashCollectedPaise))},
  {label:"Pending",value:formatMoney(Number(cur.pendingPaise)),now:Number(cur.pendingPaise),before:Number(prev.pendingPaise),inverse:true,note:"Not yet paid"},
 ]:[];
 return <div className="dash">
  <AutoRefresh/>
  {money&&<nav aria-label="Period" className="dash-periods">{dashboardPeriods.map(p=><Link key={p} href={base+"/dashboard?store="+store+"&period="+p} aria-current={p===period?"page":undefined}>{periodText[p].label}</Link>)}</nav>}
  {money&&<section aria-labelledby="dash-cards"><h2 id="dash-cards" className="dash-visually-hidden">{periodText[period].label} summary</h2><div className="dash-cards">{cards.map(c=><div key={c.label} className="dash-card"><span>{c.label}</span><strong>{c.value}</strong><Change now={c.now} before={c.before} inverse={c.inverse}/>{c.note&&<small>{c.note}</small>}</div>)}</div><p className="dash-muted">Orders placed in this period (India time), {periodText[period].versus}.</p></section>}
  <div className="dash-grid">
   <section className="dash-panel"><h2>Needs action <span className="dash-count">{waiting}</span></h2>
    <ul className="dash-status">{openStatuses.map(s=><li key={s}><Link href={ordersLink("&status="+s)}><span className={badge(s)}>{statusText[s]}</span><strong>{Number(d.needsAction[s]??0)}</strong></Link></li>)}</ul>
   </section>
   <section className="dash-panel"><h2>Today&apos;s orders by time</h2>
    <table className="dash-table"><thead><tr><th scope="col">Slot</th><th scope="col">Delivery</th><th scope="col">Pickup</th><th scope="col">Still open</th></tr></thead>
    <tbody>{d.slots.map(s=><tr key={s.slot}><th scope="row">{slotText[s.slot]}</th><td>{s.delivery}</td><td>{s.pickup}</td><td>{s.open}</td></tr>)}</tbody></table>
    <p className="dash-muted">By order time; cancelled orders are not counted.</p>
   </section>
   {money&&<>
    <section className="dash-panel"><h2>Low stock</h2>
     {d.lowStock?.length?<ul className="dash-list">{d.lowStock.map(s=><li key={s.name}><span>{s.name}</span><strong className={s.onHand===0?"dash-sold-out":undefined}>{stockText(s)}</strong></li>)}</ul>:<p className="dash-muted">Nothing at 2 kg / 2 packs or below.</p>}
     <Link className="dash-more" href={base+"/prices?store="+store}>Update stock</Link>
    </section>
    <section className="dash-panel"><h2>Top products · {periodText[period].label}</h2>
     {d.topProducts?.length?<ol className="dash-list">{d.topProducts.map(p=><li key={p.name}><span>{p.name} <small>{p.orders} order{p.orders===1?"":"s"}</small></span><strong>{formatMoney(Number(p.revenuePaise))}</strong></li>)}</ol>:<p className="dash-muted">No sales in this period.</p>}
    </section>
    <section className="dash-panel dash-wide"><h2>Latest orders</h2>
     {d.recentOrders?.length?<ul className="dash-list dash-orders">{d.recentOrders.map(o=><li key={o.id}><Link href={ordersLink("&order="+o.id)}><span><strong>{o.order_number}</strong> <small>{o.customer||"Customer"} · {o.fulfillment_method==="STORE_PICKUP"?"Pickup":"Delivery"} · {formatDateTimeIST(o.created_at)}</small></span><span className={badge(o.status)}>{o.status==="DELIVERED"&&o.fulfillment_method==="STORE_PICKUP"?"Picked up":statusText[o.status]??o.status}</span><strong>{formatMoney(Number(o.total_paise))}</strong></Link></li>)}</ul>:<p className="dash-muted">No orders yet.</p>}
     <Link className="dash-more" href={ordersLink()}>View all orders</Link>
    </section>
   </>}
  </div>
  <p className="dash-muted">Updates every minute.</p>
 </div>;
}
