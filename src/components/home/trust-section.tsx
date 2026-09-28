import { Icon, type IconName } from "@/components/ui/icon";
const values: { icon: IconName; title: string; description: string }[] = [
  { icon: "fish", title: "Find your favourite", description: "Browse fish, seafood, chicken and mutton in one place." },
  { icon: "cut", title: "Prepared your way", description: "Choose from the preparations available for each product." },
  { icon: "bag", title: "Clear raw-weight pricing", description: "See what you pay for your selected raw weight, before cleaning." },
  { icon: "truck", title: "Delivery or pickup", description: "Choose an available option at checkout." },
];
export function TrustSection() {
  return <section className="trust-section" aria-labelledby="trust-title"><div className="container"><div className="trust-heading"><p className="eyebrow">The TRAIT approach</p><h2 id="trust-title">Good food starts with your choice</h2><p className="muted">A simpler way to plan your next meal.</p></div><div className="trust-grid">{values.map(value => <div className="trust-item" key={value.title}><span className="trust-icon"><Icon name={value.icon} /></span><h3>{value.title}</h3><p>{value.description}</p></div>)}</div></div></section>;
}
