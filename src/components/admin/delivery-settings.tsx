import { staffRpc } from "@/lib/admin/server";
import { OperationalForm } from "./operational-form";
type Area={id:string;pincode:string;name:string;delivery_fee_paise:number;minimum_order_paise:number;is_active:boolean;version:number};
export async function DeliverySettings({token,store}:{token:string;store?:string}){
 if(!store)return null;
 const areas=await staffRpc<Area[]>(token,"delivery_areas",{target_store:store});
 return <section><h2>Delivery areas</h2>{[null,...areas].map(a=><details key={a?.id??"new"}><summary>{a?.pincode??"Add delivery area"}</summary><OperationalForm operation="delivery" id={a?.id} version={Number(a?.version??0)}><input name="store" type="hidden" value={store}/><label>Pincode<input name="pincode" pattern="[1-9][0-9]{5}" required defaultValue={a?.pincode}/></label><label>Area name<input name="name" required defaultValue={a?.name}/></label><label>Delivery charge (paise)<input type="number" name="fee" min="0" required defaultValue={a?.delivery_fee_paise}/></label><label>Minimum order (paise)<input type="number" name="minimum" min="0" required defaultValue={a?.minimum_order_paise}/></label><label>Status<select name="active" defaultValue={String(a?.is_active??true)}><option value="true">Active</option><option value="false">Inactive</option></select></label></OperationalForm></details>)}</section>;
}
