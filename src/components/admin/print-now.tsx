"use client";
/** Opens the browser's print dialog for the tickets on this page. */
export function PrintNow({ count }: { count: number }) {
 return <button type="button" className="admin-button" disabled={!count} onClick={() => window.print()}>Print {count} ticket{count === 1 ? "" : "s"}</button>;
}
