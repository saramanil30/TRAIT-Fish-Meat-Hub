import { staffRpc } from "@/lib/admin/server";
import { formatDateTimeIST, formatMoney } from "@/lib/format";
type Customer={id:string;name:string|null;mobile:string;orders:number;spentPaise:number;lastOrderAt:string;addresses:{label:string|null;text:string}[]};
/** ADMIN/OWNER: customers who ordered at this store, last order first. Spend excludes cancelled orders. */
export async function CustomerList({token,store}:{token:string;store?:string}){
 if(!store) return <p>No accessible stores.</p>;
 const customers=await staffRpc<Customer[]>(token,"store_customers",{target_store:store});
 return <section><p className="admin-muted">Saved from every order by mobile number. Spent excludes cancelled orders.</p><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th scope="col">Customer</th><th scope="col">Addresses</th><th scope="col">Orders</th><th scope="col">Spent</th><th scope="col">Last order</th></tr></thead>
 <tbody>{customers.map(c=><tr key={c.id}><td><strong>{c.name??"—"}</strong><small><a href={"tel:"+c.mobile}>{c.mobile}</a></small></td><td>{c.addresses.length?c.addresses.map((a,i)=><small key={i}>{a.label?a.label+" · ":""}{a.text}</small>):<small>Pickup only</small>}</td><td>{c.orders}</td><td>{formatMoney(Number(c.spentPaise))}</td><td>{formatDateTimeIST(c.lastOrderAt)}</td></tr>)}</tbody></table>
 {!customers.length&&<div className="admin-empty">No customers yet.</div>}</div></section>;
}
