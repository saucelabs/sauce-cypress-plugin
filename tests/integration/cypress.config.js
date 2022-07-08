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
      };
      require('@saucelabs/cypress-plugin').default(on, config)

      return config
    }
  },
})
