const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildTypeScriptConfig } = require('../ui-release-preview.cjs');
test('custom preview builds use isolated generated types without changing source configuration', () => {
 const base={compilerOptions:{strict:true},include:['**/*.ts','.next/types/**/*.ts'],exclude:['node_modules','.next-*/**']};
 const before=JSON.stringify(base);
 const config=buildTypeScriptConfig(base,'.next-ui-release-test',['.next','.next-ui-release-old','.next-ui-release-test']);
 assert.equal(JSON.stringify(base),before);
 assert.ok(config.include.includes('.next-ui-release-test/types/**/*.ts'));
 assert.ok(config.exclude.includes('.next-ui-release-old'));
 assert.ok(!config.exclude.includes('.next-ui-release-test'));
 assert.ok(!config.exclude.includes('.next-*/**'));
});
