import fs from "fs";
import path from "path";
import * as stream from "stream";
import readline from "readline";

import * as Cypress from "cypress";
import {Status, TestCode, TestRun} from "@saucelabs/sauce-json-reporter";
import {Region, TestComposer} from "@saucelabs/testcomposer";
import BeforeRunDetails = Cypress.BeforeRunDetails;

import {Options} from "./index";
import {TestRuns as TestRunsAPI, TestRunRequestBody} from './api';
import {CI} from './ci';
import RunResult = cypress.RunResult;
import TestResult = cypress.TestResult;
import AttemptResult = cypress.AttemptResult;
import TestError = cypress.TestError;

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
    opts: Options = {region: Region.USWest1}
  ) {
    let reporterVersion = 'unknown';
    try {
      const packageData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
      reporterVersion = packageData.version;
      // eslint-disable-next-line no-empty
    } catch (e) {
    }

    if (!opts.region) {
      opts.region = Region.USWest1
    }
    this.opts = opts;

    this.testComposer = new TestComposer({
      region: this.opts.region || Region.USWest1,
      username: process.env.SAUCE_USERNAME || '',
      accessKey: process.env.SAUCE_ACCESS_KEY || '',
      headers: {'User-Agent': `cypress-reporter/${reporterVersion}`}
    });
    this.testRunsApi = new TestRunsAPI({
      region: this.opts.region || Region.USWest1,
      username: process.env.SAUCE_USERNAME || '',
      accessKey: process.env.SAUCE_ACCESS_KEY || '',
    });

    this.cypressDetails = cypressDetails;

    this.videoStartTime = process.env.SAUCE_VIDEO_START_TIME ?
      new Date(process.env.SAUCE_VIDEO_START_TIME).getTime() : undefined;
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
      startTime: stats.wallClockStartedAt || result.stats.startedAt || '',
      endTime: stats.wallClockEndedAt || stats.endedAt || '',
      framework: 'cypress',
      frameworkVersion: this.cypressDetails?.cypressVersion || '0.0.0',
      passed: result.stats.failures === 0,
      tags: this.opts.tags,
      build: this.opts.build,
      browserName: this.cypressDetails?.browser?.name,
      browserVersion: this.cypressDetails?.browser?.version,
      platformName: this.getOsName(this.cypressDetails?.system?.osName)
    });

    const consoleLogContent = this.getConsoleLog(result);
    const screenshotsPath = result.screenshots.map((s) => s.path);
    const report = await this.createSauceTestReport([result]);
    await this.uploadAssets(job.id, result.video, consoleLogContent, screenshotsPath, report);

    return job;
  }

  // Reports a spec as a TestRun to Sauce.
  async reportTestRun(result: RunResult, jobId: string) {
    const runs = result.tests
      .filter((test) => test.attempts.length > 0)
      .map((test) => {
        const attempt = test.attempts[test.attempts.length - 1];
        const startDate = new Date(attempt.wallClockStartedAt || attempt.startedAt ||'');
        const endDate = new Date(startDate.valueOf() + (attempt.wallClockDuration || attempt.duration || 0));

        const req: TestRunRequestBody = {
          name: test.title.join(' '),
          start_time: startDate.toISOString(),
          end_time: endDate.toISOString(),
          duration: attempt.wallClockDuration || attempt.duration || 0,

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
        if (attempt.error) {
          const err = attempt.error;
          req.errors = [
            {
              message: err.message,
              path: err.codeFrame?.originalFile,
              line: err.codeFrame?.line,
            },
          ];
        }
        return req;
      }
    );

    await this.testRunsApi.create(runs);
  }

  async uploadAssets(jobId: string | undefined, video: string | null, consoleLogContent: string, screenshots: string[], testReport: TestRun) {
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
      }
    );

    // Add screenshots
    for (const s of screenshots) {
      assets.push({
        data: fs.createReadStream(s),
        filename: path.basename(s)
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
      (e: Error) => console.error('Failed to upload assets:', e.message)
    )
  }

  getConsoleLog(result: RunResult) {
    let consoleLog = `Running: ${result.spec.name}\n\n`;

    const tree = this.orderContexts(result.tests);
    consoleLog = consoleLog.concat(
      this.formatResults(tree)
    );

    consoleLog = consoleLog.concat(`
      
  Results:

    Tests:        ${result.stats.tests || 0}
    Passing:      ${result.stats.passes || 0}
    Failing:      ${result.stats.failures || 0}
    Pending:      ${result.stats.pending || 0}
    Skipped:      ${result.stats.skipped || 0}
    Screenshots:  ${result.screenshots.length || 0}
    Video:        ${result.video != ''}
    Duration:     ${Math.floor((result.stats.duration || result.stats.wallClockDuration || 0) / 1000)} seconds
    Spec Ran:     ${result.spec.name}

      `);
    consoleLog = consoleLog.concat(`\n\n`);

    return consoleLog;
  }

  orderContexts(tests: TestResult[]) {
    let ctx: TestContext = {name: '', testResult: undefined, children: new Map()};

    for (const test of tests) {
      ctx = this.placeInContext(ctx, test.title, test);
    }
    return ctx;
  }

  placeInContext(ctx: TestContext, title: string[], test: TestResult) {
    if (title.length === 1) {
      // The last title is the actual test name.
      ctx.testResult = test;
      return ctx;
    }

    // Any title before the last is the context name.
    // That means, it's a 'describe' or 'context' block in Cypress.
    const key = title[0];
    let child = ctx.children.get(key);
    if (!child) {
      child = {name: key, testResult: undefined, children: new Map()}
      ctx.children.set(key, child);
    }

    ctx.children.set(key, this.placeInContext(child, title.slice(1), test));
    return ctx;
  }

  formatResults(ctx: TestContext, level = 0) {
    let txt = '';

    const padding = '  '.repeat(level);
    txt = txt.concat(`${padding}${ctx.name}\n`);

    if (ctx.testResult) {
        const ico = ctx.testResult.state === 'passed' ? '✓' : '✗';
        const attempts = ctx.testResult.attempts;
        const duration = attempts[attempts.length - 1].wallClockDuration || attempts[attempts.length - 1].duration;

        const testName = ctx.testResult.title.slice(-1)[0];
        txt = txt.concat(`${padding} ${ico} ${testName} (${duration}ms)\n`);
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
      const specSuite = run.withSuite(result.spec.name)

      if (result.video) {
        specSuite.attach({name: 'video', path: VIDEO_FILENAME, contentType: 'video/mp4'});
      }

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
        })

        return last;
      };

      for (const t of result.tests) {
        const name = t.title[t.title.length - 1];
        const suite = inferSuite(t.title);
        const attempt: AttemptResult = t.attempts[t.attempts.length - 1];
        const code = await getCodeBody(result.spec.name, t);
        // If results are from 'after:run', 'wallClockDuration' and 'wallClockStartedAt' properties are called 'duration' and 'startedAt'
        const startTime = new Date(attempt.wallClockStartedAt || attempt.startedAt || '');
        const duration: number = attempt.wallClockDuration || attempt.duration || 0;
        let videoTimestamp;
        if (this.videoStartTime) {
          videoTimestamp = (new Date(startTime).getTime() - this.videoStartTime) / 1000;
        }

        const tt = suite.withTest(name, {
          status: stateToStatus(t.state),
          duration,
          startTime,
          output: errorToString(attempt.error),
          code: new TestCode(code),
          videoTimestamp,
        });

        // If results are coming from `after:spec`, the screenshots are attached to the spec results. But we can
        // re-associate the screenshots back to their tests via the testId.
        result.screenshots?.forEach((s) => {
          if (s.testId === t.testId) {
            tt.attach({name: 'screenshot', path: path.basename(s.path), contentType: 'image/png'});
          }
        });

        // If results are coming from `after:run`, the screenshots are attached to each `attempt`.
        attempt.screenshots?.forEach((s) => {
          tt.attach({name: 'screenshot', path: path.basename(s.path), contentType: 'image/png'});
        });
      }

    }

    run.computeStatus();

    return run;
  }
}

async function getCodeBody(specName: string, test: TestResult) {
  // check if it's a cucumber test
  const regex = new RegExp('.*.feature$')
  if (!regex.test(specName)) {
    return test.body.split("\n");
  }

  if (test.attempts.length === 0) {
    return [];
  }

  const codeFrame = test.attempts[0].error?.codeFrame;
  const errInfo = test.attempts[0].error;
  if (!codeFrame || !errInfo) {
    return [];
  }

  // get cucumber test code info
  if (!codeFrame.originalFile || !fs.existsSync(codeFrame.originalFile)) {
    return [];
  }
  return await processLine(codeFrame.originalFile, codeFrame.line)
}

async function processLine(filename: string, n: number) {
  const min = Math.max(0, n-3);
  const max = n+3;

  const fileStream = fs.createReadStream(filename);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let cursor = 0;
  const content = [];
  for await (const line of rl) {
    if (cursor >= min && cursor <= max) {
      content.push(line)
      rl.close()
    }
    cursor++
  }
  return content;
}

function errorToString(error: TestError | null) {
  if (!error) {
    return;
  }

  const frame = error.codeFrame?.frame || "";

  return `${error.name}: ${error.message}

${frame}`
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
