import Link from "next/link";
import { staffRpc, type StaffContext } from "@/lib/admin/server";
import { formatDateTimeIST, formatMoney, formatWeight } from "@/lib/format";
import { AutoRefresh } from "./auto-refresh";
import { badge, statusText } from "./operations";
import { slotDate, slotDayName, slotRange } from "@/lib/delivery-slots";
type Totals={orders:number;revenuePaise:number;averagePaise:number;collectedPaise:number;cashCollectedPaise:number;pendingPaise:number};
/** Today's slot (id null = orders placed today without a slot). */
type Slot={id:string|null;name:string|null;startsAt:string|null;endsAt:string|null;maxOrders:number|null;booked:number;delivery:number;pickup:number;open:number};
type Prep={name:string;pricingBasis:string|null;unitsPerPack:number|null;quantity:number};
type Scheduled={date:string;slotId:string;name:string;startsAt:string;endsAt:string;orders:number;delivery:number;pickup:number;products:Prep[]};
type Dashboard={today?:string;needsAction:Record<string,number>;slots:Slot[];scheduled?:Scheduled[];summary?:{current:Totals;previous:Totals};
 lowStock?:{name:string;onHand:number;measure:"GRAMS"|"PACKS";pricingBasis:string}[];topProducts?:{name:string;orders:number;revenuePaise:number}[];
 recentOrders?:{id:string;order_number:string;status:string;fulfillment_method:string;total_paise:number;created_at:string;customer:string|null}[]};
export const dashboardPeriods=["today","yesterday","7d","30d"] as const;
type Period=typeof dashboardPeriods[number];
const periodText:Record<Period,{label:string;versus:string}>={today:{label:"Today",versus:"vs same time yesterday"},yesterday:{label:"Yesterday",versus:"vs the day before"},"7d":{label:"7 days",versus:"vs previous 7 days"},"30d":{label:"30 days",versus:"vs previous 30 days"}};
const openStatuses=["PLACED","CONFIRMED","PREPARING","READY","OUT_FOR_DELIVERY"];
/** What to prepare: weight for weighed items, else trays / units. */
const prepText=(p:Prep)=>{const n=Number(p.quantity);return p.pricingBasis==="TRAY"?n+" tray"+(n===1?"":"s"):p.pricingBasis==="UNIT"?n+" unit"+(n===1?"":"s"):formatWeight(n);};
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
 const slots=d.slots.filter(s=>"booked" in s),scheduled=d.scheduled??[];
 const days=[...new Set(scheduled.map(s=>s.date))];
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
   <section className="dash-panel"><h2>Today&apos;s slots</h2>
    {slots.length?<table className="dash-table dash-slots"><thead><tr><th scope="col">Slot</th><th scope="col">Booked</th><th scope="col">Delivery</th><th scope="col">Pickup</th><th scope="col">Open</th></tr></thead>
    <tbody>{slots.map(s=><tr key={s.id??"none"}><th scope="row"><Link href={ordersLink("&day="+(d.today??"")+(s.id?"&slot="+s.id:""))}>{s.id?<>{s.name} <small>{slotRange(s.startsAt!,s.endsAt!)}</small></>:<>No slot <small>placed today</small></>}</Link></th>
     <td className={s.maxOrders!==null&&Number(s.booked)>=s.maxOrders?"dash-sold-out":undefined}>{s.booked}{s.maxOrders!==null&&<small>/{s.maxOrders}</small>}</td><td>{s.delivery}</td><td>{s.pickup}</td><td>{s.open}</td></tr>)}</tbody></table>
    :<p className="dash-muted">No delivery slots set up. Add them in Settings.</p>}
    <p className="dash-muted">Cancelled orders are not counted. Tap a slot to see its orders.</p>
   </section>
   <section className="dash-panel dash-wide"><h2>Scheduled orders <span className="dash-count">{scheduled.reduce((n,s)=>n+Number(s.orders),0)}</span></h2>
    {days.length?days.map(day=><div key={day} className="dash-sched-day"><h3>{slotDayName(day,d.today)}, {slotDate(day)}</h3>
     <ul className="dash-sched">{scheduled.filter(s=>s.date===day).map(s=><li key={s.slotId}><Link href={ordersLink("&day="+day+"&slot="+s.slotId)}>
      <span className="dash-sched-head"><strong>{s.name} <small>{slotRange(s.startsAt,s.endsAt)}</small></strong><span>{s.orders} order{Number(s.orders)===1?"":"s"} · {s.delivery} delivery · {s.pickup} pickup</span></span>
      <span className="dash-sched-prep">{s.products.map(p=><span key={p.name+p.pricingBasis}>{p.name} <strong>{prepText(p)}</strong></span>)}</span>
     </Link></li>)}</ul></div>)
    :<p className="dash-muted">No orders for later days yet.</p>}
    <p className="dash-muted">Orders for later days, by slot, with the total to prepare. They don&apos;t reserve today&apos;s stock.</p>
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
