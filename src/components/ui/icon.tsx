import type { SVGProps } from "react";
export type IconName = "search" | "bag" | "home" | "orders" | "arrow" | "leaf" | "cut" | "truck" | "fish";
const paths: Record<IconName, string> = {
    search: "m21 21-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
    bag: "M5 7h14l1 14H4L5 7Z M9 8V5a3 3 0 0 1 6 0v3",
    home: "m3 10 9-7 9 7 M5 9v12h5v-7h4v7h5V9",
    orders: "M6 3h12v18H6z M9 7h6 M9 11h6 M9 15h4",
    arrow: "M4 12h16 m-6-6 6 6-6 6",
    leaf: "M20 3C8 2 2 8 5 16c8 5 16-1 15-13Z M4 21 15 9",
    cut: "m8 9 12 12 M8 15 20 3 M9 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
    truck: "M2 5h12v12H2z M14 9h4l4 5v3h-8 M8 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0 M20 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0",
    fish: "M3 12c5-9 13-9 17 0-4 9-12 9-17 0Z M3 12 1 7v10l2-5 M15 10h.01",
};
export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & {
    name: IconName;
}) { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name]}/></svg>; }
