import Reporter, {RunResult} from './reporter'
import Table from "cli-table3";
import chalk from "chalk";
import BeforeRunDetails = Cypress.BeforeRunDetails;
import PluginConfigOptions = Cypress.PluginConfigOptions;
import PluginEvents = Cypress.PluginEvents;
import Spec = Cypress.Spec;
import {Region} from "./region";

export {Region}

// Configuration options for the Reporter.
export interface Options {
  region?: Region
  build?: string
  tags?: string[]
}

let reporterInstance: Reporter;
const reportedSpecs: { name: string; jobURL: string; }[] = [];

const accountIsSet = function () {
  return process.env.SAUCE_USERNAME && process.env.SAUCE_ACCESS_KEY;
}

const onBeforeRun = function (details: BeforeRunDetails) {
  if (!accountIsSet()) {
    return;
  }
  reporterInstance.cypressDetails = details;
};

const onAfterSpec = async function (spec: Spec, results: CypressCommandLine.RunResult) {
  if (!accountIsSet()) {
    return;
  }

  reporterInstance.reportSpec(results as RunResult).then(
    job => {
      reportedSpecs.push({
        name: spec.name,
        jobURL: job.url,
      });

      console.log(`Report created: ${job.url}`);
    }
  ).catch(e => console.error(`Failed to report ${spec.name} to Sauce Labs:`, e.message))
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
export function afterRunTestReport(results: CypressCommandLine.CypressRunResult) {
  const rep = new Reporter(undefined);

  const testResults: any[] = [];
  results.runs?.forEach(run => {
    testResults.push({spec: run.spec, tests: run.tests, video: run.video});
  });

  return rep.createSauceTestReport(testResults);
}

export default function (on: PluginEvents, config: PluginConfigOptions, opts?: Options) {
  reporterInstance = new Reporter(undefined, opts);

  on('before:run', onBeforeRun);
  on('after:run', onAfterRun);
  on('after:spec', onAfterSpec);
  return config;
}
