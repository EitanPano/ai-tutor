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
