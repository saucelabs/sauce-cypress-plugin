import * as fs from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import * as stream from "node:stream";

import * as Cypress from "cypress";
import BeforeRunDetails = Cypress.BeforeRunDetails;
import TestResult = CypressCommandLine.TestResult;
import RunResult = CypressCommandLine.RunResult;

import { Attachment, Status, TestRun } from "@saucelabs/sauce-json-reporter";
import { Asset, TestComposer } from "@saucelabs/testcomposer";

import { Options } from "./index";
import { TestRuns as TestRunsAPI, TestRunRequestBody } from "./api";
import { CI } from "./ci";

// Once the UI is able to dynamically show videos, we can remove this and simply use whatever video name
// the framework provides.
const VIDEO_FILENAME = "video.mp4";

// Types of attachments relevant for UI display.
const webAssetsTypes = [
  ".log",
  ".json",
  ".xml",
  ".txt",
  ".mp4",
  ".webm",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
];

// TestContext represents a 'describe' or 'context' block in Cypress.
interface TestContext {
  name: string;
  testResult?: TestResult;
  children: Map<string, TestContext>;
}

export default class Reporter {
  public cypressDetails: BeforeRunDetails | undefined;

  private opts: Options;
  private readonly videoStartTime: number | undefined;
  private testComposer?: TestComposer;
  private testRunsApi?: TestRunsAPI;
  /*
   * When webAssetsDir is set, this reporter syncs web UI-related attachments
   * from the Cypress output directory to the specified web assets directory.
   * It can be specified through opts.webAssetsDir or
   * the SAUCE_WEB_ASSETS_DIR environment variable.
   * Designed exclusively for Sauce VM.
   *
   * Background: A flat uploading approach previously led to file overwrites when
   * files from different directories shared names, which is causing uploading
   * duplicate captured videos in Cypress tests.
   * We've introduced the saucectl retain artifact feature to bundle the entire
   * output folder, preventing such overwrites but leading to the upload
   * of duplicate assets.
   *
   * With changes in the Cypress runner that separate the output from the sauce
   * assets directory, this feature now copies only necessary attachments,
   * avoiding duplicate assets and supporting UI display requirements.
   */
  private webAssetsDir?: string;

  constructor(
    cypressDetails: BeforeRunDetails | undefined,
    opts: Options = { region: "us-west-1" },
  ) {
    let reporterVersion = "unknown";
    try {
      const packageData = JSON.parse(
        fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"),
      );
      reporterVersion = packageData.version;
    } catch {
      /* empty */
    }

    if (!opts.region) {
      opts.region = "us-west-1";
    }
    this.opts = opts;

    this.cypressDetails = cypressDetails;

    this.videoStartTime = process.env.SAUCE_VIDEO_START_TIME
      ? new Date(process.env.SAUCE_VIDEO_START_TIME).getTime()
      : undefined;

    this.webAssetsDir = opts.webAssetsDir || process.env.SAUCE_WEB_ASSETS_DIR;
    if (this.webAssetsDir && !fs.existsSync(this.webAssetsDir)) {
      fs.mkdirSync(this.webAssetsDir, { recursive: true });
    }

    if (opts.artifactUploadDir && fs.existsSync(opts.artifactUploadDir)) {
      fs.rmSync(opts.artifactUploadDir, { recursive: true, force: true });
    }

    if (process.env.SAUCE_VM) {
      return;
    }

    this.testComposer = new TestComposer({
      region: this.opts.region || "us-west-1",
      username: process.env.SAUCE_USERNAME || "",
      accessKey: process.env.SAUCE_ACCESS_KEY || "",
      headers: { "User-Agent": `cypress-reporter/${reporterVersion}` },
    });
    this.testRunsApi = new TestRunsAPI({
      region: this.opts.region || "us-west-1",
      username: process.env.SAUCE_USERNAME || "",
      accessKey: process.env.SAUCE_ACCESS_KEY || "",
    });
  }

