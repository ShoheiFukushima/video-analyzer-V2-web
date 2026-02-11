/**
 * Geo-Routing Configuration for Video Analyzer V2
 * Routes requests to the nearest Cloud Run region based on user's IP country
 *
 * Created: 2026-02-06
 *
 * Strategy: 6 regions covering major global markets
 * - asia-northeast1 (Tokyo): Japan, Korea, Taiwan, Hong Kong
 * - asia-southeast1 (Singapore): Southeast Asia
 * - australia-southeast1 (Sydney): Oceania
 * - us-central1 (Iowa): North America
 * - europe-west1 (Belgium): Europe
 * - southamerica-east1 (São Paulo): South America
 */

/**
 * Mapping from ISO 3166-1 alpha-2 country codes to Cloud Run regions
 */
export const REGION_MAPPING: Record<string, string> = {
  // Asia-Pacific (East) → asia-northeast1 (Tokyo)
  JP: 'asia-northeast1',
  KR: 'asia-northeast1',
  TW: 'asia-northeast1',
  HK: 'asia-northeast1',
  MO: 'asia-northeast1', // Macau

  // Asia-Pacific (Southeast) → asia-southeast1 (Singapore)
  SG: 'asia-southeast1',
  MY: 'asia-southeast1',
  TH: 'asia-southeast1',
  VN: 'asia-southeast1',
  ID: 'asia-southeast1',
  PH: 'asia-southeast1',
  MM: 'asia-southeast1', // Myanmar
  KH: 'asia-southeast1', // Cambodia
  LA: 'asia-southeast1', // Laos
  BN: 'asia-southeast1', // Brunei

  // Asia-Pacific (South) → asia-southeast1 (Singapore - closest available)
  IN: 'asia-southeast1',
  BD: 'asia-southeast1', // Bangladesh
  PK: 'asia-southeast1', // Pakistan
  LK: 'asia-southeast1', // Sri Lanka
  NP: 'asia-southeast1', // Nepal

  // Oceania → australia-southeast1 (Sydney)
  AU: 'australia-southeast1',
  NZ: 'australia-southeast1',
  FJ: 'australia-southeast1', // Fiji
  PG: 'australia-southeast1', // Papua New Guinea

  // North America → us-central1 (Iowa)
  US: 'us-central1',
  CA: 'us-central1',
  MX: 'us-central1',

  // Central America & Caribbean → us-central1 (Iowa)
  GT: 'us-central1', // Guatemala
  HN: 'us-central1', // Honduras
  SV: 'us-central1', // El Salvador
  NI: 'us-central1', // Nicaragua
  CR: 'us-central1', // Costa Rica
  PA: 'us-central1', // Panama
  CU: 'us-central1', // Cuba
  DO: 'us-central1', // Dominican Republic
  PR: 'us-central1', // Puerto Rico
  JM: 'us-central1', // Jamaica

  // South America → southamerica-east1 (São Paulo)
  BR: 'southamerica-east1',
  AR: 'southamerica-east1',
  CL: 'southamerica-east1',
  CO: 'southamerica-east1',
  PE: 'southamerica-east1',
  VE: 'southamerica-east1',
  EC: 'southamerica-east1', // Ecuador
  BO: 'southamerica-east1', // Bolivia
  PY: 'southamerica-east1', // Paraguay
  UY: 'southamerica-east1', // Uruguay

  // Europe (West) → europe-west1 (Belgium)
  GB: 'europe-west1',
  DE: 'europe-west1',
  FR: 'europe-west1',
  IT: 'europe-west1',
  ES: 'europe-west1',
  NL: 'europe-west1',
  BE: 'europe-west1',
  AT: 'europe-west1', // Austria
  CH: 'europe-west1', // Switzerland
  PT: 'europe-west1', // Portugal
  IE: 'europe-west1', // Ireland
  LU: 'europe-west1', // Luxembourg

  // Europe (North) → europe-west1 (Belgium)
  FI: 'europe-west1',
  SE: 'europe-west1',
  NO: 'europe-west1',
  DK: 'europe-west1',
  IS: 'europe-west1', // Iceland

  // Europe (East) → europe-west1 (Belgium)
  PL: 'europe-west1',
  CZ: 'europe-west1', // Czech Republic
  HU: 'europe-west1', // Hungary
  RO: 'europe-west1', // Romania
  UA: 'europe-west1', // Ukraine
  SK: 'europe-west1', // Slovakia
  BG: 'europe-west1', // Bulgaria
  HR: 'europe-west1', // Croatia
  SI: 'europe-west1', // Slovenia
  RS: 'europe-west1', // Serbia
  GR: 'europe-west1', // Greece

  // Russia & Central Asia → europe-west1 (Belgium - geographically mixed)
  RU: 'europe-west1',
  KZ: 'europe-west1', // Kazakhstan
  UZ: 'europe-west1', // Uzbekistan

  // Middle East → europe-west1 (Belgium - closest available)
  IL: 'europe-west1', // Israel
  AE: 'europe-west1', // UAE
  SA: 'europe-west1', // Saudi Arabia
  TR: 'europe-west1', // Turkey
  EG: 'europe-west1', // Egypt
  QA: 'europe-west1', // Qatar
  KW: 'europe-west1', // Kuwait
  BH: 'europe-west1', // Bahrain
  OM: 'europe-west1', // Oman
  JO: 'europe-west1', // Jordan
  LB: 'europe-west1', // Lebanon

  // Africa → europe-west1 (Belgium - closest available)
  ZA: 'europe-west1', // South Africa
  NG: 'europe-west1', // Nigeria
  KE: 'europe-west1', // Kenya
  MA: 'europe-west1', // Morocco
  GH: 'europe-west1', // Ghana
  TZ: 'europe-west1', // Tanzania
  ET: 'europe-west1', // Ethiopia
};

