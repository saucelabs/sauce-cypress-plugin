import Reporter from './reporter'
import Table from "cli-table3";
import chalk from "chalk";
import BeforeRunDetails = Cypress.BeforeRunDetails;
import PluginConfigOptions = Cypress.PluginConfigOptions;
import PluginEvents = Cypress.PluginEvents;

let reporterInstance: Reporter;
const reportedSpecs: { name: any; jobURL: string; }[] = [];

const accountIsSet = function () {
  return process.env.SAUCE_USERNAME && process.env.SAUCE_ACCESS_KEY;
}

const onBeforeRun = function (details: BeforeRunDetails) {
  if (!accountIsSet()) {
    return;
  }
  reporterInstance = new Reporter(details);
};

const onAfterSpec = async function (spec: any, results: any) {
  if (!accountIsSet()) {
    return;
  }
  const {url} = await reporterInstance.reportSpec(results);
  reportedSpecs.push({
    name: spec.name,
    jobURL: url,
  });
  console.log(`Spec file has been reported to Sauce Labs: ${url}`);
}

const onAfterRun = function () {
  if (!accountIsSet() || reportedSpecs.length == 0) {
    return;
  }

  const table = new Table({
    head: ['Spec', 'Sauce Labs job URL'],
    style: {
      head: [],
      'padding-left': 2,
      'padding-right': 2,
    },
    chars: {
      'top-mid': '',
      'top-left': '  ┌',
      'left': '  │',
      'left-mid': '  ├',
      'middle': '',
      'mid-mid': '',
      'right': '│',
      'bottom-mid': '',
      'bottom-left': '  └',
    }
  });

  for (const spec of reportedSpecs) {
    table.push([spec.name, spec.jobURL]);
  }

  console.log('\n');
  console.log(chalk['gray']('='.repeat(100)));
  console.log('\nJobs reported to Sauce Labs:\n');
  console.log(table.toString());
}

/**
 * Converts the results of a cypress run (the result from `after:run` or `cypress.run()`) to a sauce test report.
 *
 * @param results cypress run results, either from `after:run` or `cypress.run()`
 * @returns {TestRun}
 */
function afterRunTestReport(results: any) {
  const rep = new Reporter(undefined);

  const testResults: any[] = [];
  results.runs?.forEach((run: any) => {
    testResults.push({spec: run.spec, tests: run.tests, video: run.video});
  });

  return rep.createSauceTestReport(testResults);
}

module.exports = {afterRunTestReport}

module.exports.default = function (on: PluginEvents, config: PluginConfigOptions) {
  on('before:run', onBeforeRun);
  on('after:run', onAfterRun);
  on('after:spec', onAfterSpec);
  return config;
}
