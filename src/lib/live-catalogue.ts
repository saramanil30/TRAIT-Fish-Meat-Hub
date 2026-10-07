import "server-only";
import { publicRpc } from "./supabase";
import type { Product } from "@/types/catalog";
type Category = { id:string; parentId:string|null; name:string };
type Row = { pricingBasis?:Product["pricingBasis"];pricePaise?:number;priceUnitGrams?:number|null;unitsPerPack?:number|null;saleQuantities?:number[];orderable?:boolean;stockLeft?:number|null; id:string; name:string; localName?:string; description:string; categoryId:string; pricePerKgPaise:number; available:boolean; images:{assetPath?:string;alt:string;bucket?:string;objectPath?:string}[]; weightsGrams:number[]; preparations:{id:string;name:string;cleaningLossPercent:number|null}[] };
export async function liveCatalogue(): Promise<Product[]> {
 const store=process.env.TRAIT_STORE_ID;
 const business=process.env.TRAIT_BUSINESS_ID;
 if (!store&&!business) return [];
 const data=await publicRpc<{categories:Category[];products:Row[]}>(store?"catalogue":"business_catalogue",store?{target_store:store}:{target_business:business});
 return (data?.products??[]).map(p=>{
  let category=data.categories.find(c=>c.id===p.categoryId); const visited=new Set<string>();
  while(category?.parentId&&!visited.has(category.id)){visited.add(category.id);category=data.categories.find(c=>c.id===category!.parentId)??category;}
  const image=p.images.find(i=>(i.assetPath?.startsWith("/")&&!i.assetPath.startsWith("//"))||(i.bucket==="product-images"&&i.objectPath));
  const categoryName=(category?.name??"Other").toLowerCase();
  // Products without a verified photo get a neutral placeholder, never another product's image.
  const placeholder=categoryName==="eggs"?"/assets/catalogue/placeholder-eggs.svg":"/assets/catalogue/placeholder-fish.svg";
  const imageUrl=image?.assetPath ?? (image?.bucket&&image.objectPath ? process.env.SUPABASE_URL+"/storage/v1/object/public/product-images/"+image.objectPath.split("/").map(encodeURIComponent).join("/") : placeholder);
  return {pricingBasis:p.pricingBasis,pricePaise:Number(p.pricePaise??p.pricePerKgPaise),priceUnitGrams:p.priceUnitGrams,unitsPerPack:p.unitsPerPack,saleQuantities:p.saleQuantities,orderable:p.orderable,id:p.id,name:p.name,localName:p.localName,category:categoryName,pricePerKg:Number(p.pricePerKgPaise)/100,available:p.available,stockLeft:p.stockLeft??null,image:imageUrl,imageAlt:image?(image.alt||p.name):"Photo coming soon: "+p.name,cut:p.description??"",selectableWeightsGrams:p.weightsGrams??[],preparationOptions:p.preparations.map(x=>({id:x.id,label:x.name,removesCleaningWaste:x.cleaningLossPercent!==null,cleaningLossPercent:x.cleaningLossPercent===null?undefined:Number(x.cleaningLossPercent)}))};
 });
}
/** Each product's category and its ancestors, as checkout's offer rule walks them. */
export async function productCategoryChains(): Promise<Record<string,string[]>> {
 const store=process.env.TRAIT_STORE_ID;
 if (!store) return {};
 const data=await publicRpc<{categories:Category[];products:Row[]}>("catalogue",{target_store:store});
 return Object.fromEntries((data?.products??[]).map(p=>{
  const chain:string[]=[]; let id:string|null=p.categoryId;
  while(id&&!chain.includes(id)){chain.push(id);id=data.categories.find(c=>c.id===id)?.parentId??null;}
  return [p.id,chain];
 }));
}