  // Reports a spec as a Job on Sauce.
  async reportSpec(result: RunResult, specAssetsMap: Map<string, Asset[]>) {
    if (!this.testComposer) {
      return;
    }
    let suiteName = result.spec.name;
    if (this.opts.build) {
      suiteName = `${this.opts.build} - ${result.spec.name}`;
    }

    const stats = result.stats;

    const job = await this.testComposer.createReport({
      name: suiteName,
      startTime: result.stats.startedAt,
      endTime: stats.endedAt,
      framework: "cypress",
      frameworkVersion: this.cypressDetails?.cypressVersion || "0.0.0",
      passed: result.stats.failures === 0,
      tags: this.opts.tags,
      build: this.opts.build,
      browserName: this.cypressDetails?.browser?.name,
      browserVersion: this.cypressDetails?.browser?.version,
      platformName: this.getOsName(this.cypressDetails?.system?.osName),
    });

    const report = await this.createSauceTestReport([result]);
    const assets = await this.collectAssets([result], report);
    assets.push(...(specAssetsMap.get(result.spec.name) || []));
    await this.uploadAssets(job.id, assets);

    return job;
  }

  // Reports a spec as a TestRun to Sauce.
  async reportTestRun(result: RunResult, jobId: string) {
    if (!this.testRunsApi) {
      return;
    }
    const specStartTime = new Date(result.stats.startedAt).getTime();
    let elapsedTime = 0;

    const runs = result.tests
      .filter((test) => test.attempts.length > 0)
      .map((test) => {
        const req: TestRunRequestBody = {
          name: test.title.join(" "),
          start_time: new Date(specStartTime + elapsedTime).toISOString(),
          end_time: new Date(
            specStartTime + elapsedTime + test.duration,
          ).toISOString(),
          duration: test.duration,

          browser: `${this.cypressDetails?.browser?.name} ${this.cypressDetails?.browser?.version}`,
          build_name: this.opts.build,
          ci: {
            ref_name: CI.refName,
            commit_sha: CI.sha,
            repository: CI.repo,
            branch: CI.refName,
          },
          framework: "cypress",
          platform: "other",
          os: this.getOsName(this.cypressDetails?.system?.osName),
          sauce_job: {
            id: jobId,
          },
          status: stateToStatus(test.state),
          tags: this.opts.tags,
          type: "web",
        };

        elapsedTime += test.duration;

        if (test.displayError) {
          req.errors = [
            {
              message: test.displayError || "",
              path: result.spec.relative,
            },
          ];
        }
        return req;
      });

    await this.testRunsApi.create(runs);
  }

  /**
   * Converts data into a readable stream.
   * This method creates a new readable stream instance, pushes the provided data into it,
   * and then signals the end of the stream.
   *
   * @param {unknown} data - The data to be converted into a stream.
   * @returns {stream.Readable} A readable stream containing the provided data.
   */
  ReadableStream(data: unknown): stream.Readable {
    const s = new stream.Readable();
    s.push(data);
    s.push(null); // Signal the end of the stream
    return s;
  }

  async uploadAssets(jobId: string | undefined, assets: Asset[]) {
    if (!this.testComposer || !jobId) {
      return;
    }
    await this.testComposer.uploadAssets(jobId, assets).then(
      (resp) => {
        if (resp.errors) {
          for (const err of resp.errors) {
            console.error("Failed to upload asset:", err);
          }
        }
      },
      (e: Error) => console.error("Failed to upload assets:", e.message),
    );
  }

  getConsoleLog(result: RunResult) {
    let consoleLog = `Running: ${result.spec.name}\n\n`;

    const tree = this.orderContexts(result.tests);
    consoleLog = consoleLog.concat(this.formatResults(tree));

    consoleLog = consoleLog.concat(`
      
  Results:

    Tests:        ${result.stats.tests || 0}
    Passing:      ${result.stats.passes || 0}
    Failing:      ${result.stats.failures || 0}
    Pending:      ${result.stats.pending || 0}
    Skipped:      ${result.stats.skipped || 0}
    Screenshots:  ${result.screenshots.length || 0}
    Video:        ${result.video != ""}
    Duration:     ${Math.floor((result.stats.duration || 0) / 1000)} seconds
    Spec Ran:     ${result.spec.name}

      `);
    consoleLog = consoleLog.concat(`\n\n`);

    return consoleLog;
  }

