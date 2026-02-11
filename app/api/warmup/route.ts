import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge"; // Use edge for fastest response

/**
 * Warmup endpoint for Cloud Run cold start avoidance
 * Returns the geo-routed Cloud Run URL for the client to ping
 *
 * This endpoint is called by the VideoUploader component on mount
 * to pre-warm the nearest Cloud Run instance
 */
export async function GET(request: NextRequest) {
  // Get geo-routed Cloud Run URL from middleware headers
  const cloudRunUrl = request.headers.get('x-target-cloud-run');
  const geoCountry = request.headers.get('x-geo-country');
  const geoRegion = request.headers.get('x-geo-region');

  // Fallback to default if geo-routing not available
  const url = cloudRunUrl || process.env.CLOUD_RUN_URL?.trim();

  if (!url) {
    return NextResponse.json(
      { error: "Cloud Run URL not configured" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    cloudRunUrl: url,
    country: geoCountry || 'unknown',
    region: geoRegion || 'default',
  });
}
