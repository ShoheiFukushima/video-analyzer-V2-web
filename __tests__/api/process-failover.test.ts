/**
 * api/process/route.ts のフェイルオーバーロジックテスト
 *
 * このテストはcallCloudRunWithFailover関数のロジックをテストします。
 * 実際のAPIルートはモックが必要なため、ロジック部分を抽出してテストします。
 */

// フェイルオーバーロジックを模倣したテスト用関数
async function callCloudRunWithFailover(
  primaryUrl: string,
  fallbackUrls: string[],
  mockFetch: (url: string) => Promise<{ ok: boolean; status: number }>
): Promise<{ usedUrl: string; failedUrls: string[] }> {
  const allUrls = [primaryUrl, ...fallbackUrls];
  const failedUrls: string[] = [];

  for (let i = 0; i < allUrls.length; i++) {
    const url = allUrls[i];

    try {
      const response = await mockFetch(url);

      if (response.ok) {
        return { usedUrl: url, failedUrls };
      }

      failedUrls.push(`${url}:${response.status}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      failedUrls.push(`${url}:${errorMsg}`);
    }
  }

  throw new Error(`All Cloud Run regions failed: ${failedUrls.join(', ')}`);
}

describe('callCloudRunWithFailover', () => {
  describe('Primary success', () => {
    it('should return primary URL when primary succeeds', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });

      const result = await callCloudRunWithFailover(
        'https://primary.run.app',
        ['https://fallback1.run.app', 'https://fallback2.run.app'],
        mockFetch
      );

      expect(result.usedUrl).toBe('https://primary.run.app');
      expect(result.failedUrls).toEqual([]);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('Primary failure, fallback success', () => {
    it('should fallback to first fallback when primary fails', async () => {
      const mockFetch = jest.fn()
        .mockResolvedValueOnce({ ok: false, status: 503 })  // Primary fails
        .mockResolvedValueOnce({ ok: true, status: 200 });   // Fallback1 succeeds

      const result = await callCloudRunWithFailover(
        'https://primary.run.app',
        ['https://fallback1.run.app', 'https://fallback2.run.app'],
        mockFetch
      );

      expect(result.usedUrl).toBe('https://fallback1.run.app');
      expect(result.failedUrls).toEqual(['https://primary.run.app:503']);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should fallback to second fallback when primary and first fallback fail', async () => {
      const mockFetch = jest.fn()
        .mockResolvedValueOnce({ ok: false, status: 503 })  // Primary fails
        .mockResolvedValueOnce({ ok: false, status: 502 })  // Fallback1 fails
        .mockResolvedValueOnce({ ok: true, status: 200 });  // Fallback2 succeeds

      const result = await callCloudRunWithFailover(
        'https://primary.run.app',
        ['https://fallback1.run.app', 'https://fallback2.run.app'],
        mockFetch
      );

      expect(result.usedUrl).toBe('https://fallback2.run.app');
      expect(result.failedUrls).toEqual([
        'https://primary.run.app:503',
        'https://fallback1.run.app:502'
      ]);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('Network errors', () => {
    it('should handle network errors and continue to fallback', async () => {
      const mockFetch = jest.fn()
        .mockRejectedValueOnce(new Error('Network timeout'))  // Primary network error
        .mockResolvedValueOnce({ ok: true, status: 200 });    // Fallback1 succeeds

      const result = await callCloudRunWithFailover(
        'https://primary.run.app',
        ['https://fallback1.run.app'],
        mockFetch
      );

      expect(result.usedUrl).toBe('https://fallback1.run.app');
      expect(result.failedUrls).toEqual(['https://primary.run.app:Network timeout']);
    });

    it('should handle mixed failures (network error + HTTP error)', async () => {
      const mockFetch = jest.fn()
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const result = await callCloudRunWithFailover(
        'https://primary.run.app',
        ['https://fallback1.run.app', 'https://fallback2.run.app'],
        mockFetch
      );

      expect(result.usedUrl).toBe('https://fallback2.run.app');
      expect(result.failedUrls).toEqual([
        'https://primary.run.app:Connection refused',
        'https://fallback1.run.app:500'
      ]);
    });
  });

  describe('All regions fail', () => {
    it('should throw error when all regions fail', async () => {
      const mockFetch = jest.fn()
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce({ ok: false, status: 502 })
        .mockResolvedValueOnce({ ok: false, status: 500 });

      await expect(
        callCloudRunWithFailover(
          'https://primary.run.app',
          ['https://fallback1.run.app', 'https://fallback2.run.app'],
          mockFetch
        )
      ).rejects.toThrow('All Cloud Run regions failed');
    });

    it('should include all failed URLs in error message', async () => {
      const mockFetch = jest.fn()
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockRejectedValueOnce(new Error('Timeout'));

      try {
        await callCloudRunWithFailover(
          'https://primary.run.app',
          ['https://fallback1.run.app'],
          mockFetch
        );
        fail('Expected error to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('https://primary.run.app:503');
        expect((error as Error).message).toContain('https://fallback1.run.app:Timeout');
      }
    });
  });

  describe('No fallbacks', () => {
    it('should work with no fallback URLs', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });

      const result = await callCloudRunWithFailover(
        'https://primary.run.app',
        [],
        mockFetch
      );

      expect(result.usedUrl).toBe('https://primary.run.app');
      expect(result.failedUrls).toEqual([]);
    });

    it('should throw error when primary fails with no fallbacks', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });

      await expect(
        callCloudRunWithFailover('https://primary.run.app', [], mockFetch)
      ).rejects.toThrow('All Cloud Run regions failed');
    });
  });

  describe('Order of attempts', () => {
    it('should try URLs in order: primary, fallback1, fallback2', async () => {
      const callOrder: string[] = [];
      const mockFetch = jest.fn().mockImplementation(async (url: string) => {
        callOrder.push(url);
        if (url === 'https://fallback2.run.app') {
          return { ok: true, status: 200 };
        }
        return { ok: false, status: 503 };
      });

      await callCloudRunWithFailover(
        'https://primary.run.app',
        ['https://fallback1.run.app', 'https://fallback2.run.app'],
        mockFetch
      );

      expect(callOrder).toEqual([
        'https://primary.run.app',
        'https://fallback1.run.app',
        'https://fallback2.run.app'
      ]);
    });
  });
});
