# sauce-cypress-plugin

This Cypress plugins reports each spec to your Sauce Labs account.

## Installation

Install from npm:
```
npm install sauce-cypress-plugin
```

Register the plugin in your project's `cypress/plugins/index.js`:
```
module.exports = (on, config) => {
  // Other plugins you may already have.
  require('sauce-cypress-plugin')(on, config);
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


