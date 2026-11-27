export interface RateCageCodeMap {
  readonly INVALID_INPUT: 'ERR_RATECAGE_INVALID_INPUT';
  readonly INVALID_OPTIONS: 'ERR_RATECAGE_INVALID_OPTIONS';
  readonly INVALID_IP: 'ERR_RATECAGE_INVALID_IP';
  readonly INVALID_CIDR: 'ERR_RATECAGE_INVALID_CIDR';
  readonly INVALID_KEY: 'ERR_RATECAGE_INVALID_KEY';
  readonly INVALID_COST: 'ERR_RATECAGE_INVALID_COST';
  readonly INVALID_STATE: 'ERR_RATECAGE_INVALID_STATE';
  readonly INVALID_CONFIG: 'ERR_RATECAGE_INVALID_CONFIG';
  readonly STORE_ERROR: 'ERR_RATECAGE_STORE_ERROR';
}

export const CODE: RateCageCodeMap;

export interface RateCageResultCodeMap {
  readonly OK: 'OK';
  readonly RATE_LIMITED: 'RATE_LIMITED';
  readonly COST_EXCEEDS_LIMIT: 'COST_EXCEEDS_LIMIT';
  readonly STORE_ERROR: 'STORE_ERROR';
  readonly INVALID_INPUT: 'INVALID_INPUT';
}

export const RESULT_CODE: RateCageResultCodeMap;

export interface RateCageDefaults {
  readonly algorithm: 'sliding-window';
  readonly limit: 60;
  readonly windowMs: 60000;
  readonly namespace: 'ratecage';
  readonly maxKeys: 50000;
  readonly maxKeyLength: 256;
  readonly trustedProxies: readonly [];
  readonly maxForwardedHops: 16;
  readonly maxForwardedHeaderBytes: 2048;
  readonly ipv6Prefix: 64;
  readonly cost: 1;
  readonly onStoreError: 'deny';
}

export const DEFAULTS: RateCageDefaults;

export class RateCageError extends Error {
  readonly name: 'RateCageError';
  readonly code: string;
  readonly reason: string;
  readonly field?: string;
  readonly limit?: number;
  readonly actual?: number;
  constructor(code: string, reason: string, details?: {
    field?: string;
    limit?: number;
    actual?: number;
    cause?: unknown;
  });
  toJSON(): {
    name: string;
    code: string;
    reason: string;
    message: string;
    field?: string;
    limit?: number;
    actual?: number;
  };
}

export interface NormalizeIpOptions {
  /** IPv6 network prefix used for bucketing. False or null disables bucketing. */
  readonly ipv6Prefix?: number | false | null;
}

export function normalizeIp(ip: string, options?: NormalizeIpOptions): string;

export interface ParsedCidr {
  readonly family: 4 | 6;
  readonly bits: 32 | 128;
  readonly prefix: number;
  readonly network: string;
  readonly networkValue: bigint;
  readonly input: string;
}

export function parseCidr(cidr: string): ParsedCidr;
export function ipInCidr(ip: string, cidr: string | ParsedCidr): boolean;

export interface ExtractClientIpOptions {
  readonly socketIp: string;
  readonly xForwardedFor?: string;
  readonly forwarded?: string;
  readonly trustedProxies?: readonly (string | ParsedCidr)[];
  readonly maxForwardedHops?: number;
  readonly maxForwardedHeaderBytes?: number;
  readonly ipv6Prefix?: number | false | null;
}

export function extractClientIp(options: ExtractClientIpOptions): string;
export function extractClientIp(
  socketIp: string,
  xForwardedFor?: string,
  options?: Omit<ExtractClientIpOptions, 'socketIp' | 'xForwardedFor'>
): string;

export interface MemoryRateStoreOptions {
  readonly maxKeys?: number;
  readonly maxKeyLength?: number;
  readonly now?: () => number;
  readonly pruneScanLimit?: number;
}

export interface RateStore {
  get(key: string): unknown | Promise<unknown>;
  set(key: string, value: unknown, ttlMs: number): unknown | Promise<unknown>;
  update?(
    key: string,
    updater: (current: unknown, nowMs: number) => unknown,
    ttlMs: number
  ): unknown | Promise<unknown>;
  delete?(key: string): unknown | Promise<unknown>;
}

