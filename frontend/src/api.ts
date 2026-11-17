// Shared browser API helper. The browser sends the HTTP-only session cookie,
// while Express determines the authenticated user and checks their role.
export async function api<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch("http://localhost:3001" + path, {
    credentials: "include",
    ...options
  });

  const payload: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof payload === "object" && payload !== null &&
      "error" in payload && typeof payload.error === "string"
        ? payload.error
        : "Request failed";
    throw new Error(message);
  }
  return payload as T;
}
