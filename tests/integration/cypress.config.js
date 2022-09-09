const {defineConfig} = require('cypress')

module.exports = defineConfig({
  e2e: {
    setupNodeEvents(on, config) {
      require('../../src/index').default(on, config, {
        build: "Cypress Kitchensink Example",
        tags: [
          "plugin",
          "kitchensink",
          "cypress"
        ],
        region: "us-west-1",
      })

      return config
    }
  },
})
