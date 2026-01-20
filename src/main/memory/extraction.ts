import { MemoryType } from '../../shared/types';

export interface ExtractedMemory {
  type: MemoryType;
  content: string;
  confidence: number; // 0-1 confidence score
}

interface ExtractionPattern {
  type: MemoryType;
  patterns: RegExp[];
  minConfidence: number;
}

// Heuristic patterns for memory extraction
const EXTRACTION_PATTERNS: ExtractionPattern[] = [
  {
    type: 'decision',
    patterns: [
      /I'll use\s+(.{10,200})/i,
      /I'm going to use\s+(.{10,200})/i,
      /Let's go with\s+(.{10,200})/i,
      /The approach is\s+(.{10,200})/i,
      /I've decided to\s+(.{10,200})/i,
      /We'll use\s+(.{10,200})/i,
      /I chose\s+(.{10,200})/i,
      /The solution is to\s+(.{10,200})/i,
      /I recommend\s+(.{10,200})/i,
      /Best approach:\s*(.{10,200})/i,
    ],
    minConfidence: 0.6,
  },
  {
    type: 'error_fix',
    patterns: [
      /Fixed by\s+(.{10,300})/i,
      /The issue was\s+(.{10,300})/i,
      /The problem was\s+(.{10,300})/i,
      /Error resolved:\s*(.{10,300})/i,
      /The fix is\s+(.{10,300})/i,
      /Solution:\s*(.{10,300})/i,
      /Root cause:\s*(.{10,300})/i,
      /This fixed\s+(.{10,300})/i,
      /Resolved by\s+(.{10,300})/i,
      /The bug was\s+(.{10,300})/i,
    ],
    minConfidence: 0.7,
  },
  {
    type: 'pattern',
    patterns: [
      /Always use\s+(.{10,200})/i,
      /Never use\s+(.{10,200})/i,
      /Convention:\s*(.{10,200})/i,
      /Best practice:\s*(.{10,200})/i,
      /Standard approach:\s*(.{10,200})/i,
      /The pattern is\s+(.{10,200})/i,
      /We follow\s+(.{10,200})/i,
      /The rule is\s+(.{10,200})/i,
      /Coding standard:\s*(.{10,200})/i,
    ],
    minConfidence: 0.65,
  },
  {
    type: 'context',
    patterns: [
      /Remember:\s*(.{10,300})/i,
      /Important:\s*(.{10,300})/i,
      /Note to self:\s*(.{10,300})/i,
      /Key point:\s*(.{10,300})/i,
      /Keep in mind:\s*(.{10,300})/i,
      /Don't forget:\s*(.{10,300})/i,
      /For future reference:\s*(.{10,300})/i,
      /Context:\s*(.{10,300})/i,
    ],
    minConfidence: 0.6,
  },
];

// Additional boost patterns that increase confidence
const CONFIDENCE_BOOSTERS: RegExp[] = [
  /because\s+/i,
  /this ensures\s+/i,
  /to avoid\s+/i,
  /to prevent\s+/i,
  /for consistency\s*/i,
  /going forward\s*/i,
  /from now on\s*/i,
];

// Patterns that decrease confidence (likely not actual memories)
const CONFIDENCE_REDUCERS: RegExp[] = [
  /\?\s*$/,  // Ends with question
  /I think\s+/i,  // Uncertain
  /maybe\s+/i,
  /perhaps\s+/i,
  /I'm not sure\s+/i,
  /could be\s+/i,
];

/**
 * Extract potential memories from terminal output
 */
export function extractMemories(text: string): ExtractedMemory[] {
  const memories: ExtractedMemory[] = [];
  const seen = new Set<string>();

  // Clean the text - remove ANSI codes
  const cleanText = text
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b\[[0-9;]*[mM]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');

  for (const extraction of EXTRACTION_PATTERNS) {
    for (const pattern of extraction.patterns) {
      const matches = cleanText.matchAll(new RegExp(pattern, 'gi'));

      for (const match of matches) {
        const content = match[1]?.trim();

        if (!content || content.length < 10) continue;

        // Skip if we've seen similar content
        const normalizedContent = content.toLowerCase().replace(/\s+/g, ' ');
        if (seen.has(normalizedContent)) continue;
        seen.add(normalizedContent);

        // Calculate confidence
        let confidence = extraction.minConfidence;

        // Apply boosters
        for (const booster of CONFIDENCE_BOOSTERS) {
          if (booster.test(content)) {
            confidence = Math.min(1, confidence + 0.1);
          }
        }

        // Apply reducers
        for (const reducer of CONFIDENCE_REDUCERS) {
          if (reducer.test(content)) {
            confidence = Math.max(0, confidence - 0.2);
          }
        }

        // Only include if confidence is above threshold
        if (confidence >= 0.5) {
          memories.push({
            type: extraction.type,
            content: cleanContent(content),
            confidence,
          });
        }
      }
    }
  }

  // Sort by confidence (highest first)
  return memories.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Clean extracted content for storage
 */
function cleanContent(content: string): string {
  return content
    // Remove leading/trailing punctuation
    .replace(/^[,.:;]+/, '')
    .replace(/[,.:;]+$/, '')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    // Remove common prefixes
    .replace(/^(that|which|to)\s+/i, '')
    // Trim
    .trim();
}

/**
 * Debounce extraction to avoid processing every small chunk
 */
export class ExtractionBuffer {
  private buffer: string = '';
  private lastExtraction: number = 0;
  private debounceMs: number;
  private minBufferSize: number;
  private maxBufferSize: number;

  constructor(options?: {
    debounceMs?: number;
    minBufferSize?: number;
    maxBufferSize?: number;
  }) {
    this.debounceMs = options?.debounceMs ?? 2000;
    this.minBufferSize = options?.minBufferSize ?? 500;
    this.maxBufferSize = options?.maxBufferSize ?? 10000;
  }

  /**
   * Add data to buffer and check if extraction should run
   */
  append(data: string): ExtractedMemory[] | null {
    this.buffer += data;

    // Trim buffer if too large
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer = this.buffer.slice(-this.maxBufferSize);
    }

    const now = Date.now();
    const timeSinceLastExtraction = now - this.lastExtraction;

    // Extract if:
    // 1. Buffer is large enough AND enough time has passed
    // 2. Buffer contains potential memory markers
    const hasMemoryMarkers = /\b(fixed|decided|always|never|remember|important|solution|convention)\b/i.test(this.buffer);

    if (
      this.buffer.length >= this.minBufferSize &&
      (timeSinceLastExtraction >= this.debounceMs || hasMemoryMarkers)
    ) {
      const memories = extractMemories(this.buffer);
      this.lastExtraction = now;

      // Keep recent buffer for context but clear most of it
      this.buffer = this.buffer.slice(-200);

      return memories.length > 0 ? memories : null;
    }

    return null;
  }

  /**
   * Force extraction of current buffer
   */
  flush(): ExtractedMemory[] {
    const memories = extractMemories(this.buffer);
    this.buffer = '';
    this.lastExtraction = Date.now();
    return memories;
  }

  /**
   * Clear the buffer without extracting
   */
  clear(): void {
    this.buffer = '';
  }
}
