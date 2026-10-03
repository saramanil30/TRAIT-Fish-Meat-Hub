/** Shown while a storefront page loads: a heading and product-card skeletons. */
export default function Loading() {
  return <div className="container page-section" aria-busy="true"><p role="status" className="visually-hidden">Loading…</p><div className="skeleton skeleton-title" /><div className="skeleton-grid">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton-card"><div className="skeleton skeleton-image" /><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line short" /><div className="skeleton skeleton-button" /></div>)}</div></div>;
}
