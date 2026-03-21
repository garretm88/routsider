import type { APIRoute } from "astro";
import {
  getUserByEmail,
  verifyPassword,
  createSession,
} from "../../../lib/auth";

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const email = form.get("email");
  const password = form.get("password");

  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    !email ||
    !password
  ) {
    return redirect("/admin/login?error=invalid");
  }

  const user = await getUserByEmail(email);
  if (!user) {
    return redirect("/admin/login?error=invalid");
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return redirect("/admin/login?error=invalid");
  }

  const token = await createSession(user.id);

  cookies.set("session", token, {
    path: "/",
    httpOnly: true,
    secure: import.meta.env.PROD,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });

  return redirect("/admin");
};
