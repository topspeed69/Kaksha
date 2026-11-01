import { sql } from "drizzle-orm";
import { db } from "@/db";
import { ok } from "@/server/http";
import { bootstrap } from "@/server/bootstrap";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    await bootstrap();
    return ok({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