  orderContexts(tests: TestResult[]) {
    let ctx: TestContext = {
      name: "",
      testResult: undefined,
      children: new Map(),
    };

    for (const test of tests) {
      ctx = this.placeInContext(ctx, test.title, test);
    }
    return ctx;
  }

  placeInContext(ctx: TestContext, title: string[], test: TestResult) {
    // The last title is the actual test name.
    // Any title before the last is the context name.
    // That means, it's a 'describe' or 'context' block in Cypress.
    const isTest = title.length === 1;

    const key = title[0];
    if (isTest) {
      const child = { name: key, testResult: test, children: new Map() };
      ctx.children.set(key, child);
      return ctx;
    }

    let child = ctx.children.get(key);
    if (!child) {
      child = { name: key, testResult: undefined, children: new Map() };
      ctx.children.set(key, child);
    }

    this.placeInContext(child, title.slice(1), test);

    return ctx;
  }

  formatResults(ctx: TestContext, level = 0) {
    let txt = "";

    const padding = "  ".repeat(level);
    if (!ctx.testResult) {
      txt = txt.concat(`${padding}${ctx.name}\n`);
    }

    if (ctx.testResult) {
      const ico = ctx.testResult.state === "passed" ? "✓" : "✗";
      const testName = ctx.testResult.title.slice(-1)[0];
      txt = txt.concat(
        `${padding}${ico} ${testName} (${ctx.testResult.duration}ms)\n`,
      );
    }

    for (const child of ctx.children.values()) {
      txt = txt.concat(this.formatResults(child, level + 1));
    }
    return txt;
  }

  getOsName(osName: string | undefined) {
    if (!osName) {
      return "unknown";
    }
    if ("darwin" === osName) {
      return "Mac";
    }
    return osName;
  }

  async createSauceTestReport(results: RunResult[]) {
    const run = new TestRun();

    for (const result of results) {
      const specSuite = run.withSuite(result.spec.name);
      this.collectAttachments(result).forEach((attachment) => {
        specSuite.attach(attachment);
      });

      // inferSuite returns the most appropriate suite for the test, while creating a new one along the way if necessary.
      // The 'title' parameter is a bit misleading, since it's an array of strings, with the last element being the actual test name.
      // All other elements are the context of the test, coming from 'describe()' and 'context()'.
      const inferSuite = (title: string[]) => {
        let last = specSuite;

        title.forEach((subtitle: string, i: number) => {
          if (i === title.length - 1) {
            return;
          }

          last = last.withSuite(subtitle);
        });

        return last;
      };

      // We don't know the concrete start time of each test, but we know the
      // start time of the spec and the duration of each test, which is run
      // sequentially within the spec. As long as this behavior doesn't change,
      // we can infer the start time of each test based on its duration and
      // execution order.
      const specStartTime = new Date(result.stats.startedAt).getTime();
      let elapsedTime = 0;

      for (const t of result.tests) {
        const name = t.title[t.title.length - 1];
        const suite = inferSuite(t.title);
        const startedAt = new Date(specStartTime + elapsedTime);
        elapsedTime += t.duration;

        let videoTimestamp;
        if (this.videoStartTime) {
          videoTimestamp = (startedAt.getTime() - this.videoStartTime) / 1000;
        }

        suite.withTest(name, {
          status: stateToStatus(t.state),
          duration: t.duration,
          startTime: startedAt,
          output: t.displayError || "",
          videoTimestamp,
        });
      }
    }

    run.computeStatus();

    return run;
  }

  /**
   * Gathers video and screenshot attachments from Cypress test results for Sauce JSON reports.
   * Attachments are formatted for JSON reporting, detailing the name, path, and content type.
   *
   * Notes: Adds a video with a predefined VIDEO_NAME if present when web asset sync is not enabled.
   *
   * @param {RunResult} result - Cypress test run result for a single spec.
   * @returns {Attachment[]} Array of attachments for the Sauce JSON report.
   */
  collectAttachments(result: RunResult): Attachment[] {
    const specName = result.spec.name;
    const attachments: Attachment[] = [];
    if (result.video) {
      attachments.push({
        name: "video",
        path: this.resolveVideoName(path.basename(result.video)),
        contentType: "video/mp4",
      });
    }
    result.screenshots?.forEach((s) => {
      attachments.push({
        name: "screenshot",
        path: this.resolveAssetName(specName, path.basename(s.path)),
        contentType: "image/png",
      });
    });
    return attachments;
  }

