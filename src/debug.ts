import Debug from 'debug';

// Wrap debug module to ensure common namespace
export default function (name: string) {
  return Debug(`@saucelabs/cypress-plugin:${name}`);
}
