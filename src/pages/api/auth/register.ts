import type { APIRoute } from "astro";
import { createUser, countUsers, validateSession } from "../../../lib/auth";

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  // Guard: only allow registration when no users exist (bootstrap) or caller is authenticated
  const userCount = await countUsers();
  if (userCount > 0) {
    const token = cookies.get("session")?.value;
    if (!token) {
      return new Response("Unauthorized", { status: 403 });
    }
    const caller = await validateSession(token);
    if (!caller) {
      return new Response("Unauthorized", { status: 403 });
    }
  }

  const form = await request.formData();
  const email = form.get("email");
  const password = form.get("password");
  const name = form.get("name");

  if (
    typeof email !== "string" ||
    !email ||
    typeof password !== "string" ||
    password.length < 8 ||
    typeof name !== "string" ||
    !name
  ) {
    const dest =
      userCount === 0
        ? "/admin/login?error=validation"
        : "/admin?error=validation";
    return redirect(dest);
  }

  try {
    await createUser(email, password, name);
  } catch {
    const dest =
      userCount === 0 ? "/admin/login?error=exists" : "/admin?error=exists";
    return redirect(dest);
  }

  // After bootstrap registration, redirect to login; otherwise back to admin
  return redirect(userCount === 0 ? "/admin/login?registered=1" : "/admin");
};
