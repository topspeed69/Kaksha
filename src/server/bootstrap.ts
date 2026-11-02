import { getSettings, seedSettingsFromEnv } from "@/server/settings";
import { resumePendingWork } from "@/server/pipeline/runner";
import { seedFixtureCourse } from "@/server/fixture";

const globalBoot = globalThis as typeof globalThis & {
  __kakshaBooted?: Promise<void>;
};

/**
 * Runs once per process: seeds the reference course so a fresh install has
 * something to play, and picks up generation work interrupted by a restart.
 */
export function bootstrap(): Promise<void> {
  if (!globalBoot.__kakshaBooted) {
    globalBoot.__kakshaBooted = (async () => {
      try {
        await seedSettingsFromEnv();
        await getSettings();
        await seedFixtureCourse();
        await resumePendingWork();
      } catch (error) {
        globalBoot.__kakshaBooted = undefined;
        console.error("[kaksha] bootstrap failed", (error as Error).message);
      }
    })();
  }
  return globalBoot.__kakshaBooted;
}
