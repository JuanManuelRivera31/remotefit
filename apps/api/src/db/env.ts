// Loads the repo-root .env into process.env when it exists (Node built-in; real env vars win).
export function loadEnv(): void {
  try {
    process.loadEnvFile(new URL("../../../../.env", import.meta.url));
  } catch {
    // No .env file: rely on the real environment.
  }
}

export function requireDatabaseUrl(): string {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
  return url;
}