export class MemoryRateStore implements RateStore {
  readonly maxKeys: number;
  readonly maxKeyLength: number;
  readonly pruneScanLimit: number;
  readonly now: () => number;
  readonly size: number;
  constructor(options?: MemoryRateStoreOptions);
  nowMs(): number;
  validateKey(key: string): void;
  pruneExpiredOpportunistic(): number;
  pruneExpired(): number;
  evictOverflow(): number;
  get(key: string): unknown;
  set(key: string, value: unknown, ttlMs: number): unknown;
  update(key: string, updater: (current: unknown, nowMs: number) => unknown, ttlMs: number): unknown;
  delete(key: string): boolean;
  clear(): void;
}

export function createRateLimitKey(namespace: string, key: string, maxKeyLength?: number): string;

export type RateAlgorithm = 'sliding-window' | 'fixed-window' | 'token-bucket';
export type StoreErrorPolicy = 'deny' | 'allow';

export interface RateLimiterOptions {
  readonly algorithm?: RateAlgorithm;
  readonly limit?: number;
  readonly windowMs?: number;
  readonly capacity?: number;
  readonly refillPerSecond?: number;
  readonly cost?: number;
  readonly namespace?: string;
  readonly store?: RateStore;
  readonly now?: () => number;
  readonly onStoreError?: StoreErrorPolicy;
  readonly legacyHeaders?: boolean;
  readonly includeHeaders?: boolean;
  readonly maxKeyLength?: number;
}

export interface RateRequestOptions {
  readonly cost?: number;
}

export type RateResultCode = 'OK' | 'RATE_LIMITED' | 'COST_EXCEEDS_LIMIT' | 'STORE_ERROR' | 'INVALID_INPUT';

export interface RateResult {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly resetSeconds: number;
  readonly resetAtMs: number;
  readonly retryAfterSeconds: number;
  readonly key: string;
  readonly reason: string;
  readonly code: RateResultCode;
  readonly headers: Readonly<Record<string, string>>;
}

export interface RateLimiter {
  consume(key: string, options?: RateRequestOptions): Promise<RateResult>;
  check(key: string, options?: RateRequestOptions): Promise<RateResult>;
  peek(key: string, options?: RateRequestOptions): Promise<RateResult>;
  readonly config: Readonly<{
    algorithm: RateAlgorithm;
    limit: number;
    reportedLimit: number;
    windowMs: number;
    capacity: number;
    refillPerSecond: number;
    cost: number;
    namespace: string;
    store: RateStore;
    now: () => number;
    onStoreError: StoreErrorPolicy;
    legacyHeaders: boolean;
    includeHeaders: boolean;
    maxKeyLength: number;
  }>;
}

export function createRateLimiter(options?: RateLimiterOptions): RateLimiter;

export interface NodeRequestLike {
  readonly headers?: Record<string, string | string[] | undefined>;
  readonly socket?: { readonly remoteAddress?: string };
  readonly connection?: { readonly remoteAddress?: string };
}

export interface NodeResponseLike {
  statusCode: number;
  readonly headersSent?: boolean;
  readonly writableEnded?: boolean;
  setHeader?(name: string, value: string): void;
  end?(body?: string): void;
}

export type NodeNextFunction = (error?: unknown) => void;

export interface NodeRateLimitMiddlewareOptions extends RateLimiterOptions {
  readonly limiter?: RateLimiter;
  readonly trustedProxies?: readonly (string | ParsedCidr)[];
  readonly maxForwardedHops?: number;
  readonly maxForwardedHeaderBytes?: number;
  readonly ipv6Prefix?: number | false | null;
  readonly keyPrefix?: string;
  readonly message?: string;
  readonly skip?: (request: NodeRequestLike) => boolean;
  readonly onDenied?: (request: NodeRequestLike, response: NodeResponseLike, result: RateResult) => void;
  readonly socketIp?: string | ((request: NodeRequestLike) => string | undefined);
}

export function createNodeRateLimitMiddleware(
  options?: NodeRateLimitMiddlewareOptions
): (request: NodeRequestLike, response: NodeResponseLike, next?: NodeNextFunction) => Promise<boolean>;

export interface FetchHeadersLike {
  get(name: string): string | null;
}

