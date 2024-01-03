import fs from 'fs';
import path from 'path';
import * as stream from 'stream';

import * as Cypress from 'cypress';
import BeforeRunDetails = Cypress.BeforeRunDetails;
import TestResult = CypressCommandLine.TestResult;
import RunResult = CypressCommandLine.RunResult;

import { Status, TestRun } from '@saucelabs/sauce-json-reporter';
import { TestComposer } from '@saucelabs/testcomposer';

import { Options } from './index';
import { TestRuns as TestRunsAPI, TestRunRequestBody } from './api';
import { CI } from './ci';

// Once the UI is able to dynamically show videos, we can remove this and simply use whatever video name
// the framework provides.
const VIDEO_FILENAME = 'video.mp4';

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
  private testComposer: TestComposer;
  private testRunsApi: TestRunsAPI;

  constructor(
    cypressDetails: BeforeRunDetails | undefined,
    opts: Options = { region: 'us-west-1' },
  ) {
    let reporterVersion = 'unknown';
    try {
      const packageData = JSON.parse(
        fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'),
      );
      reporterVersion = packageData.version;
    } catch (e) {
      /* empty */
    }

    if (!opts.region) {
      opts.region = 'us-west-1';
    }
    this.opts = opts;

    this.testComposer = new TestComposer({
      region: this.opts.region || 'us-west-1',
      username: process.env.SAUCE_USERNAME || '',
      accessKey: process.env.SAUCE_ACCESS_KEY || '',
      headers: { 'User-Agent': `cypress-reporter/${reporterVersion}` },
    });
    this.testRunsApi = new TestRunsAPI({
      region: this.opts.region || 'us-west-1',
      username: process.env.SAUCE_USERNAME || '',
      accessKey: process.env.SAUCE_ACCESS_KEY || '',
    });

    this.cypressDetails = cypressDetails;

    this.videoStartTime = process.env.SAUCE_VIDEO_START_TIME
      ? new Date(process.env.SAUCE_VIDEO_START_TIME).getTime()
      : undefined;
  }

  // Reports a spec as a Job on Sauce.
  async reportSpec(result: RunResult) {
    let suiteName = result.spec.name;
    if (this.opts.build) {
      suiteName = `${this.opts.build} - ${result.spec.name}`;
    }

    const stats = result.stats;

    const job = await this.testComposer.createReport({
      name: suiteName,
      startTime: result.stats.startedAt,
      endTime: stats.endedAt,
      framework: 'cypress',
      frameworkVersion: this.cypressDetails?.cypressVersion || '0.0.0',
      passed: result.stats.failures === 0,
      tags: this.opts.tags,
      build: this.opts.build,
      browserName: this.cypressDetails?.browser?.name,
      browserVersion: this.cypressDetails?.browser?.version,
      platformName: this.getOsName(this.cypressDetails?.system?.osName),
    });

    const consoleLogContent = this.getConsoleLog(result);
    const screenshotsPath = result.screenshots.map((s) => s.path);
    const report = await this.createSauceTestReport([result]);
    await this.uploadAssets(
      job.id,
      result.video,
      consoleLogContent,
      screenshotsPath,
      report,
    );

    return job;
  }

  // Reports a spec as a TestRun to Sauce.
  async reportTestRun(result: RunResult, jobId: string) {
    const specStartTime = new Date(result.stats.startedAt).getTime();
    let elapsedTime = 0;

    const runs = result.tests
      .filter((test) => test.attempts.length > 0)
      .map((test) => {
        const req: TestRunRequestBody = {
          name: test.title.join(' '),
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
          framework: 'cypress',
          platform: 'other',
          os: this.getOsName(this.cypressDetails?.system?.osName),
          sauce_job: {
            id: jobId,
          },
          status: stateToStatus(test.state),
          tags: this.opts.tags,
          type: 'web',
        };

        elapsedTime += test.duration;

        if (test.displayError) {
          req.errors = [
            {
              message: test.displayError || '',
              path: result.spec.relative,
            },
          ];
        }
        return req;
      });

    await this.testRunsApi.create(runs);
  }

  async uploadAssets(
    jobId: string | undefined,
    video: string | null,
    consoleLogContent: string,
    screenshots: string[],
    testReport: TestRun,
  ) {
    const assets = [];

    // Since reporting is made by spec, there is only one video to upload.
    if (video) {
      assets.push({
        data: fs.createReadStream(video),
        filename: VIDEO_FILENAME,
      });
    }

    // Add generated console.log
    const logReadable = new stream.Readable();
    logReadable.push(consoleLogContent);
    logReadable.push(null);

    const reportReadable = new stream.Readable();
    reportReadable.push(testReport.stringify());
    reportReadable.push(null);

    assets.push(
      {
        data: logReadable,
        filename: 'console.log',
      },
      {
        data: reportReadable,
        filename: 'sauce-test-report.json',
      },
    );

    // Add screenshots
    for (const s of screenshots) {
      assets.push({
        data: fs.createReadStream(s),
        filename: path.basename(s).replaceAll(/#/g, ''),
      });
    }

    await this.testComposer.uploadAssets(jobId || '', assets).then(
      (resp) => {
        if (resp.errors) {
          for (const err of resp.errors) {
            console.error('Failed to upload asset:', err);
          }
        }
      },
      (e: Error) => console.error('Failed to upload assets:', e.message),
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
    Video:        ${result.video != ''}
    Duration:     ${Math.floor((result.stats.duration || 0) / 1000)} seconds
    Spec Ran:     ${result.spec.name}

      `);
    consoleLog = consoleLog.concat(`\n\n`);

    return consoleLog;
  }

  orderContexts(tests: TestResult[]) {
    let ctx: TestContext = {
      name: '',
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
    let txt = '';

    const padding = '  '.repeat(level);
    if (!ctx.testResult) {
      txt = txt.concat(`${padding}${ctx.name}\n`);
    }

    if (ctx.testResult) {
      const ico = ctx.testResult.state === 'passed' ? '✓' : '✗';
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
      return 'unknown';
    }
    if ('darwin' === osName) {
      return 'Mac';
    }
    return osName;
  }

  async createSauceTestReport(results: RunResult[]) {
    const run = new TestRun();

    for (const result of results) {
      const specSuite = run.withSuite(result.spec.name);

      if (result.video) {
        specSuite.attach({
          name: 'video',
          path: VIDEO_FILENAME,
          contentType: 'video/mp4',
        });
      }

      result.screenshots?.forEach((s) => {
        specSuite.attach({
          name: 'screenshot',
          path: path.basename(s.path),
          contentType: 'image/png',
        });
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
          output: t.displayError || '',
          videoTimestamp,
        });
      }
    }

    run.computeStatus();

    return run;
  }
}

/**
 * Translates cypress's state to the Sauce Labs Status.
 * @param state the cypress state of the test
 * @returns Status
 */
function stateToStatus(state: string) {
  switch (state) {
    case 'passed':
      return Status.Passed;
    case 'failed':
      return Status.Failed;
    case 'pending':
      return Status.Skipped;
    case 'skipped':
      return Status.Skipped;
    default:
      return Status.Skipped;
  }
}
