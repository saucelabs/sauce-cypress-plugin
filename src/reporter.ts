import * as Cypress from "cypress";
import path from "path";
import fs from "fs";
import {Status, TestCode, TestRun} from "@saucelabs/sauce-json-reporter";
import {Options} from "./index";
import {CreateReportRequest, TestComposer} from "./testcomposer";
import BeforeRunDetails = Cypress.BeforeRunDetails;
import {Region} from "./region";
import * as stream from "stream";

// Once the UI is able to dynamically show videos, we can remove this and simply use whatever video name
// the framework provides.
const VIDEO_FILENAME = 'video.mp4';

export default class Reporter {
  public cypressDetails: BeforeRunDetails | undefined;

  private opts: Options;
  private readonly videoStartTime: number | undefined;
  private sessionId = '';
  private testComposer: TestComposer;

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
    })

    this.cypressDetails = cypressDetails;

    this.videoStartTime = process.env.SAUCE_VIDEO_START_TIME ?
      new Date(process.env.SAUCE_VIDEO_START_TIME).getTime() : undefined;
  }

  // Reports a spec as a Job on Sauce.
  async reportSpec({
                     spec,
                     reporterStats,
                     tests,
                     video,
                     screenshots,
                   }: any) {
    const {start, end, failures} = reporterStats;

    let suiteName = spec.name;
    if (this.opts.build) {
      suiteName = `${this.opts.build} - ${spec.name}`;
    }


    const body = this.createBody({
      startedAt: start,
      endedAt: end,
      browserName: this.cypressDetails?.browser?.name,
      browserVersion: this.cypressDetails?.browser?.version,
      cypressVersion: this.cypressDetails?.cypressVersion,
      build: this.opts.build,
      tags: this.opts.tags,
      success: failures === 0,
      suiteName,
    });

    await this.createJob(body);

    const consoleLogContent = this.getConsoleLog({spec, stats: reporterStats, tests, screenshots});
    const screenshotsPath = screenshots.map((s: any) => s.path);
    const report = this.createSauceTestReport([{spec, tests, video, screenshots}]);
    await this.uploadAssets(this.sessionId, video, consoleLogContent, screenshotsPath, report);

    return {
      sessionId: this.sessionId,
      url: this.generateJobLink(this.sessionId),
    };
  }

  async createJob(body: CreateReportRequest) {
    const job = await this.testComposer.createReport(body);
    this.sessionId = job.id;
    return this.sessionId;
  }

  createBody({
               suiteName,
               startedAt,
               endedAt,
               cypressVersion,
               success,
               tags,
               build,
               browserName,
               browserVersion,
             }: any) {

    return {
      name: suiteName,
      user: process.env.SAUCE_USERNAME,
      startTime: startedAt,
      endTime: endedAt,
      framework: 'cypress',
      frameworkVersion: cypressVersion,
      status: 'complete',
      suite: suiteName,
      errors: [], // To Add
      passed: success,
      tags: tags,
      build: build,
      browserName,
      browserVersion,
      platformName: this.getOsName(this.cypressDetails?.system?.osName),
    };
  }

  async uploadAssets(sessionId: string | undefined, video: string, consoleLogContent: string, screenshots: string[], testReport: TestRun) {
    const assets = [];

    // Since reporting is made by spec, there is only one video to upload.
    try {
      assets.push({
        data: fs.createReadStream(video),
        filename: VIDEO_FILENAME,
      });
    } catch (e) {
      console.error(`Failed to load video ${video}:`, e);
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
      try {
        assets.push({
          data: fs.createReadStream(s),
          filename: path.basename(s)
        });
      } catch (e) {
        console.error(`Failed to load screenshot ${s}:`, e)
      }
    }

    this.testComposer.uploadAssets(sessionId || '', assets).then(
      (resp) => {
        if (resp.errors) {
          for (const err of resp.errors) {
            console.error('Failed to upload asset:', err);
          }
        }
      },
      (e: Error) => console.log('Failed to upload assets:', e)
    )
  }

  getConsoleLog(run: any) {
    let consoleLog = `Running: ${run.spec.name}\n\n`;

    const tree = this.orderContexts(run.tests);
    consoleLog = consoleLog.concat(
      this.formatResults(tree)
    );

    consoleLog = consoleLog.concat(`
      
  Results:

    Tests:        ${run.stats.tests || 0}
    Passing:      ${run.stats.passes || 0}
    Failing:      ${run.stats.failures || 0}
    Pending:      ${run.stats.pending || 0}
    Skipped:      ${run.stats.skipped || 0}
    Screenshots:  ${run.screenshots?.length || 0}
    Video:        ${run.video != ''}
    Duration:     ${Math.floor(run.stats.duration / 1000)} seconds
    Spec Ran:     ${run.spec.name}

      `);
    consoleLog = consoleLog.concat(`\n\n`);

    return consoleLog;
  }

  orderContexts(tests: any) {
    let arch = {name: '', values: [], children: {}};

    for (const test of tests) {
      arch = this.placeInContext(arch, test.title, test);
    }
    return arch;
  }

  placeInContext(arch: any, title: any, test: any) {
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

  generateJobLink(sessionId: string) {
    const m = new Map<string, string>();
    m.set('us-west-1', 'app.saucelabs.com')
    m.set('eu-central-1', 'app.eu-central-1.saucelabs.com')
    m.set('staging', 'app.staging.saucelabs.net')

    return `https://${m.get(this.opts.region || Region.USWest1)}/tests/${sessionId}`;
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

      // If results are coming from `after:spec`, the screenshots are attached to the spec results.
      result.screenshots?.forEach((s: any) => {
        specSuite.attach({name: 'screenshot', path: path.basename(s.path), contentType: 'image/png'});
      });

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
