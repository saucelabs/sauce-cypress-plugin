# sauce-cypress-plugin

This Cypress plugins reports each spec to your Sauce Labs account.

When you run tests with the Cypress CLI, using this plugin, test results and artifacts are uploaded to [Sauce Labs](https://app.saucelabs.com).

## Requirements

- Node 22
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

`sauce-cypress-plugin` is configurable through your cypress config file, e.g. `cypress.config.{js, cjs, mjs,ts}`.

Example `cypress.config.cjs`:

```javascript
const { defineConfig } = require("cypress");

module.exports = defineConfig({
  e2e: {
    setupNodeEvents(on, config) {
      require("@saucelabs/cypress-plugin").default(on, config, {
        region: "us-west-1",
        build: "myBuild",
        tags: ["example1"],
      });
      return config;
    },
  },
});
```

Example `cypress.config.mjs`:

```javascript
import { defineConfig } from "cypress";
import reporter from "@saucelabs/cypress-plugin";

export default defineConfig({
  e2e: {
    setupNodeEvents(on, config) {
      reporter.default(on, config, {
        region: "us-west-1",
        build: "myBuild",
        tags: ["example1"],
      });
      return config;
    },
  },
});
```

Example `cypress.config.ts`:

```typescript
import { defineConfig } from "cypress";
import Reporter, { Region } from "@saucelabs/cypress-plugin";

export default defineConfig({
  e2e: {
    setupNodeEvents(on, config) {
      Reporter(on, config, {
        region: Region.USWest1, // us-west-1 is the default
        build: "myBuild",
        tags: ["example1"],
      });
      return config;
    },
  },
});
```

### Plugin Setup (Cypress 9 and below)

Register the plugin in your project's `cypress/plugins/index.js`:

```javascript
module.exports = (on, config) => {
  // Other plugins you may already have.
  // ...
  require("@saucelabs/cypress-plugin").default(on, config, {
    region: "us-west-1",
    build: "myBuild",
    tags: ["example1"],
  });
  return config;
};
```

## Plugin Options

| Name                | Description                                                                                                                                                                                                                                                                                                                | Type                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `build`             | Sets a build ID. <br> Default: `''`                                                                                                                                                                                                                                                                                        | `string`                      |
| `tags`              | Tags to add to the uploaded Sauce job. <br> Default: `[]`                                                                                                                                                                                                                                                                  | `string[]`                    |
| `region`            | Sets the region. <br> Default: `us-west-1`                                                                                                                                                                                                                                                                                 | `us-west-1` \| `eu-central-1` |
| `artifactUploadDir` | If specified, automatically upload files from this directory, **per spec**. e.g. files in `{artifactUploadDir}/{specName}/` would be uploaded to the job that ran `spec_name`. The directory is relative to your cypress config file. The directory will be deleted at the beginning of the next run. Default: `undefined` | `string`                      |

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

## Upload Assets Task

This task allows you to upload assets (such as images or logs) to a specific Sauce Labs job associated with the test spec.

| Parameter           | Type                 | Description                                                                                                                                                               |
| ------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spec`              | `string`             | Path to the spec file being executed, typically provided by `__filename`.                                                                                                 |
| `assets`            | `Asset` \| `Asset[]` | Can be a single `Asset` object or an array of `Asset` objects to be uploaded to Sauce Labs. Each `Asset` should contain a `filename` and either a `path` or `data`.       |
| `assets[].path`     | `string`             | **Required**. Path to the file on the local filesystem (e.g., `"pics/this-is-fine.png"`).                                                                                 |
| `assets[].filename` | `string`             | **Optional**. The name of the file to upload, as it should appear in Sauce Labs (e.g., `"this-is-fine.png"`). If not provided, the file path basename is used by default. |

### Example Usage

```javascript
it("upload assets", () => {
  // Single file upload.
  cy.task("sauce:uploadAssets", {
    spec: __filename,
    assets: { path: "pics/this-is-fine.png" },
  });

  // Multiple files upload.
  cy.task("sauce:uploadAssets", {
    spec: __filename,
    assets: [
      { path: "pics/this-is-fine.png" },
      { path: "test.txt", filename: "test.log" },
    ],
  });
});
```

## Real-life Example

[tests/integration/](https://github.com/saucelabs/sauce-cypress-plugin/tree/main/tests/integration/) folder will present an integration example with [Cypress' Kitchensink](https://github.com/cypress-io/cypress-example-kitchensink/tree/master/cypress/e2e/2-advanced-examples) tests set.

## Development

### Setup

1. Install dependencies: `npm ci`
2. Setup git hooks: `npm run prepare`. This setups pre-commit hooks to format
   and lint staged code.
3. Build: `npm run build`

### Running Locally

There are integration tests included in the project in the [tests/integration/](https://github.com/saucelabs/sauce-cypress-plugin/tree/main/tests/integration/) directory:

1. `cd tests/integration`
2. `npx cypress run`

In the output of the run, the plugin prints out the job URLs where the test
results are uploaded to.

You can also use [npm link](https://docs.npmjs.com/cli/v11/commands/npm-link)
to symlink the plugin into an existing cypress project.

### Debug

You can run your cypress tests with the environment variable `DEBUG="@saucelabs/cypress-plugin:*"` to see additional debug output.

## Releasing

New versions are released with a manual GitHub Actions workflow.

1. Go to https://github.com/saucelabs/sauce-cypress-plugin/actions/workflows/release.yml
2. Run the workflow and specify the branch and release type (`major`, `minor`,
   or `patch`).
