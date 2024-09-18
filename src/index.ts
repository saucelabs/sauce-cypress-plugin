import Reporter from './reporter';
import Table from 'cli-table3';
import chalk from 'chalk';
import BeforeRunDetails = Cypress.BeforeRunDetails;
import PluginConfigOptions = Cypress.PluginConfigOptions;
import PluginEvents = Cypress.PluginEvents;
import Spec = Cypress.Spec;
import { Region } from './api';
import fs from 'fs';
import path from 'path';

// Configuration options for the Reporter.
export interface Options {
  region?: Region;
  build?: string;
  tags?: string[];
  webAssetsDir?: string;
  addArtifacts?: string; // Add this line to include the addArtifacts property
}

interface ReporterOptions {
  addArtifacts?: string;
  // other properties if needed
}

let reporterInstance: Reporter & { options?: ReporterOptions };
const reportedSpecs: { name: string; jobURL: string }[] = [];

const accountIsSet = function () {
  return process.env.SAUCE_USERNAME && process.env.SAUCE_ACCESS_KEY;
};

const cleanArtifacts = function (artifactsPath: string) {
  console.log(`Attempting to clean artifacts at: ${artifactsPath}`);
  if (fs.existsSync(artifactsPath)) {
    console.log(`Path exists: ${artifactsPath}`);
    fs.readdirSync(artifactsPath).forEach((file: string) => {
      const curPath = path.join(artifactsPath, file);
      if (fs.lstatSync(curPath).isDirectory()) {
        cleanArtifacts(curPath);
      } else {
        console.log(`Deleting file: ${curPath}`);
        fs.unlinkSync(curPath);
      }
    });
    console.log(`Removing directory: ${artifactsPath}`);
    fs.rmdirSync(artifactsPath);
  } else {
    console.log(`Path does not exist: ${artifactsPath}`);
  }
};

const onBeforeRun = function (details: BeforeRunDetails) {
  console.log('onBeforeRun function called');
  if (!accountIsSet()) {
    console.log('Account is not set');
    return;
  }
  reporterInstance.cypressDetails = details;

  console.log('Reporter options:', reporterInstance.options);
  if (reporterInstance.options?.addArtifacts) {
    console.log(
      'Cleaning artifacts at:',
      reporterInstance.options.addArtifacts,
    );
    cleanArtifacts(reporterInstance.options.addArtifacts);
  }
};

const onAfterSpec = async function (
  spec: Spec,
  results: CypressCommandLine.RunResult,
) {
  if (!accountIsSet()) {
    return;
  }

  try {
    const job = await reporterInstance.reportSpec(results);
    reportedSpecs.push({
      name: spec.name,
      jobURL: job.url,
    });

    console.log(`Report created: ${job.url}`);

    await reporterInstance.reportTestRun(results, job.id);
  } catch (e) {
    if (e instanceof Error) {
      console.error(`Failed to report ${spec.name} to Sauce Labs:`, e.message);
    }
  }
};

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
      left: '  │',
      'left-mid': '  ├',
      middle: '',
      'mid-mid': '',
      right: '│',
      'bottom-mid': '',
      'bottom-left': '  └',
    },
  });

  for (const spec of reportedSpecs) {
    table.push([spec.name, spec.jobURL]);
  }

  console.log('\n');
  console.log(chalk['gray']('='.repeat(100)));
  console.log('\nJobs reported to Sauce Labs:\n');
  console.log(table.toString());
};

function isFailedRunResult(
  maybe:
    | CypressCommandLine.CypressRunResult
    | CypressCommandLine.CypressFailedRunResult,
): maybe is CypressCommandLine.CypressFailedRunResult {
  return (
    (maybe as CypressCommandLine.CypressFailedRunResult).status === 'failed'
  );
}

/**
 * Converts the results of a cypress run (the result from `after:run` or `cypress.run()`) to a sauce test report.
 *
 * @param results cypress run results, either from `after:run` or `cypress.run()`
 */
export async function afterRunTestReport(
  results:
    | CypressCommandLine.CypressRunResult
    | CypressCommandLine.CypressFailedRunResult,
) {
  const rep = new Reporter(undefined);

  const testResults: CypressCommandLine.RunResult[] = [];
  if (!isFailedRunResult(results)) {
    results.runs.forEach((run) => {
      testResults.push(run);
    });
  }

  const reportJSON = await rep.createSauceTestReport(testResults);
  const assets = rep.collectAssets(testResults, reportJSON);
  rep.syncAssets(assets);
  return reportJSON;
}

export default function (
  on: PluginEvents,
  config: PluginConfigOptions,
  opts?: Options,
) {
  console.log('Initializing Reporter with options:', opts);
  reporterInstance = new Reporter(undefined, opts);
  reporterInstance.options = opts; // Ensure options are assigned

  on('before:run', (details) => {
    console.log('before:run event triggered');
    onBeforeRun(details);
  });
  on('after:run', onAfterRun);
  on('after:spec', onAfterSpec);
  return config;
}
