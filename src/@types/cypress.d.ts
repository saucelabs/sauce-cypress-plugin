// The official Cypress types are not always accurate, so we need to extend them.
// See https://github.com/cypress-io/cypress/issues/23805 for more information.
//
/// <reference path="../../node_modules/cypress/types/cypress-npm-api.d.ts"/>
declare namespace cypress {
  import ms = CypressCommandLine.ms;
  import dateTimeISO = CypressCommandLine.dateTimeISO;
  import HookInformation = CypressCommandLine.HookInformation;
  import pixels = CypressCommandLine.pixels;

  interface CypressRunResult {
    status: 'finished'
    startedTestsAt: dateTimeISO
    endedTestsAt: dateTimeISO
    totalDuration: ms
    totalSuites: number
    totalTests: number
    totalFailed: number
    totalPassed: number
    totalPending: number
    totalSkipped: number
    /**
     * If Cypress test run is being recorded, full url will be provided.
     * @see https://on.cypress.io/dashboard-introduction
     */
    runUrl?: string
    runs: RunResult[]
    browserPath: string
    browserName: string
    browserVersion: string
    osName: string
    osVersion: string
    cypressVersion: string
    config: Cypress.ResolvedConfigOptions
  }

  interface RunResult {
    screenshots: ScreenshotInformation[]

    stats: {
      suites: number
      tests: number
      passes: number
      pending: number
      skipped: number
      failures: number
      startedAt?: dateTimeISO
      endedAt?: dateTimeISO
      duration?: ms
      wallClockStartedAt?: dateTimeISO
      wallClockEndedAt?: dateTimeISO
      wallClockDuration?: ms
    }

    /**
     * Reporter name like "spec"
     */
    reporter: string
    /**
     * This is controlled by the reporter, and Cypress cannot guarantee
     * the properties. Usually this object has suites, tests, passes, etc
     */
    reporterStats: object
    hooks: HookInformation[]
    tests: TestResult[]
    error: string | null
    video: string | null
    /**
     * information about the spec test file.
     */
    spec: {
      /**
       * filename like "spec.js"
       */
      name: string
      /**
       * name relative to the project root, like "cypress/integration/spec.js"
       */
      relative: string
      /**
       * resolved filename of the spec
       */
      absolute: string
      relativeToCommonRoot: string
    }
    shouldUploadVideo: boolean
    skippedSpec: boolean
  }

  interface TestResult {
    testId: string
    title: string[]
    state: string
    body: string
    displayError: string | null
    attempts: AttemptResult[]
  }

  interface TestError {
    name: string
    message: string
    stack: string
    codeFrame?: { line: number, column: number, frame: string, originalFile?: string };
  }

  interface AttemptResult {
    state: string
    error: TestError | null
    wallClockStartedAt?: dateTimeISO
    wallClockDuration?: ms
    startedAt?: dateTimeISO
    duration?: ms
    videoTimestamp: ms
    screenshots?: ScreenshotInformation[]
  }

  interface ScreenshotInformation {
    screenshotId: string
    name: string
    testId: string
    takenAt: dateTimeISO
    /**
     * Absolute path to the saved image
     */
    path: string
    height: pixels
    width: pixels
  }
}
