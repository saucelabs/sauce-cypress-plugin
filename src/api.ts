import * as util from 'util';
import axios, {AxiosInstance, isAxiosError} from 'axios';
import Debug from './debug';

const debug = Debug('api');

// The Sauce Labs region.
export type Region = 'us-west-1' | 'eu-central-1' | 'us-east-4' | 'staging';

const apiURLMap = new Map<Region, string>([
    ['us-west-1', 'https://api.us-west-1.saucelabs.com'],
    ['us-east-4', 'https://api.us-east-4.saucelabs.com'],
    ['eu-central-1', 'https://api.eu-central-1.saucelabs.com'],
    ['staging', 'https://api.staging.saucelabs.net']
  ]
);

interface CI {
  ref_name?: string;
  commit_sha?: string;
  repository?: string;
  branch?: string;
}

interface SauceJob {
  id?: string;
  name?: string;
}

export interface TestRunError {
  message?: string;
  path?: string;
  line?: number;
}

// ISO_8601 (YYYY-MM-DDTHH:mm:ss.sssZ)
type ISODate = string;

export interface TestRunRequestBody {
  name: string;
  start_time: ISODate;
  end_time: ISODate;
  duration: number;

  user_id?: string;
  team_id?: string;
  group_id?: string;
  author_id?: string;
  path_name?: string;
  build_id?: string;
  build_name?: string;
  creation_time?: ISODate;
  browser?: string;
  os?: string;
  app_name?: string;
  status?: 'passed' | 'failed' | 'skipped';
  platform?: 'vdc' | 'rdc' | 'api' | 'other';
  type?: 'web' | 'mobile' | 'api' | 'other';
  framework?: string;
  ci?: CI;
  sauce_job?: SauceJob;
  errors?: TestRunError[];
  tags?: string[];
}

interface HTTPValidationError {
  detail: { loc: string | number, msg: string, type: string }
}

export class TestRuns {
  private api: AxiosInstance;

  constructor(opts: { username: string, accessKey: string, region: Region}) {
    this.api = axios.create({
      auth: {
        username: opts.username,
        password: opts.accessKey,
      },
      baseURL: apiURLMap.get(opts.region),
    });
  }

  async create(testRuns: TestRunRequestBody[]) {
    try {
      debug('Submitting test run to test-runs api', testRuns);
      await this.api.post<void>('/test-runs/v1/', {
        test_runs: testRuns,
      });
    } catch (e: unknown) {
      if (isAxiosError(e)) {
        let data;
        switch (e.response?.status) {
          case 422:
            data = e.response?.data as HTTPValidationError;
            debug('Failed to report test run data', util.inspect(data, { depth: null}));
            break;
          default:
            debug('Unexpected http error while reporting test run data: %s', e.message);
        }
      } else {
        debug('Unexpected error while reporting test run data', e);
      }
    }
  }
}
