import { adminRoute,json } from "../_utils";
import { getSpace } from "@/lib/maintenance";
export const dynamic="force-dynamic";
export async function GET() { return adminRoute(async()=>json(await getSpace())); }
