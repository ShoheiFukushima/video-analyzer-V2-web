import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Define public routes (no authentication required)
const isPublicRoute = createRouteMatcher(["/", "/sign-in(.*)", "/sign-up(.*)"]);

// Define API routes (let API handlers manage their own authentication)
const isApiRoute = createRouteMatcher(["/api(.*)"]);

export default clerkMiddleware(async (auth, request) => {
  // API routes handle their own authentication
  // Don't redirect, let the route handler use auth()
  if (isApiRoute(request)) {
    return NextResponse.next();
  }

  // For public routes, no authentication required
  if (isPublicRoute(request)) {
    return NextResponse.next();
  }

  // For all other routes, enforce authentication
  const { userId } = await auth();
  if (!userId) {
    // Redirect to sign-in if not authenticated
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set("redirect_url", request.url);
    return NextResponse.redirect(signInUrl);
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|json|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