  /**
   * Gathers test assets for upload to Sauce through the TestComposer API.
   * Assets include videos, screenshots, console logs, and the Sauce JSON report.
   *
   * @param {RunResult[]} results - Contains video and screenshot paths from a Cypress test run.
   * @param {TestRun} report - The Sauce JSON report object.
   * @returns {Asset[]} Array of assets, each with a filename and data stream, ready for upload.
   */
  async collectAssets(results: RunResult[], report: TestRun): Promise<Asset[]> {
    const assets: Asset[] = [];
    for (const result of results) {
      const specName = result.spec.name;
      if (result.video) {
        assets.push({
          filename: this.resolveVideoName(path.basename(result.video)),
          path: result.video,
          data: fs.createReadStream(result.video),
        });
      }
      result.screenshots?.forEach((s) => {
        assets.push({
          filename: this.resolveAssetName(specName, path.basename(s.path)),
          path: s.path,
          data: fs.createReadStream(s.path),
        });
      });

      if (this.opts.artifactUploadDir) {
        const artifactPath = path.join(this.opts.artifactUploadDir, specName);
        if (fs.existsSync(artifactPath)) {
          const entries = await readdir(path.resolve(artifactPath), {
            withFileTypes: true,
          });

          for (const entry of entries) {
            if (!entry.isFile()) {
              continue;
            }

            const entryPath = path.join(artifactPath, entry.name);
            assets.push({
              filename: entry.name,
              path: entryPath,
              data: fs.createReadStream(path.resolve(entryPath)),
            });
          }
        }
      }

      assets.push(
        {
          data: this.ReadableStream(this.getConsoleLog(result)),
          filename: "console.log",
        },
        {
          data: this.ReadableStream(report.stringify()),
          filename: "sauce-test-report.json",
        },
      );
    }

    return assets;
  }

  /**
   * Resolves the name of an asset file by prefixing it with the spec name,
   * under the condition that the asset filename is provided,
   * the sync asset feature is enabled, and the asset type is syncable.
   *
   * @param {string} specName The name of the test associated with the asset.
   * @param {string} filename The original filename of the asset.
   * @returns {string} The resolved asset name, prefixed with the test name if all conditions are met;
   * otherwise, returns the original filename.
   */
  resolveAssetName(specName: string, filename: string): string {
    if (
      !filename ||
      !this.isWebAssetSyncEnabled() ||
      !this.isWebAsset(filename)
    ) {
      return filename;
    }
    return `${specName}-${filename}`;
  }

  // Determines the video filename based on web asset sync status.
  // If web assets sync is disabled, returns a default filename VIDEO_NAME;
  // otherwise, returns the provided video name.
  resolveVideoName(videoName: string): string {
    if (!this.isWebAssetSyncEnabled()) {
      return VIDEO_FILENAME;
    }
    return videoName;
  }

  // Checks if the file type of a given filename is among the types compatible with the Sauce Labs web UI.
  isWebAsset(filename: string): boolean {
    return webAssetsTypes.includes(path.extname(filename));
  }

  // Check if asset syncing to webAssetDir is enabled.
  isWebAssetSyncEnabled(): boolean {
    return !!this.webAssetsDir;
  }

  // Copy Cypress generated assets to webAssetDir.
  syncAssets(assets: Asset[]) {
    if (!this.isWebAssetSyncEnabled()) {
      return;
    }
    assets.forEach((asset) => {
      if (!asset.path) {
        return;
      }
      fs.copyFileSync(
        asset.path,
        path.join(this.webAssetsDir || "", asset.filename),
      );
    });
  }
}

/**
 * Translates cypress's state to the Sauce Labs Status.
 * @param state the cypress state of the test
 * @returns Status
 */
function stateToStatus(state: string) {
  switch (state) {
    case "passed":
      return Status.Passed;
    case "failed":
      return Status.Failed;
    case "pending":
      return Status.Skipped;
    case "skipped":
      return Status.Skipped;
    default:
      return Status.Skipped;
  }
}
