import { getStats } from "@/lib/documents";
import { ollamaStatus } from "@/lib/rag";

export const dynamic = "force-dynamic";

export async function GET() {
  const [ollama, stats] = await Promise.all([ollamaStatus(), Promise.resolve(getStats())]);
  return Response.json({ ollama, stats });
}
