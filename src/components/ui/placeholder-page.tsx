import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/icon";
export function PlaceholderPage({ title, description, icon = "bag" }: {
    title: string;
    description: string;
    icon?: IconName;
}) { return <section className="container placeholder"><span className="placeholder-icon"><Icon name={icon} width={32} height={32}/></span><p className="eyebrow">A little more to come</p><h1>{title}</h1><p>{description}</p><Link href="/" className="button primary">Explore the collection <Icon name="arrow"/></Link></section>; }
