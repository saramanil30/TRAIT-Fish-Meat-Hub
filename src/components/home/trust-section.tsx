import { Icon, type IconName } from "@/components/ui/icon";
const values: {
    icon: IconName;
    title: string;
    description: string;
}[] = [{ icon: "leaf", title: "Freshly Sourced", description: "Fresh ingredients at the heart of every good meal." }, { icon: "cut", title: "Cleaned Your Way", description: "The cuts you love, for the dishes you make." }, { icon: "truck", title: "Home Delivery", description: "From our counter to your kitchen. Coming soon." }];
export function TrustSection() { return <section className="trust-section" aria-label="The TRAIT approach"><div className="container trust-grid">{values.map(value => <div className="trust-item" key={value.title}><span className="trust-icon"><Icon name={value.icon}/></span><div><h3>{value.title}</h3><p>{value.description}</p></div></div>)}</div></section>; }
