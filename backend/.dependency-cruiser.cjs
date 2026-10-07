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
      comment:
        'lib/ and http/ are infrastructure: they never import features, routes, services or app[.]ts.',
      severity: 'error',
      from: { path: '^src/(lib|http)/' },
      to: { path: '^src/(feature|route|service)/|^src/app[.]ts$' }
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
        path: '^src/feature/[^/]+/',
        pathNot: ['^src/feature/$1/', '^src/feature/[^/]+/index[.]ts$']
      }
    },
    {
      name: 'root-uses-public-api',
      comment: 'Top-level src files (app[.]ts, index[.]ts) reach modules only through index[.]ts.',
      severity: 'error',
      from: { path: '^src/[^/]+[.]ts$' },
      to: { path: '^src/feature/[^/]+/', pathNot: '^src/feature/[^/]+/index[.]ts$' }
    }
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types']
    }
  }
}
