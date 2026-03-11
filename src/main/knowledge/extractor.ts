import { detectDomains } from './domain-tagger';

export interface KnowledgeCandidate {
  content: string;
  domains: string[];
  trigger: 'decision' | 'error_fix' | 'pattern' | 'insight';
  confidence: number;
}

// Patterns indicating knowledge-worthy content
const DECISION_PATTERNS = [
  /I recommend/i, /chose .+ over/i, /went with/i, /better (choice|option|approach)/i,
  /decided to/i, /prefer .+ because/i, /the (best|right) approach/i,
];

const ERROR_FIX_PATTERNS = [
  /fixed .+ by/i, /the (issue|problem|bug) (is|was)/i, /resolved .+ by/i,
  /the fix (is|was)/i, /solved .+ by/i, /root cause/i,
];

const PATTERN_INDICATORS = [
  /this pattern/i, /always .+ when/i, /best practice/i, /consistent/i,
  /centralized/i, /reusable/i, /convention/i,
];

const TRIVIAL_PATTERNS = [
  /^(hello|hi|hey|thanks|thank you|ok|okay|sure|got it)/i,
  /how can I help/i, /let me know/i,
];

function isTrivial(userMsg: string, assistantMsg: string): boolean {
  return (
    (userMsg.length < 20 && TRIVIAL_PATTERNS.some(p => p.test(userMsg))) ||
    (assistantMsg.length < 50)
  );
}

function extractDecisions(assistantMsg: string): string[] {
  const sentences = assistantMsg.split(/[.!]\s+/);
  return sentences.filter(s => DECISION_PATTERNS.some(p => p.test(s))).map(s => s.trim());
}

function extractErrorFixes(assistantMsg: string): string[] {
  const sentences = assistantMsg.split(/[.!]\s+/);
  return sentences.filter(s => ERROR_FIX_PATTERNS.some(p => p.test(s))).map(s => s.trim());
}

function extractPatterns(assistantMsg: string): string[] {
  const sentences = assistantMsg.split(/[.!]\s+/);
  return sentences.filter(s => PATTERN_INDICATORS.some(p => p.test(s))).map(s => s.trim());
}

export function extractKnowledgeCandidates(
  userMessage: string,
  assistantMessage: string
): KnowledgeCandidate[] {
  if (isTrivial(userMessage, assistantMessage)) return [];

  const candidates: KnowledgeCandidate[] = [];
  const fullContext = `${userMessage} ${assistantMessage}`;

  // Extract decisions
  for (const decision of extractDecisions(assistantMessage)) {
    if (decision.length > 20) {
      candidates.push({
        content: decision,
        domains: detectDomains(fullContext),
        trigger: 'decision',
        confidence: 0.7,
      });
    }
  }

  // Extract error fixes
  for (const fix of extractErrorFixes(assistantMessage)) {
    if (fix.length > 20) {
      candidates.push({
        content: fix,
        domains: detectDomains(fullContext),
        trigger: 'error_fix',
        confidence: 0.8,
      });
    }
  }

  // Extract patterns
  for (const pattern of extractPatterns(assistantMessage)) {
    if (pattern.length > 20) {
      candidates.push({
        content: pattern,
        domains: detectDomains(fullContext),
        trigger: 'pattern',
        confidence: 0.6,
      });
    }
  }

  return candidates;
}
