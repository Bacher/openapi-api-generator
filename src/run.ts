#!/usr/bin/env node

import path from 'path';
import yargs from 'yargs/yargs';
import {hideBin} from 'yargs/helpers';
import mkdirp from 'mkdirp';
import fs from 'fs/promises';

import {generate} from './generator';
import {parseOpenapi} from './parser';

const DEBUG = true;

async function run() {
  const {argv} = await yargs(hideBin(process.argv))
    .scriptName(require('../package.json').name)
    .option('out', {
      alias: 'o',
      description: 'Output directory',
      default: 'out',
      defaultDescription: './out',
    })
    .option('namespace', {
      description: 'Typescript namespace for API types',
      default: '',
    })
    .option('use-enums', {
      type: 'boolean',
      description: 'Use Typescript enums for openapi enum values',
      default: false,
    })
    .alias('help', 'h')
    .alias('version', 'v')
    .example([
      ['$0 api/openapi.yaml', 'Process api/openapi.yaml file'],
      ['$0 -o ./gen api/openapi.yaml', 'Collect generated api in ./gen directory'],
      ['$0 -o ./gen api/openapi.yaml --use-enums', 'Generate api with enums'],
    ]);

  const args = await argv;

  const entryFile = args['_'][0];

  if (!entryFile) {
    console.error('Need to specify openapi file');
    process.exit(1);
  }

  const fullEntryPath = path.resolve(entryFile.toString());
  const outDir = path.resolve(args.out);

  const {types, apiMethods} = await parseOpenapi(fullEntryPath);

  if (DEBUG) {
    await fs.writeFile(
      path.join(outDir, 'types.ast.json'),
      JSON.stringify(
        [...types.entries()].reduce((acc, [name, value]) => {
          acc[name] = value;
          return acc;
        }, {}),
        null,
        2,
      ),
    );
  }

  try {
    await mkdirp(outDir);
  } catch {}

  await generate({types, apiMethods, namespace: args.namespace, useEnums: args['use-enums']}, outDir);
}

run().catch((err) => {
  console.error('Fatal Error');
  console.error(err);
  process.exit(1);
});
