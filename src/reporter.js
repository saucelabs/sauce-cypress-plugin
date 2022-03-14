const SauceLabs = require('saucelabs').default;
const path = require('path');
const fs = require('fs');
const {readFile} = require('fs/promises');
const {Status, TestRun, TestCode} = require("@saucelabs/sauce-json-reporter");

// Once the UI is able to dynamically show videos, we can remove this and simply use whatever video name
// the framework provides.
const VIDEO_FILENAME = 'video.mp4';

class Reporter {
  constructor(cypressDetails) {
    let reporterVersion = 'unknown';
    try {
      const packageData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
      reporterVersion = packageData.version;
      // eslint-disable-next-line no-empty
    } catch (e) {
    }

    this.region = cypressDetails?.config?.sauce?.region || 'us-west-1';
    this.tld = this.region === 'staging' ? 'net' : 'com';

    this.api = new SauceLabs({
      user: process.env.SAUCE_USERNAME,
      key: process.env.SAUCE_ACCESS_KEY,
      region: this.region,
      tld: this.tld,
      headers: {'User-Agent': `cypress-reporter/${reporterVersion}`},
    });

    this.cypressDetails = cypressDetails;
  }

  // Reports a spec as a Job on Sauce.
  async reportSpec({
    spec,
    reporterStats,
    tests,
    video,
    screenshots,
  }) {
    const {start, end, failures} = reporterStats;

    let suiteName = spec.name;
    if (this.cypressDetails?.config?.sauce?.build) {
      suiteName = `${this.cypressDetails.config.sauce.build} - ${spec.name}`;
    }


    const body = this.createBody({
      startedAt: start,
      endedAt: end,
      browserName: this.cypressDetails.browser.name,
      browserVersion: this.cypressDetails.browser.version,
      cypressVersion: this.cypressDetails.config.version,
      build: this.cypressDetails.config.sauce?.build,
      tags: this.cypressDetails.config.sauce?.tags,
      success: failures === 0,
      suiteName,
    });

    this.sessionId = await this.createJob(body);

    const consoleLogContent = await this.constructConsoleLog({spec, stats: reporterStats, tests, screenshots});
    const screenshotsPath = screenshots.map(s => s.path);
    const report = this.createSauceTestReport([{spec, tests, video, screenshots}]);
    await this.uploadAssets(this.sessionId, video, consoleLogContent, screenshotsPath, report);

    return {
      sessionId: this.sessionId,
      url: this.generateJobLink(this.sessionId),
    };
  }

  async createJob(body) {
    await this.api.createJob(body).then(
      (resp) => this.sessionId = resp.ID,
      (err) => console.error('Create job failed: ', err)
    );
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
  }) {

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

  async uploadAssets(sessionId, video, consoleLogContent, screenshots, testReport) {
    const assets = [];

    // Since reporting is made by spec, there is only one video to upload.
    try {
      const videoContent = await readFile(video);
      assets.push({
        data: videoContent,
        filename: VIDEO_FILENAME,
      });
    } catch (e) {
      console.log(`@saucelabs/cypress-plugin: unable to report video file ${video}: ${e}`);
    }

    // Add generated console.log
    assets.push(
      {
        data: consoleLogContent,
        filename: 'console.log',
      },
      {
        data: testReport,
        filename: 'sauce-test-report.json',
      }
    );

    // Add screenshots
    assets.push(...screenshots);

    await Promise.all([
      this.api.uploadJobAssets(sessionId, {files: assets}).then(
        (resp) => {
          if (resp.errors) {
            for (let err of resp.errors) {
              console.error(err);
            }
          }
        },
        (e) => console.log('Upload failed:', e.stack)
      )
    ]);
  }

  async constructConsoleLog(run) {
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

  orderContexts(tests) {
    let arch = {name: '', values: [], children: {}};

    for (const test of tests) {
      arch = this.placeInContext(arch, test.title, test);
    }
    return arch;
  }

  placeInContext(arch, title, test) {
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

  formatResults(node, level = 0) {
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

  generateJobLink(sessionId) {
    const domainMapping = {
      'us-west-1': 'app.saucelabs.com',
      'eu-central-1': 'app.eu-central-1.saucelabs.com',
      'staging': 'app.staging.saucelabs.net'
    };
    return `https://${domainMapping[this.region]}/tests/${sessionId}`;
  }

  getOsName(osName) {
    if (!osName) {
      return 'unknown';
    }
    if ('darwin' === osName) {
      return 'Mac';
    }
    return osName;
  }

  createSauceTestReport(results) {
    const run = new TestRun();

    results.forEach(result => {
      const specSuite = run.withSuite(result.spec.name)

      if (result.video) {
        specSuite.attach({name: 'video', path: VIDEO_FILENAME, contentType: 'video/mp4'});
      }

      // If results are coming from `after:spec`, the screenshots are attached to the spec results.
      result.screenshots?.forEach(s => {
        specSuite.attach({name: 'screenshot', path: path.basename(s.path), contentType: 'image/png'});
      });

      // inferSuite returns the most appropriate suite for the test, while creating a new one along the way if necessary.
      // The 'title' parameter is a bit misleading, since it's an array of strings, with the last element being the actual test name.
      // All other elements are the context of the test, coming from 'describe()' and 'context()'.
      const inferSuite = (title) => {
        let last = specSuite;

        title.forEach((subtitle, i) => {
          if (i === title.length - 1) {
            return;
          }

          last = last.withSuite(subtitle);
        })

        return last;
      };

      result.tests.forEach(t => {
        const name = t.title[t.title.length - 1];
        const suite = inferSuite(t.title);
        const attempt = t.attempts[t.attempts.length - 1];
        const code = t.body.split("\n");

        const tt = suite.withTest(name,{
          status: stateToStatus(t.state),
          duration: attempt.wallClockDuration,
          output: errorToString(attempt.error),
          startTime: attempt.wallClockStartedAt,
          code: new TestCode(code),
        });

        // If results are coming from `after:run`, the screenshots are attached to each `attempt`.
        attempt.screenshots?.forEach(s => {
          tt.attach({name: 'screenshot', path: path.basename(s.path), contentType: 'image/png'});
        });
      });

    });

    run.computeStatus();

    return run;
  }
}

function errorToString(error) {
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
 * @returns {Status.Skipped|Status.Failed|Status.Passed}
 */
function stateToStatus(state) {
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


module.exports = Reporter;
