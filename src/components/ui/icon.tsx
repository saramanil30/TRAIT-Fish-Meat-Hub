import type { SVGProps } from "react";
export type IconName = "search" | "bag" | "home" | "orders" | "arrow" | "leaf" | "cut" | "truck" | "fish" | "cart" | "box" | "instagram" | "facebook" | "pin" | "shield" | "card" | "drop" | "medal" | "clock" | "chevronLeft" | "chevronRight";
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
    cart: "M2 3h3l2.6 12.2a1 1 0 0 0 1 .8h9.7a1 1 0 0 0 1-.8L21 7H6 M10 20a1 1 0 1 1-2 0 1 1 0 0 1 2 0 M19 20a1 1 0 1 1-2 0 1 1 0 0 1 2 0",
    box: "M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9Z M3 7.5l9 4.5 9-4.5 M12 12v9",
    instagram: "M7.5 3h9A4.5 4.5 0 0 1 21 7.5v9a4.5 4.5 0 0 1-4.5 4.5h-9A4.5 4.5 0 0 1 3 16.5v-9A4.5 4.5 0 0 1 7.5 3Z M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M17.5 6.5h.01",
    facebook: "M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4Z M15.5 7.5H14a2.5 2.5 0 0 0-2.5 2.5v11 M9 13h6",
    pin: "M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z M14.5 9.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0",
    shield: "M12 3 4.5 6v5.5c0 4.7 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.8 7.5-9.5V6L12 3Z m-3.5 9 2.5 2.5 4.5-5",
    card: "M3 6h18v12H3z M3 10h18 M7 14.5h4",
    drop: "M12 3s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11Z M9.5 14.5a2.5 2.5 0 0 0 2.5 2.5",
    medal: "M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z M8.6 13.9 7 21l5-2.8 5 2.8-1.6-7.1 M12 6.5l1 2 2.2.3-1.6 1.5.4 2.2-2-1-2 1 .4-2.2-1.6-1.5 2.2-.3 1-2Z",
    clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 7v5l3.5 2",
    chevronLeft: "m15 5-7 7 7 7",
    chevronRight: "m9 5 7 7-7 7",
};
export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & {
    name: IconName;
}) { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name]}/></svg>; }
