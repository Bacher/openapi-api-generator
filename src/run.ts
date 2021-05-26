#!/usr/bin/env node

import path from 'path';
import yargs from 'yargs/yargs';
import {hideBin} from 'yargs/helpers';
import mkdirp from 'mkdirp';

import {generate} from './generator';
import {parseOpenapi} from './parser';

async function run() {
  const {argv} = await yargs(hideBin(process.argv))
    .scriptName(require('../package.json').name)
    .option('out', {
      alias: 'o',
      description: 'Output directory',
      default: 'out',
      defaultDescription: './out',
    })
    .alias('help', 'h')
    .alias('version', 'v')
    .example([
      ['$0 api/openapi.yaml', 'Process api/openapi.yaml file'],
      ["$0 -o ./api api/openapi.yaml'", 'Collect generated api in ./api directory'],
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

  try {
    await mkdirp(outDir);
  } catch {}

  await generate({types, apiMethods}, outDir);
}

run().catch((err) => {
  console.error('Fatal Error');
  console.error(err);
  process.exit(1);
});
