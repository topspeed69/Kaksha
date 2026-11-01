import { getSettings } from "@/server/settings";
import { resumePendingWork } from "@/server/pipeline/runner";
import { seedFixtureCourse } from "@/server/fixture";

const globalBoot = globalThis as typeof globalThis & {
  __lumenBooted?: Promise<void>;
};

/**
 * Runs once per process: seeds the reference course so a fresh install has
 * something to play, and picks up generation work interrupted by a restart.
 */
export function bootstrap(): Promise<void> {
  if (!globalBoot.__lumenBooted) {
    globalBoot.__lumenBooted = (async () => {
      try {
        await getSettings();
        await seedFixtureCourse();
        await resumePendingWork();
      } catch (error) {
        globalBoot.__lumenBooted = undefined;
        console.error("[lumen] bootstrap failed", (error as Error).message);
      }
    })();
  }
  return globalBoot.__lumenBooted;
}
