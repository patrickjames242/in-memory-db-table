import { transformFileAsync } from '@babel/core';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * the main purpose of this file is to reduce the decorator syntax throughout the project
 * so that projects utilizing this library that are not configured to handle the decorator syntax can still
 * use the library without needing to add additional babel plugins to their build process.
 * */

const __dirname = path.dirname(
  fileURLToPath(import.meta.url)
);
const rootDir = path.resolve(__dirname, '..');
// Reuse the repo's main Babel config, but force the "build" env below
// so the postbuild pass applies browser-oriented transforms.
const babelConfigFile = path.join(
  rootDir,
  'babel.config.cjs'
);
// tsup emits one ESM bundle and one CJS bundle; both need decorators
// lowered before publishing.
const distFiles = ['dist/index.js', 'dist/index.cjs'];

for (const relativePath of distFiles) {
  const filePath = path.join(rootDir, relativePath);
  // Re-run Babel over the generated bundle to transform decorator syntax
  // into plain JavaScript helper code while preserving source maps.
  const result = await transformFileAsync(filePath, {
    configFile: babelConfigFile,
    babelrc: false,
    envName: 'build',
    inputSourceMap: true,
    sourceMaps: true,
    sourceFileName: relativePath,
  });

  if (!result?.code || !result.map) {
    throw new Error(
      `Babel transform failed for ${relativePath}`
    );
  }

  // Replace the original tsup output in place so package.json can keep
  // pointing at the same dist entrypoints.
  await fs.writeFile(filePath, result.code);
  await fs.writeFile(
    `${filePath}.map`,
    JSON.stringify(result.map)
  );
}
