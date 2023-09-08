require('jest');

const {exec} = require('child_process');
const axios = require('axios');

const jobUrlPattern = /https:\/\/app\.saucelabs\.com\/tests\/([0-9a-f]{32})/g
const specFile = 'todo.cy.js';

let hasError;
let output;

describe('report tests to Sauce', function () {
  beforeAll(async function () {
    if (!process.env.SAUCE_USERNAME || !process.env.SAUCE_ACCESS_KEY) {
      throw new Error('Please set SAUCE_USERNAME and SAUCE_ACCESS_KEY env variables');
    }

    const cypressRunCommand = `cypress run cypress/e2e/1-getting-started/${specFile}`;
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

  test('cypress execution passed', function () {
    expect(hasError).toBeNull();
  });

  test('jobs link is displayed', function () {
    const jobs = {};
    const jobIDs = output.match(jobUrlPattern);

    for (const job of jobIDs) {
      const idx = job.slice(job.lastIndexOf('/')+1);
      jobs[idx] = (jobs[idx] || 0) + 1
    }
    expect(Object.keys(jobs).length).toBe(1);
    for (const idx of Object.keys(jobs)) {
      expect(jobs[idx]).toBe(2);
    }
  });

  test('job has video.mp4/console.log attached', async function () {
    let jobId = output.match(jobUrlPattern)[0];
    jobId = jobId.slice(jobId.lastIndexOf('/')+1);

    const url = `https://api.us-west-1.saucelabs.com/rest/v1/jobs/${jobId}/assets`;
    const response = await axios.get(url, {
      auth: {
        username: process.env.SAUCE_USERNAME,
        password: process.env.SAUCE_ACCESS_KEY,
      }
    });
    const assets = response.data;
    expect(assets['console.log']).toBe('console.log');
    expect(assets['video.mp4']).toBe('video.mp4');
    expect(assets.video).toBe('video.mp4');
  });

  test('job has name/tags correctly set', async function () {
    const cypressConfig = {
      sauce: {
        build: "Cypress Kitchensink Example",
        tags: [
          "plugin",
          "kitchensink",
          "cypress"
        ],
        region: "us-west-1",
      }
    }
    let jobId = output.match(jobUrlPattern)[0];
    jobId = jobId.slice(jobId.lastIndexOf('/')+1);

    const url = `https://api.us-west-1.saucelabs.com/rest/v1/jobs/${jobId}`;
    const response = await axios.get(url, {
      auth: {
        username: process.env.SAUCE_USERNAME,
        password: process.env.SAUCE_ACCESS_KEY,
      }
    });
    const jobDetails = response.data;
    expect(jobDetails.passed).toBe(true);
    expect(jobDetails.tags.sort()).toEqual(cypressConfig.sauce.tags.sort());
    expect(jobDetails.name).toBe(`${cypressConfig.sauce.build} - ${specFile}`);
  });
});
