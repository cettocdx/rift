const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const ts = require("typescript");
const esbuild = createRequire(require.resolve("trigger.dev/package.json"))(
  "esbuild",
);

// Static repository graph only. Never evaluate the task or import its runtime
// dependencies. External packages/nonliteral runtime imports still require the
// real Trigger discovery manifest before deployment can be accepted.
async function inspectCanaryGraph(root, injectedEntry, profile = "agent") {
  if (!["agent", "hack"].includes(profile))
    throw new Error("Unknown canary profile");
  const result = await esbuild.build({
    absWorkingDir: root,
    ...(injectedEntry
      ? { stdin: { ...injectedEntry, resolveDir: root, loader: "ts" } }
      : {
          entryPoints: [
            profile === "hack"
              ? "trigger-hack-canary/tasks.ts"
              : "trigger-canary/agent-long.ts",
          ],
        }),
    bundle: true,
    write: false,
    metafile: true,
    platform: "node",
    format: "esm",
    packages: "external",
    logLevel: "silent",
  });
  const inputs = Object.keys(result.metafile.inputs).filter(
    (file) => file !== "<stdin>",
  );
  const registrations = [];
  const modules = new Map();
  for (const file of Object.keys(result.metafile.inputs)) {
    const source = ts.createSourceFile(
      file,
      file === "<stdin>"
        ? injectedEntry.contents
        : fs.readFileSync(path.resolve(root, file), "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    modules.set(file, { source, factories: new Map() });
  }
  // Discover definitions before resolving calls: the calling module may appear
  // before its factory in the graph, and imports may rename the factory.
  for (const [file, { source, factories }] of modules) {
    const sdkBindings = new Map();
    for (const statement of source.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !statement.moduleSpecifier.text.startsWith("@trigger.dev/sdk")
      )
        continue;
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements)
          sdkBindings.set(
            element.name.text,
            element.propertyName?.text ?? element.name.text,
          );
      }
      if (bindings && ts.isNamespaceImport(bindings))
        sdkBindings.set(bindings.name.text, "namespace");
    }
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        let callee = node.expression;
        const members = [];
        while (ts.isPropertyAccessExpression(callee)) {
          members.unshift(callee.name.text);
          callee = callee.expression;
        }
        if (ts.isIdentifier(callee) && sdkBindings.has(callee.text)) {
          const binding = sdkBindings.get(callee.text);
          const method = (
            binding === "namespace" ? members : [binding, ...members]
          ).join(".");
          if (["task", "schemaTask", "schedules.task"].includes(method)) {
            const options = node.arguments[0];
            const id =
              options && ts.isObjectLiteralExpression(options)
                ? options.properties.find(
                    (p) =>
                      ts.isPropertyAssignment(p) &&
                      p.name.getText(source).replace(/["']/g, "") === "id",
                  )
                : undefined;
            // Resolve only a direct named factory parameter. Unknown dynamic
            // registration still produces null and fails the allowlist.
            let parent = node.parent;
            while (parent && !ts.isFunctionDeclaration(parent))
              parent = parent.parent;
            const parameterIndex =
              id && ts.isIdentifier(id.initializer) && parent?.name
                ? parent.parameters.findIndex(
                    (p) =>
                      ts.isIdentifier(p.name) &&
                      p.name.text === id.initializer.text,
                  )
                : -1;
            if (parameterIndex >= 0) {
              factories.set(parent.name.text, { method, parameterIndex });
            } else {
              registrations.push({
                file,
                method,
                id:
                  id && ts.isStringLiteral(id.initializer)
                    ? id.initializer.text
                    : null,
              });
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  for (const [file, { source, factories: localFactories }] of modules) {
    const factories = new Map(localFactories);
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement)) continue;
      const target = result.metafile.inputs[file].imports.find(
        (item) =>
          !item.external && item.original === statement.moduleSpecifier.text,
      );
      const targetFactories = target && modules.get(target.path)?.factories;
      const bindings = statement.importClause?.namedBindings;
      if (!targetFactories || !bindings || !ts.isNamedImports(bindings))
        continue;
      for (const binding of bindings.elements) {
        const factory = targetFactories.get(
          binding.propertyName?.text ?? binding.name.text,
        );
        if (factory) factories.set(binding.name.text, factory);
      }
    }
    const visitFactoryCalls = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        factories.has(node.expression.text)
      ) {
        const factory = factories.get(node.expression.text);
        const id = node.arguments[factory.parameterIndex];
        registrations.push({
          file,
          method: factory.method,
          id: id && ts.isStringLiteral(id) ? id.text : null,
        });
      }
      ts.forEachChild(node, visitFactoryCalls);
    };
    visitFactoryCalls(source);
  }
  return {
    repositoryModules: inputs.length,
    triggerFiles: inputs.filter((file) => file.startsWith("trigger/")).sort(),
    registrations,
    externalImports: [
      ...new Set(
        Object.values(result.metafile.outputs).flatMap((output) =>
          output.imports
            .filter((item) => item.external)
            .map((item) => item.path),
        ),
      ),
    ].sort(),
    warnings: result.warnings.map((warning) => warning.text),
  };
}

function assertCanary(report, includeHack) {
  const expected = [
    { file: "trigger/agent-long.ts", method: "task", id: "agent-long" },
    ...(includeHack
      ? [{ file: "trigger/hack-long.ts", method: "task", id: "hack-long" }]
      : []),
  ];
  const order = (rows) =>
    [...rows].sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    );
  if (
    report.warnings.length ||
    JSON.stringify(order(report.registrations)) !==
      JSON.stringify(order(expected)) ||
    report.triggerFiles.some(
      (file) =>
        ![
          "trigger/agent-long.ts",
          "trigger/stream-ids.ts",
          "trigger/streams.ts",
          ...(includeHack ? ["trigger/hack-long.ts"] : []),
        ].includes(file),
    )
  ) {
    throw new Error(
      includeHack
        ? "Expected agent-long and hack-long registrations only; inspect the transitive graph before proceeding."
        : "Expected agent-long registration only; inspect the transitive graph before proceeding.",
    );
  }
}
function assertAgentOnly(report) {
  assertCanary(report, false);
}
function assertHackCanary(report) {
  assertCanary(report, true);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 1 && args[0] === "--hack")) {
    throw new Error(
      "Usage: node scripts/verify-trigger-canary-graph.cjs [--hack]",
    );
  }
  const hack = args.includes("--hack");
  inspectCanaryGraph(
    path.resolve(__dirname, ".."),
    undefined,
    hack ? "hack" : "agent",
  )
    .then((report) => {
      (hack ? assertHackCanary : assertAgentOnly)(report);
      console.log(JSON.stringify(report, null, 2));
    })
    .catch((error) => {
      console.error(
        error instanceof Error ? error.message : "Canary graph check failed.",
      );
      process.exitCode = 1;
    });
}
module.exports = { inspectCanaryGraph, assertAgentOnly, assertHackCanary };
