/**
 * geo-routing.ts のユニットテスト
 */

import {
  REGION_MAPPING,
  DEFAULT_REGION,
  REGIONS,
  FAILOVER_CHAINS,
  getRegionForCountry,
  getCloudRunUrlForRegion,
  getFallbackRegions,
  getConfiguredCloudRunUrls,
} from '@/lib/geo-routing';

describe('geo-routing', () => {
  describe('REGION_MAPPING', () => {
    it('should map Japan to asia-northeast1', () => {
      expect(REGION_MAPPING['JP']).toBe('asia-northeast1');
    });

    it('should map US to us-central1', () => {
      expect(REGION_MAPPING['US']).toBe('us-central1');
    });

    it('should map Germany to europe-west1', () => {
      expect(REGION_MAPPING['DE']).toBe('europe-west1');
    });

    it('should map Brazil to southamerica-east1', () => {
      expect(REGION_MAPPING['BR']).toBe('southamerica-east1');
    });

    it('should map Singapore to asia-southeast1', () => {
      expect(REGION_MAPPING['SG']).toBe('asia-southeast1');
    });

    it('should map Australia to australia-southeast1', () => {
      expect(REGION_MAPPING['AU']).toBe('australia-southeast1');
    });
  });

  describe('getRegionForCountry', () => {
    it('should return correct region for known country', () => {
      expect(getRegionForCountry('JP')).toBe('asia-northeast1');
      expect(getRegionForCountry('US')).toBe('us-central1');
      expect(getRegionForCountry('DE')).toBe('europe-west1');
    });

    it('should handle lowercase country codes', () => {
      expect(getRegionForCountry('jp')).toBe('asia-northeast1');
      expect(getRegionForCountry('us')).toBe('us-central1');
    });

    it('should return default region for unknown country', () => {
      expect(getRegionForCountry('XX')).toBe(DEFAULT_REGION);
      expect(getRegionForCountry('ZZ')).toBe(DEFAULT_REGION);
    });

    it('should return default region for null/undefined', () => {
      expect(getRegionForCountry(null)).toBe(DEFAULT_REGION);
      expect(getRegionForCountry(undefined)).toBe(DEFAULT_REGION);
    });

    it('should return default region for empty string', () => {
      expect(getRegionForCountry('')).toBe(DEFAULT_REGION);
    });
  });

  describe('REGIONS', () => {
    it('should have 6 regions configured', () => {
      expect(REGIONS.length).toBe(6);
    });

    it('should have correct region IDs', () => {
      const regionIds = REGIONS.map(r => r.id);
      expect(regionIds).toContain('asia-northeast1');
      expect(regionIds).toContain('asia-southeast1');
      expect(regionIds).toContain('australia-southeast1');
      expect(regionIds).toContain('us-central1');
      expect(regionIds).toContain('europe-west1');
      expect(regionIds).toContain('southamerica-east1');
    });

    it('should have unique environment variable names', () => {
      const envVars = REGIONS.map(r => r.envVar);
      const uniqueEnvVars = new Set(envVars);
      expect(uniqueEnvVars.size).toBe(envVars.length);
    });
  });

  describe('FAILOVER_CHAINS', () => {
    it('should have failover chain for each region', () => {
      REGIONS.forEach(region => {
        expect(FAILOVER_CHAINS[region.id]).toBeDefined();
        expect(Array.isArray(FAILOVER_CHAINS[region.id])).toBe(true);
        expect(FAILOVER_CHAINS[region.id].length).toBeGreaterThan(0);
      });
    });

    it('should not include self in failover chain', () => {
      Object.entries(FAILOVER_CHAINS).forEach(([region, fallbacks]) => {
        expect(fallbacks).not.toContain(region);
      });
    });

    it('tokyo should fallback to singapore first', () => {
      expect(FAILOVER_CHAINS['asia-northeast1'][0]).toBe('asia-southeast1');
    });

    it('us-central1 should fallback to europe-west1 first', () => {
      expect(FAILOVER_CHAINS['us-central1'][0]).toBe('europe-west1');
    });
  });

  describe('getFallbackRegions', () => {
    it('should return correct fallback regions for tokyo', () => {
      const fallbacks = getFallbackRegions('asia-northeast1');
      expect(fallbacks).toEqual(['asia-southeast1', 'us-central1', 'australia-southeast1']);
    });

    it('should return correct fallback regions for us-central1', () => {
      const fallbacks = getFallbackRegions('us-central1');
      expect(fallbacks).toEqual(['europe-west1', 'southamerica-east1', 'asia-northeast1']);
    });

    it('should return default fallback for unknown region', () => {
      const fallbacks = getFallbackRegions('unknown-region');
      expect(fallbacks).toEqual(FAILOVER_CHAINS[DEFAULT_REGION]);
    });
  });

  describe('getCloudRunUrlForRegion', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should return undefined when env var not set', () => {
      delete process.env.CLOUD_RUN_URL_TOKYO;
      expect(getCloudRunUrlForRegion('asia-northeast1')).toBeUndefined();
    });

    it('should return URL when env var is set', () => {
      process.env.CLOUD_RUN_URL_TOKYO = 'https://test.asia-northeast1.run.app';
      expect(getCloudRunUrlForRegion('asia-northeast1')).toBe('https://test.asia-northeast1.run.app');
    });

    it('should return undefined for unknown region', () => {
      expect(getCloudRunUrlForRegion('unknown-region')).toBeUndefined();
    });
  });

  describe('getConfiguredCloudRunUrls', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should return empty array when no URLs configured', () => {
      // Clear all Cloud Run URL env vars
      REGIONS.forEach(r => {
        delete process.env[r.envVar];
      });
      expect(getConfiguredCloudRunUrls()).toEqual([]);
    });

    it('should return only configured URLs', () => {
      // Clear all first
      REGIONS.forEach(r => {
        delete process.env[r.envVar];
      });

      // Set only tokyo
      process.env.CLOUD_RUN_URL_TOKYO = 'https://tokyo.run.app';

      const result = getConfiguredCloudRunUrls();
      expect(result.length).toBe(1);
      expect(result[0]).toEqual({ region: 'asia-northeast1', url: 'https://tokyo.run.app' });
    });

    it('should return multiple configured URLs', () => {
      // Clear all first
      REGIONS.forEach(r => {
        delete process.env[r.envVar];
      });

      process.env.CLOUD_RUN_URL_TOKYO = 'https://tokyo.run.app';
      process.env.CLOUD_RUN_URL_US = 'https://us.run.app';

      const result = getConfiguredCloudRunUrls();
      expect(result.length).toBe(2);
    });
  });

  describe('DEFAULT_REGION', () => {
    it('should be us-central1', () => {
      expect(DEFAULT_REGION).toBe('us-central1');
    });
  });

  describe('Country coverage', () => {
    it('should cover major Asian countries', () => {
      const asianCountries = ['JP', 'KR', 'TW', 'HK', 'SG', 'MY', 'TH', 'VN', 'ID', 'PH', 'IN'];
      asianCountries.forEach(country => {
        expect(REGION_MAPPING[country]).toBeDefined();
      });
    });

    it('should cover major European countries', () => {
      const europeanCountries = ['GB', 'DE', 'FR', 'IT', 'ES', 'NL', 'PL', 'SE', 'NO'];
      europeanCountries.forEach(country => {
        expect(REGION_MAPPING[country]).toBeDefined();
        expect(REGION_MAPPING[country]).toBe('europe-west1');
      });
    });

    it('should cover major American countries', () => {
      const americanCountries = ['US', 'CA', 'MX', 'BR', 'AR'];
      americanCountries.forEach(country => {
        expect(REGION_MAPPING[country]).toBeDefined();
      });
    });

    it('should cover Oceania', () => {
      expect(REGION_MAPPING['AU']).toBe('australia-southeast1');
      expect(REGION_MAPPING['NZ']).toBe('australia-southeast1');
    });
  });
});
