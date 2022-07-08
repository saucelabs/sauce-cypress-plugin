# sauce-cypress-plugin

This Cypress plugins reports each spec to your Sauce Labs account.

When you run tests with the Cypress CLI, using this plugin, test results and artifacts are uploaded to [Sauce Labs](https://app.saucelabs.com).

## Installation

Install from npm:
```
npm install @saucelabs/cypress-plugin
```

## Configuration

### Sauce Labs credentials

`SAUCE_USERNAME` and `SAUCE_ACCESS_KEY` environment variables needs to be set to
allow the plugin to report your results to Sauce Labs.
Your Sauce Labs Username and Access Key are available from your
[dashboard](https://app.saucelabs.com/user-settings).

### Plugin configuration for cypress 10+

`sauce-cypress-plugin` is configurable through your cypress config file, e.g. `cypress.config.{js,ts}`.

Example:
```
const { defineConfig } = require('cypress')

module.exports = defineConfig({
  e2e: {
    setupNodeEvents(on, config) {
      config.sauce = {
        build: "Cypress Kitchensink Example",
        tags: [
          "plugin",
          "kitchensink",
          "cypress"
        ],
        region: "us-west-1",
      }
      require('@saucelabs/cypress-plugin').default(on, config)

      return config
    }
  },
})
```

| Name | Description | Kind |
| --- | --- | --- | 
| build | Sets a build ID | String |
| tags | Sets tags | Array of String |
| region | Sets the region (Default: `us-west-1`) | String |

### Plugin configuration under cypress 10

Register the plugin in your project's `cypress/plugins/index.js`:
```
module.exports = (on, config) => {
  // Other plugins you may already have.
  require('@saucelabs/cypress-plugin').default(on, config);
  return config
}
```

`sauce-cypress-plugin` is configurable through your `cypress.json` file.

Example:
```
{
  "sauce": {
    "build": "Cypress Kitchensink Example",
    "tags": [
      "plugin",
      "kitchensink",
      "cypress"
    ],
    "region": "us-west-1",
  }
}
```

| Name | Description | Kind |
| --- | --- | --- | 
| build | Sets a build ID | String |
| tags | Sets tags | Array of String |
| region | Sets the region (Default: `us-west-1`) | String |

## Real-life example

[tests/integration/](https://github.com/saucelabs/sauce-cypress-plugin/tree/main/tests/integration/) folder will present an integration example with [Cypress' Kitchensink](https://github.com/cypress-io/cypress-example-kitchensink/tree/master/cypress/integration/2-advanced-examples) tests set.
