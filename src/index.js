const fs = require('fs');
const reporter = require('./reporter');

let reporterInstance;
let perSpecReport;

const onBeforeRun = function (details) {
  reporterInstance = new reporter(details);
  perSpecReport = details && details.config.sauce && details.config.sauce.report == 'spec';
};

const onAfterRun = async function (results) {
  if (!process.env.SAUCE_USERNAME || !process.env.SAUCE_ACCESS_KEY) {
    return;
  }
  if (perSpecReport) {
    return
  }
  await reporterInstance.reportRun(results);
}

const onAfterSpec = async function (spec, results) {
  if (!process.env.SAUCE_USERNAME || !process.env.SAUCE_ACCESS_KEY) {
    return;
  }
  if (!perSpecReport) {
    return
  }
  await reporterInstance.reportSpec(results);
}

module.exports = function (on, config) {
  on('before:run', onBeforeRun);
  on('after:run', onAfterRun);
  on('after:spec', onAfterSpec);
  return config;
}