export interface FetchRequestLike {
  readonly headers?: FetchHeadersLike;
  readonly ip?: string;
  readonly socketIp?: string;
  readonly socket?: { readonly remoteAddress?: string };
}

export interface FetchResponseLike {
  readonly status: number;
  readonly statusText: string;
  readonly headers: unknown;
  readonly body: unknown;
  clone(): FetchResponseLike;
}

export type FetchStyleHandler = (request: FetchRequestLike) => FetchResponseLike | Promise<FetchResponseLike>;

export interface FetchRateLimitHandlerOptions extends RateLimiterOptions {
  readonly handler?: FetchStyleHandler;
  readonly limiter?: RateLimiter;
  readonly trustedProxies?: readonly (string | ParsedCidr)[];
  readonly maxForwardedHops?: number;
  readonly maxForwardedHeaderBytes?: number;
  readonly ipv6Prefix?: number | false | null;
  readonly keyPrefix?: string;
  readonly message?: string;
  readonly socketIp?: string | ((request: FetchRequestLike) => string | undefined);
  readonly getSocketIp?: (request: FetchRequestLike) => string | undefined;
}

export function createFetchRateLimitHandler(
  handler: FetchStyleHandler,
  options?: FetchRateLimitHandlerOptions
): (request: FetchRequestLike) => Promise<FetchResponseLike>;
export function createFetchRateLimitHandler(
  options: FetchRateLimitHandlerOptions & { handler: FetchStyleHandler }
): (request: FetchRequestLike) => Promise<FetchResponseLike>;

export type LintSeverity = 'error' | 'warning';

export interface RateLimitConfigFinding {
  readonly code: string;
  readonly severity: LintSeverity;
  readonly path: string;
  readonly message: string;
  readonly recommendation: string;
}

export function lintRateLimitConfig(input: string | object): readonly RateLimitConfigFinding[];

export interface RateCageOptions extends RateLimiterOptions {
  readonly trustedProxies?: readonly (string | ParsedCidr)[];
  readonly maxForwardedHops?: number;
  readonly maxForwardedHeaderBytes?: number;
  readonly ipv6Prefix?: number | false | null;
  readonly keyPrefix?: string;
  readonly message?: string;
  readonly socketIp?: string | ((request: NodeRequestLike) => string | undefined);
}

export interface RateCage {
  readonly limiter: RateLimiter;
  consume(key: string, options?: RateRequestOptions): Promise<RateResult>;
  check(key: string, options?: RateRequestOptions): Promise<RateResult>;
  peek(key: string, options?: RateRequestOptions): Promise<RateResult>;
  readonly middleware: (request: NodeRequestLike, response: NodeResponseLike, next?: NodeNextFunction) => Promise<boolean>;
  readonly nodeMiddleware: (request: NodeRequestLike, response: NodeResponseLike, next?: NodeNextFunction) => Promise<boolean>;
  extractClientIp(
    socketIp: string,
    xForwardedFor?: string,
    overrides?: Partial<ExtractClientIpOptions>
  ): string;
  createFetchHandler(
    handler: FetchStyleHandler,
    overrides?: FetchRateLimitHandlerOptions
  ): (request: FetchRequestLike) => Promise<FetchResponseLike>;
  readonly config: RateLimiter['config'];
}

export function createRateCage(options?: RateCageOptions): RateCage;

declare const ratecage: {
  readonly CODE: typeof CODE;
  readonly RESULT_CODE: typeof RESULT_CODE;
  readonly DEFAULTS: typeof DEFAULTS;
  readonly RateCageError: typeof RateCageError;
  readonly normalizeIp: typeof normalizeIp;
  readonly parseCidr: typeof parseCidr;
  readonly ipInCidr: typeof ipInCidr;
  readonly extractClientIp: typeof extractClientIp;
  readonly MemoryRateStore: typeof MemoryRateStore;
  readonly createRateLimitKey: typeof createRateLimitKey;
  readonly createRateLimiter: typeof createRateLimiter;
  readonly createRateCage: typeof createRateCage;
  readonly createNodeRateLimitMiddleware: typeof createNodeRateLimitMiddleware;
  readonly createFetchRateLimitHandler: typeof createFetchRateLimitHandler;
  readonly lintRateLimitConfig: typeof lintRateLimitConfig;
};

export default ratecage;
