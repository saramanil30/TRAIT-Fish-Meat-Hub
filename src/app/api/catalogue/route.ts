import { liveCatalogue } from "@/lib/live-catalogue";
export async function GET() {
 try {return Response.json(await liveCatalogue(),{headers:{"Cache-Control":"no-store"}});}
 catch {return Response.json({error:"Catalogue temporarily unavailable."},{status:503});}
}
