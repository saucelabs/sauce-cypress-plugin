const SauceLabs = require('saucelabs').default;
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { tmpdir } = require('os');


class Reporter {
  constructor(cypressDetails) {

    this.api = new SauceLabs({
      user: process.env.SAUCE_USERNAME,
      key: process.env.SAUCE_ACCESS_KEY,
      region: 'us-west-1',
      tld: 'com',
    });

    this.cypressDetails = cypressDetails;
  }

  async reportSpec({
    spec,
    reporterStats,
    tests,
    video,
   }) {

    const { start, end, failures} = reporterStats;
    const body = this.createBody({
      startedAt: start,
      endedAt: end,
      browserName: this.cypressDetails.browser.name,
      browserVersion: this.cypressDetails.browser.version,
      cypressVersion: this.cypressDetails.config.version,
      build: this.cypressDetails.config.sauce.build,
      tags: this.cypressDetails.config.sauce.tags,
      success: failures === 0,
      suiteName: `${this.cypressDetails.config.sauce.suiteName} - ${spec.name}`,
    });

    this.sessionId = await this.createJob(body);

    const consoleFilename = await this.constructConsoleLog([{ spec, stats: reporterStats, tests }]);
    await this.uploadAssets(this.sessionId, [video], consoleFilename);
    return this.sessionId;
  }

  async reportRun({
    startedTestsAt,
    endedTestsAt,
    browserName,
    browserVersion,
    cypressVersion,
    totalFailed,
    runs,
   }) {
    const body = this.createBody({
      startedAt: startedTestsAt,
      endedAt: endedTestsAt,
      browserName: browserName,
      browserVersion: browserVersion,
      cypressVersion: cypressVersion,
      build: this.cypressDetails.config.sauce.build,
      tags: this.cypressDetails.config.sauce.tags,
      success: totalFailed === 0,
      suiteName: this.cypressDetails.config.sauce.suiteName,
    });

    this.sessionId = await this.createJob(body);

    const consoleFilename = await this.constructConsoleLog(runs);
    await this.uploadAssets(this.sessionId, runs.map(x => x.video), consoleFilename);
    return this.sessionId;
  }

  async createJob(body) {
    await this.api.createJob(body).then(
      (resp) => this.sessionId = resp.ID,
      (err) => console.error('Create job failed: ', err)
    );
    return this.sessionId;
  }

  createBody ({
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
      platformName: 'local-cypress:latest',
      saucectlVersion: 'v0.0.0',
    };
  }

  async uploadAssets (sessionId, videos, consoleLog) {
    // Non-optimum fix => Merge videos to video.mp4
    fs.copyFileSync(videos[0], 'video.mp4');
    videos.push(path.join(process.cwd(), 'video.mp4'));

    await Promise.all([
      this.api.uploadJobAssets(sessionId, { files: [...videos, consoleLog] }).then(
        (resp) => {
          // console.log(resp);
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

  async constructConsoleLog(runs) {
    let consoleLog = '';
    for (const run of runs) {
      consoleLog = consoleLog.concat(`SpecFile: ${run.spec.name}\n`);

      const tree = this.orderContexts(run.tests);
      consoleLog = consoleLog.concat(
          this.formatResults(tree)
      );

      consoleLog = consoleLog.concat(`
      
  Results:

    Tests:        ${run.stats.tests}
    Passing:      ${run.stats.passes}
    Failing:      ${run.stats.failures}
    Pending:      ${run.stats.pending}
    Skipped:      ${run.stats.skipped}
    Screenshots:  ${0}
    Video:        ${run.video != ''}
    Duration:     ${Math.floor(run.stats.duration / 1000)} seconds
    Spec Ran:     ${run.spec.name}

      `);
      consoleLog = consoleLog.concat(`\n\n`);
    }
  
    // Save to file (to promisify)
    const consoleFilename = this.tmpFile();
    fs.writeFileSync(consoleFilename, consoleLog);
    return consoleFilename;
  }

  orderContexts (tests) {
    let arch = { name: 'Root', values: [], children: {}};

    for (const test of tests) {
      arch = this.placeInContext(arch, test.title, test);
    }
    return arch;
  }

  placeInContext (arch, title, test) {
    if (title.length === 1) {
      arch.values.push({ title: title[0], result: test });
      return arch;
    }
  
    const key = title[0];
    if (!arch.children[key]) {
      arch.children[key] = { name: key, values: [], children: {}};
    }
    arch.children[key] = this.placeInContext(arch.children[key], title.slice(1), test);
    return arch;
  }
  
  formatResults (node, level = 0) {
    let txt = '';
    
    const padding = '  '.repeat(level);
    txt = txt.concat(`${padding}${node.name}\n\n`);
  
    if (node.values) {
      for (const val of node.values) {
        const ico = val.result.state === 'passed' ? '✓' : '✗';
        const attempts = val.result.attempts;
        const duration = attempts[attempts.length - 1].duration;
        
        txt = txt.concat(`${padding} ${ico} ${val.title} (${duration}ms)\n`);
      }
    }
  
    for (const child of Object.keys(node.children)) {
      txt = txt.concat(`\n`);
      txt = txt.concat(this.formatResults(node.children[child], level+1));
    }
    return txt;
  }

  tmpFile () {
    const workdir = path.join(tmpdir(), `sauce-cypress-plugin-${crypto.randomBytes(6).readUIntLE(0,6).toString(36)}`);
    // To promisify
    fs.mkdirSync(workdir);
    return path.join(workdir, `/console.log`);
  }
}

module.exports = Reporter;
