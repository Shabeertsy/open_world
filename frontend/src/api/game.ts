export type Player = { id: number; username: string; display_name: string; avatar: string | null };
type AuthResponse = { access: string; refresh: string; player: Player };

async function parseAuth(response: Response): Promise<AuthResponse> {
  if (!response.ok) throw new Error("Authentication failed. Check your details and try again.");
  return response.json();
}

export async function register(form: FormData): Promise<AuthResponse> { return parseAuth(await fetch("/api/auth/register/", { method: "POST", body: form })); }
export async function login(username: string, password: string): Promise<AuthResponse> { return parseAuth(await fetch("/api/auth/login/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) })); }
export async function logout(access: string, refresh: string) { await fetch("/api/auth/logout/", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${access}` }, body: JSON.stringify({ refresh }) }); }
