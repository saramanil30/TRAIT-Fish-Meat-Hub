import { Icon } from "@/components/ui/icon";
export function SearchForm({ id, defaultValue = "" }: {
    id: string;
    defaultValue?: string;
}) { return <form action="/search" role="search" className="search-form"><label className="sr-only" htmlFor={id}>Search fish, meat and local names</label><Icon name="search"/><input id={id} name="q" type="search" placeholder="Search fish, meat & more" defaultValue={defaultValue} maxLength={100}/><button type="submit" aria-label="Search products"><Icon name="arrow"/></button></form>; }
