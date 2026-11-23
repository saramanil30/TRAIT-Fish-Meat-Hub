import Image from "next/image";
import type { HeaderBrand } from "@/lib/brand-image";
/** Settings → Header logo, shared by the header, checkout header and footer: the wide logo above 700 px and the square
 *  icon below, each replaced by `builtIn` (the built-in logo) when that logo isn't saved. */
export function BrandLogos({ brand = {}, builtIn, preload = false }: { brand?: HeaderBrand; builtIn: React.ReactNode; preload?: boolean }) {
  if (!brand.desktop && !brand.mobile) return <>{builtIn}</>;
  return <>
    <span className="brand-desktop">{brand.desktop ? <Image className="brand-logo-wide" src={brand.desktop.url} alt="TRAIT Fish & Meat Hub" width={brand.desktop.width} height={brand.desktop.height} unoptimized preload={preload} /> : builtIn}</span>
    <span className="brand-mobile">{brand.mobile ? <Image className="brand-logo-icon" src={brand.mobile} alt="TRAIT Fish & Meat Hub" width={512} height={512} unoptimized /> : builtIn}</span>
  </>;
}
