import Reporter from "./reporter";
import Table from "cli-table3";
import chalk from "chalk";
import path from "node:path";
import fs from "node:fs";
import { Asset } from "@saucelabs/testcomposer";
import BeforeRunDetails = Cypress.BeforeRunDetails;
import PluginConfigOptions = Cypress.PluginConfigOptions;
import PluginEvents = Cypress.PluginEvents;
import Spec = Cypress.Spec;
import { Region } from "./api";

// Configuration options for the Reporter.
export interface Options {
  region?: Region;
  build?: string;
  tags?: string[];
  webAssetsDir?: string;

  artifactUploadDir?: string;
}

let reporterInstance: Reporter;
const reportedSpecs: { name: string; jobURL: string }[] = [];

// Maps spec names to their associated assets, cached for later upload.
let specToAssets: Map<string, Asset[]>;

const isAccountSet = function () {
  return process.env.SAUCE_USERNAME && process.env.SAUCE_ACCESS_KEY;
};

const onBeforeRun = function (details: BeforeRunDetails) {
  if (!isAccountSet()) {
    return;
  }
  reporterInstance.cypressDetails = details;
};

const onAfterSpec = async function (
  spec: Spec,
  results: CypressCommandLine.RunResult,
) {
  if (!isAccountSet()) {
    return;
  }

  try {
    const job = await reporterInstance.reportSpec(results, specToAssets);
    if (!job?.id || !job?.url) {
      return;
    }
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
  if (!process.env.SAUCE_VM && !isAccountSet()) {
    console.warn(
      "Credentials not set! SAUCE_USERNAME and SAUCE_ACCESS_KEY environment " +
        "variables must be defined in order for reports to be uploaded to Sauce Labs.",
    );
    return;
  }
  if (reportedSpecs.length == 0) {
    return;
  }

  const table = new Table({
    head: ["Spec", "Sauce Labs job URL"],
    style: {
      head: [],
      "padding-left": 2,
      "padding-right": 2,
    },
    chars: {
      "top-mid": "",
      "top-left": "  ┌",
      left: "  │",
      "left-mid": "  ├",
      middle: "",
      "mid-mid": "",
      right: "│",
      "bottom-mid": "",
      "bottom-left": "  └",
    },
  });

  for (const spec of reportedSpecs) {
    table.push([spec.name, spec.jobURL]);
  }

  console.log("\n");
  console.log(chalk["gray"]("=".repeat(100)));
  console.log("\nJobs reported to Sauce Labs:\n");
  console.log(table.toString());
};

function isFailedRunResult(
  maybe:
    | CypressCommandLine.CypressRunResult
    | CypressCommandLine.CypressFailedRunResult,
): maybe is CypressCommandLine.CypressFailedRunResult {
  return (
    (maybe as CypressCommandLine.CypressFailedRunResult).status === "failed"
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
  const assets = await rep.collectAssets(testResults, reportJSON);
  rep.syncAssets(assets);
  return reportJSON;
}

/**
 * Temporarily caches assets for the current spec test job.
 * Assets collected by this function are stored and later uploaded in `onAfterSpec`.
 **/
const cacheAssets = ({
  spec,
  ...assets
}: {
  spec: string;
  assets: Asset[];
}): null => {
  if (!spec) {
    throw new Error("'spec' is required.");
  }
  const assetsArray = Object.values(assets).flat();
  if (assetsArray.length === 0) {
    throw new Error("'assets' is required.");
  }
  assetsArray.forEach((asset: Asset) => {
    if (!asset.path) {
      throw new Error("'path' is required.");
    }
    const resolvedPath = path.resolve(asset.path);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`File not found at path '${resolvedPath}'.`);
    }
    asset.data = fs.createReadStream(resolvedPath);
    if (!asset.filename) {
      asset.filename = path.basename(asset.path);
    }
  });

  // The spec name in the Cypress report uses the basename of the spec file.
  // To ensure matching during upload, convert it to the basename here as well.
  const specName = path.basename(spec);
  const currAssets = specToAssets.get(specName) || [];
  currAssets.push(...assetsArray);
  specToAssets.set(specName, currAssets);

  return null; // Cypress task requirement.
};

export default function (
  on: PluginEvents,
  config: PluginConfigOptions,
  opts?: Options,
) {
  reporterInstance = new Reporter(undefined, opts);
  specToAssets = new Map();

  on("task", {
    "sauce:uploadAssets": cacheAssets,
  });
  on("before:run", onBeforeRun);
  on("after:run", onAfterRun);
  on("after:spec", onAfterSpec);
  return config;
}
