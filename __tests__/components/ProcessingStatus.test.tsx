import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProcessingStatus } from '@/app/components/ProcessingStatus';
import { TestWrapper } from '@/app/test-utils/test-utils';

// Mock fetch globally
global.fetch = jest.fn();

describe('ProcessingStatus', () => {
  const mockUploadId = 'upload_123';
  const mockOnComplete = jest.fn();
  let mockAppendChild: jest.Mock;
  let mockRemoveChild: jest.Mock;
  let mockClick: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    (global.fetch as jest.Mock).mockClear();

    // Mock DOM methods
    mockAppendChild = jest.fn();
    mockRemoveChild = jest.fn();
    mockClick = jest.fn();

    // Mock document.body methods
    document.body.appendChild = mockAppendChild;
    document.body.removeChild = mockRemoveChild;

    // Reset URL mocks
    (window.URL.createObjectURL as jest.Mock) = jest.fn(() => 'blob:mock-url');
    (window.URL.revokeObjectURL as jest.Mock) = jest.fn();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe('Rendering with different status types', () => {
    it('should render processing state initially', () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'processing',
          progress: 30,
        }),
      });

      const { container } = render(
        <TestWrapper>
          <ProcessingStatus uploadId={mockUploadId} />
        </TestWrapper>
      );

      expect(container).toBeInTheDocument();
      expect(screen.getByText(/Processing your video/i)).toBeInTheDocument();
      expect(screen.getByText(/Uploading video/i)).toBeInTheDocument();
    });

    it('should render error state with error message', async () => {
      const errorMessage = 'Processing failed: Network error';

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'error',
          message: errorMessage,
        }),
      });

      render(
        <TestWrapper>
          <ProcessingStatus uploadId={mockUploadId} onComplete={mockOnComplete} />
        </TestWrapper>
      );

      // Trigger initial poll
      await act(async () => {
        jest.advanceTimersByTime(0);
      });

      await waitFor(() => {
        expect(screen.getByText('Processing Failed')).toBeInTheDocument();
        expect(screen.getByText(errorMessage)).toBeInTheDocument();
      });

      expect(mockOnComplete).toHaveBeenCalled();
    });

    it('should render completed state with download button', async () => {
      const mockResultUrl = 'https://example.com/result.xlsx';

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'completed',
          resultUrl: mockResultUrl,
          progress: 100,
        }),
      });

      render(
        <TestWrapper>
          <ProcessingStatus uploadId={mockUploadId} onComplete={mockOnComplete} />
        </TestWrapper>
      );

      await act(async () => {
        jest.advanceTimersByTime(0);
      });

      await waitFor(() => {
        expect(screen.getByText('Processing Completed!')).toBeInTheDocument();
      });

      expect(mockOnComplete).toHaveBeenCalled();
    });

    it('should render processing state with different stages', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'processing',
          progress: 50,
        }),
      });

      render(
        <TestWrapper>
          <ProcessingStatus uploadId={mockUploadId} />
        </TestWrapper>
      );

      // Progress through simulated stages
      await act(async () => {
        jest.advanceTimersByTime(5000); // First stage
      });

      expect(screen.getByText(/Downloading video from storage/i)).toBeInTheDocument();

      await act(async () => {
        jest.advanceTimersByTime(5000); // Second stage
      });

      expect(screen.getByText(/Extracting video metadata/i)).toBeInTheDocument();
    });
  });

  describe('Progress bar display', () => {
    it('should display progress bar with correct percentage', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'processing',
          progress: 45,
        }),
      });

      render(
        <TestWrapper>
          <ProcessingStatus uploadId={mockUploadId} />
        </TestWrapper>
      );

      await act(async () => {
        jest.advanceTimersByTime(0);
      });

      await waitFor(() => {
        const progressBar = document.querySelector('.bg-indigo-600');
        expect(progressBar).toHaveStyle({ width: '45%' });
      });
    });

    it('should update progress bar as processing advances', async () => {
      let progressValue = 30;

      (global.fetch as jest.Mock).mockImplementation(async () => ({
        ok: true,
        json: async () => ({
          status: 'processing',
          progress: progressValue,
        }),
      }));

      render(
        <TestWrapper>
          <ProcessingStatus uploadId={mockUploadId} />
        </TestWrapper>
      );

      await act(async () => {
        jest.advanceTimersByTime(0);
      });

      await waitFor(() => {
        expect(screen.getByText('30%')).toBeInTheDocument();
      });

      // Update progress
      progressValue = 70;
      await act(async () => {
        jest.advanceTimersByTime(10000); // Trigger next poll
      });

      await waitFor(() => {
        expect(screen.getByText('70%')).toBeInTheDocument();
      });
    });

    it('should show 100% progress when completed', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'completed',
          resultUrl: 'https://example.com/result.xlsx',
          progress: 100,
        }),
      });

      render(
        <TestWrapper>
          <ProcessingStatus uploadId={mockUploadId} />
        </TestWrapper>
      );

      await act(async () => {
        jest.advanceTimersByTime(0);
      });

      await waitFor(() => {
        expect(screen.getByText('100%')).toBeInTheDocument();
      });
    });
  });

  describe('Stage descriptions', () => {
    const stages = [
      { status: 'uploading', label: 'Uploading video...' },
      { status: 'downloading', label: 'Downloading video from storage...' },
      { status: 'metadata', label: 'Extracting video metadata...' },
      { status: 'vad', label: 'Detecting voice activity...' },
      { status: 'frames', label: 'Extracting video frames (scene detection)...' },
      { status: 'whisper', label: 'Transcribing audio with Whisper AI...' },
      { status: 'ocr', label: 'Performing OCR with Gemini Vision...' },
      { status: 'excel', label: 'Generating Excel report...' },
      { status: 'upload_result', label: 'Uploading results...' },
      { status: 'completed', label: 'Processing completed!' },
    ];

    stages.forEach(({ status, label }) => {
      it(`should display correct label for ${status} stage`, async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
          ok: true,
          json: async () => ({
            status: 'processing',
            progress: 50,
          }),
        });

        const { rerender } = render(
          <TestWrapper>
            <ProcessingStatus uploadId={mockUploadId} />
          </TestWrapper>
        );

        // Simulate stage progression
        const stageIndex = stages.findIndex((s) => s.status === status);
        await act(async () => {
          jest.advanceTimersByTime(stageIndex * 5000);
        });

        await waitFor(() => {
          expect(screen.getByText(label)).toBeInTheDocument();
        });
      });
    });
  });

  describe('Metadata display', () => {
    it('should display metadata when available', async () => {
      const mockMetadata = {
        duration: 120.5,
        segmentCount: 15,
        ocrResultCount: 50,
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'completed',
          resultUrl: 'https://example.com/result.xlsx',
          metadata: mockMetadata,
          progress: 100,
        }),
      });

      render(
        <TestWrapper>
          <ProcessingStatus uploadId={mockUploadId} />
        </TestWrapper>
      );

      await act(async () => {
        jest.advanceTimersByTime(0);
      });

      await waitFor(() => {
        expect(screen.getByText('120.5s')).toBeInTheDocument();
        expect(screen.getByText('15')).toBeInTheDocument();
        expect(screen.getByText('50')).toBeInTheDocument();
      });

      expect(screen.getByText('Duration')).toBeInTheDocument();
      expect(screen.getByText('Segments')).toBeInTheDocument();
      expect(screen.getByText('OCR Frames')).toBeInTheDocument();
    });

    it('should not display metadata section when metadata is null', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'completed',
          resultUrl: 'https://example.com/result.xlsx',
          metadata: null,
          progress: 100,
        }),
      });

      render(
        <TestWrapper>
          <ProcessingStatus uploadId={mockUploadId} />
        </TestWrapper>
      );

      await act(async () => {
        jest.advanceTimersByTime(0);
      });

      await waitFor(() => {
        expect(screen.getByText('Processing Completed!')).toBeInTheDocument();
      });

      expect(screen.queryByText('Duration')).not.toBeInTheDocument();
      expect(screen.queryByText('Segments')).not.toBeInTheDocument();
      expect(screen.queryByText('OCR Frames')).not.toBeInTheDocument();
    });

    it('should handle undefined metadata gracefully', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'completed',
          resultUrl: 'https://example.com/result.xlsx',
          progress: 100,
        }),
      });

      render(
        <TestWrapper>
          <ProcessingStatus uploadId={mockUploadId} />
        </TestWrapper>
      );

      await act(async () => {
        jest.advanceTimersByTime(0);
      });

      await waitFor(() => {
        expect(screen.getByText('Processing Completed!')).toBeInTheDocument();
      });

      expect(screen.queryByText('Duration')).not.toBeInTheDocument();
    });

    it('should handle partial metadata with default values', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'completed',
          resultUrl: 'https://example.com/result.xlsx',
          metadata: {
            duration: undefined,
            segmentCount: 10,
            ocrResultCount: undefined,
          },
          progress: 100,
        }),
      });

      render(
        <TestWrapper>
          <ProcessingStatus uploadId={mockUploadId} />
        </TestWrapper>
      );

      await act(async () => {
        jest.advanceTimersByTime(0);
      });

      await waitFor(() => {
        expect(screen.getByText('0s')).toBeInTheDocument(); // Default duration
        expect(screen.getByText('10')).toBeInTheDocument();
        expect(screen.getByText('0')).toBeInTheDocument(); // Default ocrResultCount
      });
    });
  });

  describe('Download functionality', () => {
    it('should trigger auto-download on completion', async () => {
      const mockBlob = new Blob(['mock excel data'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

      (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
        if (url.includes('/api/status/')) {
          return {
            ok: true,
            json: async () => ({
              status: 'completed',
              resultUrl: 'https://example.com/result.xlsx',
              progress: 100,
            }),
          };
        }
        if (url.includes('/api/download/')) {
          return {
            ok: true,
            blob: async () => mockBlob,
          };
        }
        return { ok: false };
      });

      const mockAnchor = {
        href: '',
        download: '',
        click: mockClick,
      };
      jest.spyOn(document, 'createElement').mockReturnValue(mockAnchor as any);

      render(
        <TestWrapper>
          <ProcessingStatus uploadId={mockUploadId} />
        </TestWrapper>
      );

      await act(async () => {
        jest.advanceTimersByTime(0);
      });

      await waitFor(() => {
        expect(screen.getByText('Processing Completed!')).toBeInTheDocument();
      });

      // Wait for auto-download timer
      await act(async () => {
        jest.advanceTimersByTime(500);
      });

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(`/api/download/${mockUploadId}`);
        expect(mockClick).toHaveBeenCalled();
      });
    });

    it('should handle manual download button click', async () => {
      const user = userEvent.setup({ delay: null });
      const mockBlob = new Blob(['mock excel data']);

      (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
        if (url.includes('/api/status/')) {
          return {
            ok: true,
            json: async () => ({
              status: 'completed',
              resultUrl: 'https://example.com/result.xlsx',
              progress: 100,
            }),
          };
        }
        if (url.includes('/api/download/')) {
          return {
            ok: true,
            blob: async () => mockBlob,
          };
        }
        return { ok: false };
      });

      const mockAnchor = {
        href: '',
        download: '',
        click: mockClick,
      };
      jest.spyOn(document, 'createElement').mockReturnValue(mockAnchor as any);

      render(
        <TestWrapper>
          <ProcessingStatus uploadId={mockUploadId} />
        </TestWrapper>
      );

      await act(async () => {
        jest.advanceTimersByTime(0);
      });

      await waitFor(() => {
        expect(screen.getByText('Processing Completed!')).toBeInTheDocument();
      });

      const downloadButton = screen.getByRole('button', { name: /Download Excel Report/i });
      await user.click(downloadButton);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(`/api/download/${mockUploadId}`);
      });
    });

    it('should show error message when download fails', async () => {
      const user = userEvent.setup({ delay: null });

      (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
        if (url.includes('/api/status/')) {
          return {
            ok: true,
            json: async () => ({
              status: 'completed',
              resultUrl: 'https://example.com/result.xlsx',
              progress: 100,
            }),
          };
        }
        if (url.includes('/api/download/')) {
          return {
            ok: false,
            status: 404,
            json: async () => ({ error: 'File not found' }),
          };
        }
        return { ok: false };
      });

      render(
        <TestWrapper>
          <ProcessingStatus uploadId={mockUploadId} />
        </TestWrapper>
      );

      await act(async () => {
        jest.advanceTimersByTime(0);
      });

      await waitFor(() => {
        expect(screen.getByText('Processing Completed!')).toBeInTheDocument();
      });

      // Wait for auto-download attempt
      await act(async () => {
        jest.advanceTimersByTime(500);
      });

      await waitFor(() => {
        expect(screen.getByText('Processing Failed')).toBeInTheDocument();
        expect(screen.getByText('File not found')).toBeInTheDocument();
      });
    });

    it('should disable download button while downloading', async () => {
      const user = userEvent.setup({ delay: null });

      (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
        if (url.includes('/api/status/')) {
          return {
            ok: true,
            json: async () => ({
              status: 'completed',
              resultUrl: 'https://example.com/result.xlsx',
              progress: 100,
            }),
          };
        }
        if (url.includes('/api/download/')) {
          // Simulate slow download
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return {
            ok: true,
            blob: async () => new Blob(['data']),
          };
        }
        return { ok: false };
      });

      const mockAnchor = {
        href: '',
        download: '',
        click: mockClick,
      };
      jest.spyOn(document, 'createElement').mockReturnValue(mockAnchor as any);

      render(
        <TestWrapper>
          <ProcessingStatus uploadId={mockUploadId} />
        </TestWrapper>
      );

      await act(async () => {
        jest.advanceTimersByTime(0);
      });

      await waitFor(() => {
        expect(screen.getByText('Processing Completed!')).toBeInTheDocument();
      });

      const downloadButton = screen.getByRole('button');
      await user.click(downloadButton);

      // Button should be disabled during download
      expect(downloadButton).toBeDisabled();
      expect(screen.getByText('Downloading...')).toBeInTheDocument();
    });
  });

  describe('Upload ID display', () => {
    it('should display upload ID in processing state', () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'processing',
          progress: 30,
        }),
      });

      render(
        <TestWrapper>
          <ProcessingStatus uploadId={mockUploadId} />
        </TestWrapper>
      );

      expect(screen.getByText(`Upload ID: ${mockUploadId}`)).toBeInTheDocument();
    });

    it('should not display upload ID in completed state', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'completed',
          resultUrl: 'https://example.com/result.xlsx',
          progress: 100,
        }),
      });

      render(
        <TestWrapper>
          <ProcessingStatus uploadId={mockUploadId} />
        </TestWrapper>
      );

      await act(async () => {
        jest.advanceTimersByTime(0);
      });

      await waitFor(() => {
        expect(screen.getByText('Processing Completed!')).toBeInTheDocument();
      });

      expect(screen.queryByText(`Upload ID: ${mockUploadId}`)).not.toBeInTheDocument();
    });

    it('should not display upload ID in error state', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'error',
          message: 'Error occurred',
        }),
      });

      render(
        <TestWrapper>
          <ProcessingStatus uploadId={mockUploadId} />
        </TestWrapper>
      );

      await act(async () => {
        jest.advanceTimersByTime(0);
      });

      await waitFor(() => {
        expect(screen.getByText('Processing Failed')).toBeInTheDocument();
      });

      expect(screen.queryByText(`Upload ID: ${mockUploadId}`)).not.toBeInTheDocument();
    });
  });

  describe('Polling behavior', () => {
    it('should poll status at regular intervals', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'processing',
          progress: 30,
        }),
      });

      render(
        <TestWrapper>
          <ProcessingStatus uploadId={mockUploadId} />
        </TestWrapper>
      );

      // Initial poll
      await act(async () => {
        jest.advanceTimersByTime(0);
      });

      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Wait for next poll (10 seconds)
      await act(async () => {
        jest.advanceTimersByTime(10000);
      });

      expect(global.fetch).toHaveBeenCalledTimes(2);

      // Wait for another poll
      await act(async () => {
        jest.advanceTimersByTime(10000);
      });

      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it('should stop polling when completed', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'completed',
          resultUrl: 'https://example.com/result.xlsx',
          progress: 100,
        }),
      });

      render(
        <TestWrapper>
          <ProcessingStatus uploadId={mockUploadId} />
        </TestWrapper>
      );

      await act(async () => {
        jest.advanceTimersByTime(0);
      });

      const callCount = (global.fetch as jest.Mock).mock.calls.length;

      // Wait for multiple poll intervals
      await act(async () => {
        jest.advanceTimersByTime(30000);
      });

      // Fetch count should not increase (polling stopped)
      expect((global.fetch as jest.Mock).mock.calls.length).toBe(callCount);
    });

    it('should stop polling when error occurs', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'error',
          message: 'Processing failed',
        }),
      });

      render(
        <TestWrapper>
          <ProcessingStatus uploadId={mockUploadId} />
        </TestWrapper>
      );

      await act(async () => {
        jest.advanceTimersByTime(0);
      });

      const callCount = (global.fetch as jest.Mock).mock.calls.length;

      // Wait for multiple poll intervals
      await act(async () => {
        jest.advanceTimersByTime(30000);
      });

      // Fetch count should not increase (polling stopped)
      expect((global.fetch as jest.Mock).mock.calls.length).toBe(callCount);
    });
  });

  describe('onComplete callback', () => {
    it('should call onComplete when processing succeeds', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'completed',
          resultUrl: 'https://example.com/result.xlsx',
          progress: 100,
        }),
      });

      render(
        <TestWrapper>
          <ProcessingStatus uploadId={mockUploadId} onComplete={mockOnComplete} />
        </TestWrapper>
      );

      await act(async () => {
        jest.advanceTimersByTime(0);
      });

      await waitFor(() => {
        expect(mockOnComplete).toHaveBeenCalledTimes(1);
      });
    });

    it('should call onComplete when processing fails', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'error',
          message: 'Processing failed',
        }),
      });

      render(
        <TestWrapper>
          <ProcessingStatus uploadId={mockUploadId} onComplete={mockOnComplete} />
        </TestWrapper>
      );

      await act(async () => {
        jest.advanceTimersByTime(0);
      });

      await waitFor(() => {
        expect(mockOnComplete).toHaveBeenCalledTimes(1);
      });
    });

    it('should work without onComplete callback', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'completed',
          resultUrl: 'https://example.com/result.xlsx',
          progress: 100,
        }),
      });

      expect(() => {
        render(
          <TestWrapper>
            <ProcessingStatus uploadId={mockUploadId} />
          </TestWrapper>
        );
      }).not.toThrow();

      await act(async () => {
        jest.advanceTimersByTime(0);
      });

      await waitFor(() => {
        expect(screen.getByText('Processing Completed!')).toBeInTheDocument();
      });
    });
  });
});
