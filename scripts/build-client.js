const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');

const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const outFile = path.join(publicDir, 'bundle.js');
const sources = [
  'store.jsx',
  'board.jsx',
  'screens.jsx',
  'app.jsx',
];

const input = sources.map((fileName) => {
  const filePath = path.join(publicDir, fileName);
  return `// ---- ${fileName} ----\n${fs.readFileSync(filePath, 'utf8')}`;
}).join('\n\n');

const result = babel.transformSync(input, {
  filename: 'client-entry.js',
  babelrc: false,
  configFile: false,
  comments: false,
  sourceType: 'script',
  presets: [
    [require.resolve('@babel/preset-env'), { targets: { browsers: 'defaults' } }],
    [require.resolve('@babel/preset-react'), { runtime: 'classic' }],
  ],
});

fs.writeFileSync(outFile, `${result.code}\n`);
console.log(`Built ${path.relative(rootDir, outFile)}`);
