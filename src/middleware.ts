import { defineMiddleware } from "astro:middleware";
import { validateSession } from "./lib/auth";

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  // Only protect /admin routes
  if (!pathname.startsWith("/admin")) {
    return next();
  }

  const sessionToken = context.cookies.get("session")?.value;

  // Login page: redirect to dashboard if already authenticated
  if (pathname === "/admin/login") {
    if (sessionToken) {
      const user = await validateSession(sessionToken);
      if (user) {
        return context.redirect("/admin");
      }
    }
    return next();
  }

  // All other /admin routes: require authentication
  if (!sessionToken) {
    return context.redirect("/admin/login");
  }

  const user = await validateSession(sessionToken);
  if (!user) {
    // Invalid/expired session — clear the stale cookie
    context.cookies.delete("session", { path: "/" });
    return context.redirect("/admin/login");
  }

  context.locals.user = user;
  return next();
});
