import type { APIRoute } from "astro";
import { destroySession } from "../../../lib/auth";

export const prerender = false;

export const POST: APIRoute = async ({ cookies, redirect }) => {
  const token = cookies.get("session")?.value;

  if (token) {
    await destroySession(token);
  }

  cookies.delete("session", { path: "/" });
  return redirect("/admin/login");
};
