import * as Cypress from "cypress";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import {Status, TestCode, TestRun} from "@saucelabs/sauce-json-reporter";
import {Options} from "./index";
import {Region, TestComposer} from "@saucelabs/testcomposer";
import BeforeRunDetails = Cypress.BeforeRunDetails;
import * as stream from "stream";
import ScreenshotInformation = CypressCommandLine.ScreenshotInformation;
import TestResult = CypressCommandLine.TestResult;
import {TestRuns as TestRunsAPI, TestRunRequestBody, TestRunError} from './api';
import { AxiosError, isAxiosError } from "axios";
import { CI, IS_CI } from './ci';

// Once the UI is able to dynamically show videos, we can remove this and simply use whatever video name
// the framework provides.
const VIDEO_FILENAME = 'video.mp4';

// RunResultStats represents a workaround for https://github.com/cypress-io/cypress/issues/23805.
interface RunResultStats {
  suites: number
  tests: number
  passes: number
  pending: number
  skipped: number
  failures: number
  startedAt?: string // dateTimeISO, very likely not set
  endedAt?: string // dateTimeISO, very likely not set
  duration?: number // ms, very likely not set
  wallClockStartedAt?: string // dateTimeISO
  wallClockEndedAt?: string // dateTimeISO
  wallClockDuration?: number // ms
}

// RunResult represents a workaround to deal with Cypress' own poor implementation of their APIs. Namely, that their
// objects do not actually adhere to their own interface.
export interface RunResult extends CypressCommandLine.RunResult {
  screenshots: ScreenshotInformation[]
}

export interface TestError extends CypressCommandLine.TestError {
  codeFrame?: { line: number, column: number, frame: string, originalFile?: string
 };
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

    const stats = result.stats as RunResultStats;

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
    const report = this.createSauceTestReport([{
      spec: result.spec,
      tests: result.tests,
      video: result.video,
      screenshots: result.screenshots
    }]);
    await this.uploadAssets(job.id, result.video, consoleLogContent, screenshotsPath, report);

    return job;
  }

  async reportTestRun(result: RunResult, meta: { jobId: string | undefined }) {
    const stats = result.stats as RunResultStats;
    const status = 
      stats.failures > 0 ? Status.Failed
        : stats.skipped === stats.tests ? Status.Skipped
        : Status.Passed;

    const req : TestRunRequestBody = {
      id: crypto.randomUUID(),
      name: result.spec.name,
      start_time: stats.wallClockStartedAt || result.stats.startedAt || '',
      end_time: stats.wallClockEndedAt || stats.endedAt || '',
      duration: stats.wallClockDuration ?? result.stats.duration ?? '',
      platform: 'other',
      type: 'web',
      framework: 'cypress',
      status,
      errors: this.findErrors(result),
    };

    if (this.cypressDetails?.browser) {
      req.browser = `${this.cypressDetails?.browser?.name} ${this.cypressDetails?.browser?.version}`;
    }
    if (this.cypressDetails?.system) {
      req.os = this.getOsName(this.cypressDetails?.system?.osName);
    }
    if (this.opts.tags) {
      req.tags = this.opts.tags?.map((tag) => ({ title: tag }));
    }
    // NOTE: If we didn't run in sauce, do we need to define sauce_job for the test run?
    if (meta.jobId) {
      req.sauce_job = {
        id: meta.jobId,
      };
    }
    if (IS_CI) {
      req.ci = {
        ref_name: CI.refName,
        commit_sha: CI.sha,
        // NOTE: Is this supposed to be the repo name or the repo url?
        repository: CI.repo,
        branch: CI.refName,
      };
    }

    await this.testRunsApi.create([req]);
  }

  findErrors(result: RunResult) : TestRunError[] {
    const errors : TestRunError[] = [];
    result.tests.forEach((test) => {
      if (stateToStatus(test.state) !== Status.Failed) {
        return;
      }

      test.attempts.forEach((attempt) => {
        if (stateToStatus(attempt.state) !== Status.Failed || attempt.error === null) {
          return;
        }
        
        const err = attempt.error as TestError;
        errors.push({
          message: err.message,
          path: err.codeFrame?.originalFile,
          line: err.codeFrame?.line,
        });
      });
    });

    return errors;
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
    Duration:     ${Math.floor(result.stats.duration / 1000)} seconds
    Spec Ran:     ${result.spec.name}

      `);
    consoleLog = consoleLog.concat(`\n\n`);

    return consoleLog;
  }

  orderContexts(tests: TestResult[]) {
    let arch = {name: '', values: [], children: {}};

    for (const test of tests) {
      arch = this.placeInContext(arch, test.title, test);
    }
    return arch;
  }

  placeInContext(arch: any, title: string[], test: TestResult) {
    if (title.length === 1) {
      arch.values.push({title: title[0], result: test});
      return arch;
    }

    const key = title[0];
    if (!arch.children[key]) {
      arch.children[key] = {name: key, values: [], children: {}};
    }
    arch.children[key] = this.placeInContext(arch.children[key], title.slice(1), test);
    return arch;
  }

  formatResults(node: any, level = 0) {
    let txt = '';

    const padding = '  '.repeat(level);
    txt = txt.concat(`${padding}${node.name}\n`);

    if (node.values) {
      for (const val of node.values) {
        const ico = val.result.state === 'passed' ? '✓' : '✗';
        const attempts = val.result.attempts;
        const duration = attempts[attempts.length - 1].wallClockDuration;

        txt = txt.concat(`${padding} ${ico} ${val.title} (${duration}ms)\n`);
      }
    }

    for (const child of Object.keys(node.children)) {
      txt = txt.concat(this.formatResults(node.children[child], level + 1));
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

  createSauceTestReport(results: any) {
    const run = new TestRun();

    results.forEach((result: any) => {
      const specSuite = run.withSuite(result.spec.name)

      if (result.video) {
        specSuite.attach({name: 'video', path: VIDEO_FILENAME, contentType: 'video/mp4'});
      }

      // inferSuite returns the most appropriate suite for the test, while creating a new one along the way if necessary.
      // The 'title' parameter is a bit misleading, since it's an array of strings, with the last element being the actual test name.
      // All other elements are the context of the test, coming from 'describe()' and 'context()'.
      const inferSuite = (title: any) => {
        let last = specSuite;

        title.forEach((subtitle: any, i: number) => {
          if (i === title.length - 1) {
            return;
          }

          last = last.withSuite(subtitle);
        })

        return last;
      };

      result.tests.forEach((t: any) => {
        const name = t.title[t.title.length - 1];
        const suite = inferSuite(t.title);
        const attempt = t.attempts[t.attempts.length - 1];
        const code = t.body.split("\n");
        // If results are from 'after:run', 'wallClockDuration' and 'wallClockStartedAt' properties are called 'duration' and 'startedAt'
        const startTime = attempt.wallClockStartedAt || attempt.startedAt;
        const duration = attempt.wallClockDuration || attempt.duration;
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
        result.screenshots?.forEach((s: any) => {
          if (s.testId === t.testId) {
            tt.attach({name: 'screenshot', path: path.basename(s.path), contentType: 'image/png'});
          }
        });

        // If results are coming from `after:run`, the screenshots are attached to each `attempt`.
        attempt.screenshots?.forEach((s: any) => {
          tt.attach({name: 'screenshot', path: path.basename(s.path), contentType: 'image/png'});
        });
      });

    });

    run.computeStatus();

    return run;
  }
}

function errorToString(error: any) {
  if (!error) {
    return error;
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
function stateToStatus(state: any) {
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
