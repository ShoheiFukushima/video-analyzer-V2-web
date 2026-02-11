import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  getRegionForCountry,
  getCloudRunUrlForRegion,
  getFallbackRegions,
  DEFAULT_REGION,
} from "@/lib/geo-routing";

// Define public routes (no authentication required)
const isPublicRoute = createRouteMatcher(["/", "/sign-in(.*)", "/sign-up(.*)"]);

// Define API routes (let API handlers manage their own authentication)
const isApiRoute = createRouteMatcher(["/api(.*)"]);

/**
 * Get target Cloud Run URL and fallbacks based on user's geographic location
 * Uses Vercel's x-vercel-ip-country header for geo-detection
 */
function getGeoRoutingInfo(request: Request): {
  country: string;
  region: string;
  cloudRunUrl: string | undefined;
  fallbackUrls: string[];
} {
  // Get country from Vercel's geo-IP detection
  const country = (request.headers.get('x-vercel-ip-country') || 'US').toUpperCase();
  const region = getRegionForCountry(country);
  const cloudRunUrl = getCloudRunUrlForRegion(region);

  // Get fallback URLs
  const fallbackRegions = getFallbackRegions(region);
  const fallbackUrls = fallbackRegions
    .map(r => getCloudRunUrlForRegion(r))
    .filter((url): url is string => !!url);

  return { country, region, cloudRunUrl, fallbackUrls };
}

export default clerkMiddleware(async (auth, request) => {
  // Add geo-routing headers for API routes
  // IMPORTANT: Use request headers (not response headers) so API routes can read them
  if (isApiRoute(request)) {
    const { country, region, cloudRunUrl, fallbackUrls } = getGeoRoutingInfo(request);

    // Create new request headers with geo-routing info
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-geo-country', country);
    requestHeaders.set('x-geo-region', region);

    if (cloudRunUrl) {
      requestHeaders.set('x-target-cloud-run', cloudRunUrl);
    }

    if (fallbackUrls.length > 0) {
      requestHeaders.set('x-fallback-cloud-run', fallbackUrls.join(','));
    }

    // Pass modified request headers to the API route
    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }

  // For public routes, no authentication required
  if (isPublicRoute(request)) {
    return NextResponse.next();
  }

  // For all other routes, enforce authentication
  const { userId, redirectToSignIn } = await auth();
  if (!userId) {
    // Use Clerk's redirectToSignIn for proper redirect handling
    return redirectToSignIn({ returnBackUrl: request.url });
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|json|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
