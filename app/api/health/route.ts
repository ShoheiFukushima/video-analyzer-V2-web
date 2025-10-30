import { NextRequest, NextResponse } from 'next/server';

// Public endpoint - no authentication required
export const runtime = 'nodejs';

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  checks: {
    api: boolean;
    blob?: boolean;
    cloudRun?: boolean;
    clerk?: boolean;
  };
  errors?: string[];
}

export async function GET(request: NextRequest) {
  const errors: string[] = [];
  const checks = {
    api: true, // API is responding if we got here
    blob: false,
    cloudRun: false,
    clerk: false,
  };

  // Check Blob Storage connectivity
  try {
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      checks.blob = true;
    } else {
      errors.push('Blob Storage token not configured');
    }
  } catch (error) {
    errors.push('Blob Storage check failed');
  }

  // Check Cloud Run connectivity
  try {
    const cloudRunUrl = process.env.CLOUD_RUN_URL;
    const workerSecret = process.env.WORKER_SECRET;

    if (cloudRunUrl && workerSecret) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      try {
        const response = await fetch(`${cloudRunUrl}/health`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${workerSecret}`,
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          checks.cloudRun = data.status === 'ok';
          if (!checks.cloudRun) {
            errors.push('Cloud Run health check returned non-ok status');
          }
        } else {
          errors.push(`Cloud Run health check failed with status ${response.status}`);
        }
      } catch (fetchError) {
        clearTimeout(timeoutId);
        if ((fetchError as any).name === 'AbortError') {
          errors.push('Cloud Run health check timed out');
        } else {
          errors.push(`Cloud Run health check error: ${(fetchError as Error).message}`);
        }
      }
    } else {
      errors.push('Cloud Run configuration missing');
    }
  } catch (error) {
    errors.push(`Cloud Run check failed: ${(error as Error).message}`);
  }

  // Check Clerk Authentication
  try {
    if (process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
      checks.clerk = true;
    } else {
      errors.push('Clerk authentication not configured');
    }
  } catch (error) {
    errors.push('Clerk check failed');
  }

  // Determine overall health status
  let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

  if (!checks.api) {
    status = 'unhealthy';
  } else if (!checks.blob || !checks.clerk) {
    status = 'unhealthy';
  } else if (!checks.cloudRun) {
    status = 'degraded'; // Can still function with simulation mode
  }

  const healthStatus: HealthStatus = {
    status,
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '2.0.0',
    checks,
  };

  if (errors.length > 0) {
    healthStatus.errors = errors;
  }

  // Return appropriate status code based on health
  const statusCode = status === 'healthy' ? 200 : status === 'degraded' ? 200 : 503;

  return NextResponse.json(healthStatus, { status: statusCode });
}