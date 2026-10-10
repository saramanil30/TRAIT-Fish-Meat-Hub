import { staffRpc } from "@/lib/admin/server";
import { slotRange, slotTime } from "@/lib/delivery-slots";
import { OperationalForm } from "./operational-form";
type Slot={id:string;name:string;startsAt:string;endsAt:string;cutoffAt:string;maxOrders:number;active:boolean;version:number};
/** Settings → Delivery slots (ADMIN and OWNER). Times are India time; the cutoff is the last moment to order for the same day. */
export async function DeliverySlotSettings({token,store}:{token:string;store?:string}){
 if(!store)return null;
 const slots=await staffRpc<Slot[]>(token,"delivery_slots",{target_store:store}).catch(()=>null);
 if(!slots)return <section><h2>Delivery slots</h2><p>Unavailable. Apply the delivery slots database migration, then reload.</p></section>;
 return <section className="slot-settings"><h2>Delivery slots</h2>
  <p className="admin-muted">Customers choose today or the next two days, then a slot. Same-day orders close at the cutoff; a full slot cannot be chosen. Set a slot Inactive to stop offering it. With no active slots, checkout asks for no time.</p>
  {[null,...slots].map(s=><details key={s?.id??"new"}><summary>{s?<>{s.name} · {slotRange(s.startsAt,s.endsAt)} · order by {slotTime(s.cutoffAt)} · max {s.maxOrders}{!s.active&&" (inactive)"}</>:"Add delivery slot"}</summary>
   <OperationalForm operation="slot" id={s?.id} version={s?.version??0}><input name="store" type="hidden" value={store}/>
    <label>Name<input name="name" required maxLength={40} defaultValue={s?.name} placeholder="Morning"/></label>
    <label>Starts<input name="starts" type="time" required defaultValue={s?.startsAt??"07:00"}/></label>
    <label>Ends<input name="ends" type="time" required defaultValue={s?.endsAt??"11:00"}/></label>
    <label>Same-day cutoff<input name="cutoff" type="time" required defaultValue={s?.cutoffAt??"09:00"}/><small className="admin-muted">Before the end time.</small></label>
    <label>Max orders<input name="max" type="number" min="1" max="1000" step="1" inputMode="numeric" required defaultValue={s?.maxOrders??20}/></label>
    <label>Status<select name="active" defaultValue={String(s?.active??true)}><option value="true">Active</option><option value="false">Inactive</option></select></label>
   </OperationalForm></details>)}
 </section>;
}
