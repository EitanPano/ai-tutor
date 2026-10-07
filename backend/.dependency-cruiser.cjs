/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment: 'Import cycles make load order fragile and hide the real dependency direction.',
      severity: 'error',
      from: {},
      to: { circular: true }
    },
    {
      name: 'infra-is-leaf',
      comment: 'lib/ and http/ are infrastructure: they never import features or app.ts.',
      severity: 'error',
      from: { path: '^src/(lib|http)/' },
      to: { path: '^src/feature/|^src/app[.]ts$' }
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
        'A module may import values only from itself, src/lib and src/http; other modules are reached through injected APIs.',
      severity: 'error',
      from: { path: '^src/feature/([^/]+)/' },
      to: {
        path: '^src/',
        pathNot: ['^src/feature/$1/', '^src/(lib|http)/'],
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
