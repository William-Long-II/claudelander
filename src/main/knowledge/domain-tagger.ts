const DOMAIN_PATTERNS: Record<string, RegExp[]> = {
  database: [/sql/i, /query/i, /database/i, /postgres/i, /mysql/i, /sqlite/i, /migration/i, /schema/i, /table/i, /index/i, /connection pool/i, /transaction/i, /orm/i],
  auth: [/auth/i, /oauth/i, /jwt/i, /token/i, /login/i, /password/i, /session/i, /permission/i, /rbac/i, /credential/i],
  testing: [/test/i, /spec/i, /vitest/i, /jest/i, /mock/i, /assert/i, /coverage/i, /tdd/i, /fixture/i],
  frontend: [/react/i, /css/i, /html/i, /component/i, /render/i, /dom/i, /layout/i, /style/i, /webpack/i, /vite/i, /ui\b/i, /ux/i],
  backend: [/api/i, /endpoint/i, /server/i, /middleware/i, /route/i, /handler/i, /express/i, /rest/i, /graphql/i],
  devops: [/docker/i, /kubernetes/i, /ci\/cd/i, /deploy/i, /nginx/i, /pipeline/i, /github action/i, /terraform/i, /aws/i, /cloud/i],
  performance: [/performance/i, /optimize/i, /cache/i, /latency/i, /memory leak/i, /profil/i, /bottleneck/i, /speed/i],
  security: [/security/i, /vulnerability/i, /xss/i, /csrf/i, /injection/i, /encrypt/i, /sanitiz/i, /owasp/i],
  architecture: [/architect/i, /pattern/i, /design/i, /refactor/i, /abstraction/i, /module/i, /dependency/i, /solid/i],
  error_handling: [/error/i, /exception/i, /catch/i, /throw/i, /retry/i, /fallback/i, /graceful/i, /stack trace/i],
};

export function detectDomains(content: string): string[] {
  const detected: string[] = [];

  for (const [domain, patterns] of Object.entries(DOMAIN_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(content)) {
        detected.push(domain);
        break;
      }
    }
  }

  return detected.length > 0 ? detected : ['general'];
}
