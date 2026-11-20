import { isAdmin } from "@/lib/auth";
import { calculatePending,validCron } from "@/lib/maintenance";
import { json,failure } from "../../_utils";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export const maxDuration=300;
export async function POST(request:Request) {
  if (!validCron(request) && !await isAdmin()) return json({error:"No autorizado."},401);
  try { return json(await calculatePending({signal:request.signal})); }
  catch(error) { return failure(error,"No pudimos calcular los vectores pendientes."); }
}
