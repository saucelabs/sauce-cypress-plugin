# sauce-cypress-plugin

This Cypress plugins reports each spec to your Sauce Labs account.

When you run tests with the Cypress CLI, using this plugin, test results and artifacts are uploaded to [Sauce Labs](https://app.saucelabs.com).

## Requirements

- Node 14
- Cypress

## Installation

Install from npm:
```
npm install @saucelabs/cypress-plugin
```

## Configuration

### Sauce Labs Credentials

`SAUCE_USERNAME` and `SAUCE_ACCESS_KEY` environment variables need to be set for the plugin to report your results to
Sauce Labs. Your Sauce Labs Username and Access Key are available from your
[dashboard](https://app.saucelabs.com/user-settings).

### Plugin Setup (Cypress 10 and above)

`sauce-cypress-plugin` is configurable through your cypress config file, e.g. `cypress.config.{js,ts}`.

Example `cypress.config.js`:
```javascript
const {defineConfig} = require('cypress')

module.exports = defineConfig({
  e2e: {
    setupNodeEvents(on, config) {
      require('@saucelabs/cypress-plugin').default(on, config,
        {
          region: 'us-west-1',
          build: 'myBuild',
          tags: ['example1']
        }
      )
      return config
    }
  },
})
```

Example `cypress.config.ts`:
```typescript
import {defineConfig} from 'cypress'
import Reporter, {Region} from '@saucelabs/cypress-plugin'

export default defineConfig({
  e2e: {
    setupNodeEvents(on, config) {
      Reporter(on, config,
        {
          region: Region.USWest1, // us-west-1 is the default
          build: 'myBuild',
          tags: ['example1']
        }
      )
      return config
    }
  },
})
```

### Plugin Setup (Cypress 9 and below)

Register the plugin in your project's `cypress/plugins/index.js`:
```javascript
module.exports = (on, config) => {
  // Other plugins you may already have.
  // ...
  require('@saucelabs/cypress-plugin').default(on, config,
    {
      region: 'us-west-1',
      build: 'myBuild',
      tags: ['example1']
    }
  )
  return config
}
```

## Run a Test 🚀
Trigger cypress to run a test
```
cypress run
```

The jobs will be reported to Sauce Labs
```
Jobs reported to Sauce Labs:

  ┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
  │  Spec                                        Sauce Labs job URL                                                │
  ├────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │  cypress/e2e/1-getting-started/todo.cy.js    https://app.saucelabs.com/tests/b30ffb871827408c81e454103b946c99  │
  └────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Real-life example

[tests/integration/](https://github.com/saucelabs/sauce-cypress-plugin/tree/main/tests/integration/) folder will present an integration example with [Cypress' Kitchensink](https://github.com/cypress-io/cypress-example-kitchensink/tree/master/cypress/e2e/2-advanced-examples) tests set.
