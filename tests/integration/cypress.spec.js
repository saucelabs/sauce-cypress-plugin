const {it, describe, before} = require('node:test');
const {strictEqual, deepStrictEqual, ok} = require('node:assert');

const {exec} = require('child_process');
const axios = require('axios');

const jobUrlPattern = /https:\/\/app\.saucelabs\.com\/tests\/([0-9a-f]{32})/g
const specFile = 'todo.cy.js';

let hasError;
let output;

describe('report tests to Sauce', async () => {
  before(async () => {
    if (!process.env.SAUCE_USERNAME || !process.env.SAUCE_ACCESS_KEY) {
      throw new Error('Please set SAUCE_USERNAME and SAUCE_ACCESS_KEY env variables');
    }

    const cypressRunCommand = `npx cypress run cypress/e2e/1-getting-started/${specFile}`;
    const execOpts = {
      cwd: __dirname,
      env: process.env,
    };

    const p = new Promise((resolve) => {
      exec(cypressRunCommand, execOpts, async function (err, stdout, stderr) {
        console.log('err: ', err)
        console.log('stdout: ', stdout)
        console.log('stderr: ', stderr)
        hasError = err;
        output = stdout;
        resolve();
      });
    });
    await p;
  });

  it('finished without error', () => {
    strictEqual(hasError, null);
  });

  it('has job link', () => {
    const jobs = {};
    const jobIDs = output.match(jobUrlPattern);

    for (const job of jobIDs) {
      const idx = job.slice(job.lastIndexOf('/') + 1);
      jobs[idx] = (jobs[idx] || 0) + 1
    }
    strictEqual(Object.keys(jobs).length, 1);
    for (const idx of Object.keys(jobs)) {
      strictEqual(jobs[idx], 2);
    }
  });

  it('has video.mp4/console.log attached', async () => {
    let jobId = output.match(jobUrlPattern)[0];
    jobId = jobId.slice(jobId.lastIndexOf('/') + 1);

    const url = `https://api.us-west-1.saucelabs.com/rest/v1/jobs/${jobId}/assets`;
    const response = await axios.get(url, {
      auth: {
        username: process.env.SAUCE_USERNAME,
        password: process.env.SAUCE_ACCESS_KEY,
      }
    });
    const assets = response.data;
    strictEqual(assets['console.log'], 'console.log');
    strictEqual(assets['video.mp4'], 'video.mp4');
    strictEqual(assets.video, 'video.mp4');
  });

  it('has expected metadata', async () => {
    const expected = {
      build: "Cypress Kitchensink Example",
      tags: [
        "plugin",
        "kitchensink",
        "cypress"
      ],
    }
    let jobId = output.match(jobUrlPattern)[0];
    jobId = jobId.slice(jobId.lastIndexOf('/') + 1);

    const url = `https://api.us-west-1.saucelabs.com/rest/v1/jobs/${jobId}`;
    const response = await axios.get(url, {
      auth: {
        username: process.env.SAUCE_USERNAME,
        password: process.env.SAUCE_ACCESS_KEY,
      }
    });
    const jobDetails = response.data;

    strictEqual(jobDetails.passed, true);
    deepStrictEqual(jobDetails.tags.sort(), expected.tags.sort(), 'tags are not set correctly');
    strictEqual(jobDetails.name, `${expected.build} - ${specFile}`, 'name is not set correctly');
  });
});
