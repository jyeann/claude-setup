// Fixed catalogue: node ids and types, the action list, parameter whitelists and edge rules (design.md 3.1, 5.1, 6).
const freeze = Object.freeze;

export const NODE_IDS = freeze([
  'clients', 'lb', 'service-1', 'service-2', 'service-3', 'cache', 'db-primary', 'db-replica', 'queue', 'consumer', 'third-party',
]);

export const NODE_TYPES = freeze({
  clients: 'client', lb: 'lb', 'service-1': 'service', 'service-2': 'service', 'service-3': 'service', cache: 'cache',
  'db-primary': 'db', 'db-replica': 'db', queue: 'queue', consumer: 'consumer', 'third-party': 'third-party',
});

const act = (id, name, kind, appliesTo, once) => freeze({ id, name, kind, appliesTo: freeze(appliesTo), once });

// Order is part of the contract (the action list never reorders, so it leaks no hint).
export const ACTIONS = freeze([
  act('inspect', 'Inspect', 'diagnostic', [], false),
  act('trace-request', 'Trace request', 'diagnostic', [], false),
  act('tail-logs', 'Tail logs', 'diagnostic', [], false),
  act('compare-dashboards', 'Compare dashboards', 'diagnostic', [], false),
  act('deploy-history', 'Deploy history', 'diagnostic', [], false),
  act('scale-service', 'Scale service', 'fix', ['service', 'consumer'], false),
  act('add-ttl-jitter', 'Add TTL jitter', 'fix', ['cache'], true),
  act('circuit-breaker', 'Circuit breaker', 'fix', ['service', 'consumer'], true),
  act('backoff-jitter', 'Backoff with jitter', 'fix', ['client', 'service'], true),
  act('shed-load', 'Shed load', 'fix', ['lb'], true),
  act('failover', 'Failover', 'fix', ['db'], true),
  act('shard-rekey', 'Shard or rekey', 'fix', ['db'], true),
  act('add-index', 'Add index', 'fix', ['db'], true),
  act('rollback', 'Rollback', 'fix', ['service', 'consumer'], true),
  act('raise-pool-size', 'Raise pool size', 'fix', ['service', 'consumer'], true),
  act('renew-cert', 'Renew certificate', 'fix', ['lb', 'service', 'third-party'], true),
]);

export const ACTION_IDS = freeze(ACTIONS.map((a) => a.id));
export const FIX_IDS = freeze(ACTIONS.filter((a) => a.kind === 'fix').map((a) => a.id));
export const DIAGNOSTIC_IDS = freeze(ACTIONS.filter((a) => a.kind === 'diagnostic').map((a) => a.id));
export const ACTION_BY_ID = freeze(Object.fromEntries(ACTIONS.map((a) => [a.id, a])));
export const DEFAULT_COST = freeze({ diagnostic: 1, fix: 2 });

const P = (min, max, extra = {}) => freeze({ min, max, ...extra });
const common = () => ({
  capacity: P(1, 1000000, { required: true }),
  instances: P(1, 64, { int: true, default: 1 }),
  capFactor: P(0, 10, { default: 1 }),
  baseMs: P(0, 10000, { default: 5 }),
  extraMs: P(0, 30000, { default: 0 }),
});
const timeout = () => ({ timeoutMs: P(50, 60000, { default: 3000 }) });
const errs = () => ({ errorBase: P(0, 1, { default: 0 }), backlogMax: P(0, 1000000, { int: true, default: 0 }) });
const pooled = () => ({ workers: P(0, 100000, { default: 0 }), poolSize: P(0, 1000, { int: true, default: 0 }) });

export const PARAMS = freeze({
  client: freeze({ rps: P(1, 100000, { required: true }) }),
  lb: freeze({ ...common(), ...timeout(), ...errs(), shed: P(0, 0.9, { default: 0 }) }),
  service: freeze({ ...common(), ...timeout(), ...errs(), ...pooled() }),
  cache: freeze({ ...common(), errorBase: P(0, 1, { default: 0 }), backlogMax: P(0, 1000000, { int: true, default: 0 }), hitRate: P(0, 1, { default: 0.95 }), missCost: P(0, 10, { default: 0 }) }),
  db: freeze({
    ...common(), ...timeout(), ...errs(),
    maxConnections: P(1, 100000, { int: true, default: 100000 }),
    connOverhead: P(0, 0.01, { default: 0 }),
    shards: P(1, 64, { int: true, default: 1 }),
    hotShare: P(0, 1), // default is 1 / shards, filled by the validator
    writers: P(1, 2, { int: true, default: 1 }),
    conflictRate: P(0, 1, { default: 0 }),
  }),
  queue: freeze({ ...common(), maxDepth: P(1, 10000000, { int: true, required: true }) }),
  consumer: freeze({ ...common(), ...timeout(), ...errs(), ...pooled() }),
  'third-party': freeze({ ...common(), ...timeout(), ...errs() }),
});

export const EDGE_PARAMS = freeze({
  calls: P(0, 100, { default: 1 }),
  share: P(0, 1, { default: 1 }),
  retries: P(0, 5, { int: true, default: 0 }),
  backoff: freeze({ bool: true, default: false }),
  breaker: freeze({ bool: true, default: false }),
  fallback: freeze({ bool: true, default: true }),
  missOnly: freeze({ bool: true }), // default true for edges out of a cache, else false
});

// Allowed edge directions by node type. db>db is only db-primary > db-replica (replication).
export const EDGE_RULES = freeze({
  client: freeze(['lb']),
  lb: freeze(['service']),
  service: freeze(['service', 'cache', 'db', 'queue', 'third-party']),
  cache: freeze(['db']),
  queue: freeze(['consumer']),
  consumer: freeze(['db', 'third-party', 'service']),
  db: freeze(['db']),
  'third-party': freeze([]),
});
