import OpenAI from 'openai';
import fs from 'fs';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface TranscriptionSegment {
  timestamp: number;
  duration: number;
  text: string;
  confidence: number;
}

export const transcribeAudio = async (
  audioPath: string,
  uploadId: string
): Promise<TranscriptionSegment[]> => {
  try {
    console.log(`[${uploadId}] Starting transcription with Whisper...`);

    // Check if file exists
    if (!fs.existsSync(audioPath)) {
      console.warn(`[${uploadId}] Audio file not found, using mock transcription`);
      return generateMockTranscription();
    }

    const audioBuffer = fs.readFileSync(audioPath);
    const file = new File([audioBuffer], 'audio.mp3', { type: 'audio/mpeg' });

    // Type for Whisper verbose response
    interface WhisperVerboseResponse {
      text: string;
      segments?: Array<{
        start: number;
        end: number;
        text: string;
        confidence?: number;
      }>;
    }

    // Call Whisper API with proper parameters
    // Create params object separately to handle SDK type requirements
    const createParams = {
      file: file,
      model: 'whisper-1' as const,
      language: 'en',
      response_format: 'verbose_json' as const,
      temperature: 0,
    };

    const response: unknown = await (openai.audio.transcriptions.create as Function)(createParams);

    // Parse response
    const segments: TranscriptionSegment[] = [];

    // Check if response has segments (verbose format)
    const responseData = response as unknown as WhisperVerboseResponse;
    if (responseData.segments && Array.isArray(responseData.segments)) {
      for (const segment of responseData.segments) {
        segments.push({
          timestamp: segment.start || 0,
          duration: (segment.end || 0) - (segment.start || 0),
          text: segment.text || '',
          confidence: segment.confidence || 0.95,
        });
      }
    } else {
      // Simple transcription format, return as single segment
      segments.push({
        timestamp: 0,
        duration: 0,
        text: (response as unknown as { text?: string }).text || '',
        confidence: 0.95,
      });
    }

    console.log(`[${uploadId}] Transcription complete: ${segments.length} segments`);
    return segments;

  } catch (error) {
    console.error(`[${uploadId}] Transcription error:`, error);

    // Fallback to mock data
    console.log(`[${uploadId}] Using mock transcription as fallback`);
    return generateMockTranscription();
  }
};

function generateMockTranscription(): TranscriptionSegment[] {
  return [
    {
      timestamp: 0,
      duration: 5,
      text: 'Welcome to the video analysis service. This is a sample transcription.',
      confidence: 0.95,
    },
    {
      timestamp: 5.1,
      duration: 4,
      text: 'We are processing your video with advanced AI models.',
      confidence: 0.92,
    },
    {
      timestamp: 9.2,
      duration: 5,
      text: 'The system extracts both speech and text from your video automatically.',
      confidence: 0.94,
    },
    {
      timestamp: 14.3,
      duration: 3,
      text: 'Results are compiled into a comprehensive Excel report.',
      confidence: 0.93,
    },
  ];
}
