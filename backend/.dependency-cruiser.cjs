/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment:
        'Import cycles make load order fragile and hide the real dependency direction. A cycle that passes through a type-only import is erased at runtime (route -> middleware -> context -> module index -> route), so it does not count.',
      severity: 'error',
      from: {},
      to: { circular: true, viaOnly: { dependencyTypesNot: ['type-only'] } }
    },
    {
      name: 'lib-is-leaf',
      comment: 'lib/ is infrastructure: it imports nothing else under src/.',
      severity: 'error',
      from: { path: '^src/lib/' },
      to: { path: '^src/', pathNot: '^src/lib/' }
    },
    {
      name: 'http-is-leaf',
      comment: 'http/ holds shared Express helpers: it imports only lib/ and http/.',
      severity: 'error',
      from: { path: '^src/http/' },
      to: { path: '^src/', pathNot: '^src/(lib|http)/' }
    },
    {
      name: 'middleware-values-from-lib-or-context',
      comment:
        'Middleware imports values only from middleware/, lib/ and context.ts; anything else it reads per request through ctxOf(req).',
      severity: 'error',
      from: { path: '^src/middleware/' },
      to: {
        path: '^src/',
        pathNot: ['^src/(middleware|lib)/', '^src/context[.]ts$'],
        dependencyTypesNot: ['type-only']
      }
    },
    {
      name: 'middleware-types-via-index',
      comment: "Middleware reaches a module (for its types) only through that module's index.ts.",
      severity: 'error',
      from: { path: '^src/middleware/' },
      to: { path: '^src/feature/', pathNot: '^src/feature/[^/]+/index[.]ts$' }
    },
    {
      name: 'context-types-only-from-modules',
      comment:
        'context.ts names module services as types only; app.ts builds the values and injects them.',
      severity: 'error',
      from: { path: '^src/context[.]ts$' },
      to: { path: '^src/feature/', dependencyTypesNot: ['type-only'] }
    },
    {
      name: 'not-to-unresolvable',
      comment: 'Every import must resolve; otherwise the other rules could pass vacuously.',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true }
    },
    {
      name: 'cross-module-type-only',
      comment:
        'A module may depend on another module only through type-only imports; values are injected.',
      severity: 'error',
      from: { path: '^src/feature/([^/]+)/' },
      to: { path: '^src/feature/', pathNot: '^src/feature/$1/', dependencyTypesNot: ['type-only'] }
    },
    {
      name: 'module-public-api-only',
      comment: "A module reaches another module only through that module's index[.]ts.",
      severity: 'error',
      from: { path: '^src/feature/([^/]+)/' },
      to: {
        path: '^src/feature/',
        pathNot: ['^src/feature/$1/', '^src/feature/[^/]+/index[.]ts$']
      }
    },
    {
      name: 'feature-values-own-or-infra',
      comment:
        'A module may import values only from itself and the infrastructure (src/lib, src/http, src/middleware, src/context.ts); other modules are reached through injected APIs.',
      severity: 'error',
      from: { path: '^src/feature/([^/]+)/' },
      to: {
        path: '^src/',
        pathNot: ['^src/feature/$1/', '^src/(lib|http|middleware)/', '^src/context[.]ts$'],
        dependencyTypesNot: ['type-only']
      }
    },
    {
      name: 'outside-uses-public-api',
      comment: 'Code outside src/feature reaches a module only through its index.ts.',
      severity: 'error',
      from: { path: '^src/', pathNot: '^src/feature/' },
      to: { path: '^src/feature/', pathNot: '^src/feature/[^/]+/index[.]ts$' }
    },
    {
      name: 'index-exports-module-only',
      comment: 'An index.ts re-exports values only from its <m>.module.ts.',
      severity: 'error',
      from: { path: '^src/feature/[^/]+/index[.]ts$' },
      to: { path: '^src/', pathNot: '[.]module[.]ts$', dependencyTypesNot: ['type-only'] }
    }
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    // dependency-cruiser ignores package "exports" maps by default; resolving them keeps not-to-unresolvable meaningful for ESM packages.
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types']
    }
  }
}