/**
 * Default region for unknown countries
 */
export const DEFAULT_REGION = 'us-central1';

/**
 * Region metadata for monitoring and debugging
 */
export interface RegionInfo {
  id: string;
  name: string;
  location: string;
  envVar: string;
}

export const REGIONS: RegionInfo[] = [
  { id: 'asia-northeast1', name: 'Tokyo', location: 'Japan', envVar: 'CLOUD_RUN_URL_TOKYO' },
  { id: 'asia-southeast1', name: 'Singapore', location: 'Singapore', envVar: 'CLOUD_RUN_URL_SINGAPORE' },
  { id: 'australia-southeast1', name: 'Sydney', location: 'Australia', envVar: 'CLOUD_RUN_URL_SYDNEY' },
  { id: 'us-central1', name: 'Iowa', location: 'USA', envVar: 'CLOUD_RUN_URL_US' },
  { id: 'europe-west1', name: 'Belgium', location: 'Belgium', envVar: 'CLOUD_RUN_URL_EU' },
  { id: 'southamerica-east1', name: 'São Paulo', location: 'Brazil', envVar: 'CLOUD_RUN_URL_BRAZIL' },
];

/**
 * Failover chains for each region
 * If primary fails, try fallback regions in order
 */
export const FAILOVER_CHAINS: Record<string, string[]> = {
  'asia-northeast1': ['asia-southeast1', 'us-central1', 'australia-southeast1'],
  'asia-southeast1': ['asia-northeast1', 'australia-southeast1', 'us-central1'],
  'australia-southeast1': ['asia-southeast1', 'asia-northeast1', 'us-central1'],
  'us-central1': ['europe-west1', 'southamerica-east1', 'asia-northeast1'],
  'europe-west1': ['us-central1', 'asia-northeast1', 'southamerica-east1'],
  'southamerica-east1': ['us-central1', 'europe-west1', 'asia-northeast1'],
};

/**
 * Get the target Cloud Run region for a country code
 * @param countryCode - ISO 3166-1 alpha-2 country code (e.g., "JP", "US")
 * @returns Cloud Run region ID
 */
export function getRegionForCountry(countryCode: string | null | undefined): string {
  if (!countryCode) return DEFAULT_REGION;
  return REGION_MAPPING[countryCode.toUpperCase()] || DEFAULT_REGION;
}

/**
 * Get the Cloud Run URL for a specific region
 * @param region - Cloud Run region ID
 * @returns Cloud Run service URL or undefined if not configured
 */
export function getCloudRunUrlForRegion(region: string): string | undefined {
  const regionInfo = REGIONS.find(r => r.id === region);
  if (!regionInfo) return undefined;
  // Trim to remove any trailing newlines from environment variables
  const url = process.env[regionInfo.envVar]?.trim();
  return url || undefined;
}

/**
 * Get fallback regions for a primary region
 * @param primaryRegion - Primary Cloud Run region ID
 * @returns Array of fallback region IDs
 */
export function getFallbackRegions(primaryRegion: string): string[] {
  return FAILOVER_CHAINS[primaryRegion] || FAILOVER_CHAINS[DEFAULT_REGION];
}

/**
 * Get all configured Cloud Run URLs (for warmup)
 * @returns Array of configured Cloud Run URLs
 */
export function getConfiguredCloudRunUrls(): { region: string; url: string }[] {
  return REGIONS
    .map(r => ({ region: r.id, url: process.env[r.envVar]?.trim() }))
    .filter((r): r is { region: string; url: string } => !!r.url);
}
