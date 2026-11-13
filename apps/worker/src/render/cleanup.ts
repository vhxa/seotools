/** Cleanup must neither replace an outcome nor prevent the remaining cleanup steps. */
export async function bestEffort(cleanup: () => unknown): Promise<void> {
  try {
    await cleanup()
  } catch {
    // A target/session/connection may already have disappeared after a crash.
  }
}
