import { ok, errorResponse, readJson } from "@/server/http";
import { getSettings, maskSettings, saveSettings } from "@/server/settings";
import { bootstrap } from "@/server/bootstrap";

export const dynamic = "force-dynamic";

export async function GET() {
  await bootstrap();
  const settings = await getSettings();
  return ok({ settings: maskSettings(settings) });
}

export async function PUT(request: Request) {
  try {
    const body = await readJson<Record<string, unknown>>(request);
    const next = await saveSettings(body);
    return ok({ settings: maskSettings(next) });
  } catch (error) {
    return errorResponse(error);
  }
}
