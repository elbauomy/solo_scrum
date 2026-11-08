// Name helpers and the two accounts from the environment, which become the first users (see src/lib/users.ts).

export type Role = "admin" | "viewer";
export type Account = { username: string; role: Role; password: string | undefined };

/** "  Khaled   ElBauomy " and "khaled elbauomy" are the same user name. */
export const normalizeName = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** "khaled elbauomy" -> "Khaled Elbauomy" */
export const displayName = (s: string) =>
  s
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");

/**
 * The two accounts from before user management. They are copied into the database the first time anyone signs in
 * (owner -> Administrator, viewer -> Viewer). Passwords come from `APP_PASSWORD` and `VIEWER_PASSWORD`.
 */
export function accountsFromEnv(env: Record<string, string | undefined>): Account[] {
  return [
    { username: env.ADMIN_USERNAME?.trim() || "khaled elbauomy", role: "admin", password: env.APP_PASSWORD },
    { username: env.VIEWER_USERNAME?.trim() || "remoon milad", role: "viewer", password: env.VIEWER_PASSWORD },
  ];
}
