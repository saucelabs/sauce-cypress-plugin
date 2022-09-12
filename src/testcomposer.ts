import axios, {AxiosRequestConfig} from "axios";
import {Region} from "./region";
import FormData from "form-data";
import * as stream from "stream";

const apiURLMap = new Map<Region, string>([
    [Region.USWest1, 'https://api.us-west-1.saucelabs.com/v1/testcomposer'],
    [Region.EUCentral1, 'https://api.eu-central-1.saucelabs.com/v1/testcomposer'],
    [Region.Staging, 'https://api.staging.saucelabs.net/v1/testcomposer']
  ]
);

const appURLMap = new Map<Region, string>([
    [Region.USWest1, 'https://app.saucelabs.com'],
    [Region.EUCentral1, 'https://app.eu-central-1.saucelabs.com'],
    [Region.Staging, 'https://api.staging.saucelabs.net']
  ]
);

export interface Options {
  region: Region
  username: string
  accessKey: string
  headers?: Record<string, string | number | boolean>
}

export interface CreateReportRequest {
  name: string
  browserName: string
  browserVersion: string
  platformName: string
  framework: string
  frameworkVersion: string
  passed: boolean
  startTime: string
  endTime: string
  build: string
  tags: string[]
}

interface CreateReportResponse {
  ID: string
}

export interface Asset {
  filename: string
  data: stream.Readable
}

export interface UploadAssetResponse {
  uploaded: string[]
  errors: string[]
}

export class TestComposer {
  private readonly opts: Options
  private readonly requestConfig: AxiosRequestConfig

  private readonly url: string

  constructor(opts: Options) {
    this.opts = opts;
    this.url = apiURLMap.get(opts.region) || Region.USWest1;
    this.requestConfig = {auth: {username: this.opts.username, password: this.opts.accessKey}, headers: opts.headers};
  }

  async createReport(req: CreateReportRequest) {
    const resp = await axios.post(this.url + '/reports', req, this.requestConfig);

    // TODO error handling (non 201 response codes)

    const id = (resp.data as CreateReportResponse).ID;
    return {id: id, url: appURLMap.get(this.opts.region) + '/tests/' + id};
  }

  async uploadAssets(jobId: string, assets: Asset[]) {
    const form = new FormData();
    for (const asset of assets) {
      form.append('file', asset.data, {filename: asset.filename});
    }

    const resp = await axios.put(this.url + `/jobs/${jobId}/assets`, form, this.requestConfig);

    // TODO error handling (non 200 response codes)

    return resp.data as UploadAssetResponse;
  }
}
