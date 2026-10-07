let nextKeyIndex = 0;

export function getOpenRouterApiKeys(): string[] {
  const configured = [
    process.env.OPENROUTER_API_KEYS,
    process.env.OPENROUTER_API_KEY,
  ]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => value.split(/[,\r\n]+/))
    .map((value) => value.trim())
    .filter(Boolean);

  return [...new Set(configured)];
}

export function getRotatedOpenRouterApiKeys(): string[] {
  const keys = getOpenRouterApiKeys();
  if (!keys.length) return [];

  const start = nextKeyIndex % keys.length;
  nextKeyIndex = (start + 1) % keys.length;
  return keys.slice(start).concat(keys.slice(0, start));
}

export function isOpenRouterQuotaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:\b(?:401|402|429)\b|quota|rate.?limit|credits?|insufficient)/i.test(
    message,
  );
}
