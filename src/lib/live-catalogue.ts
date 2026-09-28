import "server-only";
import { publicRpc } from "./supabase";
import type { Product } from "@/types/catalog";
type Category = { id:string; parentId:string|null; name:string };
type Row = { id:string; name:string; localName?:string; description:string; categoryId:string; pricePerKgPaise:number; available:boolean; images:{assetPath?:string;alt:string;bucket?:string;objectPath?:string}[]; weightsGrams:number[]; preparations:{id:string;name:string;cleaningLossPercent:number|null}[] };
export async function liveCatalogue(): Promise<Product[]> {
 const store=process.env.TRAIT_STORE_ID;
 if (!store) return [];
 const data=await publicRpc<{categories:Category[];products:Row[]}>("catalogue",{target_store:store});
 return data.products.map(p=>{
  let category=data.categories.find(c=>c.id===p.categoryId); const visited=new Set<string>();
  while(category?.parentId&&!visited.has(category.id)){visited.add(category.id);category=data.categories.find(c=>c.id===category!.parentId)??category;}
  const image=p.images.find(i=>(i.assetPath?.startsWith("/")&&!i.assetPath.startsWith("//"))||(i.bucket==="product-images"&&i.objectPath));
  const imageUrl=image?.assetPath ?? (image?.bucket&&image.objectPath ? process.env.SUPABASE_URL+"/storage/v1/object/public/product-images/"+image.objectPath.split("/").map(encodeURIComponent).join("/") : "/trait-logo.jpeg");
  return {id:p.id,name:p.name,localName:p.localName,category:(category?.name??"Other").toLowerCase(),pricePerKg:Number(p.pricePerKgPaise)/100,available:p.available,image:imageUrl,imageAlt:image?.alt??p.name,cut:p.description??"",selectableWeightsGrams:p.weightsGrams,preparationOptions:p.preparations.map(x=>({id:x.id,label:x.name,removesCleaningWaste:x.cleaningLossPercent!==null,cleaningLossPercent:x.cleaningLossPercent===null?undefined:Number(x.cleaningLossPercent)}))};
 });
}
