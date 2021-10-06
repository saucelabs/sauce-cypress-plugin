# sauce-cypress-plugin

This Cypress plugins reports each spec to your Sauce Labs account. When you run tests with the Cypress CLI, using this plugin, you can send the test results to [Sauce Labs](https://app.saucelabs.com).

## Installation

Install from npm:
```
npm install @saucelabs/cypress-plugin
```

Register the plugin in your project's `cypress/plugins/index.js`:
```
module.exports = (on, config) => {
  // Other plugins you may already have.
  require('@saucelabs/cypress-plugin')(on, config);
  return config
}
```

## Configuration

### Sauce Labs credentials

`SAUCE_USERNAME` and `SAUCE_ACCESS_KEY` environment variables needs to be set to
allow the plugin to report your results to Sauce Labs.
Your Sauce Labs Username and Access Key are available from your
[dashboard](https://app.saucelabs.com/user-settings).

### Plugin configuration

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
