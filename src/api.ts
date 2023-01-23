import axios, { AxiosInstance } from 'axios';

// The Sauce Labs region.
export type Region = 'us-west-1' | 'eu-central-1' | 'staging';

const apiURLMap = new Map<Region, string>([
    ['us-west-1', 'https://api.us-west-1.saucelabs.com'],
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
  id: string;
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
  tags?: { title: string }[];
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

  async create(testRuns: { test_runs: TestRunRequestBody[] }) {
    await this.api.post<void>('/test-runs/v1/', testRuns);
  }
}
